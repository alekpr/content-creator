import { useRef, useState } from 'react';
import type { Project, Storyboard } from '@content-creator/shared';
import { api } from '../../api/client.ts';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface SceneReferenceUploadProps {
  project: Project;
  onRefresh: () => void;
}

export function SceneReferenceUpload({ project, onRefresh }: SceneReferenceUploadProps) {
  const storyboard = project.stages.storyboard.result as Storyboard | undefined;
  if (!storyboard?.scenes?.length) return null;

  const refImages = (project.stages.images.referenceImages ?? {}) as Record<string, string>;
  const imagesStageConfig = (project.stages.images.stageConfig ?? {}) as Record<string, unknown>;
  const styleRefFilename = imagesStageConfig.styleReferenceImage as string | undefined;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-600">
        Reference Images <span className="font-normal text-gray-400">(optional — Gemini will use these as style/content guide)</span>
      </p>

      <GlobalStyleRefCard
        projectId={project._id}
        styleRefFilename={styleRefFilename}
        onRefresh={onRefresh}
        isPortrait={project.input.platform === 'tiktok'}
      />

      <div className="grid grid-cols-2 gap-2">
        {storyboard.scenes.map(scene => (
          <SceneRefCard
            key={scene.id}
            projectId={project._id}
            sceneId={scene.id}
            refFilename={refImages[String(scene.id)]}
            onRefresh={onRefresh}
            isPortrait={project.input.platform === 'tiktok'}
          />
        ))}
      </div>
    </div>
  );
}

interface GlobalStyleRefCardProps {
  projectId: string;
  styleRefFilename?: string;
  onRefresh: () => void;
  isPortrait: boolean;
}

function GlobalStyleRefCard({ projectId, styleRefFilename, onRefresh, isPortrait }: GlobalStyleRefCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refUrl = styleRefFilename ? `${API_BASE}/api/files/${projectId}/${styleRefFilename}` : null;
  const thumbStyle = isPortrait ? { aspectRatio: '9/16' } : { aspectRatio: '16/9' };

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('Image too large (max 4 MB)');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const mimeType = (file.type as 'image/jpeg' | 'image/png' | 'image/webp') || 'image/jpeg';
      await api.setStyleReferenceImage(projectId, base64, mimeType);
      onRefresh();
    } catch {
      setError('Upload failed');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setLoading(true);
    setError(null);
    try {
      await api.removeStyleReferenceImage(projectId);
      onRefresh();
    } catch {
      setError('Remove failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 overflow-hidden bg-amber-50/40">
      <div className="flex items-center justify-between px-2 py-1 border-b border-amber-200 bg-amber-50">
        <p className="text-[11px] font-medium text-amber-700">Global Style Reference</p>
        <span className="text-[10px] text-amber-600">applies to all scenes</span>
      </div>

      {refUrl ? (
        <div className="relative group">
          <img
            src={refUrl}
            alt="Global style reference"
            style={thumbStyle}
            className="w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="rounded bg-white text-gray-800 px-2 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-50"
            >
              Change
            </button>
            <button
              onClick={handleRemove}
              disabled={loading}
              className="rounded bg-red-500 text-white px-2 py-1 text-xs font-medium hover:bg-red-600 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          style={thumbStyle}
          className="w-full flex flex-col items-center justify-center text-amber-500 hover:text-amber-700 hover:bg-amber-100/40 transition-colors disabled:opacity-50"
        >
          <span className="text-2xl leading-none">{loading ? '…' : '+'}</span>
          <span className="text-xs mt-1">Upload style anchor image</span>
        </button>
      )}

      {error && <p className="text-[10px] text-red-500 px-2 py-0.5">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

interface SceneRefCardProps {
  projectId: string;
  sceneId: number;
  refFilename?: string;
  onRefresh: () => void;
  isPortrait: boolean;
}

function SceneRefCard({ projectId, sceneId, refFilename, onRefresh, isPortrait }: SceneRefCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refUrl = refFilename ? `${API_BASE}/api/files/${projectId}/${refFilename}` : null;
  const thumbStyle = isPortrait ? { aspectRatio: '9/16' } : { aspectRatio: '16/9' };

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('Image too large (max 4 MB)');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const mimeType = (file.type as 'image/jpeg' | 'image/png' | 'image/webp') || 'image/jpeg';
      await api.setSceneReferenceImage(projectId, sceneId, base64, mimeType);
      onRefresh();
    } catch {
      setError('Upload failed');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setLoading(true);
    setError(null);
    try {
      await api.removeSceneReferenceImage(projectId, sceneId);
      onRefresh();
    } catch {
      setError('Remove failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 overflow-hidden bg-gray-50">
      {refUrl ? (
        <div className="relative group">
          <img
            src={refUrl}
            alt={`Scene ${sceneId} reference`}
            style={thumbStyle}
            className="w-full object-cover"
          />
          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="rounded bg-white text-gray-800 px-2 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-50"
            >
              Change
            </button>
            <button
              onClick={handleRemove}
              disabled={loading}
              className="rounded bg-red-500 text-white px-2 py-1 text-xs font-medium hover:bg-red-600 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white rounded px-1">
            Scene {sceneId}
          </span>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          style={thumbStyle}
          className="w-full flex flex-col items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          <span className="text-2xl leading-none">{loading ? '…' : '+'}</span>
          <span className="text-xs mt-1">Scene {sceneId} reference</span>
        </button>
      )}
      {error && <p className="text-[10px] text-red-500 px-2 py-0.5">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix  e.g. "data:image/jpeg;base64,..."
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
