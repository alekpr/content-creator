import fs from 'fs';
import path from 'path';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { MusicResult } from '@content-creator/shared';

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

  const attemptNumber = (project.stages.music.attempts?.length ?? 0) + 1;
  const existingMusicVersions = ((project.stages.music.sceneVersions ?? {}) as Record<string, string[]>)['0'] ?? [];
  const versionNumber = existingMusicVersions.length + 1;

  onProgress('Generating background music...');

  let audioBase64: string;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            {
              text: `Background music: ${musicMood}. No lyrics. Loopable. 30 seconds.`,
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

  const durationMs = Date.now() - startTime;
  const costUSD = 0.04;
  const previewUrl = `/api/files/${projectId}/${filename}`;

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.music.status': 'review',
    'stages.music.result': { musicPath, filename, previewUrl },
    'stages.music.reviewData': { previewUrl },
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
  });

  onProgress('Music ready');
  return { musicPath, filename, previewUrl };
}
