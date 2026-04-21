const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const api = {
  createProject: (data: object) =>
    request('/api/projects', { method: 'POST', body: JSON.stringify(data) }),

  listProjects: () =>
    request('/api/projects'),

  getProject: (id: string) =>
    request(`/api/projects/${id}`),

  deleteProject: (id: string) =>
    request(`/api/projects/${id}`, { method: 'DELETE' }),

  // ─── Stages ─────────────────────────────────────────────────────────────

  getStage: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}`),

  updatePrompt: (projectId: string, stage: string, data: object) =>
    request(`/api/projects/${projectId}/stages/${stage}/prompt`, { method: 'PATCH', body: JSON.stringify(data) }),

  generateStage: (projectId: string, stage: string, data?: object) =>
    request(`/api/projects/${projectId}/stages/${stage}/generate`, { method: 'POST', body: JSON.stringify(data ?? {}) }),

  approveStage: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/approve`, { method: 'POST' }),

  skipStage: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/skip`, { method: 'POST' }),

  retryStage: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/retry`, { method: 'POST' }),

  resetStage: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/reset`, { method: 'POST' }),

  reopenStage: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/reopen`, { method: 'POST' }),

  regenerateSceneImage: (projectId: string, sceneId: number, prompt: string) =>
    request(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/regenerate`, { method: 'POST', body: JSON.stringify({ prompt }) }),

  regenerateSceneVideo: (projectId: string, sceneId: number, prompt?: string) =>
    request(`/api/projects/${projectId}/stages/videos/scenes/${sceneId}/regenerate`, { method: 'POST', body: JSON.stringify({ prompt }) }),

  updateScene: (projectId: string, sceneId: number, data: object) =>
    request(`/api/projects/${projectId}/stages/storyboard/scenes/${sceneId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  updateStageModel: (projectId: string, stage: string, model: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/model`, { method: 'PATCH', body: JSON.stringify({ model }) }),

  setSceneReferenceImage: (projectId: string, sceneId: number, imageBase64: string, mimeType: string) =>
    request<{ url: string }>(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/reference`, {
      method: 'PATCH', body: JSON.stringify({ imageBase64, mimeType }),
    }),

  removeSceneReferenceImage: (projectId: string, sceneId: number) =>
    request<{ removed: boolean }>(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/reference`, { method: 'DELETE' }),

  selectSceneVersion: (projectId: string, stage: 'images' | 'videos', sceneId: number, filename: string) =>
    request<{ selected: string }>(`/api/projects/${projectId}/stages/${stage}/scenes/${sceneId}/select`, { method: 'POST', body: JSON.stringify({ filename }) }),

  selectStageVersion: (projectId: string, stage: 'voiceover' | 'music', filename: string) =>
    request<{ selected: string }>(`/api/projects/${projectId}/stages/${stage}/select`, { method: 'POST', body: JSON.stringify({ filename }) }),

  getAttempts: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/attempts`),
};
