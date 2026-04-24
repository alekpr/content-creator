import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { ProjectModel, type ProjectDocument } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { validate } from '../middleware/validate.middleware.js';
import { emitStageStatus, emitStageProgress, emitStageResult, emitStageError, emitCostUpdate } from '../socket/socket.handler.js';
import { generateStoryboard } from '../pipeline/stage1-storyboard.js';
import { generateImages, buildImagePrompts, regenerateSceneImage } from '../pipeline/stage2-images.js';
import { submitVideoGenerationJobs, waitForVideoJobs, regenerateSceneVideo } from '../pipeline/stage3-videos.js';
import { generateVoiceover, buildVoiceoverScript, regenerateSingleSceneVoiceover } from '../pipeline/stage4-voiceover.js';
import { generateMusic } from '../pipeline/stage5-music.js';
import { assembleVideo } from '../pipeline/stage6-assembly.js';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { ensureDir } from '../utils/file.helper.js';
import type { StageKey, Storyboard, StageDoc, CostBreakdown, StageCostEntry, StageModelConfig, VoiceoverStageConfig, AssemblyStageConfig } from '@content-creator/shared';
import { DEFAULT_STAGE_MODELS } from '@content-creator/shared';

export const stagesRouter = Router({ mergeParams: true });

// ─── Cost Breakdown Helper ──────────────────────────────────────────────────────────

const STAGE_KEYS: StageKey[] = ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'];

async function buildAndSaveCostBreakdown(projectId: string): Promise<CostBreakdown | null> {
  const project = await ProjectModel.findById(projectId);
  if (!project) return null;

  const stagesMap: Partial<Record<StageKey, StageCostEntry>> = {};
  let totalTokens = 0;

  for (const key of STAGE_KEYS) {
    const stage = project.stages[key];
    if (!stage.attempts || stage.attempts.length === 0) continue;
    const last = stage.attempts[stage.attempts.length - 1];
    const entry: StageCostEntry = {
      stageKey: key,
      costUSD: stage.attempts.reduce((s, a) => s + a.costUSD, 0),
      totalTokens: last.totalTokens,
      inputTokens: last.inputTokens,
      outputTokens: last.outputTokens,
      durationMs: last.durationMs,
      attempts: stage.attempts.length,
    };
    stagesMap[key] = entry;
    totalTokens += last.totalTokens ?? 0;
  }

  const breakdown: CostBreakdown = {
    stages: stagesMap,
    totalCostUSD: project.costUSD,
    totalTokens,
    estimatedCostUSD: project.estimatedCostUSD,
  };

  await ProjectModel.findByIdAndUpdate(projectId, { costBreakdown: breakdown });
  return breakdown;
}

// --- Rate Limiting ---

const generateLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many generate requests, please slow down' },
});

// ─── Validation Schemas ───────────────────────────────────────────────────────

function isValidStage(s: string): s is StageKey {
  return STAGE_KEYS.includes(s as StageKey);
}

const PromptUpdateSchema = z.object({
  prompt: z.string().min(5).max(5000),
  sceneId: z.number().int().positive().optional(),
  negativePrompt: z.string().max(2000).optional(),
});

const ModelUpdateSchema = z.object({
  model: z.string().min(1).max(100),
});

const ReferenceImageSchema = z.object({
  imageBase64: z.string().min(1).max(6_000_000), // ~4.5 MB decoded max
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
});

const SelectVersionSchema = z.object({
  filename: z.string().min(1).max(255),
});

const SceneUpdateSchema = z.object({
  narration: z.string().min(1).max(2000).optional(),
  visual_prompt: z.string().min(1).max(2000).optional(),
  negative_prompt: z.string().max(1000).optional(),
  camera_motion: z.string().max(200).optional(),
  mood: z.string().max(200).optional(),
  duration: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional(),
});

// Params type for routes with merged parent :id and local :stage
type StageParams = { id: string; stage: string; [key: string]: string };

// ─── Stage guard middleware ───────────────────────────────────────────────────

function validateStage(req: Request<StageParams>, res: Response, next: NextFunction): void {
  if (!isValidStage(req.params.stage)) {
    res.status(400).json({ error: `Invalid stage: ${req.params.stage}` });
    return;
  }
  next();
}

// ─── GET /stages/:stage ───────────────────────────────────────────────────────

stagesRouter.get('/:stage', validateStage, async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageKey = req.params.stage as StageKey;
    const stage = project.stages[stageKey] as StageDoc;
    res.json(stage);
  } catch (err) { next(err); }
});

// ─── GET /stages/:stage/attempts ─────────────────────────────────────────────

stagesRouter.get('/:stage/attempts', validateStage, async (req, res, next) => {
  try {
    const logs = await GenerationLogModel.find({
      projectId: req.params.id,
      stageKey: req.params.stage,
    }).sort({ createdAt: -1 });
    res.json(logs);
  } catch (err) { next(err); }
});

// ─── PATCH /stages/:stage/prompt ─────────────────────────────────────────────

stagesRouter.patch('/:stage/prompt', validateStage, validate(PromptUpdateSchema), async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageKey = req.params.stage as StageKey;
    await ProjectModel.findByIdAndUpdate(req.params.id, {
      [`stages.${stageKey}.prompt`]: req.body.prompt,
    });

    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ─── PATCH /stages/storyboard/scenes/:sceneId ────────────────────────────────

stagesRouter.patch('/storyboard/scenes/:sceneId', validate(SceneUpdateSchema), async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sceneId = parseInt(req.params.sceneId as string, 10);
    const storyboard = project.stages.storyboard.result as Storyboard | undefined;
    if (!storyboard?.scenes) { res.status(400).json({ error: 'No storyboard result to edit' }); return; }

    const idx = storyboard.scenes.findIndex((s: { id: number }) => s.id === sceneId);
    if (idx < 0) { res.status(404).json({ error: `Scene ${sceneId} not found` }); return; }

    Object.assign(storyboard.scenes[idx], req.body);
    project.stages.storyboard.result = storyboard;
    project.markModified('stages.storyboard.result');
    await (project as NonNullable<typeof project>).save();

    res.json(storyboard.scenes[idx]);
  } catch (err) { next(err); }
});

// ─── PATCH /stages/:stage/model ──────────────────────────────────────────────

stagesRouter.patch('/:stage/model', validateStage, validate(ModelUpdateSchema), async (req, res, next) => {
  try {
    const stageKey = req.params.stage as StageKey;
    if (stageKey === 'assembly') {
      res.status(400).json({ error: 'Assembly stage has no configurable AI model' });
      return;
    }
    await ProjectModel.findByIdAndUpdate(req.params.id, {
      [`modelConfig.${stageKey}`]: req.body.model,
    });
    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ─── POST /stages/:stage/generate ────────────────────────────────────────────

stagesRouter.post('/:stage/generate', generateLimiter, validateStage, async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageKey = req.params.stage as StageKey;
    const projectId = req.params.id;

    // Set status to generating
    await ProjectModel.findByIdAndUpdate(projectId, {
      [`stages.${stageKey}.status`]: 'generating',
      [`stages.${stageKey}.startedAt`]: new Date(),
      [`stages.${stageKey}.error`]: null,
    });

    emitStageStatus({ projectId, stageKey, status: 'generating', message: 'Generation started' });

    // Run generation asynchronously
    void runGeneration(projectId, stageKey, project, req.body).catch(err => {
      console.error(`[Stage ${stageKey}] Generation failed:`, err);
    });

    res.json({
      accepted: true,
      estimatedSeconds: getEstimatedSeconds(stageKey),
      wsEvent: `stage:${stageKey}:progress`,
    });
  } catch (err) { next(err); }
});

async function runGeneration(projectId: string, stageKey: StageKey, project: ProjectDocument | null, body: Record<string, unknown>): Promise<void> {
  if (!project) return;

  const mc = (project.modelConfig ?? {}) as Partial<StageModelConfig>;
  const onProgress = (msg: string) => emitStageProgress({ projectId, stageKey, message: msg });

  try {
    switch (stageKey) {
      case 'storyboard': {
        const prompt = (body.prompt as string | undefined) ?? String(project.stages.storyboard.prompt ?? '');
        const model = mc.storyboard ?? DEFAULT_STAGE_MODELS.storyboard;
        const storyboard = await generateStoryboard(projectId, prompt, onProgress, model);
        emitStageResult({
          projectId, stageKey,
          previewUrls: [],
          metadata: { sceneCount: storyboard.scenes.length, estimatedDuration: storyboard.estimated_duration_seconds },
        });
        break;
      }
      case 'images': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        if (!storyboard) throw new Error('Storyboard not approved yet');
        const prompts = buildImagePrompts(storyboard, project.input.platform);
        const model = mc.images ?? DEFAULT_STAGE_MODELS.images;
        const refImages = (project.stages.images.referenceImages ?? {}) as Record<string, string>;
        const imagesStageConfig = (project.stages.images.stageConfig as Record<string, unknown> | undefined) ?? {};
        const manualImages = (imagesStageConfig.manualImages as Record<string, string> | undefined) ?? {};
        const styleReferenceImage = imagesStageConfig.styleReferenceImage as string | undefined;
        const results = await generateImages(projectId, prompts, onProgress, model, refImages, manualImages, project.input.platform, styleReferenceImage);
        emitStageResult({
          projectId, stageKey,
          previewUrls: results.map(r => r.previewUrl),
          metadata: { sceneCount: results.length },
        });
        break;
      }
      case 'videos': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        if (!storyboard) throw new Error('Storyboard not approved yet');

        const sceneImages = (project.stages.images.result as Array<{ sceneId: number; imagePath: string; imageBase64?: string }> | undefined) ?? [];
        if (sceneImages.length === 0) throw new Error('Images not approved yet');

        // We need imageBase64 — re-read from disk if not in memory
        const sceneImagesWithBase64 = sceneImages.map(img => {
          const base64 = img.imageBase64 ?? (fs.existsSync(img.imagePath) ? fs.readFileSync(img.imagePath).toString('base64') : '');
          const filename = `scene_${img.sceneId}_ref.png`;
          return { ...img, filename, imageBase64: base64, previewUrl: `/api/files/${projectId}/scene_${img.sceneId}_ref.png` };
        });

        // Skip scenes that already have a manual video upload
        const manualVideos = (project.stages.videos.stageConfig as Record<string, unknown> | undefined)?.manualVideos as Record<string, string> ?? {};
        const manualSceneIds = new Set(Object.keys(manualVideos).map(Number));
        const scenesToGenerate = storyboard.scenes.filter(s => !manualSceneIds.has(s.id));

        const scenePromptOverrides = ((project.stages.videos.stageConfig as Record<string, unknown> | undefined)?.scenePromptOverrides ?? {}) as Record<string, string>;

        const attemptNumber = (project.stages.videos.attempts?.length ?? 0) + 1;
        const videoModel = mc.videos ?? DEFAULT_STAGE_MODELS.videos;

        if (scenesToGenerate.length === 0) {
          // All scenes are manual — just set status to review
          await ProjectModel.findByIdAndUpdate(projectId, { 'stages.videos.status': 'review' });
          break;
        }

        const jobIds = await submitVideoGenerationJobs(projectId, scenesToGenerate, sceneImagesWithBase64, project.input.platform, attemptNumber, videoModel, scenePromptOverrides);

        await ProjectModel.findByIdAndUpdate(projectId, {
          'stages.videos.status': 'generating',
        });

        await waitForVideoJobs(projectId, jobIds, jobIds.length);
        break;
      }
      case 'voiceover': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        if (!storyboard) throw new Error('Storyboard not approved yet');
        const stageConfig = (project.stages.voiceover.stageConfig ?? {}) as VoiceoverStageConfig;
        const config = buildVoiceoverScript(storyboard, project.input.voice, project.input.language, stageConfig);
        const voiceModel = mc.voiceover ?? DEFAULT_STAGE_MODELS.voiceover;
        const result = await generateVoiceover(projectId, config, onProgress, voiceModel);
        emitStageResult({ projectId, stageKey, previewUrls: [result.previewUrl], metadata: {} });
        break;
      }
      case 'music': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        const musicStageConfig = (project.stages.music.stageConfig ?? {}) as import('@content-creator/shared').MusicStageConfig;
        // Priority: body.musicMood → stageConfig.customPrompt → directors_brief → storyboard.music_mood
        const briefPrompt = storyboard?.directorsBrief?.music?.promptText;
        const musicMood = (body.musicMood as string | undefined) ?? musicStageConfig.customPrompt ?? briefPrompt ?? storyboard?.music_mood ?? 'upbeat, positive';
        const musicModel = mc.music ?? DEFAULT_STAGE_MODELS.music;
        const result = await generateMusic(projectId, musicMood, onProgress, musicModel);
        emitStageResult({ projectId, stageKey, previewUrls: [result.previewUrl], metadata: {} });
        break;
      }
      case 'assembly': {
        const freshProject = await ProjectModel.findById(projectId);
        if (!freshProject) throw new Error('Project not found');

        const videoResults = (freshProject.stages.videos.result as Array<{ sceneId: number; videoPath: string }> | undefined) ?? [];
        const videoPaths = videoResults.sort((a, b) => a.sceneId - b.sceneId).map(r => r.videoPath);
        const voicePath = (freshProject.stages.voiceover.result as { audioPath: string } | undefined)?.audioPath;
        const musicPath = (freshProject.stages.music.result as { musicPath: string } | undefined)?.musicPath ?? null;
        const sceneTimings = (freshProject.stages.voiceover.result as { sceneTimings?: import('@content-creator/shared').VoiceoverSceneTiming[] } | undefined)?.sceneTimings;

        if (!voicePath) throw new Error('Voiceover not approved yet');
        if (videoPaths.length === 0) throw new Error('No video clips found');

        // Load persisted stageConfig (saved by PATCH /assembly/settings)
        const savedConfig = (freshProject.stages.assembly.stageConfig ?? {}) as AssemblyStageConfig;

        const assemblyConfig = {
          voiceVolume: 1.0,
          musicVolume: 0.2,
          fadeInSeconds: 0.5,
          fadeOutSeconds: 1.0,
          outputFormat: 'mp4' as const,
          outputQuality: 'standard' as const,
          ...savedConfig,
          ...(body.config as object | undefined),
        };

        const result = await assembleVideo(
          projectId,
          videoPaths,
          voicePath,
          musicPath,
          assemblyConfig,
          percent => emitStageProgress({ projectId, stageKey, message: `Assembling... ${percent}%`, percent }),
          sceneTimings,
        );

        emitStageResult({ projectId, stageKey, previewUrls: [result.fileUrl], metadata: {} });
        break;
      }
    }

    if (stageKey !== 'assembly') {
      emitStageStatus({ projectId, stageKey, status: 'review', message: 'Generation complete, ready for review' });
    }

    // Build cost breakdown and push real-time update
    const breakdown = await buildAndSaveCostBreakdown(projectId);
    if (breakdown) {
      emitCostUpdate({ projectId, totalCostUSD: breakdown.totalCostUSD, breakdown });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ProjectModel.findByIdAndUpdate(projectId, {
      [`stages.${stageKey}.status`]: 'failed',
      [`stages.${stageKey}.error`]: message,
    });
    emitStageError({ projectId, stageKey, error: message });
    emitStageStatus({ projectId, stageKey, status: 'failed', message });
  }
}

// ─── POST /stages/:stage/approve ─────────────────────────────────────────────

stagesRouter.post('/:stage/approve', validateStage, async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageKey = req.params.stage as StageKey;
    const stage = project.stages[stageKey] as StageDoc;

    if (stage.status !== 'review') {
      res.status(400).json({ error: `Stage ${stageKey} is not in review status (current: ${stage.status})` });
      return;
    }

    const updates: Record<string, unknown> = {
      [`stages.${stageKey}.status`]: 'approved',
      [`stages.${stageKey}.completedAt`]: new Date(),
    };

    // Unlock next stage — only if it has never been started (pending).
    // If it already has content (prompt_ready / review / approved / etc.) from a
    // previous run, leave it untouched so the user doesn't lose work.
    const nextStage = getNextStage(stageKey);
    if (nextStage) {
      const nextStageDoc = project.stages[nextStage] as StageDoc;
      if (nextStageDoc.status === 'pending') {
        updates[`stages.${nextStage}.status`] = 'prompt_ready';
        // Pre-build prompt for next stage if possible
        const nextPrompt = buildNextStagePrompt(nextStage, project);
        if (nextPrompt) updates[`stages.${nextStage}.prompt`] = nextPrompt;
      }
    }

    await ProjectModel.findByIdAndUpdate(req.params.id, updates);
    emitStageStatus({ projectId: req.params.id, stageKey, status: 'approved', message: 'Stage approved' });
    if (nextStage) {
      const nextStageDoc = project.stages[nextStage] as StageDoc;
      if (nextStageDoc.status === 'pending') {
        emitStageStatus({ projectId: req.params.id, stageKey: nextStage, status: 'prompt_ready', message: 'Ready for review' });
      }
    }

    res.json({ approved: true, nextStage: nextStage ?? null });
  } catch (err) { next(err); }
});

// ─── POST /stages/:stage/skip (music only) ────────────────────────────────────

stagesRouter.post('/:stage/skip', validateStage, async (req, res, next) => {
  try {
    if (req.params.stage !== 'music') {
      res.status(400).json({ error: 'Only the music stage can be skipped' });
      return;
    }

    await ProjectModel.findByIdAndUpdate(req.params.id, {
      'stages.music.status': 'skipped',
      'stages.assembly.status': 'prompt_ready',
    });

    emitStageStatus({ projectId: req.params.id, stageKey: 'music', status: 'skipped', message: 'Music skipped' });
    emitStageStatus({ projectId: req.params.id, stageKey: 'assembly', status: 'prompt_ready', message: 'Ready for assembly' });

    res.json({ skipped: true });
  } catch (err) { next(err); }
});

// ─── POST /stages/:stage/retry ────────────────────────────────────────────────

stagesRouter.post('/:stage/retry', validateStage, async (req, res, next) => {
  try {
    await ProjectModel.findByIdAndUpdate(req.params.id, {
      [`stages.${req.params.stage}.status`]: 'prompt_ready',
      [`stages.${req.params.stage}.error`]: null,
    });
    res.json({ retrying: true });
  } catch (err) { next(err); }
});

// ─── POST /stages/:stage/reset ────────────────────────────────────────────────

stagesRouter.post('/:stage/reset', validateStage, async (req, res, next) => {
  try {
    const update: Record<string, unknown> = {
      [`stages.${req.params.stage}.status`]: 'prompt_ready',
      [`stages.${req.params.stage}.error`]: null,
      [`stages.${req.params.stage}.result`]: null,
      [`stages.${req.params.stage}.reviewData`]: null,
    };
    // For images stage: also clear manual uploads and per-scene reference images
    // so user can re-configure from scratch after storyboard regeneration
    if (req.params.stage === 'images') {
      update['stages.images.stageConfig'] = {};
      update['stages.images.referenceImages'] = {};
    }
    await ProjectModel.findByIdAndUpdate(req.params.id, update);
    emitStageStatus({ projectId: req.params.id, stageKey: req.params.stage as StageKey, status: 'prompt_ready', message: 'Stage reset' });
    res.json({ reset: true });
  } catch (err) { next(err); }
});

// ─── POST /stages/:stage/reopen ───────────────────────────────────────────────

stagesRouter.post('/:stage/reopen', validateStage, async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageKey = req.params.stage as StageKey;
    const stage = project.stages[stageKey] as StageDoc;

    if (stage.status !== 'approved') {
      res.status(400).json({ error: `Stage ${stageKey} is not approved` });
      return;
    }

    await ProjectModel.findByIdAndUpdate(req.params.id, {
      [`stages.${stageKey}.status`]: 'review',
    });
    emitStageStatus({ projectId: req.params.id, stageKey, status: 'review', message: 'Stage reopened for review' });
    res.json({ reopened: true });
  } catch (err) { next(err); }
});
// ─── POST /stages/images/scenes/:sceneId/upload (direct manual upload — no AI) ────────

stagesRouter.post('/images/scenes/:sceneId/upload', validate(ReferenceImageSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { imageBase64, mimeType } = req.body as { imageBase64: string; mimeType: string };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const existingVersions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
    const versionNumber = (existingVersions[String(sceneId)] ?? []).length + 1;
    const filename = `scene_${sceneId}_upload_v${versionNumber}.${ext}`;
    const imageDir = path.join(env.TEMP_DIR, projectId);
    ensureDir(imageDir);
    const imagePath = path.join(imageDir, filename);
    fs.writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));
    const previewUrl = `/api/files/${projectId}/${filename}`;

    // Upsert into result[]
    const imageResults = (project.stages.images.result as Array<{ sceneId: number; imagePath: string; filename: string; previewUrl: string }> | undefined) ?? [];
    const idx = imageResults.findIndex(r => r.sceneId === sceneId);
    const entry = { sceneId, imagePath, filename, previewUrl };
    if (idx >= 0) { imageResults[idx] = entry; } else { imageResults.push(entry); }

    const newVersions = { ...existingVersions, [String(sceneId)]: [...(existingVersions[String(sceneId)] ?? []), filename] };
    const previewUrls = (project.stages.images.reviewData?.previewUrls ?? []) as string[];
    const urlIdx = previewUrls.findIndex(u => u.includes(`scene_${sceneId}_`));
    if (urlIdx >= 0) { previewUrls[urlIdx] = previewUrl; } else { previewUrls.push(previewUrl); }

    // Store in stageConfig.manualImages so generateImages() can skip this scene
    const stageConfig = (project.stages.images.stageConfig ?? {}) as Record<string, unknown>;
    const manualImages = { ...((stageConfig.manualImages ?? {}) as Record<string, string>), [String(sceneId)]: filename };

    project.stages.images.result = imageResults;
    project.stages.images.sceneVersions = newVersions;
    project.stages.images.reviewData = { previewUrls };
    project.stages.images.stageConfig = { ...stageConfig, manualImages };
    project.markModified('stages.images.result');
    project.markModified('stages.images.sceneVersions');
    project.markModified('stages.images.reviewData');
    project.markModified('stages.images.stageConfig');
    await project.save();

    res.json({ filename, previewUrl });
  } catch (err) { next(err); }
});

// ─── DELETE /stages/images/scenes/:sceneId/upload ─────────────────────────────────

stagesRouter.delete('/images/scenes/:sceneId/upload', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageConfig = (project.stages.images.stageConfig ?? {}) as Record<string, unknown>;
    const manualImages = { ...((stageConfig.manualImages ?? {}) as Record<string, string>) };
    delete manualImages[String(sceneId)];

    project.stages.images.stageConfig = { ...stageConfig, manualImages };
    project.markModified('stages.images.stageConfig');
    await project.save();

    res.json({ removed: true });
  } catch (err) { next(err); }
});
// ─── PATCH /stages/images/scenes/:sceneId/reference ─────────────────────────

stagesRouter.patch('/images/scenes/:sceneId/reference', validate(ReferenceImageSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { imageBase64, mimeType } = req.body as { imageBase64: string; mimeType: string };

    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `ref_scene_${sceneId}.${ext}`;
    const refDir = path.join(env.TEMP_DIR, projectId);
    ensureDir(refDir);
    fs.writeFileSync(path.join(refDir, filename), Buffer.from(imageBase64, 'base64'));

    await ProjectModel.findByIdAndUpdate(projectId, {
      [`stages.images.referenceImages.${sceneId}`]: filename,
    });

    res.json({ url: `/api/files/${projectId}/${filename}` });
  } catch (err) { next(err); }
});

// ─── PATCH /stages/images/style-reference ───────────────────────────────────

stagesRouter.patch('/images/style-reference', validate(ReferenceImageSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const { imageBase64, mimeType } = req.body as { imageBase64: string; mimeType: string };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `ref_style_global.${ext}`;
    const refDir = path.join(env.TEMP_DIR, projectId);
    ensureDir(refDir);

    const stageConfig = (project.stages.images.stageConfig ?? {}) as Record<string, unknown>;
    const previous = stageConfig.styleReferenceImage as string | undefined;
    if (previous && previous !== filename) {
      const previousPath = path.join(refDir, previous);
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
    }

    fs.writeFileSync(path.join(refDir, filename), Buffer.from(imageBase64, 'base64'));

    project.stages.images.stageConfig = { ...stageConfig, styleReferenceImage: filename };
    project.markModified('stages.images.stageConfig');
    await project.save();

    res.json({ url: `/api/files/${projectId}/${filename}` });
  } catch (err) { next(err); }
});

// ─── DELETE /stages/images/scenes/:sceneId/reference ─────────────────────────

stagesRouter.delete('/images/scenes/:sceneId/reference', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);

    const project = await ProjectModel.findById(projectId);
    const refImages = ((project?.stages.images.referenceImages ?? {}) as Record<string, string>);
    const filename = refImages[String(sceneId)];
    if (filename) {
      const refPath = path.join(env.TEMP_DIR, projectId, filename);
      if (fs.existsSync(refPath)) fs.unlinkSync(refPath);
    }

    const updated = { ...refImages };
    delete updated[String(sceneId)];
    await ProjectModel.findByIdAndUpdate(projectId, { 'stages.images.referenceImages': updated });

    res.json({ removed: true });
  } catch (err) { next(err); }
});

// ─── DELETE /stages/images/style-reference ──────────────────────────────────

stagesRouter.delete('/images/style-reference', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageConfig = (project.stages.images.stageConfig ?? {}) as Record<string, unknown>;
    const filename = stageConfig.styleReferenceImage as string | undefined;
    if (filename) {
      const refPath = path.join(env.TEMP_DIR, projectId, filename);
      if (fs.existsSync(refPath)) fs.unlinkSync(refPath);
    }

    const updated = { ...stageConfig };
    delete updated.styleReferenceImage;
    project.stages.images.stageConfig = updated;
    project.markModified('stages.images.stageConfig');
    await project.save();

    res.json({ removed: true });
  } catch (err) { next(err); }
});

// ─── POST /stages/images/scenes/:sceneId/regenerate ──────────────────────────

stagesRouter.post('/images/scenes/:sceneId/regenerate', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    // prompt: full replacement; additionalPrompt: appended on top of original
    const { prompt, additionalPrompt, model: bodyModel, refineFromCurrent } = req.body as {
      prompt?: string;
      additionalPrompt?: string;
      model?: string;
      refineFromCurrent?: boolean;
    };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    // Model: body override → project modelConfig → default
    const imageModel = (bodyModel as import('@content-creator/shared').ImageModel | undefined)
      ?? (project.modelConfig as Partial<StageModelConfig> | undefined)?.images
      ?? DEFAULT_STAGE_MODELS.images;

    // Resolve prompt: either explicit full prompt, or original prompt + additional details
    let finalPrompt: string | undefined = prompt;
    if (!finalPrompt) {
      // Get the original prompt from storyboard
      const storyboard = project.stages.storyboard.result as import('@content-creator/shared').Storyboard | undefined;
      const scene = storyboard?.scenes.find(s => s.id === sceneId);
      const aspectRatio = project.input.platform === 'tiktok' ? '9:16' : '16:9';
      const orientation = project.input.platform === 'tiktok' ? 'vertical portrait orientation' : 'horizontal landscape orientation';
      const originalPrompt = scene
        ? `${scene.visual_prompt}, ${scene.mood}, cinematic, high quality, ${aspectRatio} aspect ratio, ${orientation}`
        : undefined;
      if (!originalPrompt) { res.status(400).json({ error: 'No storyboard prompt found; provide prompt explicitly' }); return; }
      finalPrompt = additionalPrompt
        ? `${originalPrompt}. Additional details: ${additionalPrompt}`
        : originalPrompt;
    }

    const result = await regenerateSceneImage(projectId, sceneId, finalPrompt, imageModel, !!refineFromCurrent);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── POST /stages/videos/scenes/:sceneId/regenerate ──────────────────────────

stagesRouter.post('/videos/scenes/:sceneId/regenerate', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { prompt, additionalPrompt, model: bodyModel } = req.body as {
      prompt?: string;
      additionalPrompt?: string;
      model?: string;
    };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    // Model: body override → project modelConfig → default
    const videoModel = (bodyModel as import('@content-creator/shared').VideoModel | undefined)
      ?? (project.modelConfig as Partial<StageModelConfig> | undefined)?.videos
      ?? DEFAULT_STAGE_MODELS.videos;

    // Resolve final prompt
    let finalPrompt: string | undefined = prompt;
    if (!finalPrompt && additionalPrompt) {
      const storyboard = project.stages.storyboard.result as import('@content-creator/shared').Storyboard | undefined;
      const scene = storyboard?.scenes.find(s => s.id === sceneId);
      if (scene) {
        const base = `${scene.visual_prompt}. Camera: ${scene.camera_motion}. Mood: ${scene.mood}. Cinematic.`;
        finalPrompt = `${base} Additional details: ${additionalPrompt}`;
      }
    }

    await regenerateSceneVideo(projectId, sceneId, finalPrompt, videoModel);
    res.json({ accepted: true });
  } catch (err) { next(err); }
});
// ─── POST /stages/images/scenes/:sceneId/select ───────────────────────────────────────────────────

stagesRouter.post('/images/scenes/:sceneId/select', validate(SelectVersionSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { filename } = req.body as { filename: string };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const versions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
    if (!versions[String(sceneId)]?.includes(filename)) {
      res.status(400).json({ error: 'Unknown version filename' }); return;
    }

    const imagePath = path.join(env.TEMP_DIR, projectId, filename);
    if (!fs.existsSync(imagePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

    const imageResults = (project.stages.images.result as Array<{ sceneId: number; imagePath: string; filename?: string; previewUrl?: string }> | undefined) ?? [];
    const idx = imageResults.findIndex(r => r.sceneId === sceneId);
    const previewUrl = `/api/files/${projectId}/${filename}`;
    const newEntry = { sceneId, imagePath, filename, previewUrl };
    if (idx >= 0) { imageResults[idx] = newEntry; } else { imageResults.push(newEntry); }

    const previewUrls = (project.stages.images.reviewData?.previewUrls ?? []) as string[];
    const urlIdx = previewUrls.findIndex(u => u.includes(`/scene_${sceneId}_ref_`));
    if (urlIdx >= 0) { previewUrls[urlIdx] = previewUrl; } else { previewUrls.push(previewUrl); }

    project.stages.images.result = imageResults;
    project.stages.images.reviewData = { previewUrls };
    project.markModified('stages.images.result');
    project.markModified('stages.images.reviewData');
    await project.save();

    res.json({ selected: filename });
  } catch (err) { next(err); }
});

// ─── POST /stages/videos/scenes/:sceneId/upload (direct manual upload) ───────

const VideoUploadSchema = z.object({
  videoBase64: z.string().min(1).max(26_843_546), // ~20 MB decoded max (base64 overhead ~33%)
  mimeType: z.string().min(1),
  durationSeconds: z.number().optional(),
});

stagesRouter.post('/videos/scenes/:sceneId/upload', validate(VideoUploadSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { videoBase64, mimeType, durationSeconds } = req.body as { videoBase64: string; mimeType: string; durationSeconds?: number };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('quicktime') ? 'mov' : 'mp4';
    const existingVersions = (project.stages.videos.sceneVersions ?? {}) as Record<string, string[]>;
    const versionNumber = (existingVersions[String(sceneId)] ?? []).length + 1;
    const filename = `scene_${sceneId}_upload_v${versionNumber}.${ext}`;
    const videoDir = path.join(env.TEMP_DIR, projectId);
    ensureDir(videoDir);
    const videoPath = path.join(videoDir, filename);
    fs.writeFileSync(videoPath, Buffer.from(videoBase64, 'base64'));
    const previewUrl = `/api/files/${projectId}/${filename}`;

    // Upsert result[]
    const videoResults = (project.stages.videos.result as Array<{ sceneId: number; videoPath: string; filename: string; previewUrl: string; durationSeconds?: number; costUSD: number }> | undefined) ?? [];
    const idx = videoResults.findIndex(r => r.sceneId === sceneId);
    const entry = { sceneId, videoPath, filename, previewUrl, durationSeconds: durationSeconds ?? 0, costUSD: 0 };
    if (idx >= 0) { videoResults[idx] = entry; } else { videoResults.push(entry); }

    const newVersions = { ...existingVersions, [String(sceneId)]: [...(existingVersions[String(sceneId)] ?? []), filename] };
    const previewUrls = (project.stages.videos.reviewData?.previewUrls ?? []) as string[];
    const urlIdx = previewUrls.findIndex(u => u.includes(`scene_${sceneId}_`));
    if (urlIdx >= 0) { previewUrls[urlIdx] = previewUrl; } else { previewUrls.push(previewUrl); }

    // Track in stageConfig.manualVideos so generate can skip this scene
    const stageConfig = (project.stages.videos.stageConfig ?? {}) as Record<string, unknown>;
    const manualVideos = { ...((stageConfig.manualVideos ?? {}) as Record<string, string>), [String(sceneId)]: filename };

    project.stages.videos.result = videoResults;
    project.stages.videos.sceneVersions = newVersions;
    project.stages.videos.reviewData = { previewUrls };
    project.stages.videos.stageConfig = { ...stageConfig, manualVideos };
    // Do NOT change status here — SceneVideoSetupPanel already shows the preview
    // via existingResult. Status advances to 'review' only when Generate is clicked.
    // (When status is already 'review', leave it as-is so ReviewVideos still shows all scenes.)
    project.markModified('stages.videos.result');
    project.markModified('stages.videos.sceneVersions');
    project.markModified('stages.videos.reviewData');
    project.markModified('stages.videos.stageConfig');
    await project.save();

    res.json({ filename, previewUrl });
  } catch (err) { next(err); }
});

// ─── PATCH /stages/videos/scenes/:sceneId/prompt (save custom prompt override) ─

stagesRouter.patch('/videos/scenes/:sceneId/prompt', validate(z.object({ prompt: z.string().max(5000) })), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { prompt } = req.body as { prompt: string };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageConfig = (project.stages.videos.stageConfig ?? {}) as Record<string, unknown>;
    const overrides = { ...((stageConfig.scenePromptOverrides ?? {}) as Record<string, string>) };
    overrides[String(sceneId)] = prompt;
    project.stages.videos.stageConfig = { ...stageConfig, scenePromptOverrides: overrides };
    project.markModified('stages.videos.stageConfig');
    await project.save();

    res.json({ saved: true });
  } catch (err) { next(err); }
});

// ─── DELETE /stages/videos/scenes/:sceneId/prompt (remove custom prompt override) ─

stagesRouter.delete('/videos/scenes/:sceneId/prompt', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageConfig = (project.stages.videos.stageConfig ?? {}) as Record<string, unknown>;
    const overrides = { ...((stageConfig.scenePromptOverrides ?? {}) as Record<string, string>) };
    delete overrides[String(sceneId)];
    project.stages.videos.stageConfig = { ...stageConfig, scenePromptOverrides: overrides };
    project.markModified('stages.videos.stageConfig');
    await project.save();

    res.json({ removed: true });
  } catch (err) { next(err); }
});

// ─── DELETE /stages/videos/scenes/:sceneId/upload ────────────────────────────

stagesRouter.delete('/videos/scenes/:sceneId/upload', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const stageConfig = (project.stages.videos.stageConfig ?? {}) as Record<string, unknown>;
    const manualVideos = { ...((stageConfig.manualVideos ?? {}) as Record<string, string>) };
    delete manualVideos[String(sceneId)];

    project.stages.videos.stageConfig = { ...stageConfig, manualVideos };
    project.markModified('stages.videos.stageConfig');
    await project.save();

    res.json({ removed: true });
  } catch (err) { next(err); }
});

// ─── POST /stages/videos/scenes/:sceneId/select ──────────────────────────────────────────────────

stagesRouter.post('/videos/scenes/:sceneId/select', validate(SelectVersionSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const { filename } = req.body as { filename: string };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const versions = (project.stages.videos.sceneVersions ?? {}) as Record<string, string[]>;
    if (!versions[String(sceneId)]?.includes(filename)) {
      res.status(400).json({ error: 'Unknown version filename' }); return;
    }

    const videoPath = path.join(env.TEMP_DIR, projectId, filename);
    if (!fs.existsSync(videoPath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

    const videoResults = (project.stages.videos.result as Array<{ sceneId: number; videoPath: string; filename?: string; previewUrl?: string; durationSeconds?: number; costUSD?: number }> | undefined) ?? [];
    const idx = videoResults.findIndex(r => r.sceneId === sceneId);
    const previewUrl = `/api/files/${projectId}/${filename}`;
    const existing = videoResults[idx];
    const newEntry = { sceneId, videoPath, filename, previewUrl, durationSeconds: existing?.durationSeconds, costUSD: existing?.costUSD };
    if (idx >= 0) { videoResults[idx] = newEntry; } else { videoResults.push(newEntry); }

    const previewUrls = (project.stages.videos.reviewData?.previewUrls ?? []) as string[];
    const urlIdx = previewUrls.findIndex(u => u.includes(`/scene_${sceneId}_v`));
    if (urlIdx >= 0) { previewUrls[urlIdx] = previewUrl; } else { previewUrls.push(previewUrl); }

    project.stages.videos.result = videoResults;
    project.stages.videos.reviewData = { previewUrls };
    project.markModified('stages.videos.result');
    project.markModified('stages.videos.reviewData');
    await project.save();

    res.json({ selected: filename });
  } catch (err) { next(err); }
});

// ─── POST /stages/:stage/select (voiceover | music) ───────────────────────────────────────────

stagesRouter.post('/:stage/select', validateStage, validate(SelectVersionSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const stageKey = req.params.stage as StageKey;
    if (stageKey !== 'voiceover' && stageKey !== 'music') {
      res.status(400).json({ error: 'Only voiceover and music support single-file version selection' }); return;
    }
    const { filename } = req.body as { filename: string };

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const versions = (project.stages[stageKey].sceneVersions ?? {}) as Record<string, string[]>;
    if (!versions['0']?.includes(filename)) {
      res.status(400).json({ error: 'Unknown version filename' }); return;
    }

    const filePath = path.join(env.TEMP_DIR, projectId, filename);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

    const previewUrl = `/api/files/${projectId}/${filename}`;
    if (stageKey === 'voiceover') {
      const existingResult = (project.stages.voiceover.result ?? {}) as {
        durationSeconds?: number;
        sceneTimings?: import('@content-creator/shared').VoiceoverSceneTiming[];
        sceneAudio?: Record<string, import('@content-creator/shared').VoiceoverSceneAudio>;
      };
      project.stages.voiceover.result = {
        audioPath: filePath,
        filename,
        previewUrl,
        durationSeconds: existingResult.durationSeconds,
        sceneTimings: existingResult.sceneTimings,
        sceneAudio: existingResult.sceneAudio,
      };
      project.stages.voiceover.reviewData = { previewUrl };
      project.markModified('stages.voiceover.result');
      project.markModified('stages.voiceover.reviewData');
    } else {
      project.stages.music.result = { musicPath: filePath, filename, previewUrl };
      project.stages.music.reviewData = { previewUrl };
      project.markModified('stages.music.result');
      project.markModified('stages.music.reviewData');
    }
    await project.save();

    res.json({ selected: filename });
  } catch (err) { next(err); }
});
// ─── PATCH /stages/voiceover/settings ────────────────────────────────────────

const VoiceoverSettingsSchema = z.object({
  voice: z.string().max(100).optional(),
  directorNotes: z.object({
    style:  z.string().max(500),
    pacing: z.string().max(500),
    accent: z.string().max(500),
  }).optional(),
  sceneNarrations: z.record(z.string(), z.string().max(2000)).optional(),
});

stagesRouter.patch('/voiceover/settings', validate(VoiceoverSettingsSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const existing = (project.stages.voiceover.stageConfig ?? {}) as VoiceoverStageConfig;
    const updated: VoiceoverStageConfig = { ...existing, ...req.body };

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.voiceover.stageConfig': updated,
    });

    res.json({ saved: true, stageConfig: updated });
  } catch (err) { next(err); }
});

// ─── PATCH /stages/assembly/settings ─────────────────────────────────────────

const AssemblySettingsSchema = z.object({
  voiceVolume:   z.number().min(0).max(1).optional(),
  musicVolume:   z.number().min(0).max(1).optional(),
  fadeInSeconds: z.number().min(0).max(5).optional(),
  fadeOutSeconds: z.number().min(0).max(5).optional(),
  outputQuality: z.enum(['standard', 'high']).optional(),
});

stagesRouter.patch('/assembly/settings', validate(AssemblySettingsSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const existing = (project.stages.assembly.stageConfig ?? {}) as AssemblyStageConfig;
    const updated: AssemblyStageConfig = { ...existing, ...req.body };

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.assembly.stageConfig': updated,
    });

    res.json({ saved: true, stageConfig: updated });
  } catch (err) { next(err); }
});

// ─── PATCH /stages/music/settings ────────────────────────────────────────────

const MusicSettingsSchema = z.object({
  customPrompt: z.string().max(2000).optional(),
});

stagesRouter.patch('/music/settings', validate(MusicSettingsSchema), async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const existing = (project.stages.music.stageConfig ?? {}) as import('@content-creator/shared').MusicStageConfig;
    const updated: import('@content-creator/shared').MusicStageConfig = { ...existing, ...req.body };

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.music.stageConfig': updated,
    });

    res.json({ saved: true, stageConfig: updated });
  } catch (err) { next(err); }
});

// ─── POST /stages/voiceover/auto-tags ────────────────────────────────────────

stagesRouter.post('/voiceover/auto-tags', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const save = String(req.query['save']) === 'true';
    const singleSceneId = req.query['sceneId'] ? parseInt(String(req.query['sceneId']), 10) : null;

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const storyboard = project.stages.storyboard.result as Storyboard | undefined;
    if (!storyboard) { res.status(400).json({ error: 'Storyboard not approved yet' }); return; }

    const stageConfig = (project.stages.voiceover.stageConfig ?? {}) as VoiceoverStageConfig;

    // Build scenes list: optionally filter to a single scene
    const allScenes = storyboard.scenes.map(s => ({
      sceneId: s.id,
      original: stageConfig.sceneNarrations?.[String(s.id)] ?? s.narration,
    }));
    const scenes = singleSceneId !== null
      ? allScenes.filter(s => s.sceneId === singleSceneId)
      : allScenes;

    // Auto-enrich narrations with audio tags using a single batch prompt.
    // All scenes (or single scene + full-script context) are sent together so the
    // AI can maintain a consistent vocal tone and coherent tag flow across scenes —
    // as if the whole script were recorded in one continuous session.
    const { ai } = await import('../services/gemini.service.js');
    const enriched: Array<{ sceneId: number; original: string; enhanced: string }> = [];

    const language = project.input.language;
    const style = project.input.style;
    const platform = project.input.platform;

    // For a single-scene call include the full script as context so tone stays consistent
    const contextScenes = singleSceneId !== null ? allScenes : scenes;

    const scriptContext = contextScenes
      .map(s => {
        const sceneObj = storyboard.scenes.find(sc => sc.id === s.sceneId);
        const actLabel = sceneObj?.act ? ` [${sceneObj.act.toUpperCase()}]` : '';
        return `Scene ${s.sceneId}${actLabel}: ${s.original}`;
      })
      .join('\n');

    const targetSceneList = scenes
      .map(s => {
        const sceneObj = storyboard.scenes.find(sc => sc.id === s.sceneId);
        return `{"sceneId": ${s.sceneId}, "act": "${sceneObj?.act ?? ''}", "narration": ${JSON.stringify(s.original)}}`;
      })
      .join(',\n  ');

    const batchPrompt = `You are a professional voice director and audio engineer.
Your job is to add expressive audio direction tags to narration scripts for a ${platform} video.
Style: ${style} | Language: ${language}

RULES:
1. Maintain a CONSISTENT vocal tone across all scenes — as if one narrator records the whole video in a single session.
2. Tags must FLOW NATURALLY across scene boundaries; the energy arc should match the narrative structure:
   - HOOK: energetic, attention-grabbing, slightly faster pace
   - CONTEXT: clear, informative, steady and warm
   - BUT: tense, dramatic, slower for emphasis
   - REVEAL: satisfying, confident, authoritative or warm close
3. Use tags sparingly — only where they meaningfully affect delivery. Avoid over-tagging every sentence.
4. Common tags (use these consistently, do not invent unusual tags): [pause], [excitedly], [softly], [whispering], [dramatically], [warmly], [confidently], [slowly], [laughs], [sighs], [emphasize]
5. Return a JSON array ONLY — no markdown, no explanation.

FULL SCRIPT CONTEXT (all scenes in order, for tone reference):
${scriptContext}

SCENES TO TAG (return enhanced narration for these scene IDs only):
[
  ${targetSceneList}
]

Return format (JSON array, same order as input):
[{"sceneId": 1, "enhanced": "narration with [tags] inserted"}, ...]`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: batchPrompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '[]';
    let parsed: Array<{ sceneId: number; enhanced: string }> = [];
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Fall back: return originals unchanged
      parsed = scenes.map(s => ({ sceneId: s.sceneId, enhanced: s.original }));
    }

    for (const scene of scenes) {
      const result = parsed.find(p => p.sceneId === scene.sceneId);
      enriched.push({
        sceneId: scene.sceneId,
        original: scene.original,
        enhanced: result?.enhanced?.trim() ?? scene.original,
      });
    }

    if (save) {
      const sceneNarrations: Record<string, string> = {};
      for (const e of enriched) sceneNarrations[String(e.sceneId)] = e.enhanced;
      const updatedConfig: VoiceoverStageConfig = { ...stageConfig, sceneNarrations };
      await ProjectModel.findByIdAndUpdate(projectId, {
        'stages.voiceover.stageConfig': updatedConfig,
      });
    }

    res.json({ scenes: enriched });
  } catch (err) { next(err); }
});

// ─── POST /stages/voiceover/scenes/:sceneId/fit-transcript ─────────────────────
// Rewrites narration to fit the scene duration (same meaning, adjusted length)

stagesRouter.post('/voiceover/scenes/:sceneId/fit-transcript', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt((req.params as Record<string, string>)['sceneId'], 10);
    if (isNaN(sceneId)) { res.status(400).json({ error: 'Invalid sceneId' }); return; }

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const storyboard = project.stages.storyboard.result as Storyboard | undefined;
    if (!storyboard) { res.status(400).json({ error: 'Storyboard not approved yet' }); return; }

    const targetScene = storyboard.scenes.find(s => s.id === sceneId);
    if (!targetScene) { res.status(404).json({ error: `Scene ${sceneId} not found` }); return; }

    const stageConfig = (project.stages.voiceover.stageConfig ?? {}) as VoiceoverStageConfig;
    const currentNarration = stageConfig.sceneNarrations?.[String(sceneId)] ?? targetScene.narration;
    const language = project.input.language;
    const durationSecs = targetScene.duration;

    // WPS estimate matches the frontend badge logic
    const wps = language === 'th' ? 2.2 : 2.5;
    const targetWords = Math.round(durationSecs * wps);

    const langName: Record<string, string> = {
      th: 'Thai', en: 'English', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
    };
    const langLabel = langName[language] ?? language;

    const prompt =
      `You are a scriptwriter. Rewrite the following ${langLabel} narration so it contains approximately ${targetWords} spoken words ` +
      `(suitable for a ${durationSecs}-second video scene spoken at a natural pace). ` +
      `Preserve the original meaning, topic, and tone as closely as possible. ` +
      `Do NOT include audio direction tags. Return ONLY the rewritten narration, nothing else.\n\n` +
      `ORIGINAL NARRATION:\n${currentNarration}`;

    const { ai: geminiAi } = await import('../services/gemini.service.js');
    const response = await geminiAi.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: prompt }] }],
    });

    const rewritten = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? currentNarration;
    res.json({ sceneId, original: currentNarration, rewritten, targetWords, durationSecs });
  } catch (err) { next(err); }
});

// ─── POST /stages/voiceover/scenes/:sceneId/regenerate ────────────────────────

stagesRouter.post('/voiceover/scenes/:sceneId/regenerate', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt((req.params as Record<string, string>)['sceneId'], 10);
    if (isNaN(sceneId)) { res.status(400).json({ error: 'Invalid sceneId' }); return; }

    const project = await ProjectModel.findById(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const mc = (project.modelConfig ?? {}) as import('@content-creator/shared').StageModelConfig;
    const voiceModel = mc.voiceover ?? DEFAULT_STAGE_MODELS.voiceover;

    emitStageStatus({ projectId, stageKey: 'voiceover', status: 'generating', message: 'Regenerating scene voiceover…' });
    await ProjectModel.findByIdAndUpdate(projectId, { 'stages.voiceover.status': 'generating' });

    const onProgress = (msg: string) =>
      emitStageProgress({ projectId, stageKey: 'voiceover', message: msg });

    const result = await regenerateSingleSceneVoiceover(projectId, sceneId, onProgress, voiceModel);
    emitStageResult({ projectId, stageKey: 'voiceover', previewUrls: [result.previewUrl], metadata: {} });
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNextStage(current: StageKey): StageKey | null {
  const order: StageKey[] = ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'];
  const idx = order.indexOf(current);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}

function buildNextStagePrompt(
  stageKey: StageKey,
  project: ProjectDocument
): string | null {
  if (stageKey === 'voiceover') {
    const storyboard = project.stages.storyboard.result as Storyboard | undefined;
    if (storyboard) {
      return storyboard.scenes.map(s => s.narration).join('\n\n');
    }
  }
  if (stageKey === 'music') {
    const storyboard = project.stages.storyboard.result as Storyboard | undefined;
    return storyboard?.music_mood ?? null;
  }
  return null;
}

function getEstimatedSeconds(stageKey: StageKey): number {
  const estimates: Record<StageKey, number> = {
    storyboard: 10,
    images: 30,
    videos: 120,
    voiceover: 15,
    music: 15,
    assembly: 60,
  };
  return estimates[stageKey];
}
