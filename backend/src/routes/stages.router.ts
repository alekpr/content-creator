import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { ProjectModel, type ProjectDocument } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { validate } from '../middleware/validate.middleware.js';
import { emitStageStatus, emitStageProgress, emitStageResult, emitStageError } from '../socket/socket.handler.js';
import { generateStoryboard } from '../pipeline/stage1-storyboard.js';
import { generateImages, buildImagePrompts, regenerateSceneImage } from '../pipeline/stage2-images.js';
import { submitVideoGenerationJobs, waitForVideoJobs, regenerateSceneVideo } from '../pipeline/stage3-videos.js';
import { generateVoiceover, buildVoiceoverScript } from '../pipeline/stage4-voiceover.js';
import { generateMusic } from '../pipeline/stage5-music.js';
import { assembleVideo } from '../pipeline/stage6-assembly.js';
import fs from 'fs';
import type { StageKey, Storyboard, StageDoc } from '@content-creator/shared';

export const stagesRouter = Router({ mergeParams: true });

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const generateLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many generate requests, please slow down' },
});

// ─── Validation Schemas ───────────────────────────────────────────────────────

const STAGE_KEYS: StageKey[] = ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'];

function isValidStage(s: string): s is StageKey {
  return STAGE_KEYS.includes(s as StageKey);
}

const PromptUpdateSchema = z.object({
  prompt: z.string().min(5).max(5000),
  sceneId: z.number().int().positive().optional(),
  negativePrompt: z.string().max(2000).optional(),
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
    await (project as NonNullable<typeof project>).save();

    res.json(storyboard.scenes[idx]);
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

  const onProgress = (msg: string) => emitStageProgress({ projectId, stageKey, message: msg });

  try {
    switch (stageKey) {
      case 'storyboard': {
        const prompt = (body.prompt as string | undefined) ?? String(project.stages.storyboard.prompt ?? '');
        const storyboard = await generateStoryboard(projectId, prompt, onProgress);
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
        const results = await generateImages(projectId, prompts, onProgress);
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
        const jobIds = await submitVideoGenerationJobs(projectId, storyboard.scenes, sceneImagesWithBase64, project.input.platform, attemptNumber);

        await ProjectModel.findByIdAndUpdate(projectId, {
          'stages.videos.status': 'generating',
        });

        await waitForVideoJobs(projectId, jobIds, storyboard.scenes.length);
        break;
      }
      case 'voiceover': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        if (!storyboard) throw new Error('Storyboard not approved yet');
        const config = buildVoiceoverScript(storyboard, project.input.voice);
        const result = await generateVoiceover(projectId, config, onProgress);
        emitStageResult({ projectId, stageKey, previewUrls: [result.previewUrl], metadata: {} });
        break;
      }
      case 'music': {
        const storyboard = project.stages.storyboard.result as Storyboard | undefined;
        const musicMood = (body.musicMood as string | undefined) ?? storyboard?.music_mood ?? 'upbeat, positive';
        const result = await generateMusic(projectId, musicMood, onProgress);
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

    emitStageStatus({ projectId, stageKey, status: 'review', message: 'Generation complete, ready for review' });
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

// ─── POST /stages/images/scenes/:sceneId/regenerate ──────────────────────────

stagesRouter.post('/images/scenes/:sceneId/regenerate', async (req, res, next) => {
  try {
    const sceneId = parseInt(req.params.sceneId as string, 10);
    const prompt = req.body.prompt as string | undefined;
    if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }

    const result = await regenerateSceneImage((req.params as Record<string, string>)['id'], sceneId, prompt);
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
