import { create } from 'zustand';
import type { Project, StageKey, StageStatus, CostBreakdown } from '@content-creator/shared';

interface ProjectStore {
  project: Project | null;
  isConnected: boolean;
  costBreakdown: CostBreakdown | null;
  setProject: (project: Project) => void;
  updateStageStatus: (stageKey: StageKey, status: StageStatus, error?: string) => void;
  updateCost: (totalCostUSD: number, breakdown: CostBreakdown) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

export const useProjectStore = create<ProjectStore>(set => ({
  project: null,
  isConnected: false,
  costBreakdown: null,

  setProject: (project) => set({ project, costBreakdown: project.costBreakdown ?? null }),

  updateStageStatus: (stageKey, status, error) =>
    set(state => {
      if (!state.project) return state;
      return {
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

  updateCost: (totalCostUSD, breakdown) =>
    set(state => ({
      costBreakdown: breakdown,
      project: state.project
        ? { ...state.project, costUSD: totalCostUSD, actualCostUSD: totalCostUSD }
        : null,
    })),

  setConnected: (isConnected) => set({ isConnected }),

  clear: () => set({ project: null, isConnected: false, costBreakdown: null }),
}));
