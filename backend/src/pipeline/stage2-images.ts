import fs from 'fs';
import path from 'path';
import { deflateSync } from 'zlib';
import { execSync } from 'child_process';
import os from 'os';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { ensureDir } from '../utils/file.helper.js';
import { env } from '../config/env.js';
import type { Storyboard, SceneImagePrompt, SceneImageResult } from '@content-creator/shared';

// ─── Mock PNG Generator (no external deps, no lavfi) ─────────────────────────

// ─── Resize reference image to target aspect ratio via ffmpeg ─────────────────
// When Gemini receives a reference image it tends to match the reference's
// dimensions regardless of the text prompt. We must resize the reference
// to the correct orientation before sending it.

const FFMPEG_BIN = env.FFMPEG_PATH;

function resizeRefToTarget(inputBuf: Buffer, targetW: number, targetH: number, inputExt = 'png'): Buffer {
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpIn  = path.join(os.tmpdir(), `ref_in_${tag}.${inputExt}`);
  const tmpOut = path.join(os.tmpdir(), `ref_out_${tag}.png`);
  try {
    fs.writeFileSync(tmpIn, inputBuf);
    // scale to cover target dimensions, then center-crop to exact size
    execSync(
      `${FFMPEG_BIN} -y -i "${tmpIn}" -vf "scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}" -frames:v 1 "${tmpOut}"`,
      { stdio: 'pipe' }
    );
    return fs.readFileSync(tmpOut);
  } finally {
    if (fs.existsSync(tmpIn))  fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

// ─── HSL → RGB helper ─────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // h: 0–360, s: 0–1, l: 0–1
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ─── Mock PNG: scene-distinct gradient placeholder ───────────────────────────
// Each sceneId gets a unique hue (golden-angle spacing) with a 3-band gradient:
//   top 20%: bright sky band (high lightness)
//   middle 60%: main scene hue
//   bottom 20%: dark ground band

function createSceneMockPng(width: number, height: number, sceneId: number): Buffer {
  function crc32(data: Buffer): number {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  // Golden-angle hue spacing — ensures maximum visual difference between scenes
  const hue = (sceneId * 137.508) % 360;
  const skyBand   = Math.floor(height * 0.20);
  const groundBand = Math.floor(height * 0.20);

  const [skyR, skyG, skyB]     = hslToRgb(hue, 0.55, 0.78);
  const [midR, midG, midB]     = hslToRgb(hue, 0.60, 0.42);
  const [gndR, gndG, gndB]     = hslToRgb(hue, 0.45, 0.20);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(height * rowLen);

  for (let y = 0; y < height; y++) {
    let pr: number, pg: number, pb: number;
    if (y < skyBand) {
      // Sky: interpolate from white at top → skyColor at skyBand
      const t = y / skyBand;
      pr = Math.round(255 + (skyR - 255) * t);
      pg = Math.round(255 + (skyG - 255) * t);
      pb = Math.round(255 + (skyB - 255) * t);
    } else if (y >= height - groundBand) {
      // Ground: interpolate from midColor → dark ground at bottom
      const t = (y - (height - groundBand)) / groundBand;
      pr = Math.round(midR + (gndR - midR) * t);
      pg = Math.round(midG + (gndG - midG) * t);
      pb = Math.round(midB + (gndB - midB) * t);
    } else {
      // Middle: solid scene color
      pr = midR; pg = midG; pb = midB;
    }

    const off = y * rowLen;
    raw[off] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3]     = pr;
      raw[off + 1 + x * 3 + 1] = pg;
      raw[off + 1 + x * 3 + 2] = pb;
    }
  }

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildImagePrompts(storyboard: Storyboard, platform = 'youtube'): SceneImagePrompt[] {
  const aspectRatio = platform === 'tiktok' ? '9:16' : '16:9';
  const orientation = platform === 'tiktok' ? 'vertical portrait orientation' : 'horizontal landscape orientation';
  return storyboard.scenes.map(scene => ({
    sceneId: scene.id,
    prompt: `${scene.visual_prompt}, ${scene.mood}, cinematic, high quality, ${aspectRatio} aspect ratio, ${orientation}`,
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
  versionNumber = 1,
  platform = 'youtube'
): Promise<SingleImageGen> {
  const imageDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(imageDir);
  const filename = `scene_${sceneId}_ref_v${versionNumber}.png`;
  const imagePath = path.join(imageDir, filename);

  let imageBase64: string;
  let totalTokens = 0;

  if (model === 'mock') {
    // Generate a scene-distinct gradient PNG — unique hue per sceneId, no API cost
    const isPortrait = platform === 'tiktok';
    const [w, h] = isPortrait ? [720, 1280] : [1280, 720];
    const png = createSceneMockPng(w, h, sceneId);
    fs.writeFileSync(imagePath, png);
    imageBase64 = png.toString('base64');
  } else {
  // All Gemini image models use generateContent() with responseModalities: ['IMAGE']
  const [targetW, targetH] = platform === 'tiktok' ? [720, 1280] : [1280, 720];
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (referenceImageBase64) {
    // Resize reference to target aspect ratio — Gemini follows reference dimensions
    // regardless of text prompt, so we must send it in the correct orientation.
    const ext = referenceMimeType === 'image/png' ? 'png' : referenceMimeType === 'image/webp' ? 'webp' : 'jpg';
    try {
      const resizedBuf = resizeRefToTarget(Buffer.from(referenceImageBase64, 'base64'), targetW, targetH, ext);
      parts.push({ inlineData: { mimeType: 'image/png', data: resizedBuf.toString('base64') } });
    } catch {
      // If ffmpeg resize fails (unlikely), fall back to original reference
      parts.push({ inlineData: { mimeType: referenceMimeType, data: referenceImageBase64 } });
    }
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

  // Post-process: crop/resize to target aspect ratio.
  // generateContent has no aspect ratio config — Gemini decides its own output
  // dimensions regardless of prompt wording. Cropping the output guarantees
  // the correct orientation every time.
  try {
    const cropped = resizeRefToTarget(Buffer.from(imageBase64, 'base64'), targetW, targetH, 'png');
    imageBase64 = cropped.toString('base64');
  } catch {
    // ffmpeg unavailable — fall back to raw Gemini output
  }
  } // end non-mock

  if (model !== 'mock') {
    fs.writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));
  }

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
  referenceImages: Record<string, string> = {},
  manualImages: Record<string, string> = {},
  platform = 'youtube'
): Promise<SceneImageResult[]> {
  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.images.attempts?.length ?? 0) + 1;
  const existingVersions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;

  // Separate prompts: scenes with manual upload skip AI generation
  const manualSceneIds = new Set(Object.keys(manualImages).map(Number));
  const promptsToGenerate = scenePrompts.filter(sp => !manualSceneIds.has(sp.sceneId));

  const versionMap: Record<string, number> = {};
  for (const sp of promptsToGenerate) {
    versionMap[String(sp.sceneId)] = (existingVersions[String(sp.sceneId)] ?? []).length + 1;
  }
  const startTime = Date.now();

  const generateCount = promptsToGenerate.length;
  const manualCount = manualSceneIds.size;
  onProgress(`Generating ${generateCount} images with AI${manualCount ? `, skipping ${manualCount} manual upload(s)` : ''}...`);

  const settlements = await Promise.allSettled(
    promptsToGenerate.map(sp => {
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
      return generateSingleImage(projectId, sp.sceneId, sp.prompt, model, refBase64, refMime, versionNumber, platform);
    })
  );

  const aiResults: SceneImageResult[] = [];
  const errors: string[] = [];
  let totalTokens = 0;

  for (const [i, settled] of settlements.entries()) {
    if (settled.status === 'fulfilled') {
      aiResults.push(settled.value.result);
      totalTokens += settled.value.totalTokens;
    } else {
      errors.push(`Scene ${promptsToGenerate[i]?.sceneId}: ${settled.reason}`);
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
  const costUSD = model === 'mock' ? 0 : aiResults.length * 0.039;

  // Merge AI-generated results with existing manual-upload results
  // Manual scenes that weren't regenerated are preserved from existing result[]
  const existingResults = (project.stages.images.result as Array<{ sceneId: number; imagePath: string; filename: string; previewUrl: string }> | undefined) ?? [];
  const aiSceneIds = new Set(aiResults.map(r => r.sceneId));
  const keptManualResults = existingResults.filter(r => manualSceneIds.has(r.sceneId) && !aiSceneIds.has(r.sceneId));

  const results: SceneImageResult[] = [
    ...keptManualResults.map(r => ({ sceneId: r.sceneId, imagePath: r.imagePath, filename: r.filename, previewUrl: r.previewUrl, imageBase64: '' })),
    ...aiResults,
  ].sort((a, b) => a.sceneId - b.sceneId);

  const newVersions: Record<string, string[]> = { ...existingVersions };
  for (const r of aiResults) {
    newVersions[String(r.sceneId)] = [...(newVersions[String(r.sceneId)] ?? []), r.filename];
  }

  // Update MongoDB — result contains both AI and manual images
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.images.status': 'review',
    'stages.images.result': results.map(r => ({ sceneId: r.sceneId, imagePath: r.imagePath, filename: r.filename, previewUrl: r.previewUrl })),
    'stages.images.reviewData': { previewUrls: results.map(r => r.previewUrl) },
    'stages.images.sceneVersions': newVersions,
    $push: {
      'stages.images.attempts': {
        attemptNumber,
        promptUsed: promptsToGenerate,
        outputPaths: aiResults.map(r => r.imagePath),
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
    promptUsed: promptsToGenerate,
    modelUsed: model,
    configUsed: { responseModalities: ['IMAGE'] },
    status: 'success',
    outputPaths: aiResults.map(r => r.imagePath),
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
  model = 'gemini-2.5-flash-image',
  refineFromCurrent = false
): Promise<SceneImageResult> {
  // Read project for ref images and existing version count
  const initProject = await ProjectModel.findById(projectId);
  const platform = (initProject?.input as { platform?: string } | undefined)?.platform ?? 'youtube';
  const refImages = (initProject?.stages.images.referenceImages ?? {}) as Record<string, string>;
  const initVersions = (initProject?.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
  const versionNumber = (initVersions[String(sceneId)] ?? []).length + 1;

  // Resolve reference image: user-uploaded ref takes priority; if refineFromCurrent=true, use current generated image
  const refFilename = refImages[String(sceneId)];
  let refBase64: string | undefined;
  let refMime = 'image/jpeg';

  if (refFilename) {
    const refPath = path.join(env.TEMP_DIR, projectId, refFilename);
    if (fs.existsSync(refPath)) {
      refBase64 = fs.readFileSync(refPath).toString('base64');
      refMime = refFilename.endsWith('.png') ? 'image/png' : refFilename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    }
  } else if (refineFromCurrent) {
    // Use the current generated image as reference for refinement
    const imageResults = (initProject?.stages.images.result as Array<{ sceneId: number; imagePath: string; filename?: string }> | undefined) ?? [];
    const current = imageResults.find(r => r.sceneId === sceneId);
    if (current?.imagePath && fs.existsSync(current.imagePath)) {
      refBase64 = fs.readFileSync(current.imagePath).toString('base64');
      refMime = current.imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    }
  }

  const gen = await generateSingleImage(projectId, sceneId, newPrompt, model, refBase64, refMime, versionNumber, platform);
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
