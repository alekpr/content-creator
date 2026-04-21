import fs from 'fs';
import { Job } from 'bullmq';
import { videoQueue, videoQueueEvents } from '../jobs/video.queue.js';
import { ProjectModel } from '../models/Project.model.js';
import {
  emitStageStatus,
  emitStageProgress,
  emitStageResult,
} from '../socket/socket.handler.js';
import type { StoryboardScene, SceneImageResult } from '@content-creator/shared';
import type { VideoGenerationConfig } from '@content-creator/shared';

// ─── Config Builder ───────────────────────────────────────────────────────────

export function buildVideoConfig(
  scene: StoryboardScene,
  platform: string
): VideoGenerationConfig {
  return {
    prompt: `${scene.visual_prompt}. Camera: ${scene.camera_motion}. Mood: ${scene.mood}. Cinematic.`,
    negativePrompt: scene.negative_prompt,
    aspectRatio: platform === 'tiktok' ? '9:16' : '16:9',
    durationSeconds: String(scene.duration) as '4' | '6' | '8',
  };
}

// ─── Submit All Scenes to BullMQ ──────────────────────────────────────────────

export async function submitVideoGenerationJobs(
  projectId: string,
  scenes: StoryboardScene[],
  sceneImages: SceneImageResult[],
  platform: string,
  attemptNumber: number,
  videoModel = 'veo-3.1-fast-generate-preview'
): Promise<string[]> {
  const jobIds: string[] = [];

  const project = await ProjectModel.findById(projectId);
  const existingVideoVersions = ((project?.stages.videos.sceneVersions ?? {}) as Record<string, string[]>);
  const completedSceneIds = new Set(
    ((project?.stages.videos.result ?? []) as Array<{ sceneId: number }>).map(r => r.sceneId)
  );

  for (const scene of scenes) {
    // Skip scenes that already have a completed result
    if (completedSceneIds.has(scene.id)) continue;

    const image = sceneImages.find(img => img.sceneId === scene.id);
    if (!image?.imageBase64) throw new Error(`No image data for scene ${scene.id}`);

    const config = buildVideoConfig(scene, platform);
    const versionNumber = (existingVideoVersions[String(scene.id)] ?? []).length + 1;

    const job = await videoQueue.add(
      `scene-${scene.id}`,
      {
        projectId,
        sceneId: scene.id,
        prompt: config.prompt,
        negativePrompt: config.negativePrompt,
        aspectRatio: config.aspectRatio,
        durationSeconds: config.durationSeconds,
        imageBase64: image.imageBase64,
        attemptNumber,
        videoModel,
        versionNumber,
      },
      { jobId: `${projectId}-scene-${scene.id}-${Date.now()}` }
    );

    jobIds.push(job.id!);
  }

  return jobIds;
}

// ─── Watch Jobs and Update Stage Status ───────────────────────────────────────

export async function waitForVideoJobs(
  projectId: string,
  jobIds: string[],
  totalScenes: number
): Promise<void> {
  // Use Job.waitUntilFinished() instead of raw events to avoid a race condition
  // where fast jobs (e.g. mock model) complete before event listeners are registered.
  // waitUntilFinished() checks the job state first, then subscribes if still pending.
  let completedCount = 0;

  await Promise.all(
    jobIds.map(async (jobId) => {
      const job = await Job.fromId(videoQueue, jobId);
      if (!job) throw new Error(`Video job ${jobId} not found in queue`);

      await job.waitUntilFinished(videoQueueEvents);

      completedCount++;
      const percent = Math.round((completedCount / totalScenes) * 100);
      emitStageProgress({ projectId, stageKey: 'videos', message: `${completedCount}/${totalScenes} scenes done`, percent });
    })
  );

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.videos.status': 'review',
  });

  const project = await ProjectModel.findById(projectId);
  {
    const results = (project?.stages.videos.result as Array<{ sceneId: number; videoPath: string; filename?: string }> | undefined) ?? [];
    const previewUrls = results.map(r =>
      r.filename
        ? `/api/files/${projectId}/${r.filename}`
        : `/api/files/${projectId}/scene_${r.sceneId}.mp4`
    );

    emitStageResult({
      projectId,
      stageKey: 'videos',
      previewUrls,
      metadata: { sceneCount: results.length },
    });

    emitStageStatus({ projectId, stageKey: 'videos', status: 'review', message: 'All videos ready for review' });
  }
}

// ─── Re-generate Single Scene ─────────────────────────────────────────────────

export async function regenerateSceneVideo(
  projectId: string,
  sceneId: number,
  newPrompt?: string,
  videoModel?: string
): Promise<void> {
  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const scene = (project.stages.storyboard.result as { scenes: StoryboardScene[] } | undefined)?.scenes.find(s => s.id === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found in storyboard`);

  const imageResults = project.stages.images.result as Array<{ sceneId: number; imagePath: string; imageBase64?: string }> | undefined;
  const image = imageResults?.find(r => r.sceneId === sceneId);
  if (!image) throw new Error(`No image found for scene ${sceneId}`);

  const config = buildVideoConfig(scene, project.input.platform);
  const attemptNumber = (project.stages.videos.attempts?.length ?? 0) + 1;
  const existingVersions = (project.stages.videos.sceneVersions ?? {}) as Record<string, string[]>;
  const versionNumber = (existingVersions[String(sceneId)] ?? []).length + 1;

  // Read imageBase64 from disk if not cached in DB
  let imageBase64 = image.imageBase64;
  if (!imageBase64 && image.imagePath && fs.existsSync(image.imagePath)) {
    imageBase64 = fs.readFileSync(image.imagePath).toString('base64');
  }
  if (!imageBase64) throw new Error(`No image data available for scene ${sceneId} — regenerate images first`);

  const job = await videoQueue.add(
    `scene-${sceneId}-regen`,
    {
      projectId,
      sceneId,
      prompt: newPrompt ?? config.prompt,
      negativePrompt: config.negativePrompt,
      aspectRatio: config.aspectRatio,
      durationSeconds: config.durationSeconds,
      imageBase64: imageBase64,
      attemptNumber,
      videoModel: videoModel ?? 'veo-3.1-fast-generate-preview',
      versionNumber,
    },
    { jobId: `${projectId}-scene-${sceneId}-${Date.now()}` }
  );

  await waitForVideoJobs(projectId, [job.id!], 1);
}
