import { Worker, UnrecoverableError, type Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { redis, type VideoJobData, type VideoJobResult } from './video.queue.js';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { emitStageProgress, emitStageStatus, emitStageError } from '../socket/socket.handler.js';
import { sleep } from '../utils/sleep.js';
import { ensureDir } from '../utils/file.helper.js';
import { estimateVideoCost } from '../utils/cost.calculator.js';
import { env } from '../config/env.js';

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);

const MAX_POLL_RETRIES = 180;        // 30 min at 10s intervals
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const BASE_POLL_INTERVAL_MS = 10_000;
const MAX_POLL_INTERVAL_MS = 60_000;

async function processVideoJob(job: Job<VideoJobData, VideoJobResult>): Promise<VideoJobResult> {
  const { projectId, sceneId, prompt, negativePrompt, aspectRatio, durationSeconds, imageBase64, attemptNumber, videoModel, versionNumber } = job.data;
  const startTime = Date.now();

  emitStageProgress({ projectId, stageKey: 'videos', sceneId, message: `Scene ${sceneId}: submitting to Veo...` });

  // ─── Generate video file (real or mock) ──────────────────────────────────────
  const videoDir = path.join(env.TEMP_DIR, projectId);
  ensureDir(videoDir);
  const vFilename = `scene_${sceneId}_v${versionNumber}.mp4`;
  const videoPath = path.join(videoDir, vFilename);
  let costUSD: number;

  if (videoModel === 'mock') {
    // Generate mock video from the scene reference image with a slow Ken Burns zoom effect
    const [w, h] = aspectRatio === '9:16' ? [720, 1280] : [1280, 720];
    const dur = parseInt(durationSeconds, 10);
    const fps = 24;
    const totalFrames = dur * fps;

    // Write imageBase64 to a temp PNG so ffmpeg can read it
    const tmpImgPath = path.join(env.TEMP_DIR, projectId, `mock_src_${sceneId}.png`);
    fs.writeFileSync(tmpImgPath, Buffer.from(imageBase64, 'base64'));

    // Ken Burns: slow zoom-in from 1.0x to 1.06x over the clip duration
    // zoompan filter: zoom progresses each frame, output size locked to scene dimensions
    const zoomExpr = `zoom='min(zoom+${(0.06 / totalFrames).toFixed(6)},1.06)'`;
    const xExpr = `x='iw/2-(iw/zoom/2)'`;
    const yExpr = `y='ih/2-(ih/zoom/2)'`;
    const zoompanFilter = `scale=${w * 2}:${h * 2},zoompan=${zoomExpr}:${xExpr}:${yExpr}:d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(tmpImgPath)
        .inputOptions(['-loop 1'])
        .complexFilter([zoompanFilter])
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', `-t ${dur}`, '-an'])
        .output(videoPath)
        .on('end', () => { try { fs.unlinkSync(tmpImgPath); } catch {} resolve(); })
        .on('error', (err: Error) => reject(new Error(`Mock video ffmpeg error: ${err.message}`)))
        .run();
    });
    costUSD = 0;
  } else {
  // Submit to Veo
  const supportsNegativePrompt = videoModel !== 'veo-3.1-lite-generate-preview';
  let operation = await ai.models.generateVideos({
    model: videoModel ?? 'veo-3.1-fast-generate-preview',
    prompt,
    image: { imageBytes: imageBase64, mimeType: 'image/png' },
    config: {
      aspectRatio,
      durationSeconds: parseInt(durationSeconds, 10),
      ...(supportsNegativePrompt && negativePrompt ? { negativePrompt } : {}),
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
  const vFilename = `scene_${sceneId}_v${versionNumber}.mp4`;
  const videoPath = path.join(videoDir, vFilename);

  await ai.files.download({
    file: operation.response.generatedVideos[0].video,
    downloadPath: videoPath,
  });

  costUSD = estimateVideoCost(Number(durationSeconds));
  } // end non-mock

  const durationMs = Date.now() - startTime;

  // Remove any existing result entry for this sceneId (handles regeneration),
  // then atomically push the new entry + update all related fields.
  await ProjectModel.findByIdAndUpdate(projectId, {
    $pull: { 'stages.videos.result': { sceneId } },
  });

  const previewUrl = `/api/files/${projectId}/${vFilename}`;
  const entry = { sceneId, videoPath, filename: vFilename, previewUrl, durationSeconds: Number(durationSeconds), costUSD };
  const attemptEntry = { attemptNumber, promptUsed: prompt, outputPaths: [videoPath], costUSD, durationMs, createdAt: new Date() };

  await ProjectModel.findByIdAndUpdate(projectId, {
    $push: {
      'stages.videos.result': entry,
      'stages.videos.attempts': attemptEntry,
      [`stages.videos.sceneVersions.${sceneId}`]: vFilename,
    },
    $addToSet: { 'stages.videos.reviewData.previewUrls': previewUrl },
    $inc: { costUSD },
  });

  // Write generation log
  await GenerationLogModel.create({
    projectId,
    stageKey: 'videos',
    attemptNumber,
    promptUsed: prompt,
    modelUsed: videoModel ?? 'veo-3.1-fast-generate-preview',
    configUsed: { aspectRatio, durationSeconds },
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
    async (job) => {
      try {
        return await processVideoJob(job);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Don't retry on rate limit or permission errors — they won't recover on retry
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('403') || msg.includes('NOT_FOUND')) {
          throw new UnrecoverableError(msg);
        }
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 1,
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
