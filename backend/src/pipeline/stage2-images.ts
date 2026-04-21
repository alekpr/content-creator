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

interface SingleImageGen {
  result: SceneImageResult;
  totalTokens: number;
}

async function generateSingleImage(
  projectId: string,
  sceneId: number,
  prompt: string,
  model = 'gemini-2.5-flash-image',
  referenceImageBase64?: string,
  referenceMimeType = 'image/jpeg',
  versionNumber = 1
): Promise<SingleImageGen> {
  const imageDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(imageDir);
  const filename = `scene_${sceneId}_ref_v${versionNumber}.png`;
  const imagePath = path.join(imageDir, filename);

  let imageBase64: string;
  let totalTokens = 0;

  // All Gemini image models use generateContent() with responseModalities: ['IMAGE']
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (referenceImageBase64) {
    parts.push({ inlineData: { mimeType: referenceMimeType, data: referenceImageBase64 } });
  }
  parts.push({ text: `Generate a high-quality image for this scene. ${prompt}` });

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });

  // Find the image part (may not be the first part when TEXT is also in modalities)
  const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  const inlineData = imagePart?.inlineData;
  if (!inlineData?.data) throw new Error(`No image data returned for scene ${sceneId}`);
  imageBase64 = inlineData.data;
  totalTokens = response.usageMetadata?.totalTokenCount ?? 0;

  fs.writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));

  return {
    result: {
      sceneId,
      imagePath,
      filename,
      previewUrl: `/api/files/${projectId}/${filename}`,
      imageBase64,
    },
    totalTokens,
  };
}

// ─── Generate All Images ──────────────────────────────────────────────────────

export async function generateImages(
  projectId: string,
  scenePrompts: SceneImagePrompt[],
  onProgress: (msg: string) => void,
  model = 'gemini-2.5-flash-image',
  referenceImages: Record<string, string> = {}
): Promise<SceneImageResult[]> {
  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.images.attempts?.length ?? 0) + 1;
  const existingVersions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
  const versionMap: Record<string, number> = {};
  for (const sp of scenePrompts) {
    versionMap[String(sp.sceneId)] = (existingVersions[String(sp.sceneId)] ?? []).length + 1;
  }
  const startTime = Date.now();

  onProgress(`Generating ${scenePrompts.length} images in parallel...`);

  const settlements = await Promise.allSettled(
    scenePrompts.map(sp => {
      const refFilename = referenceImages[String(sp.sceneId)];
      let refBase64: string | undefined;
      let refMime = 'image/jpeg';
      if (refFilename) {
        const refPath = path.join(env.TEMP_DIR, projectId, refFilename);
        if (fs.existsSync(refPath)) {
          refBase64 = fs.readFileSync(refPath).toString('base64');
          refMime = refFilename.endsWith('.png') ? 'image/png' : refFilename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        }
      }
      const versionNumber = versionMap[String(sp.sceneId)] ?? 1;
      return generateSingleImage(projectId, sp.sceneId, sp.prompt, model, refBase64, refMime, versionNumber);
    })
  );

  const results: SceneImageResult[] = [];
  const errors: string[] = [];
  let totalTokens = 0;

  for (const [i, settled] of settlements.entries()) {
    if (settled.status === 'fulfilled') {
      results.push(settled.value.result);
      totalTokens += settled.value.totalTokens;
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

  const newVersions: Record<string, string[]> = { ...existingVersions };
  for (const r of results) {
    newVersions[String(r.sceneId)] = [...(newVersions[String(r.sceneId)] ?? []), r.filename];
  }

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.images.status': 'review',
    'stages.images.result': results.map(r => ({ sceneId: r.sceneId, imagePath: r.imagePath, filename: r.filename, previewUrl: r.previewUrl })),
    'stages.images.reviewData': { previewUrls: results.map(r => r.previewUrl) },
    'stages.images.sceneVersions': newVersions,
    $push: {
      'stages.images.attempts': {
        attemptNumber,
        promptUsed: scenePrompts,
        outputPaths: results.map(r => r.imagePath),
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
    stageKey: 'images',
    attemptNumber,
    promptUsed: scenePrompts,
    modelUsed: model,
    configUsed: { responseModalities: ['IMAGE'] },
    status: 'success',
    outputPaths: results.map(r => r.imagePath),
    durationMs,
    costUSD,
    totalTokens,
  });

  onProgress(`All ${results.length} images generated`);
  return results;
}

// --- Re-generate Single Scene ---

export async function regenerateSceneImage(
  projectId: string,
  sceneId: number,
  newPrompt: string,
  model = 'gemini-2.5-flash-image'
): Promise<SceneImageResult> {
  // Read project for ref images and existing version count
  const initProject = await ProjectModel.findById(projectId);
  const refImages = (initProject?.stages.images.referenceImages ?? {}) as Record<string, string>;
  const initVersions = (initProject?.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
  const versionNumber = (initVersions[String(sceneId)] ?? []).length + 1;
  const refFilename = refImages[String(sceneId)];
  let refBase64: string | undefined;
  let refMime = 'image/jpeg';
  if (refFilename) {
    const refPath = path.join(env.TEMP_DIR, projectId, refFilename);
    if (fs.existsSync(refPath)) {
      refBase64 = fs.readFileSync(refPath).toString('base64');
      refMime = refFilename.endsWith('.png') ? 'image/png' : refFilename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    }
  }

  const gen = await generateSingleImage(projectId, sceneId, newPrompt, model, refBase64, refMime, versionNumber);
  const result = gen.result;

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const imageResults = (project.stages.images.result as Array<{ sceneId: number; imagePath: string; filename?: string; previewUrl?: string }> | undefined) ?? [];
  const idx = imageResults.findIndex(r => r.sceneId === sceneId);

  if (idx >= 0) {
    imageResults[idx] = { sceneId, imagePath: result.imagePath, filename: result.filename, previewUrl: result.previewUrl };
  } else {
    imageResults.push({ sceneId, imagePath: result.imagePath, filename: result.filename, previewUrl: result.previewUrl });
  }

  const previewUrls = (project.stages.images.reviewData?.previewUrls ?? []) as string[];
  const urlIdx = previewUrls.findIndex(u => u.includes(`scene_${sceneId}_ref`));
  if (urlIdx >= 0) {
    previewUrls[urlIdx] = result.previewUrl;
  } else {
    previewUrls.push(result.previewUrl);
  }

  const freshVersions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
  project.stages.images.sceneVersions = {
    ...freshVersions,
    [String(sceneId)]: [...(freshVersions[String(sceneId)] ?? []), result.filename],
  };
  project.stages.images.result = imageResults;
  project.stages.images.reviewData = { previewUrls };
  project.markModified('stages.images.sceneVersions');
  project.markModified('stages.images.result');
  project.markModified('stages.images.reviewData');
  await project.save();

  return result;
}
