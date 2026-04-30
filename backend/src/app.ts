import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
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

  // ─── Electron Production: Serve built frontend from Express ────────────────
  // When SERVE_FRONTEND=true the renderer and backend share the same origin
  // (http://localhost:3001), eliminating any CORS concerns entirely.

  if (process.env.SERVE_FRONTEND === 'true' && process.env.FRONTEND_DIST_DIR) {
    const frontendDist = process.env.FRONTEND_DIST_DIR;
    if (fs.existsSync(frontendDist)) {
      app.use(express.static(frontendDist));
      // SPA fallback — all non-API GET requests return index.html for React Router
      app.get('/{*path}', (_req, res) => {
        res.sendFile(path.join(frontendDist, 'index.html'));
      });
    } else {
      console.warn(`[App] SERVE_FRONTEND=true but FRONTEND_DIST_DIR not found: ${frontendDist}`);
    }
  }

  // ─── Error Handling ────────────────────────────────────────────────────────

  app.use(notFound);
  app.use(errorMiddleware);

  return app;
}
