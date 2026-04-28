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

  togglePublishStatus: (projectId: string, platform: string, action: 'add' | 'remove') =>
    request(`/api/projects/${projectId}/publish`, { 
      method: 'PATCH', 
      body: JSON.stringify({ platform, action }) 
    }),

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

  // Direct manual upload — saves image to result without AI generation
  uploadSceneImageDirect: (projectId: string, sceneId: number, imageBase64: string, mimeType: string) =>
    request(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/upload`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    }) as Promise<{ filename: string; previewUrl: string }>,

  removeSceneImageDirect: (projectId: string, sceneId: number) =>
    request(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/upload`, { method: 'DELETE' }),

  // Direct manual video upload — saves video to result without AI generation
  uploadSceneVideoDirect: (projectId: string, sceneId: number, videoBase64: string, mimeType: string, durationSeconds?: number) =>
    request(`/api/projects/${projectId}/stages/videos/scenes/${sceneId}/upload`, {
      method: 'POST',
      body: JSON.stringify({ videoBase64, mimeType, durationSeconds }),
    }) as Promise<{ filename: string; previewUrl: string }>,

  removeSceneVideoDirect: (projectId: string, sceneId: number) =>
    request(`/api/projects/${projectId}/stages/videos/scenes/${sceneId}/upload`, { method: 'DELETE' }),

  regenerateSceneImage: (
    projectId: string,
    sceneId: number,
    opts: { prompt?: string; additionalPrompt?: string; model?: string; refineFromCurrent?: boolean }
  ) =>
    request(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  regenerateSceneVideo: (
    projectId: string,
    sceneId: number,
    opts: { prompt?: string; additionalPrompt?: string; model?: string }
  ) =>
    request(`/api/projects/${projectId}/stages/videos/scenes/${sceneId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  saveSceneVideoPrompt: (projectId: string, sceneId: number, prompt: string) =>
    request(`/api/projects/${projectId}/stages/videos/scenes/${sceneId}/prompt`, {
      method: 'PATCH',
      body: JSON.stringify({ prompt }),
    }),

  removeSceneVideoPrompt: (projectId: string, sceneId: number) =>
    request(`/api/projects/${projectId}/stages/videos/scenes/${sceneId}/prompt`, { method: 'DELETE' }),

  updateScene: (projectId: string, sceneId: number, data: object) =>
    request(`/api/projects/${projectId}/stages/storyboard/scenes/${sceneId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  generateSocialMeta: (projectId: string) =>
    request<{ socialMeta: { videoTitle: string; description: string; hashtags: string[] } }>(
      `/api/projects/${projectId}/stages/storyboard/social-meta`,
      { method: 'POST' }
    ),

  updateStageModel: (projectId: string, stage: string, model: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/model`, { method: 'PATCH', body: JSON.stringify({ model }) }),

  setSceneReferenceImage: (projectId: string, sceneId: number, imageBase64: string, mimeType: string) =>
    request<{ url: string }>(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/reference`, {
      method: 'PATCH', body: JSON.stringify({ imageBase64, mimeType }),
    }),

  setStyleReferenceImage: (projectId: string, imageBase64: string, mimeType: string) =>
    request<{ url: string }>(`/api/projects/${projectId}/stages/images/style-reference`, {
      method: 'PATCH', body: JSON.stringify({ imageBase64, mimeType }),
    }),

  removeSceneReferenceImage: (projectId: string, sceneId: number) =>
    request<{ removed: boolean }>(`/api/projects/${projectId}/stages/images/scenes/${sceneId}/reference`, { method: 'DELETE' }),

  removeStyleReferenceImage: (projectId: string) =>
    request<{ removed: boolean }>(`/api/projects/${projectId}/stages/images/style-reference`, { method: 'DELETE' }),

  selectSceneVersion: (projectId: string, stage: 'images' | 'videos', sceneId: number, filename: string) =>
    request<{ selected: string }>(`/api/projects/${projectId}/stages/${stage}/scenes/${sceneId}/select`, { method: 'POST', body: JSON.stringify({ filename }) }),

  selectStageVersion: (projectId: string, stage: 'voiceover' | 'music', filename: string) =>
    request<{ selected: string }>(`/api/projects/${projectId}/stages/${stage}/select`, { method: 'POST', body: JSON.stringify({ filename }) }),

  getAttempts: (projectId: string, stage: string) =>
    request(`/api/projects/${projectId}/stages/${stage}/attempts`),

  saveVoiceoverSettings: (projectId: string, settings: object) =>
    request(`/api/projects/${projectId}/stages/voiceover/settings`, { method: 'PATCH', body: JSON.stringify(settings) }),

  saveAssemblySettings: (projectId: string, settings: object) =>
    request(`/api/projects/${projectId}/stages/assembly/settings`, { method: 'PATCH', body: JSON.stringify(settings) }),

  autoTagNarrations: (projectId: string, save = false, sceneId?: number) =>
    request<{ scenes: Array<{ sceneId: number; original: string; enhanced: string }> }>(
      `/api/projects/${projectId}/stages/voiceover/auto-tags?save=${save}${sceneId !== undefined ? `&sceneId=${sceneId}` : ''}`,
      { method: 'POST' }
    ),

  regenerateVoiceoverScene: (projectId: string, sceneId: number) =>
    request(`/api/projects/${projectId}/stages/voiceover/scenes/${sceneId}/regenerate`, { method: 'POST' }),

  fitVoiceoverTranscript: (projectId: string, sceneId: number) =>
    request<{ sceneId: number; original: string; rewritten: string; targetWords: number; durationSecs: number }>(
      `/api/projects/${projectId}/stages/voiceover/scenes/${sceneId}/fit-transcript`,
      { method: 'POST' }
    ),

  saveMusicSettings: (projectId: string, data: { customPrompt?: string }) =>
    request(`/api/projects/${projectId}/stages/music/settings`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ─── Niches ───────────────────────────────────────────────────────────────

  analyzeNiche: (data: object) =>
    request('/api/niches/analyze', { method: 'POST', body: JSON.stringify(data) }),

  listNiches: () =>
    request('/api/niches'),

  getNiche: (id: string) =>
    request(`/api/niches/${id}`),

  deleteNiche: (id: string) =>
    request(`/api/niches/${id}`, { method: 'DELETE' }),

  useNiche: (id: string, nicheIndex: number) =>
    request<{ projectId: string; redirectUrl: string }>(`/api/niches/${id}/use`, {
      method: 'POST',
      body: JSON.stringify({ nicheIndex }),
    }),

  loadMoreNicheIdeas: (id: string, nicheIndex: number) =>
    request<{ ideas: string[] }>(`/api/niches/${id}/results/${nicheIndex}/more-ideas`, { method: 'POST' }),
};
