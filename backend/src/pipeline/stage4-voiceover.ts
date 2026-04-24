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

/** Convert DirectorsBriefVoiceover → VoiceoverDirectorNotes for buildTtsPrompt */
function briefToDirectorNotes(brief: NonNullable<Storyboard['directorsBrief']>['voiceover']): VoiceoverDirectorNotes {
  return {
    style: [brief.narratorPersona, brief.emotionalArc, brief.deliveryStyle].filter(Boolean).join('. '),
    pacing: brief.pacing,
    accent: brief.accent,
  };
}

// ─── Script Builder ───────────────────────────────────────────────────────────

export function buildVoiceoverScript(
  storyboard: Storyboard,
  voice: string,
  language: import('@content-creator/shared').Language = 'th',
  stageConfig?: VoiceoverStageConfig,
): VoiceoverConfig {
  const resolvedVoice = stageConfig?.voice ?? voice;
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
    : stageConfig?.directorNotes;

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

// ─── TTS for a single scene ───────────────────────────────────────────────────

function buildTtsPrompt(narration: string, directorNotes?: VoiceoverDirectorNotes): string {
  if (!directorNotes || (!directorNotes.style && !directorNotes.pacing && !directorNotes.accent)) {
    return narration;
  }
  // Keep notes concise — long instructions confuse TTS and hurt clarity
  const noteParts: string[] = [];
  if (directorNotes.style)  noteParts.push(directorNotes.style);
  if (directorNotes.pacing) noteParts.push(`Pacing: ${directorNotes.pacing}`);
  if (directorNotes.accent) noteParts.push(`Accent: ${directorNotes.accent}`);
  const noteBlock = noteParts.join('. ');
  return `<voice_direction>${noteBlock}</voice_direction>\n\n${narration}`;
}

async function generateSceneAudio(
  narration: string,
  voiceName: string,
  model: string,
  directorNotes?: VoiceoverDirectorNotes,
): Promise<{ audioBase64: string; mimeType: string; tokens: number }> {
  const prompt = buildTtsPrompt(narration, directorNotes);
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

  const audioPart = response.candidates?.[0]?.content?.parts?.find(
    p => p.inlineData?.mimeType?.startsWith('audio/')
  );
  const inlineData = audioPart?.inlineData;
  if (!inlineData?.data) throw new Error('Empty audio response from Gemini TTS');

  return {
    audioBase64: inlineData.data,
    mimeType: inlineData.mimeType ?? '',
    tokens: response.usageMetadata?.totalTokenCount ?? 0,
  };
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
      const { audioBase64, mimeType, tokens } = await generateSceneAudio(scene.narration, voiceName, model, config.directorNotes);
      totalTokens += tokens;

      // Decode → WAV
      const isMp3 = mimeType.includes('mp3');
      const wavBuffer = isMp3
        ? Buffer.from(audioBase64, 'base64')
        : pcmToWav(audioBase64);
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
    const { audioBase64, mimeType, tokens: _ } = await generateSceneAudio(narration, voiceName, model, stageConfig.directorNotes);
    const isMp3 = mimeType.includes('mp3');
    const wavBuffer = isMp3 ? Buffer.from(audioBase64, 'base64') : pcmToWav(audioBase64);
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
