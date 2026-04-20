import fs from 'fs';
import path from 'path';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { Storyboard, VoiceoverConfig, VoiceoverResult } from '@content-creator/shared';

// Voice names are passed directly from the project input

// ─── Script Builder ───────────────────────────────────────────────────────────

export function buildVoiceoverScript(storyboard: Storyboard, voice: string): VoiceoverConfig {
  const fullScript = storyboard.scenes.map(s => s.narration).join('\n\n');
  return {
    script: fullScript,
    voice: voice as import('@content-creator/shared').Voice,
    speed: 1.0,
    language: 'th',
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function generateVoiceover(
  projectId: string,
  config: VoiceoverConfig,
  onProgress: (msg: string) => void
): Promise<VoiceoverResult> {
  const startTime = Date.now();

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.voiceover.attempts?.length ?? 0) + 1;
  const voiceName = config.voice;

  onProgress('Generating voiceover...');

  let audioBase64: string;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: config.script }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? '';
    if (!audioBase64) throw new Error('Empty audio response from Gemini TTS');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.voiceover.status': 'failed',
      'stages.voiceover.error': message,
    });
    throw err;
  }

  const audioDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(audioDir);
  const audioPath = path.join(audioDir, 'voiceover.mp3');
  fs.writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'));

  const durationMs = Date.now() - startTime;
  const costUSD = 0.001;
  const previewUrl = `/api/files/${projectId}/voiceover.mp3`;

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.voiceover.status': 'review',
    'stages.voiceover.result': { audioPath },
    'stages.voiceover.reviewData': { previewUrl },
    $push: {
      'stages.voiceover.attempts': {
        attemptNumber,
        promptUsed: config.script,
        outputPaths: [audioPath],
        costUSD,
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
    modelUsed: 'gemini-2.5-flash-preview-tts',
    configUsed: { voiceName, speed: config.speed },
    status: 'success',
    outputPaths: [audioPath],
    durationMs,
    costUSD,
  });

  onProgress('Voiceover ready');
  return { audioPath, filename: 'voiceover.mp3', previewUrl };
}
