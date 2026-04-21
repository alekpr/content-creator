import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { Storyboard, VoiceoverConfig, VoiceoverDirectorNotes, VoiceoverResult, VoiceoverSceneConfig, VoiceoverSceneTiming, VoiceoverStageConfig } from '@content-creator/shared';

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);

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
  return {
    script: scenes.map(s => s.narration).join('\n\n'),
    voice: resolvedVoice as import('@content-creator/shared').Voice,
    speed: 1.0,
    language,
    scenes,
    directorNotes: stageConfig?.directorNotes,
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

  const ratio = actualSecs / targetSecs;

  if (ratio <= 1.10) {
    // ≤10% faster — gentle atempo, speech quality preserved
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .audioFilters(`atempo=${ratio.toFixed(6)}`)
        .duration(targetSecs)
        .output(output)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`fitAudio atempo error: ${err.message}`)))
        .run();
    });
    return targetSecs;
  }

  // ratio > 1.10 — keep natural speech, video will stretch instead
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
  const lines: string[] = ['### DIRECTOR\'S NOTES'];
  if (directorNotes.style)  lines.push(`Style: ${directorNotes.style}`);
  if (directorNotes.pacing) lines.push(`Pacing: ${directorNotes.pacing}`);
  if (directorNotes.accent) lines.push(`Accent: ${directorNotes.accent}`);
  lines.push('', '### TRANSCRIPT', narration);
  return lines.join('\n');
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
  model = 'gemini-2.5-flash-preview-tts'
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
  const intermediateFiles: string[] = [];
  const sceneTimings: VoiceoverSceneTiming[] = [];

  try {
    // Generate TTS per scene and fit to target duration
    for (let i = 0; i < config.scenes.length; i++) {
      const scene = config.scenes[i];
      onProgress(`Generating voiceover for scene ${scene.sceneId} (${i + 1}/${config.scenes.length})...`);

      const rawFile = path.join(audioDir, `voiceover_scene_${scene.sceneId}_v${versionNumber}_raw.wav`);
      const fittedFile = path.join(audioDir, `voiceover_scene_${scene.sceneId}_v${versionNumber}_fitted.wav`);
      intermediateFiles.push(rawFile, fittedFile);

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
      'stages.voiceover.result': { audioPath, filename, previewUrl, durationSeconds: totalAudioDuration, sceneTimings },
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
    return { audioPath, filename, previewUrl, durationSeconds: totalAudioDuration, sceneTimings };

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
