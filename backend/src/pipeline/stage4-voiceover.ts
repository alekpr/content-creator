import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { Storyboard, VoiceoverConfig, VoiceoverDirectorNotes, VoiceoverResult, VoiceoverSceneAudio, VoiceoverSceneConfig, VoiceoverSceneTiming, VoiceoverStageConfig } from '@content-creator/shared';

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);

function sanitizeDirectorNoteText(text?: string): string {
  if (!text) return '';

  const cleaned = text
    // Strip quoted script fragments that may be spoken literally by TTS.
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/‘[^’]*’/g, ' ')
    .replace(/「[^」]*」/g, ' ')
    .replace(/『[^』]*』/g, ' ')
    // Normalize phrase-specific pause directives into generic transition cues.
    .replace(/(pause[^.\n]{0,80}?before)\s+[^.;,\n]{1,120}/gi, '$1 key transition')
    .replace(/(หยุด[^.\n]{0,80}?ก่อน)\s+[^.;,\n]{1,120}/gi, '$1 ช่วงเปลี่ยนฉากสำคัญ')
    // Remove explicit scene references from global direction notes.
    .replace(/\bscene\s*\d+\b/gi, 'scene')
    .replace(/\bฉาก\s*\d+\b/g, 'ฉาก')
    .replace(/\s+/g, ' ')
    .trim();

  // Keep control text short to avoid instruction drift in TTS models.
  return cleaned.slice(0, 220);
}

function sanitizeDirectorNotes(notes?: VoiceoverDirectorNotes): VoiceoverDirectorNotes | undefined {
  if (!notes) return undefined;
  const sanitized: VoiceoverDirectorNotes = {
    style: sanitizeDirectorNoteText(notes.style),
    pacing: sanitizeDirectorNoteText(notes.pacing),
    accent: sanitizeDirectorNoteText(notes.accent),
  };
  if (!sanitized.style && !sanitized.pacing && !sanitized.accent) return undefined;
  return sanitized;
}

/** Convert DirectorsBriefVoiceover → VoiceoverDirectorNotes for buildTtsPrompt */
function briefToDirectorNotes(brief: NonNullable<Storyboard['directorsBrief']>['voiceover']): VoiceoverDirectorNotes {
  return sanitizeDirectorNotes({
    style: [brief.narratorPersona, brief.emotionalArc, brief.deliveryStyle].filter(Boolean).join('. '),
    pacing: brief.pacing,
    accent: brief.accent,
  }) ?? { style: '', pacing: '', accent: '' };
}

// ─── Script Builder ───────────────────────────────────────────────────────────

export function buildVoiceoverScript(
  storyboard: Storyboard,
  voice: string,
  language: import('@content-creator/shared').Language = 'th',
  stageConfig?: VoiceoverStageConfig,
): VoiceoverConfig {
  // Voice selection priority:
  // 1. User override (stageConfig.voice) — highest priority
  // 2. AI recommendation from storyboard (directorsBrief.voiceover.recommendedVoice)
  // 3. Project default voice — fallback
  const resolvedVoice = stageConfig?.voice 
    ?? storyboard.directorsBrief?.voiceover.recommendedVoice 
    ?? voice;
  
  const scenes: VoiceoverSceneConfig[] = storyboard.scenes.map(s => ({
    sceneId: s.id,
    narration: stageConfig?.sceneNarrations?.[String(s.id)] ?? s.narration,
    targetDurationSeconds: s.duration,
  }));

  // Auto-use Director's Brief voiceover notes when user hasn't set custom notes
  const hasCustomNotes = stageConfig?.directorNotes &&
    (stageConfig.directorNotes.style || stageConfig.directorNotes.pacing || stageConfig.directorNotes.accent);
  const autoNotes = !hasCustomNotes && storyboard.directorsBrief
    ? briefToDirectorNotes(storyboard.directorsBrief.voiceover)
    : sanitizeDirectorNotes(stageConfig?.directorNotes);

  return {
    script: scenes.map(s => s.narration).join('\n\n'),
    voice: resolvedVoice as import('@content-creator/shared').Voice,
    speed: 1.0,
    language,
    scenes,
    directorNotes: autoNotes,
  };
}

// ─── FFmpeg Audio Helpers ─────────────────────────────────────────────────────

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration ?? 0);
    });
  });
}

/**
 * Fit a raw TTS audio clip to its scene target duration.
 *
 * Strategy:
 *  - audio < target        : pad silence to fill → returns targetSecs
 *  - ratio 1.00–1.10       : gentle atempo (≤10% speedup, barely perceptible) → returns targetSecs
 *  - ratio > 1.10          : keep natural speech, DO NOT speed up → returns actual audioDuration
 *                            (assembly stage will freeze the video's last frame to match)
 *
 * Returns the actual duration of the output file.
 */
async function fitAudio(
  input: string,
  output: string,
  targetSecs: number,
): Promise<number> {
  const actualSecs = await getAudioDuration(input).catch(() => 0);

  if (actualSecs <= 0) {
    fs.copyFileSync(input, output);
    return targetSecs;
  }

  if (actualSecs <= targetSecs) {
    // Audio fits or is shorter — pad silence at the end
    if (Math.abs(actualSecs - targetSecs) < 0.05) {
      // Close enough — just copy
      fs.copyFileSync(input, output);
    } else {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(input)
          .audioFilters(`apad=pad_dur=${(targetSecs - actualSecs).toFixed(3)}`)
          .duration(targetSecs)
          .output(output)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(new Error(`fitAudio pad error: ${err.message}`)))
          .run();
      });
    }
    return targetSecs;
  }

  // Never speed up speech — always keep natural pace for best clarity.
  // The assembly stage will extend the video's last frame to match longer audio.
  fs.copyFileSync(input, output);
  return actualSecs;
}

function concatAudioFiles(inputs: string[], output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (inputs.length === 1) {
      fs.copyFileSync(inputs[0], output);
      return resolve();
    }

    const cmd = ffmpeg();
    inputs.forEach(f => cmd.input(f));

    const inputLabels = inputs.map((_, i) => `[${i}:a]`).join('');
    cmd
      .complexFilter([`${inputLabels}concat=n=${inputs.length}:v=0:a=1[aout]`])
      .outputOptions(['-map [aout]'])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`concatAudio error: ${err.message}`)))
      .run();
  });
}

// ─── PCM → WAV ────────────────────────────────────────────────────────────────

function pcmToWav(pcmBase64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function decodeTtsAudioToWavBuffer(audioBase64: string, mimeType: string): Buffer {
  const normalizedMime = mimeType.toLowerCase();

  // Gemini TTS may return MP3, WAV, or raw PCM depending on model/version.
  if (normalizedMime.includes('mp3') || normalizedMime.includes('mpeg')) {
    return Buffer.from(audioBase64, 'base64');
  }
  if (normalizedMime.includes('wav') || normalizedMime.includes('wave')) {
    return Buffer.from(audioBase64, 'base64');
  }
  // Fallback: treat as PCM and wrap in WAV header.
  return pcmToWav(audioBase64);
}

function toVerificationAudio(audioBase64: string, mimeType: string): { mimeType: string; data: string } {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes('mp3') || normalizedMime.includes('mpeg')) {
    return { mimeType: 'audio/mp3', data: audioBase64 };
  }
  if (normalizedMime.includes('wav') || normalizedMime.includes('wave')) {
    return { mimeType: 'audio/wav', data: audioBase64 };
  }
  return { mimeType: 'audio/wav', data: pcmToWav(audioBase64).toString('base64') };
}

function shouldUseStrictSceneCompliance(model: string): boolean {
  return model.includes('gemini-3.1-flash-tts-preview');
}

async function verifySceneNarrationCompliance(
  sceneId: number,
  language: import('@content-creator/shared').Language,
  expectedNarration: string,
  audioBase64: string,
  mimeType: string,
): Promise<{ pass: boolean; reason: string }> {
  const verificationAudio = toVerificationAudio(audioBase64, mimeType);
  const checkPrompt = [
    'You are an audio QA checker for TTS scene compliance.',
    `Scene ID: ${sceneId}`,
    `Language: ${language}`,
    'Task: Compare the expected script and the audio narration.',
    'Pass ONLY if the audio speaks the expected script for this scene and does not include added content from other scenes.',
    'Allow minor pronunciation differences and tiny filler words only.',
    'Return JSON only: {"pass": boolean, "reason": string}',
    '',
    'EXPECTED SCRIPT:',
    expectedNarration,
  ].join('\n');

  const verifyResp = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [
        { text: checkPrompt },
        { inlineData: { mimeType: verificationAudio.mimeType, data: verificationAudio.data } },
      ],
    }],
    config: { responseMimeType: 'application/json' },
  });

  const raw = verifyResp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!raw) return { pass: false, reason: 'empty verification response' };

  try {
    const parsed = JSON.parse(raw) as { pass?: boolean; reason?: string };
    return {
      pass: parsed.pass === true,
      reason: parsed.reason?.trim() || (parsed.pass ? 'pass' : 'failed'),
    };
  } catch {
    const upper = raw.toUpperCase();
    if (upper.includes('"PASS":TRUE') || upper.includes('PASS')) {
      return { pass: true, reason: raw };
    }
    return { pass: false, reason: raw };
  }
}

// ─── TTS for a single scene ───────────────────────────────────────────────────

function buildTtsPrompt(
  sceneId: number,
  narration: string,
  directorNotes?: VoiceoverDirectorNotes,
  strictness = 1,
): string {
  const trimmedNarration = narration.trim();
  const safeNotes = sanitizeDirectorNotes(directorNotes);

  // Keep direction concise — long control text can reduce TTS compliance.
  const noteParts: string[] = [];
  if (safeNotes?.style) noteParts.push(safeNotes.style);
  if (safeNotes?.pacing) noteParts.push(`Pacing: ${safeNotes.pacing}`);
  if (safeNotes?.accent) noteParts.push(`Accent: ${safeNotes.accent}`);

  const direction = noteParts.length > 0
    ? noteParts.join('. ')
    : 'Neutral, clear narration with stable tone and pacing.';

  return [
    'You are a TTS narrator for a short-form video pipeline.',
    `Current scene: ${sceneId}`,
    'Rules:',
    '1) Speak ONLY the exact text inside <narration>.',
    '2) Do NOT add, paraphrase, continue, summarize, or merge content from any other scene.',
    '3) Keep vocal identity, pacing, and tone consistent with the provided direction.',
    '4) Do NOT speak XML tags or metadata.',
    ...(strictness > 1
      ? ['5) If uncertain, prioritize verbatim reading of <narration> over any stylistic interpretation.']
      : []),
    '<voice_direction>',
    direction,
    '</voice_direction>',
    '<narration>',
    trimmedNarration,
    '</narration>',
  ].join('\n');
}

async function generateSceneAudio(
  sceneId: number,
  narration: string,
  voiceName: string,
  model: string,
  language: import('@content-creator/shared').Language,
  directorNotes?: VoiceoverDirectorNotes,
): Promise<{ audioBase64: string; mimeType: string; tokens: number }> {
  const strictCompliance = shouldUseStrictSceneCompliance(model);
  const maxAttempts = strictCompliance ? 3 : 1;
  let totalTokens = 0;
  let lastFailureReason = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildTtsPrompt(sceneId, narration, directorNotes, attempt);
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    totalTokens += response.usageMetadata?.totalTokenCount ?? 0;

    const audioPart = response.candidates?.[0]?.content?.parts?.find(
      p => p.inlineData?.mimeType?.startsWith('audio/')
    );
    const inlineData = audioPart?.inlineData;
    if (!inlineData?.data) throw new Error('Empty audio response from Gemini TTS');

    if (!strictCompliance) {
      return {
        audioBase64: inlineData.data,
        mimeType: inlineData.mimeType ?? '',
        tokens: totalTokens,
      };
    }

    const compliance = await verifySceneNarrationCompliance(
      sceneId,
      language,
      narration,
      inlineData.data,
      inlineData.mimeType ?? '',
    ).catch(() => ({ pass: false, reason: 'verification request failed' }));

    if (compliance.pass) {
      return {
        audioBase64: inlineData.data,
        mimeType: inlineData.mimeType ?? '',
        tokens: totalTokens,
      };
    }

    lastFailureReason = compliance.reason;
  }

  throw new Error(
    `Scene ${sceneId} TTS failed strict script compliance after ${maxAttempts} attempts` +
    (lastFailureReason ? `: ${lastFailureReason}` : '')
  );
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function generateVoiceover(
  projectId: string,
  config: VoiceoverConfig,
  onProgress: (msg: string) => void,
  model = 'gemini-2.5-pro-preview-tts'
): Promise<VoiceoverResult> {
  const startTime = Date.now();

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.voiceover.attempts?.length ?? 0) + 1;
  const existingVoiceVersions = ((project.stages.voiceover.sceneVersions ?? {}) as Record<string, string[]>)['0'] ?? [];
  const versionNumber = existingVoiceVersions.length + 1;
  const voiceName = config.voice;

  const audioDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(audioDir);

  let totalTokens = 0;
  const fittedFiles: string[] = [];
  const intermediateFiles: string[] = [];  // only raw/temp files — fitted files are KEPT
  const sceneTimings: VoiceoverSceneTiming[] = [];
  const sceneAudio: Record<string, VoiceoverSceneAudio> = {};

  try {
    // Generate TTS per scene and fit to target duration
    for (let i = 0; i < config.scenes.length; i++) {
      const scene = config.scenes[i];
      onProgress(`Generating voiceover for scene ${scene.sceneId} (${i + 1}/${config.scenes.length})...`);

      // Raw file is temporary; fitted "current" file is kept for per-scene regen later
      const rawFile = path.join(audioDir, `voiceover_scene_${scene.sceneId}_raw.wav`);
      const fittedFile = path.join(audioDir, `voiceover_scene_${scene.sceneId}_current.wav`);
      intermediateFiles.push(rawFile);  // only raw is cleaned up

      // Call TTS
      const { audioBase64, mimeType, tokens } = await generateSceneAudio(
        scene.sceneId,
        scene.narration,
        voiceName,
        model,
        config.language,
        config.directorNotes,
      );
      totalTokens += tokens;

      // Decode → WAV
      const wavBuffer = decodeTtsAudioToWavBuffer(audioBase64, mimeType);
      fs.writeFileSync(rawFile, wavBuffer);

      // Fit to target duration — returns actual output duration
      // (may exceed targetDuration if narration is too long; video will stretch instead)
      const actualAudioDuration = await fitAudio(rawFile, fittedFile, scene.targetDurationSeconds);
      fittedFiles.push(fittedFile);

      sceneTimings.push({
        sceneId: scene.sceneId,
        audioDuration: actualAudioDuration,
        videoDuration: scene.targetDurationSeconds,
      });

      // Track per-scene audio for individual preview + regen
      const sceneFilename = `voiceover_scene_${scene.sceneId}_current.wav`;
      sceneAudio[String(scene.sceneId)] = {
        filename: sceneFilename,
        previewUrl: `/api/files/${projectId}/${sceneFilename}`,
        durationSeconds: actualAudioDuration,
        narrationUsed: scene.narration,
      };

      if (actualAudioDuration > scene.targetDurationSeconds + 0.1) {
        onProgress(
          `Scene ${scene.sceneId}: narration is ${actualAudioDuration.toFixed(1)}s ` +
          `(scene is ${scene.targetDurationSeconds}s) — video will hold last frame to match audio.`
        );
      }
    }

    onProgress('Assembling voiceover tracks...');

    // Concat all fitted per-scene clips
    const filename = `voiceover_v${versionNumber}.wav`;
    const audioPath = path.join(audioDir, filename);
    await concatAudioFiles(fittedFiles, audioPath);

    // Clean up intermediate files
    for (const f of intermediateFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    const durationMs = Date.now() - startTime;
    const costUSD = 0.001 * config.scenes.length;
    const previewUrl = `/api/files/${projectId}/${filename}`;
    const totalAudioDuration = sceneTimings.reduce((s, t) => s + t.audioDuration, 0);

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.voiceover.status': 'review',
      'stages.voiceover.result': { audioPath, filename, previewUrl, durationSeconds: totalAudioDuration, sceneTimings, sceneAudio },
      'stages.voiceover.reviewData': { previewUrl },
      'stages.voiceover.sceneVersions': {
        ...((project.stages.voiceover.sceneVersions ?? {}) as Record<string, string[]>),
        '0': [...existingVoiceVersions, filename],
      },
      $push: {
        'stages.voiceover.attempts': {
          attemptNumber,
          promptUsed: config.script,
          outputPaths: [audioPath],
          costUSD,
          totalTokens,
          durationMs,
          createdAt: new Date(),
        },
      },
      $inc: { costUSD },
    });

    await GenerationLogModel.create({
      projectId,
      stageKey: 'voiceover',
      attemptNumber,
      promptUsed: config.script,
      modelUsed: model,
      configUsed: { voiceName, speed: config.speed },
      status: 'success',
      outputPaths: [audioPath],
      durationMs,
      costUSD,
      totalTokens,
    });

    onProgress('Voiceover ready');
    return { audioPath, filename, previewUrl, durationSeconds: totalAudioDuration, sceneTimings, sceneAudio };

  } catch (err) {
    // Clean up any partial intermediate files on failure
    for (const f of intermediateFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const message = err instanceof Error ? err.message : String(err);
    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.voiceover.status': 'failed',
      'stages.voiceover.error': message,
    });
    throw err;
  }
}

// ─── Regenerate a single scene's voiceover ────────────────────────────────────

export async function regenerateSingleSceneVoiceover(
  projectId: string,
  sceneId: number,
  onProgress: (msg: string) => void,
  model = 'gemini-2.5-pro-preview-tts',
): Promise<VoiceoverResult> {
  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const storyboard = project.stages.storyboard.result as Storyboard | undefined;
  if (!storyboard) throw new Error('Storyboard not approved yet');

  const stageConfig = (project.stages.voiceover.stageConfig ?? {}) as VoiceoverStageConfig;
  const voiceName = stageConfig.voice ?? project.input.voice;
  const narration = stageConfig.sceneNarrations?.[String(sceneId)]
    ?? storyboard.scenes.find(s => s.id === sceneId)?.narration
    ?? '';
  if (!narration) throw new Error(`No narration found for scene ${sceneId}`);

  const targetScene = storyboard.scenes.find(s => s.id === sceneId);
  if (!targetScene) throw new Error(`Scene ${sceneId} not in storyboard`);

  const audioDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(audioDir);

  const rawFile = path.join(audioDir, `voiceover_scene_${sceneId}_raw.wav`);
  const fittedFile = path.join(audioDir, `voiceover_scene_${sceneId}_current.wav`);

  onProgress(`Generating voiceover for scene ${sceneId}...`);

  try {
    // Generate TTS for this single scene
    const { audioBase64, mimeType, tokens: _ } = await generateSceneAudio(
      sceneId,
      narration,
      voiceName,
      model,
      project.input.language,
      stageConfig.directorNotes,
    );
    const wavBuffer = decodeTtsAudioToWavBuffer(audioBase64, mimeType);
    fs.writeFileSync(rawFile, wavBuffer);

    const actualAudioDuration = await fitAudio(rawFile, fittedFile, targetScene.duration);
    if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);

    onProgress(`Scene ${sceneId} done — re-assembling full voiceover...`);

    // Get existing result + sceneAudio map from DB
    const existingResult = (project.stages.voiceover.result ?? {}) as VoiceoverResult;
    const existingSceneAudio = { ...(existingResult.sceneAudio ?? {}) };
    const existingTimings = [...(existingResult.sceneTimings ?? [])];

    // Update this scene's entry
    existingSceneAudio[String(sceneId)] = {
      filename: `voiceover_scene_${sceneId}_current.wav`,
      previewUrl: `/api/files/${projectId}/voiceover_scene_${sceneId}_current.wav`,
      durationSeconds: actualAudioDuration,
      narrationUsed: narration,
    };

    // Update timing for this scene
    const timingIdx = existingTimings.findIndex(t => t.sceneId === sceneId);
    const newTiming: VoiceoverSceneTiming = {
      sceneId,
      audioDuration: actualAudioDuration,
      videoDuration: targetScene.duration,
    };
    if (timingIdx >= 0) existingTimings[timingIdx] = newTiming;
    else existingTimings.push(newTiming);

    // Re-concat all scene current files in storyboard order
    const allSceneIds = storyboard.scenes.map(s => s.id);
    const fittedFiles: string[] = [];
    for (const sid of allSceneIds) {
      const f = path.join(audioDir, `voiceover_scene_${sid}_current.wav`);
      if (!fs.existsSync(f)) throw new Error(`Missing current audio for scene ${sid} — please run full voiceover generation first`);
      fittedFiles.push(f);
    }

    const existingVersions = ((project.stages.voiceover.sceneVersions ?? {}) as Record<string, string[]>)['0'] ?? [];
    const versionNumber = existingVersions.length + 1;
    const filename = `voiceover_v${versionNumber}.wav`;
    const audioPath = path.join(audioDir, filename);
    await concatAudioFiles(fittedFiles, audioPath);

    const totalAudioDuration = existingTimings.reduce((s, t) => s + t.audioDuration, 0);
    const previewUrl = `/api/files/${projectId}/${filename}`;

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.voiceover.status': 'review',
      'stages.voiceover.result': {
        audioPath,
        filename,
        previewUrl,
        durationSeconds: totalAudioDuration,
        sceneTimings: existingTimings,
        sceneAudio: existingSceneAudio,
      },
      'stages.voiceover.reviewData': { previewUrl },
      'stages.voiceover.sceneVersions': {
        ...((project.stages.voiceover.sceneVersions ?? {}) as Record<string, string[]>),
        '0': [...existingVersions, filename],
      },
    });

    onProgress('Scene voiceover updated');
    return {
      audioPath, filename, previewUrl,
      durationSeconds: totalAudioDuration,
      sceneTimings: existingTimings,
      sceneAudio: existingSceneAudio,
    };
  } catch (err) {
    if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
    throw err;
  }
}
