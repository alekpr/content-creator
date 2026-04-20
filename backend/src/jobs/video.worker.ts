import { Worker, type Job } from 'bullmq';
import path from 'path';
import { redis, type VideoJobData, type VideoJobResult } from './video.queue.js';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { emitStageProgress, emitStageStatus, emitStageError } from '../socket/socket.handler.js';
import { sleep } from '../utils/sleep.js';
import { ensureDir } from '../utils/file.helper.js';
import { estimateVideoCost } from '../utils/cost.calculator.js';
import { env } from '../config/env.js';

const MAX_POLL_RETRIES = 180;        // 30 min at 10s intervals
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const BASE_POLL_INTERVAL_MS = 10_000;
const MAX_POLL_INTERVAL_MS = 60_000;

async function processVideoJob(job: Job<VideoJobData, VideoJobResult>): Promise<VideoJobResult> {
  const { projectId, sceneId, prompt, negativePrompt, aspectRatio, durationSeconds, resolution, imageBase64, attemptNumber } = job.data;
  const startTime = Date.now();

  emitStageProgress({ projectId, stageKey: 'videos', sceneId, message: `Scene ${sceneId}: submitting to Veo...` });

  // Submit to Veo
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt,
    image: { imageBytes: imageBase64, mimeType: 'image/png' },
    config: {
      aspectRatio,
      durationSeconds: parseInt(durationSeconds, 10),
      resolution,
      ...(negativePrompt ? { negativePrompt } : {}),
    },
  });

  // Polling loop
  let retries = 0;
  const pollStart = Date.now();

  while (!operation.done) {
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
      throw new Error(`Veo timeout after ${POLL_TIMEOUT_MS / 1000}s for scene ${sceneId}`);
    }
    if (retries >= MAX_POLL_RETRIES) {
      throw new Error(`Veo exceeded max poll retries (${MAX_POLL_RETRIES}) for scene ${sceneId}`);
    }

    const interval = Math.min(
      BASE_POLL_INTERVAL_MS * Math.pow(1.05, retries),
      MAX_POLL_INTERVAL_MS
    );

    emitStageProgress({
      projectId,
      stageKey: 'videos',
      sceneId,
      message: `Scene ${sceneId}: generating... (poll ${retries + 1})`,
    });

    await sleep(interval);
    operation = await ai.operations.getVideosOperation({ operation });
    retries++;
    await job.updateProgress(Math.min(retries / MAX_POLL_RETRIES * 90, 90));
  }

  // Check for Veo error
  if (!operation.response?.generatedVideos?.[0]?.video) {
    throw new Error(`Veo returned no video for scene ${sceneId}`);
  }

  // Download video
  const videoDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(videoDir);
  const videoPath = path.join(videoDir, `scene_${sceneId}.mp4`);

  await ai.files.download({
    file: operation.response.generatedVideos[0].video,
    downloadPath: videoPath,
  });

  const durationMs = Date.now() - startTime;
  const costUSD = estimateVideoCost(Number(durationSeconds));

  // Update MongoDB — update the specific scene in the result array
  const project = await ProjectModel.findById(projectId);
  if (project) {
    const videoResult = project.stages.videos.result as Array<{ sceneId: number; videoPath: string; durationSeconds: number }> ?? [];
    const idx = videoResult.findIndex(r => r.sceneId === sceneId);
    const entry = { sceneId, videoPath, durationSeconds: Number(durationSeconds) };

    if (idx >= 0) {
      videoResult[idx] = entry;
    } else {
      videoResult.push(entry);
    }

    const previewUrl = `/api/files/${projectId}/scene_${sceneId}.mp4`;
    const existingUrls = (project.stages.videos.reviewData?.previewUrls ?? []) as string[];
    if (!existingUrls.includes(previewUrl)) existingUrls.push(previewUrl);

    project.stages.videos.result = videoResult;
    project.stages.videos.reviewData = { previewUrls: existingUrls };

    // Push attempt
    project.stages.videos.attempts.push({
      attemptNumber,
      promptUsed: prompt,
      outputPaths: [videoPath],
      costUSD,
      durationMs,
      createdAt: new Date(),
    });

    project.costUSD = (project.costUSD ?? 0) + costUSD;
    await project.save();
  }

  // Write generation log
  await GenerationLogModel.create({
    projectId,
    stageKey: 'videos',
    attemptNumber,
    promptUsed: prompt,
    modelUsed: 'veo-3.1-fast-generate-preview',
    configUsed: { aspectRatio, durationSeconds, resolution },
    status: 'success',
    outputPaths: [videoPath],
    durationMs,
    costUSD,
  });

  emitStageProgress({ projectId, stageKey: 'videos', sceneId, message: `Scene ${sceneId}: done`, percent: 100 });
  await job.updateProgress(100);

  return { sceneId, videoPath, costUSD, durationMs };
}

export function startVideoWorker(): Worker<VideoJobData, VideoJobResult> {
  const worker = new Worker<VideoJobData, VideoJobResult>(
    'video-generation',
    processVideoJob,
    {
      connection: redis,
      concurrency: 3,
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { projectId, sceneId } = job.data;
    console.error(`[VideoWorker] Job failed for scene ${sceneId}:`, err.message);

    // Only mark as failed if all retries exhausted
    if ((job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1)) {
      await ProjectModel.findByIdAndUpdate(projectId, {
        'stages.videos.status': 'failed',
        'stages.videos.error': err.message,
      });

      await GenerationLogModel.create({
        projectId,
        stageKey: 'videos',
        attemptNumber: job.attemptsMade,
        promptUsed: job.data.prompt,
        modelUsed: 'veo-3.1-fast-generate-preview',
        status: 'failed',
        outputPaths: [],
        error: err.message,
        durationMs: 0,
        costUSD: 0,
      });

      emitStageError({ projectId, stageKey: 'videos', error: err.message });
      emitStageStatus({ projectId, stageKey: 'videos', status: 'failed', message: err.message });
    }
  });

  console.log('[VideoWorker] Worker started');
  return worker;
}
