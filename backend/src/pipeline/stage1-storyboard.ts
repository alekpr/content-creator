import { z } from 'zod';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { durationToSceneCount } from '../utils/cost.calculator.js';
import type { ProjectInput, Storyboard } from '@content-creator/shared';

// ─── Zod Validators ───────────────────────────────────────────────────────────

const StoryboardSceneSchema = z.object({
  id: z.number(),
  duration: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  narration: z.string().min(1),
  visual_prompt: z.string().min(1),
  negative_prompt: z.string().default(''),
  camera_motion: z.string().default('static'),
  mood: z.string().default('neutral'),
});

const StoryboardSchema = z.object({
  title: z.string().min(1),
  hook: z.string().default(''),
  scenes: z.array(StoryboardSceneSchema).min(1),
  total_scenes: z.number(),
  estimated_duration_seconds: z.number(),
  music_mood: z.string().default('upbeat'),
});

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildStoryboardPrompt(input: ProjectInput): string {
  const sceneCount = durationToSceneCount(input.duration);

  return `
คุณเป็น video director และ scriptwriter มืออาชีพ
สร้าง video storyboard แบบ JSON เท่านั้น ห้าม markdown หรือ text นอก JSON

Platform: ${input.platform} (${input.platform === 'tiktok' ? 'hook ใน 3 วินาทีแรก, กระชับ' : 'hook ใน 15 วินาที, อธิบายละเอียดได้'})
Language: ${input.language}
Style: ${input.style}
Target scenes: ${sceneCount} scenes (duration แต่ละ scene = 4, 6 หรือ 8 วินาที)

Topic: "${input.topic}"

JSON format ที่ต้องการ:
{
  "title": "string",
  "hook": "string",
  "scenes": [
    {
      "id": 1,
      "duration": 8,
      "narration": "string (ภาษา ${input.language})",
      "visual_prompt": "string (English, cinematic description for Veo)",
      "negative_prompt": "string (what NOT to show)",
      "camera_motion": "string",
      "mood": "string"
    }
  ],
  "total_scenes": ${sceneCount},
  "estimated_duration_seconds": number,
  "music_mood": "string"
}
  `.trim();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function generateStoryboard(
  projectId: string,
  prompt: string,
  onProgress: (msg: string) => void,
  model = 'gemini-2.5-flash'
): Promise<Storyboard> {
  const startTime = Date.now();

  onProgress('Calling Gemini 2.5 Flash...');

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.storyboard.attempts?.length ?? 0) + 1;

  let storyboard: Storyboard;
  let rawText = '';

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    totalTokens = response.usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);

    rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!rawText) throw new Error('Empty response from Gemini');

    // Strip any accidental code fences
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);

    storyboard = StoryboardSchema.parse(parsed) as Storyboard;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.storyboard.status': 'failed',
      'stages.storyboard.error': message,
    });

    await GenerationLogModel.create({
      projectId,
      stageKey: 'storyboard',
      attemptNumber,
      promptUsed: prompt,
      modelUsed: model,
      status: 'failed',
      outputPaths: [],
      error: message,
      durationMs: Date.now() - startTime,
      costUSD: 0,
    });

    throw err;
  }

  const durationMs = Date.now() - startTime;
  const costUSD = 0.001;

  onProgress(`Storyboard ready: ${storyboard.scenes.length} scenes`);

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.storyboard.status': 'review',
    'stages.storyboard.result': storyboard,
    'stages.storyboard.reviewData': {
      metadata: {
        sceneCount: storyboard.scenes.length,
        estimatedDuration: storyboard.estimated_duration_seconds,
      },
    },
    $push: {
      'stages.storyboard.attempts': {
        attemptNumber,
        promptUsed: prompt,
        outputPaths: [],
        costUSD,
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        createdAt: new Date(),
      },
    },
    $inc: { costUSD },
  });

  // Write generation log
  await GenerationLogModel.create({
    projectId,
    stageKey: 'storyboard',
    attemptNumber,
    promptUsed: prompt,
    modelUsed: model,
    status: 'success',
    outputPaths: [],
    durationMs,
    costUSD,
    inputTokens,
    outputTokens,
    totalTokens,
  });

  return storyboard;
}
