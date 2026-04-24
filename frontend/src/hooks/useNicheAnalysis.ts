import type { NicheInput } from '@content-creator/shared';
import { useNicheStore } from '../store/nicheStore.ts';

export function useNicheAnalysis() {
  const { analysis, isLoading, error, analyze, reset } = useNicheStore();
  return { analysis, isLoading, error, analyze, reset };
}

export type { NicheInput };
