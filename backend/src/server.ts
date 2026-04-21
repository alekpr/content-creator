import http from 'http';
import cron from 'node-cron';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSocketIO } from './socket/socket.handler.js';
import { startVideoWorker } from './jobs/video.worker.js';
import { cleanupOldTempDirs } from './utils/file.helper.js';
import { ProjectModel } from './models/Project.model.js';

const STAGE_KEYS = ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'] as const;

/**
 * On startup, reset any stage stuck in "generating" back to "failed".
 * This happens when the server was killed mid-generation and MongoDB was never updated.
 */
async function recoverStuckGenerations(): Promise<void> {
  const stageFilters = STAGE_KEYS.map(k => ({ [`stages.${k}.status`]: 'generating' }));
  const stuckProjects = await ProjectModel.find({ $or: stageFilters });

  if (stuckProjects.length === 0) return;

  console.log(`[Startup] Found ${stuckProjects.length} project(s) with stuck generating stages — resetting to failed`);

  for (const project of stuckProjects) {
    const updates: Record<string, unknown> = {};
    for (const key of STAGE_KEYS) {
      if ((project.stages[key] as { status: string }).status === 'generating') {
        updates[`stages.${key}.status`] = 'failed';
        updates[`stages.${key}.error`] = 'Generation interrupted — server was restarted. Please try again.';
        console.log(`  → project ${project._id}: stage "${key}" reset to failed`);
      }
    }
    await ProjectModel.findByIdAndUpdate(project._id, updates);
  }
}

async function main() {
  // Connect to MongoDB
  await connectDB();

  // Reset any stages stuck in "generating" from a previous crashed/killed run
  await recoverStuckGenerations();

  // Build Express app
  const app = createApp();

  // Create HTTP server and attach Socket.io
  const httpServer = http.createServer(app);
  initSocketIO(httpServer);

  // Start BullMQ video worker
  startVideoWorker();

  // Schedule daily cleanup of old temp directories (runs at 2 AM)
  cron.schedule('0 2 * * *', () => {
    console.log('[Cron] Running temp directory cleanup...');
    cleanupOldTempDirs(48 * 60 * 60 * 1000); // 48 hours
  });

  // Start listening
  httpServer.listen(env.PORT, () => {
    console.log(`[Server] Running on port ${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Server] Shutting down...');
    httpServer.close();
    const { closeDB } = await import('./config/db.js');
    await closeDB();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT',  () => void shutdown());
}

main().catch(err => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
