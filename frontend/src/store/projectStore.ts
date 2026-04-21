import { create } from 'zustand';
import type { Project, StageKey, StageStatus, CostBreakdown } from '@content-creator/shared';

export interface StageProgress {
  message: string;
  percent: number;
}

interface ProjectStore {
  project: Project | null;
  isConnected: boolean;
  costBreakdown: CostBreakdown | null;
  stageProgress: Partial<Record<StageKey, StageProgress>>;
  setProject: (project: Project) => void;
  updateStageStatus: (stageKey: StageKey, status: StageStatus, error?: string) => void;
  updateStageProgress: (stageKey: StageKey, message: string, percent: number) => void;
  clearStageProgress: (stageKey: StageKey) => void;
  updateCost: (totalCostUSD: number, breakdown: CostBreakdown) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

export const useProjectStore = create<ProjectStore>(set => ({
  project: null,
  isConnected: false,
  costBreakdown: null,
  stageProgress: {},

  setProject: (project) => set({ project, costBreakdown: project.costBreakdown ?? null }),

  updateStageStatus: (stageKey, status, error) =>
    set(state => {
      if (!state.project) return state;
      return {
        // Clear progress when stage finishes/fails
        stageProgress: { ...state.stageProgress, [stageKey]: undefined },
        project: {
          ...state.project,
          stages: {
            ...state.project.stages,
            [stageKey]: {
              ...state.project.stages[stageKey],
              status,
              ...(error !== undefined ? { error } : {}),
            },
          },
        },
      };
    }),

  updateStageProgress: (stageKey, message, percent) =>
    set(state => ({
      stageProgress: { ...state.stageProgress, [stageKey]: { message, percent } },
    })),

  clearStageProgress: (stageKey) =>
    set(state => ({
      stageProgress: { ...state.stageProgress, [stageKey]: undefined },
    })),

  updateCost: (totalCostUSD, breakdown) =>
    set(state => ({
      costBreakdown: breakdown,
      project: state.project
        ? { ...state.project, costUSD: totalCostUSD, actualCostUSD: totalCostUSD }
        : null,
    })),

  setConnected: (isConnected) => set({ isConnected }),

  clear: () => set({ project: null, isConnected: false, costBreakdown: null, stageProgress: {} }),
}));
