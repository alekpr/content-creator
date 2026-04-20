import { Router } from 'express';
import { z } from 'zod';
import { ProjectModel } from '../models/Project.model.js';
import { validate } from '../middleware/validate.middleware.js';
import { buildStoryboardPrompt } from '../pipeline/stage1-storyboard.js';
import { estimateTotalCost, durationToSceneCount } from '../utils/cost.calculator.js';
import { cleanupProjectTemp } from '../utils/file.helper.js';
import type { CreateProjectResponse } from '@content-creator/shared';

export const projectsRouter = Router();

// ─── Validation Schema ────────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  topic: z.string().min(3).max(500),
  platform: z.enum(['youtube', 'tiktok', 'instagram', 'linkedin']),
  duration: z.enum(['30s', '60s', '3min']),
  style: z.enum(['cinematic', 'educational', 'promotional', 'documentary']),
  language: z.enum(['en', 'th', 'ja', 'zh', 'ko']),
  voice: z.enum(['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede']),
  includeMusic: z.boolean(),
});

// ─── POST /api/projects ───────────────────────────────────────────────────────

projectsRouter.post('/', validate(CreateProjectSchema), async (req, res, next) => {
  try {
    const input = req.body;
    const storyboardPrompt = buildStoryboardPrompt(input);
    const estimatedCostUSD = estimateTotalCost(input.duration, durationToSceneCount(input.duration), input.includeMusic);

    const project = await ProjectModel.create({
      title: input.topic.slice(0, 100),
      input,
      stages: {
        storyboard: { status: 'prompt_ready', prompt: storyboardPrompt, attempts: [] },
        images:     { status: 'pending', prompt: '', attempts: [] },
        videos:     { status: 'pending', prompt: '', attempts: [] },
        voiceover:  { status: 'pending', prompt: '', attempts: [] },
        music:      { status: 'pending', prompt: '', attempts: [] },
        assembly:   { status: 'pending', prompt: '', attempts: [] },
      },
    });

    const response: CreateProjectResponse = {
      projectId: project._id.toString(),
      status: project.status,
      stages: {
        storyboard: { status: 'prompt_ready', prompt: storyboardPrompt },
        images:     { status: 'pending' },
        videos:     { status: 'pending' },
        voiceover:  { status: 'pending' },
        music:      { status: 'pending' },
        assembly:   { status: 'pending' },
      },
      estimatedCostUSD,
    };

    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/projects ────────────────────────────────────────────────────────

projectsRouter.get('/', async (_req, res, next) => {
  try {
    const projects = await ProjectModel.find({})
      .sort({ createdAt: -1 })
      .select('title status input costUSD createdAt updatedAt');

    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/projects/:id ────────────────────────────────────────────────────

projectsRouter.get('/:id', async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────

projectsRouter.delete('/:id', async (req, res, next) => {
  try {
    const project = await ProjectModel.findByIdAndDelete(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    cleanupProjectTemp(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/projects/:id/download ──────────────────────────────────────────

projectsRouter.get('/:id/download', async (req, res, next) => {
  try {
    const project = await ProjectModel.findById(req.params.id).select('output status');
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (project.status !== 'completed' || !project.output?.filePath) {
      res.status(400).json({ error: 'Project output not ready' });
      return;
    }
    res.download(project.output.filePath, `${req.params.id}.mp4`);
  } catch (err) {
    next(err);
  }
});
