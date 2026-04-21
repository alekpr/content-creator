import { useState } from 'react';
import type { Project, SceneVideoResult } from '@content-creator/shared';
import { api } from '../../api/client.ts';
import { VersionBadges } from './VersionBadges.tsx';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ReviewVideosProps {
  project: Project;
  onRefresh: () => void;
}

export function ReviewVideos({ project, onRefresh }: ReviewVideosProps) {
  const results = project.stages.videos.result as SceneVideoResult[] | undefined;
  if (!results?.length) return <p className="text-sm text-gray-400">No video results yet.</p>;

  return (
    <div className="space-y-3">
      {results.map(v => (
        <VideoCard
          key={v.sceneId}
          video={v}
          project={project}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function VideoCard({
  video,
  project,
  onRefresh,
}: {
  video: SceneVideoResult;
  project: Project;
  onRefresh: () => void;
}) {
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const sceneVersions = (project.stages.videos.sceneVersions ?? {}) as Record<string, string[]>;
  const versions = sceneVersions[String(video.sceneId)] ?? [];
  const videoUrl = `${API_BASE}/api/files/${project._id}/${video.filename}`;

  async function handleSelectVersion(filename: string) {
    setLoading(true);
    try {
      await api.selectSceneVersion(project._id, 'videos', video.sceneId, filename);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    setLoading(true);
    try {
      await api.regenerateSceneVideo(project._id, video.sceneId, prompt || undefined);
      setShowRegenerate(false);
      setPrompt('');
      onRefresh();
    } catch {
      // no-op
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <video
        src={videoUrl}
        controls
        className="w-full aspect-video bg-black"
      />
      <div className="p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Scene {video.sceneId} · {video.durationSeconds}s</span>
          <div className="flex items-center gap-2">
            <a
              href={videoUrl}
              download={video.filename}
              className="text-xs text-gray-500 hover:text-gray-700"
              title="Download clip"
            >
              ↓
            </a>
            <button
              onClick={() => setShowRegenerate(v => !v)}
              className="text-xs text-blue-600 hover:underline"
            >
              {showRegenerate ? 'Cancel' : 'Regenerate'}
            </button>
          </div>
        </div>

        <VersionBadges
          versions={versions}
          selectedFilename={video.filename}
          loading={loading}
          onSelect={handleSelectVersion}
        />

        {showRegenerate && (
          <div className="space-y-1">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={2}
              placeholder="New video prompt (optional)"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={handleRegenerate}
              disabled={loading}
              className="rounded bg-blue-600 text-white px-2 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Regenerating…' : 'Go'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
