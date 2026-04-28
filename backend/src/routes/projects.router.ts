import { Router } from 'express';
import { z } from 'zod';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { validate } from '../middleware/validate.middleware.js';
import { buildStoryboardPrompt } from '../pipeline/stage1-storyboard.js';
import { estimateTotalCost, durationToSceneCount } from '../utils/cost.calculator.js';
import { cleanupProjectTemp, cleanupProjectOutput } from '../utils/file.helper.js';
import { DURATION_VALUES } from '@content-creator/shared';
import type { CreateProjectResponse } from '@content-creator/shared';

export const projectsRouter = Router();

// ─── Validation Schema ────────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  topic: z.string().min(3).max(500),
  platform: z.enum(['youtube', 'tiktok', 'instagram', 'linkedin']),
  duration: z.enum(DURATION_VALUES),
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
      estimatedCostUSD,
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
      .select('title status input costUSD estimatedCostUSD createdAt updatedAt publishedTo');

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
    // Delete all generated files from disk
    cleanupProjectTemp(req.params.id);
    cleanupProjectOutput(req.params.id);
    // Delete all generation logs for this project
    await GenerationLogModel.deleteMany({ projectId: project._id });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/projects/:id/publish ──────────────────────────────────────────

projectsRouter.patch('/:id/publish', async (req, res, next) => {
  try {
    const { platform, action } = req.body;
    console.log('🔄 PATCH /api/projects/:id/publish', { projectId: req.params.id, platform, action });
    
    if (!platform || !['youtube', 'tiktok', 'facebook'].includes(platform)) {
      res.status(400).json({ error: 'Invalid platform' });
      return;
    }
    
    if (!action || !['add', 'remove'].includes(action)) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }
    
    // Use Mongoose operators to properly update array
    const updateOperation = action === 'add' 
      ? { $addToSet: { publishedTo: platform } }  // Add only if not exists
      : { $pull: { publishedTo: platform } };     // Remove from array
    
    console.log('📝 Update operation:', updateOperation);
    
    const updated = await ProjectModel.findByIdAndUpdate(
      req.params.id,
      updateOperation,
      { new: true }  // Return updated document
    );
    
    if (!updated) {
      console.log('❌ Project not found:', req.params.id);
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    
    console.log('✅ Updated publishedTo:', updated.publishedTo);
    res.json(updated);
  } catch (err) {
    console.error('❌ Error in PATCH /publish:', err);
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
