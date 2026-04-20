import http from 'http';
import cron from 'node-cron';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSocketIO } from './socket/socket.handler.js';
import { startVideoWorker } from './jobs/video.worker.js';
import { cleanupOldTempDirs } from './utils/file.helper.js';

async function main() {
  // Connect to MongoDB
  await connectDB();

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
