import { useState } from 'react';
import type { Project, SceneImageResult } from '@content-creator/shared';
import { api } from '../../api/client.ts';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ReviewImagesProps {
  project: Project;
  onRefresh: () => void;
}

export function ReviewImages({ project, onRefresh }: ReviewImagesProps) {
  const results = project.stages.images.result as SceneImageResult[] | undefined;
  if (!results?.length) return <p className="text-sm text-gray-400">No image results yet.</p>;

  return (
    <div className="grid grid-cols-2 gap-3">
      {results.map(img => (
        <ImageCard
          key={img.sceneId}
          img={img}
          project={project}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function ImageCard({
  img,
  project,
  onRefresh,
}: {
  img: SceneImageResult;
  project: Project;
  onRefresh: () => void;
}) {
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const imageUrl = `${API_BASE}/api/files/${project._id}/${img.filename}`;

  async function handleRegenerate() {
    setLoading(true);
    try {
      await api.regenerateSceneImage(project._id, img.sceneId, prompt);
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
      <img
        src={imageUrl}
        alt={`Scene ${img.sceneId}`}
        className="w-full aspect-video object-cover bg-gray-100"
      />
      <div className="p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Scene {img.sceneId}</span>
          <button
            onClick={() => setShowRegenerate(v => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showRegenerate ? 'Cancel' : 'Regenerate'}
          </button>
        </div>

        {showRegenerate && (
          <div className="space-y-1">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={2}
              placeholder="New image prompt (leave blank to keep original)"
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
