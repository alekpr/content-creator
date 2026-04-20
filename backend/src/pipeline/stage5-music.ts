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
  onProgress: (msg: string) => void
): Promise<MusicResult> {
  const startTime = Date.now();

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.music.attempts?.length ?? 0) + 1;

  onProgress('Generating background music...');

  let audioBase64: string;

  try {
    const response = await ai.models.generateContent({
      model: 'lyria-3-clip-preview',
      contents: [
        {
          parts: [
            {
              text: `Background music: ${musicMood}. No lyrics. Loopable. 30 seconds.`,
            },
          ],
        },
      ],
    });

    audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? '';
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
  const musicPath = path.join(audioDir, 'music.mp3');
  fs.writeFileSync(musicPath, Buffer.from(audioBase64, 'base64'));

  const durationMs = Date.now() - startTime;
  const costUSD = 0.04;
  const previewUrl = `/api/files/${projectId}/music.mp3`;

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.music.status': 'review',
    'stages.music.result': { musicPath },
    'stages.music.reviewData': { previewUrl },
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
    modelUsed: 'lyria-3-clip-preview',
    status: 'success',
    outputPaths: [musicPath],
    durationMs,
    costUSD,
  });

  onProgress('Music ready');
  return { musicPath, filename: 'music.mp3', previewUrl };
}
