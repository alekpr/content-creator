import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const videoQueue = new Queue<VideoJobData, VideoJobResult>('video-generation', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const videoQueueEvents = new QueueEvents('video-generation', { connection: redis });

// ─── Job Data Types ───────────────────────────────────────────────────────────

export interface VideoJobData {
  projectId: string;
  sceneId: number;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16';
  durationSeconds: '4' | '6' | '8';
  imageBase64: string;
  attemptNumber: number;
  videoModel?: string;
  versionNumber: number;
}

export interface VideoJobResult {
  sceneId: number;
  videoPath: string;
  costUSD: number;
  durationMs: number;
}

export function getRedisStatus(): 'ready' | 'not ready' {
  return redis.status === 'ready' ? 'ready' : 'not ready';
}
