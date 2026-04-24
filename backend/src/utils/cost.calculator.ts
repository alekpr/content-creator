import type { Duration } from '@content-creator/shared';

interface StageCost {
  storyboard: number;
  imagePerScene: number;
  videoPerSecond: number;
  voiceover: number;
  musicClip: number;
}

const COST_TABLE: StageCost = {
  storyboard: 0.001,
  imagePerScene: 0.039,
  videoPerSecond: 0.10,
  voiceover: 0.001,
  musicClip: 0.04,
};

export function estimateTotalCost(
  duration: Duration,
  sceneCount: number,
  hasMusic: boolean
): number {
  const totalVideoSeconds = durationToSeconds(duration);

  const cost =
    COST_TABLE.storyboard +
    COST_TABLE.imagePerScene * sceneCount +
    COST_TABLE.videoPerSecond * totalVideoSeconds +
    COST_TABLE.voiceover +
    (hasMusic ? COST_TABLE.musicClip : 0);

  return Math.round(cost * 100) / 100;
}

export function estimateVideoCost(durationSeconds: number): number {
  return COST_TABLE.videoPerSecond * durationSeconds;
}

export function durationToSceneCount(duration: Duration): number {
  switch (duration) {
    case '32s':  return 4;
    case '64s':  return 8;
    case '160s': return 20;
  }
}

export function durationToSeconds(duration: Duration): number {
  switch (duration) {
    case '32s':  return 32;
    case '64s':  return 64;
    case '160s': return 160;
  }
}
