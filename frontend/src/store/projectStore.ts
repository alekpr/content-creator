import { create } from 'zustand';
import type { Project, StageKey, StageStatus } from '@content-creator/shared';

interface ProjectStore {
  project: Project | null;
  isConnected: boolean;
  setProject: (project: Project) => void;
  updateStageStatus: (stageKey: StageKey, status: StageStatus, error?: string) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

export const useProjectStore = create<ProjectStore>(set => ({
  project: null,
  isConnected: false,

  setProject: (project) => set({ project }),

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

  setConnected: (isConnected) => set({ isConnected }),

  clear: () => set({ project: null, isConnected: false }),
}));
