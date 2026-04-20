import { useEffect } from 'react';
import { api } from '../api/client.ts';
import { useProjectStore } from '../store/projectStore.ts';
import type { Project } from '@content-creator/shared';

export function useProject(projectId: string | undefined) {
  const { project, setProject } = useProjectStore();

  useEffect(() => {
    if (!projectId) return;

    api.getProject(projectId)
      .then(data => setProject(data as Project))
      .catch(console.error);
  }, [projectId, setProject]);

  const refresh = () => {
    if (!projectId) return;
    api.getProject(projectId)
      .then(data => setProject(data as Project))
      .catch(console.error);
  };

  return { project, refresh };
}
