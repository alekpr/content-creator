import fs from 'fs';
import path from 'path';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { Storyboard, SceneImagePrompt, SceneImageResult } from '@content-creator/shared';

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildImagePrompts(storyboard: Storyboard): SceneImagePrompt[] {
  return storyboard.scenes.map(scene => ({
    sceneId: scene.id,
    prompt: `${scene.visual_prompt}, ${scene.mood}, cinematic, high quality, 16:9`,
    negativePrompt: scene.negative_prompt,
  }));
}

// ─── Single Image ─────────────────────────────────────────────────────────────

async function generateSingleImage(
  projectId: string,
  sceneId: number,
  prompt: string
): Promise<SceneImageResult> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ parts: [{ text: prompt }] }],
    config: { responseModalities: ['IMAGE'] },
  });

  const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) throw new Error(`No image data returned for scene ${sceneId}`);

  const imageDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(imageDir);

  const imagePath = path.join(imageDir, `scene_${sceneId}_ref.png`);
  fs.writeFileSync(imagePath, Buffer.from(inlineData.data, 'base64'));

  return {
    sceneId,
    imagePath,
    filename: `scene_${sceneId}_ref.png`,
    previewUrl: `/api/files/${projectId}/scene_${sceneId}_ref.png`,
    imageBase64: inlineData.data,
  };
}

// ─── Generate All Images ──────────────────────────────────────────────────────

export async function generateImages(
  projectId: string,
  scenePrompts: SceneImagePrompt[],
  onProgress: (msg: string) => void
): Promise<SceneImageResult[]> {
  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.images.attempts?.length ?? 0) + 1;
  const startTime = Date.now();

  onProgress(`Generating ${scenePrompts.length} images in parallel...`);

  const settlements = await Promise.allSettled(
    scenePrompts.map(sp => generateSingleImage(projectId, sp.sceneId, sp.prompt))
  );

  const results: SceneImageResult[] = [];
  const errors: string[] = [];

  for (const [i, settled] of settlements.entries()) {
    if (settled.status === 'fulfilled') {
      results.push(settled.value);
    } else {
      errors.push(`Scene ${scenePrompts[i]?.sceneId}: ${settled.reason}`);
    }
  }

  if (errors.length > 0) {
    const errorMsg = errors.join('; ');
    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.images.status': 'failed',
      'stages.images.error': errorMsg,
    });
    throw new Error(errorMsg);
  }

  const durationMs = Date.now() - startTime;
  const costUSD = results.length * 0.039;

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.images.status': 'review',
    'stages.images.result': results.map(r => ({ sceneId: r.sceneId, imagePath: r.imagePath })),
    'stages.images.reviewData': { previewUrls: results.map(r => r.previewUrl) },
    $push: {
      'stages.images.attempts': {
        attemptNumber,
        promptUsed: scenePrompts,
        outputPaths: results.map(r => r.imagePath),
        costUSD,
        durationMs,
        createdAt: new Date(),
      },
    },
    $inc: { costUSD },
  });

  await GenerationLogModel.create({
    projectId,
    stageKey: 'images',
    attemptNumber,
    promptUsed: scenePrompts,
    modelUsed: 'gemini-2.5-flash',
    configUsed: { responseModalities: ['IMAGE'] },
    status: 'success',
    outputPaths: results.map(r => r.imagePath),
    durationMs,
    costUSD,
  });

  onProgress(`All ${results.length} images generated`);
  return results;
}

// ─── Re-generate Single Scene ─────────────────────────────────────────────────

export async function regenerateSceneImage(
  projectId: string,
  sceneId: number,
  newPrompt: string
): Promise<SceneImageResult> {
  const result = await generateSingleImage(projectId, sceneId, newPrompt);

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const imageResults = (project.stages.images.result as Array<{ sceneId: number; imagePath: string }> | undefined) ?? [];
  const idx = imageResults.findIndex(r => r.sceneId === sceneId);

  if (idx >= 0) {
    imageResults[idx] = { sceneId, imagePath: result.imagePath };
  } else {
    imageResults.push({ sceneId, imagePath: result.imagePath });
  }

  const previewUrls = (project.stages.images.reviewData?.previewUrls ?? []) as string[];
  const urlIdx = previewUrls.findIndex(u => u.includes(`scene_${sceneId}_ref`));
  if (urlIdx >= 0) {
    previewUrls[urlIdx] = result.previewUrl;
  } else {
    previewUrls.push(result.previewUrl);
  }

  project.stages.images.result = imageResults;
  project.stages.images.reviewData = { previewUrls };
  await project.save();

  return result;
}
