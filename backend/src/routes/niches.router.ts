import { Router } from 'express';
import { z } from 'zod';
import { NicheAnalysisModel } from '../models/NicheAnalysis.model.js';
import { ProjectModel } from '../models/Project.model.js';
import { validate } from '../middleware/validate.middleware.js';
import { analyzeNiche, generateMoreIdeas } from '../services/NicheService.js';
import { buildStoryboardPrompt } from '../pipeline/stage1-storyboard.js';
import { estimateTotalCost, durationToSceneCount } from '../utils/cost.calculator.js';
import type { NicheAnalysisResponse } from '@content-creator/shared';

export const nichesRouter = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const NicheInputSchema = z.object({
  interests: z.string().min(1).max(500),
  platforms: z.array(z.enum(['youtube', 'tiktok', 'instagram', 'linkedin'])).min(1),
  timePerWeek: z.enum(['low', 'mid', 'high']),
  goal: z.enum(['income', 'passive', 'affiliate', 'brand']),
  budgetTHB: z.number().min(0),
  language: z.enum(['en', 'th', 'ja', 'zh', 'ko']),
  market: z.enum(['thai', 'global', 'both']),
});

const UseNicheSchema = z.object({
  nicheIndex: z.number().int().min(0).max(2),
});

// ─── POST /api/niches/analyze ─────────────────────────────────────────────────

nichesRouter.post('/analyze', validate(NicheInputSchema), async (req, res, next) => {
  try {
    const doc = await analyzeNiche(req.body);

    const response: NicheAnalysisResponse = {
      id: doc._id.toString(),
      topPick: doc.topPick,
      tip: doc.tip,
      results: doc.results,
      costUSD: doc.costUSD,
      durationMs: doc.durationMs,
      createdAt: doc.createdAt.toISOString(),
    };

    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/niches ──────────────────────────────────────────────────────────

nichesRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query['limit']) || 20, 100);
    const skip  = Number(req.query['skip']) || 0;

    const docs = await NicheAnalysisModel.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('topPick tip results costUSD durationMs createdAt input');

    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/niches/:id ──────────────────────────────────────────────────────

nichesRouter.get('/:id', async (req, res, next) => {
  try {
    const doc = await NicheAnalysisModel.findById(req.params['id']);
    if (!doc) {
      res.status(404).json({ error: 'Niche analysis not found' });
      return;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/niches/:id ───────────────────────────────────────────────────

nichesRouter.delete('/:id', async (req, res, next) => {
  try {
    const doc = await NicheAnalysisModel.findByIdAndDelete(req.params['id']);
    if (!doc) {
      res.status(404).json({ error: 'Niche analysis not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/niches/:id/results/:nicheIndex/more-ideas ─────────────────────

nichesRouter.post('/:id/results/:nicheIndex/more-ideas', async (req, res, next) => {
  try {
    const doc = await NicheAnalysisModel.findById(req.params['id']);
    if (!doc) { res.status(404).json({ error: 'Niche analysis not found' }); return; }

    const nicheIndex = parseInt(req.params['nicheIndex'] as string, 10);
    const niche = doc.results[nicheIndex];
    if (!niche) { res.status(400).json({ error: `nicheIndex ${nicheIndex} out of range` }); return; }

    const newIdeas = await generateMoreIdeas(
      niche.name,
      niche.description,
      niche.contentIdeas,
      doc.input.language,
    );

    // Append to DB so subsequent "load more" won't repeat
    doc.results[nicheIndex].contentIdeas = [...niche.contentIdeas, ...newIdeas];
    doc.markModified('results');
    await doc.save();

    res.json({ ideas: newIdeas });
  } catch (err) { next(err); }
});

// ─── POST /api/niches/:id/use ─────────────────────────────────────────────────

nichesRouter.post('/:id/use', validate(UseNicheSchema), async (req, res, next) => {
  try {
    const doc = await NicheAnalysisModel.findById(req.params['id']);
    if (!doc) {
      res.status(404).json({ error: 'Niche analysis not found' });
      return;
    }

    const { nicheIndex } = req.body as { nicheIndex: number };
    const niche = doc.results[nicheIndex];
    if (!niche) {
      res.status(400).json({ error: `nicheIndex ${nicheIndex} out of range` });
      return;
    }

    const input = {
      topic: niche.suggestedTopic,
      platform: doc.input.platforms[0],
      duration: '64s' as const,
      style: niche.suggestedStyle,
      language: doc.input.language,
      voice: 'Puck' as const,
      includeMusic: true,
    };

    const storyboardPrompt = buildStoryboardPrompt(input);
    const estimatedCostUSD = estimateTotalCost(input.duration, durationToSceneCount(input.duration), input.includeMusic);

    const project = await ProjectModel.create({
      title: niche.suggestedTopic.slice(0, 100),
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

    const projectId = project._id.toString();
    res.status(201).json({ projectId, redirectUrl: `/projects/${projectId}` });
  } catch (err) {
    next(err);
  }
});
