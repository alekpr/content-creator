import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { getDBStatus } from './config/db.js';
import { getRedisStatus } from './jobs/video.queue.js';
import { projectsRouter } from './routes/projects.router.js';
import { stagesRouter } from './routes/stages.router.js';
import { nichesRouter } from './routes/niches.router.js';
import { safeTempPath } from './utils/file.helper.js';
import { errorMiddleware, notFound } from './middleware/error.middleware.js';

export function createApp() {
  const app = express();

  // ─── Core Middleware ───────────────────────────────────────────────────────

  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '30mb' }));

  // ─── Health ────────────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      db: getDBStatus(),
      redis: getRedisStatus(),
      uptime: process.uptime(),
    });
  });

  // ─── File Serving (with path traversal protection) ─────────────────────────

  app.get('/api/files/:projectId/:filename', (req, res) => {
    const safePath = safeTempPath(req.params.projectId, req.params.filename);
    if (!safePath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.sendFile(safePath);
  });

  // ─── API Routes ────────────────────────────────────────────────────────────

  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:id/stages', stagesRouter);
  app.use('/api/niches', nichesRouter);

  // ─── Error Handling ────────────────────────────────────────────────────────

  app.use(notFound);
  app.use(errorMiddleware);

  return app;
}
