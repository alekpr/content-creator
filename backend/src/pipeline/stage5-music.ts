import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { MusicResult, VoiceoverResult } from '@content-creator/shared';

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);

const MUSIC_TAIL_SECONDS = 1.5;
const DURATION_EPSILON_SECONDS = 0.15;
const MUSIC_END_FADE_SECONDS = 0.6;

// ─── Service ──────────────────────────────────────────────────────────────────

export async function generateMusic(
  projectId: string,
  musicMood: string,
  onProgress: (msg: string) => void,
  model = 'lyria-3-clip-preview'
): Promise<MusicResult> {
  const startTime = Date.now();

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  // Use the latest voiceover duration as source of truth.
  const voiceoverResult = project.stages.voiceover.result as VoiceoverResult | undefined;
  const voiceoverDuration = voiceoverResult?.durationSeconds;
  if (!voiceoverDuration || voiceoverDuration <= 0) {
    throw new Error('Cannot generate music: latest voiceover duration is missing or invalid');
  }
  
  const targetMusicDuration = roundSeconds(voiceoverDuration + MUSIC_TAIL_SECONDS);

  const attemptNumber = (project.stages.music.attempts?.length ?? 0) + 1;
  const existingMusicVersions = ((project.stages.music.sceneVersions ?? {}) as Record<string, string[]>)['0'] ?? [];
  const versionNumber = existingMusicVersions.length + 1;

  onProgress(`Generating ${targetMusicDuration}s background music...`);

  let audioBase64: string;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            {
              text: `Background music: ${musicMood}. No lyrics. Loopable. ${targetMusicDuration} seconds.`,
            },
          ],
        },
      ],
      config: { responseModalities: ['AUDIO'] },
    });

    audioBase64 = response.candidates?.[0]?.content?.parts
      ?.find(p => p.inlineData?.mimeType?.startsWith('audio/'))
      ?.inlineData?.data ?? '';
    if (!audioBase64) throw new Error('Empty audio response from Lyria');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.music.status': 'failed',
      'stages.music.error': message,
    });
    throw err;
  }

  const audioDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(audioDir);
  const filename = `music_v${versionNumber}.mp3`;
  const musicPath = path.join(audioDir, filename);
  fs.writeFileSync(musicPath, Buffer.from(audioBase64, 'base64'));
  const normalizedMusicPath = path.join(audioDir, `music_v${versionNumber}_normalized.mp3`);
  const actualMusicDuration = await normalizeMusicDuration(musicPath, normalizedMusicPath, targetMusicDuration);

  if (fs.existsSync(normalizedMusicPath)) {
    fs.renameSync(normalizedMusicPath, musicPath);
  }

  const durationMs = Date.now() - startTime;
  const costUSD = 0.04;
  const previewUrl = `/api/files/${projectId}/${filename}`;

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.music.status': 'review',
    'stages.music.result': {
      musicPath,
      filename,
      previewUrl,
      durationSeconds: actualMusicDuration,
      requestedDurationSeconds: targetMusicDuration,
      voiceoverDurationSeconds: roundSeconds(voiceoverDuration),
    },
    'stages.music.reviewData': {
      previewUrl,
      metadata: {
        voiceoverDurationSeconds: roundSeconds(voiceoverDuration),
        targetMusicDurationSeconds: targetMusicDuration,
        actualMusicDurationSeconds: actualMusicDuration,
      },
    },
    'stages.music.sceneVersions': {
      ...((project.stages.music.sceneVersions ?? {}) as Record<string, string[]>),
      '0': [...existingMusicVersions, filename],
    },
    $push: {
      'stages.music.attempts': {
        attemptNumber,
        promptUsed: musicMood,
        outputPaths: [musicPath],
        costUSD,
        durationMs,
        createdAt: new Date(),
      },
    },
    $inc: { costUSD },
  });

  await GenerationLogModel.create({
    projectId,
    stageKey: 'music',
    attemptNumber,
    promptUsed: musicMood,
    modelUsed: model,
    status: 'success',
    outputPaths: [musicPath],
    durationMs,
    costUSD,
    configUsed: {
      voiceoverDurationSeconds: roundSeconds(voiceoverDuration),
      targetMusicDurationSeconds: targetMusicDuration,
      actualMusicDurationSeconds: actualMusicDuration,
    },
  });

  onProgress(`Music ready (${actualMusicDuration}s)`);
  return { musicPath, filename, previewUrl, durationSeconds: actualMusicDuration };
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        resolve(0);
        return;
      }
      resolve(metadata.format.duration ?? 0);
    });
  });
}

function runFFmpeg(setup: (cmd: ffmpeg.FfmpegCommand) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    setup(cmd);
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run();
  });
}

async function normalizeMusicDuration(
  inputPath: string,
  outputPath: string,
  targetSeconds: number
): Promise<number> {
  const actualSeconds = await probeDuration(inputPath);
  if (actualSeconds <= 0) {
    return roundSeconds(targetSeconds);
  }

  if (Math.abs(actualSeconds - targetSeconds) <= DURATION_EPSILON_SECONDS) {
    return roundSeconds(actualSeconds);
  }

  const fadeOutStart = Math.max(0, targetSeconds - MUSIC_END_FADE_SECONDS).toFixed(3);
  const fadeOutDuration = Math.min(MUSIC_END_FADE_SECONDS, targetSeconds).toFixed(3);

  if (actualSeconds > targetSeconds) {
    await runFFmpeg(cmd =>
      cmd
        .input(inputPath)
        .audioFilters(`afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}`)
        .duration(targetSeconds)
        .output(outputPath)
    );
  } else {
    await runFFmpeg(cmd =>
      cmd
        .input(inputPath)
        .inputOptions(['-stream_loop -1'])
        .audioFilters(`afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}`)
        .duration(targetSeconds)
        .output(outputPath)
    );
  }

  const normalizedSeconds = await probeDuration(outputPath);
  return roundSeconds(normalizedSeconds > 0 ? normalizedSeconds : targetSeconds);
}

function roundSeconds(value: number): number {
  return Math.round(value * 10) / 10;
}
