import { useState, useRef } from 'react';
import type { Project, SceneImageResult } from '@content-creator/shared';
import { api } from '../../api/client.ts';
import { VersionBadges } from './VersionBadges.tsx';

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
  const refInputRef = useRef<HTMLInputElement>(null);

  const sceneVersions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
  const versions = sceneVersions[String(img.sceneId)] ?? [];
  const imageUrl = `${API_BASE}/api/files/${project._id}/${img.filename}`;
  const refImages = (project.stages.images.referenceImages ?? {}) as Record<string, string>;
  const refFilename = refImages[String(img.sceneId)];
  const refUrl = refFilename ? `${API_BASE}/api/files/${project._id}/${refFilename}` : null;

  async function handleSelectVersion(filename: string) {
    setLoading(true);
    try {
      await api.selectSceneVersion(project._id, 'images', img.sceneId, filename);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

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

  async function handleRefUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const r = reader.result as string;
          resolve(r.slice(r.indexOf(',') + 1));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.setSceneReferenceImage(project._id, img.sceneId, base64, file.type || 'image/jpeg');
      onRefresh();
    } finally {
      setLoading(false);
      if (refInputRef.current) refInputRef.current.value = '';
    }
  }

  async function handleRefRemove() {
    setLoading(true);
    try {
      await api.removeSceneReferenceImage(project._id, img.sceneId);
      onRefresh();
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
      {/* Reference image row */}
      {refUrl ? (
        <div className="flex items-center gap-2 px-2 pt-1.5">
          <span className="text-[10px] text-gray-400 shrink-0">Ref:</span>
          <img src={refUrl} alt="reference" className="h-6 w-10 object-cover rounded border border-gray-200" />
          <button onClick={() => refInputRef.current?.click()} disabled={loading} className="text-[10px] text-blue-500 hover:underline">change</button>
          <button onClick={handleRefRemove} disabled={loading} className="text-[10px] text-red-400 hover:underline">remove</button>
        </div>
      ) : (
        <div className="px-2 pt-1.5">
          <button onClick={() => refInputRef.current?.click()} disabled={loading} className="text-[10px] text-gray-400 hover:text-indigo-500">
            + add reference image
          </button>
        </div>
      )}
      <input ref={refInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleRefUpload} />
      <div className="p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Scene {img.sceneId}</span>
          <div className="flex items-center gap-2">
            <a
              href={imageUrl}
              download={img.filename}
              className="text-xs text-gray-500 hover:text-gray-700"
              title="Download image"
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
          selectedFilename={img.filename}
          loading={loading}
          onSelect={handleSelectVersion}
        />

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
