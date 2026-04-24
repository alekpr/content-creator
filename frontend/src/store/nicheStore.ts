import { create } from 'zustand';
import type { NicheInput, NicheAnalysisResponse } from '@content-creator/shared';
import { api } from '../api/client.ts';

interface NicheStore {
  analysis: NicheAnalysisResponse | null;
  isLoading: boolean;
  error: string | null;
  analyze: (input: NicheInput) => Promise<void>;
  reset: () => void;
}

export const useNicheStore = create<NicheStore>(set => ({
  analysis: null,
  isLoading: false,
  error: null,

  analyze: async (input: NicheInput) => {
    set({ isLoading: true, error: null });
    try {
      const result = await api.analyzeNiche(input) as NicheAnalysisResponse;
      set({ analysis: result, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  reset: () => set({ analysis: null, error: null, isLoading: false }),
}));
