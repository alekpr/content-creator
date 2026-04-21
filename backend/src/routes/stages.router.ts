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
import { generateVoiceover, buildVoiceoverScript } from '../pipeline/stage4-voiceover.js';
import { generateMusic } from '../pipeline/stage5-music.js';
import { assembleVideo } from '../pipeline/stage6-assembly.js';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { ensureDir } from '../utils/file.helper.js';
import type { StageKey, Storyboard, StageDoc, CostBreakdown, StageCostEntry, StageModelConfig } from '@content-creator/shared';
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
        const prompts = buildImagePrompts(storyboard);
        const model = mc.images ?? DEFAULT_STAGE_MODELS.images;
        const refImages = (project.stages.images.referenceImages ?? {}) as Record<string, string>;
        const results = await generateImages(projectId, prompts, onProgress, model, refImages);
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

        const attemptNumber = (project.stages.videos.attempts?.length ?? 0) + 1;
        const videoModel = mc.videos ?? DEFAULT_STAGE_MODELS.videos;
        const jobIds = await submitVideoGenerationJobs(projectId, storyboard.scenes, sceneImagesWithBase64, project.input.platform, attemptNumber, videoModel);

        await ProjectModel.findByIdAndUpdate(projectId, {
          'stages.videos.status': 'generating',
        });

        await waitForVideoJobs(projectId, jobIds, jobIds.length);
        break;
      }
      case 'voiceover': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        if (!storyboard) throw new Error('Storyboard not approved yet');
        const config = buildVoiceoverScript(storyboard, project.input.voice, project.input.language);
        const voiceModel = mc.voiceover ?? DEFAULT_STAGE_MODELS.voiceover;
        const result = await generateVoiceover(projectId, config, onProgress, voiceModel);
        emitStageResult({ projectId, stageKey, previewUrls: [result.previewUrl], metadata: {} });
        break;
      }
      case 'music': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        const musicMood = (body.musicMood as string | undefined) ?? storyboard?.music_mood ?? 'upbeat, positive';
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

        if (!voicePath) throw new Error('Voiceover not approved yet');
        if (videoPaths.length === 0) throw new Error('No video clips found');

        const assemblyConfig = {
          voiceVolume: 1.0,
          musicVolume: 0.2,
          fadeInSeconds: 0.5,
          fadeOutSeconds: 1.0,
          outputFormat: 'mp4' as const,
          outputQuality: 'standard' as const,
          ...(body.config as object | undefined),
        };

        const result = await assembleVideo(
          projectId,
          videoPaths,
          voicePath,
          musicPath,
          assemblyConfig,
          percent => emitStageProgress({ projectId, stageKey, message: `Assembling... ${percent}%`, percent })
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

    // Unlock next stage
    const nextStage = getNextStage(stageKey);
    if (nextStage) {
      updates[`stages.${nextStage}.status`] = 'prompt_ready';
      // Pre-build prompt for next stage if possible
      const nextPrompt = buildNextStagePrompt(nextStage, project);
      if (nextPrompt) updates[`stages.${nextStage}.prompt`] = nextPrompt;
    }

    await ProjectModel.findByIdAndUpdate(req.params.id, updates);
    emitStageStatus({ projectId: req.params.id, stageKey, status: 'approved', message: 'Stage approved' });
    if (nextStage) {
      emitStageStatus({ projectId: req.params.id, stageKey: nextStage, status: 'prompt_ready', message: 'Ready for review' });
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
    await ProjectModel.findByIdAndUpdate(req.params.id, {
      [`stages.${req.params.stage}.status`]: 'prompt_ready',
      [`stages.${req.params.stage}.error`]: null,
      [`stages.${req.params.stage}.result`]: null,
      [`stages.${req.params.stage}.reviewData`]: null,
    });
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

// ─── POST /stages/images/scenes/:sceneId/regenerate ──────────────────────────

stagesRouter.post('/images/scenes/:sceneId/regenerate', async (req, res, next) => {
  try {
    const projectId = (req.params as Record<string, string>)['id'];
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const prompt = req.body.prompt as string | undefined;
    if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }

    const project = await ProjectModel.findById(projectId);
    const imageModel = (project?.modelConfig as Partial<StageModelConfig> | undefined)?.images ?? DEFAULT_STAGE_MODELS.images;
    const result = await regenerateSceneImage(projectId, sceneId, prompt, imageModel);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── POST /stages/videos/scenes/:sceneId/regenerate ──────────────────────────

stagesRouter.post('/videos/scenes/:sceneId/regenerate', async (req, res, next) => {
  try {
    const sceneId = parseInt(req.params.sceneId as string, 10);
    await regenerateSceneVideo((req.params as Record<string, string>)['id'], sceneId, req.body.prompt as string | undefined);
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
      project.stages.voiceover.result = { audioPath: filePath, filename, previewUrl };
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
