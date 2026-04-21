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

export function buildVoiceoverScript(storyboard: Storyboard, voice: string, language: import('@content-creator/shared').Language = 'th'): VoiceoverConfig {
  const fullScript = storyboard.scenes.map(s => s.narration).join('\n\n');
  return {
    script: fullScript,
    voice: voice as import('@content-creator/shared').Voice,
    speed: 1.0,
    language,
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

  onProgress('Generating voiceover...');

  let audioBase64: string;
  let totalTokens = 0;

  try {
    const response = await ai.models.generateContent({
      model,
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

    totalTokens = response.usageMetadata?.totalTokenCount ?? 0;
    const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
    const part = audioPart?.inlineData;
    audioBase64 = part?.data ?? '';
    if (!audioBase64) throw new Error('Empty audio response from Gemini TTS');

    // Gemini TTS returns raw PCM (audio/L16 @ 24kHz mono) — wrap in WAV container
    const mimeType = part?.mimeType ?? '';
    if (mimeType.includes('L16') || mimeType.includes('pcm') || !mimeType.includes('mp3')) {
      const sampleRate = 24000;
      const channels = 1;
      const bitsPerSample = 16;
      const pcm = Buffer.from(audioBase64, 'base64');
      const dataSize = pcm.length;
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + dataSize, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);               // PCM subchunk size
      header.writeUInt16LE(1, 20);                // PCM format
      header.writeUInt16LE(channels, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
      header.writeUInt16LE(channels * bitsPerSample / 8, 32);
      header.writeUInt16LE(bitsPerSample, 34);
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);
      audioBase64 = Buffer.concat([header, pcm]).toString('base64');
    }
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
  const filename = `voiceover_v${versionNumber}.wav`;
  const audioPath = path.join(audioDir, filename);
  fs.writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'));

  const durationMs = Date.now() - startTime;
  const costUSD = 0.001;
  const previewUrl = `/api/files/${projectId}/${filename}`;

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.voiceover.status': 'review',
    'stages.voiceover.result': { audioPath, filename, previewUrl },
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
  return { audioPath, filename, previewUrl };
}
