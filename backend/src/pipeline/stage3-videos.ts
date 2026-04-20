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
    resolution: '720p',
  };
}

// ─── Submit All Scenes to BullMQ ──────────────────────────────────────────────

export async function submitVideoGenerationJobs(
  projectId: string,
  scenes: StoryboardScene[],
  sceneImages: SceneImageResult[],
  platform: string,
  attemptNumber: number
): Promise<string[]> {
  const jobIds: string[] = [];

  for (const scene of scenes) {
    const image = sceneImages.find(img => img.sceneId === scene.id);
    if (!image?.imageBase64) throw new Error(`No image data for scene ${scene.id}`);

    const config = buildVideoConfig(scene, platform);

    const job = await videoQueue.add(
      `scene-${scene.id}`,
      {
        projectId,
        sceneId: scene.id,
        prompt: config.prompt,
        negativePrompt: config.negativePrompt,
        aspectRatio: config.aspectRatio,
        durationSeconds: config.durationSeconds,
        resolution: config.resolution,
        imageBase64: image.imageBase64,
        attemptNumber,
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
  let completedCount = 0;

  return new Promise<void>((resolve, reject) => {
    const onCompleted = ({ jobId }: { jobId: string }) => {
      if (!jobIds.includes(jobId)) return;
      completedCount++;

      const percent = Math.round((completedCount / totalScenes) * 100);
      emitStageProgress({ projectId, stageKey: 'videos', message: `${completedCount}/${totalScenes} scenes done`, percent });

      if (completedCount >= totalScenes) {
        cleanup();

        ProjectModel.findByIdAndUpdate(projectId, {
          'stages.videos.status': 'review',
        })
          .then(() => {
            return ProjectModel.findById(projectId);
          })
          .then(project => {
            const results = (project?.stages.videos.result as Array<{ sceneId: number; videoPath: string }> | undefined) ?? [];
            const previewUrls = results.map(r => `/api/files/${projectId}/scene_${r.sceneId}.mp4`);

            emitStageResult({
              projectId,
              stageKey: 'videos',
              previewUrls,
              metadata: { sceneCount: results.length },
            });

            emitStageStatus({ projectId, stageKey: 'videos', status: 'review', message: 'All videos ready for review' });
            resolve();
          })
          .catch(reject);
      }
    };

    const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
      if (!jobIds.includes(jobId)) return;
      cleanup();
      reject(new Error(`Video job ${jobId} failed: ${failedReason}`));
    };

    const cleanup = () => {
      videoQueueEvents.off('completed', onCompleted);
      videoQueueEvents.off('failed', onFailed);
    };

    videoQueueEvents.on('completed', onCompleted);
    videoQueueEvents.on('failed', onFailed);
  });
}

// ─── Re-generate Single Scene ─────────────────────────────────────────────────

export async function regenerateSceneVideo(
  projectId: string,
  sceneId: number,
  newPrompt?: string
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

  const job = await videoQueue.add(
    `scene-${sceneId}-regen`,
    {
      projectId,
      sceneId,
      prompt: newPrompt ?? config.prompt,
      negativePrompt: config.negativePrompt,
      aspectRatio: config.aspectRatio,
      durationSeconds: config.durationSeconds,
      resolution: config.resolution,
      imageBase64: image.imageBase64 ?? '',
      attemptNumber,
    },
    { jobId: `${projectId}-scene-${sceneId}-${Date.now()}` }
  );

  await waitForVideoJobs(projectId, [job.id!], 1);
}
