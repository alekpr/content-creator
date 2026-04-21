import { useRef, useState } from 'react';
import type { Project, Storyboard } from '@content-creator/shared';
import { api } from '../../api/client.ts';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface SceneImageSetupPanelProps {
  project: Project;
  onRefresh: () => void;
}

/**
 * Pre-generation panel for Stage 2 Images.
 * Shows each scene from the approved storyboard.
 * Users can either let AI generate the image, or upload their own image directly.
 * Manually uploaded images bypass AI generation and are used as-is.
 */
export function SceneImageSetupPanel({ project, onRefresh }: SceneImageSetupPanelProps) {
  const storyboard = project.stages.storyboard.result as Storyboard | undefined;
  if (!storyboard?.scenes?.length) return null;

  const manualImages = ((project.stages.images.stageConfig as Record<string, unknown> | undefined)?.manualImages ?? {}) as Record<string, string>;
  const results = (project.stages.images.result as Array<{ sceneId: number; filename: string; previewUrl: string }> | undefined) ?? [];
  const resultMap = Object.fromEntries(results.map(r => [String(r.sceneId), r]));

  const manualCount = Object.keys(manualImages).length;
  const aiCount = storyboard.scenes.length - manualCount;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 font-medium">Scene image setup</p>
        <span className="text-[11px] text-gray-400">
          {aiCount > 0 && <span className="text-indigo-600 font-medium">{aiCount} AI</span>}
          {aiCount > 0 && manualCount > 0 && <span className="text-gray-300 mx-1">·</span>}
          {manualCount > 0 && <span className="text-emerald-600 font-medium">{manualCount} manual</span>}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {storyboard.scenes.map(scene => (
          <SceneSetupCard
            key={scene.id}
            sceneId={scene.id}
            visualPrompt={scene.visual_prompt}
            projectId={project._id}
            manualFilename={manualImages[String(scene.id)]}
            existingResult={resultMap[String(scene.id)]}
            onRefresh={onRefresh}
            isPortrait={project.input.platform === 'tiktok'}
          />
        ))}
      </div>
    </div>
  );
}

function SceneSetupCard({
  sceneId,
  visualPrompt,
  projectId,
  manualFilename,
  existingResult,
  onRefresh,
  isPortrait,
}: {
  sceneId: number;
  visualPrompt: string;
  projectId: string;
  manualFilename?: string;
  existingResult?: { filename: string; previewUrl: string };
  onRefresh: () => void;
  isPortrait: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isManual = !!manualFilename;
  const previewUrl = existingResult ? `${API_BASE}${existingResult.previewUrl}` : null;
  const thumbStyle = isPortrait ? { aspectRatio: '9/16' } : { aspectRatio: '16/9' };

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setLoading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.uploadSceneImageDirect(projectId, sceneId, base64, file.type || 'image/jpeg');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setLoading(true);
    try {
      await api.removeSceneImageDirect(projectId, sceneId);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${isManual ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
      {/* Image preview or placeholder */}
      {previewUrl && isManual ? (
        <img src={previewUrl} alt={`Scene ${sceneId}`} style={thumbStyle} className="w-full object-cover" />
      ) : (
        <div style={thumbStyle} className="w-full bg-gray-100 flex flex-col items-center justify-center gap-1">
          <span className="text-2xl text-gray-300">🤖</span>
          <span className="text-[10px] text-gray-400">AI will generate</span>
        </div>
      )}

      <div className="p-1.5 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-medium text-gray-600 truncate">Scene {sceneId}</span>
          {isManual && (
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0">Manual</span>
          )}
        </div>

        <p className="text-[10px] text-gray-400 line-clamp-2">{visualPrompt}</p>

        {error && <p className="text-[10px] text-red-500">{error}</p>}

        <div className="flex gap-1">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="flex-1 text-[11px] rounded border border-dashed border-gray-300 px-2 py-1 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
          >
            {loading ? '…' : isManual ? '↑ Replace' : '↑ Upload my image'}
          </button>
          {isManual && (
            <button
              onClick={handleRemove}
              disabled={loading}
              className="text-[11px] rounded border border-red-200 px-2 py-1 text-red-400 hover:bg-red-50 disabled:opacity-50"
              title="Remove manual upload — AI will generate instead"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} />
    </div>
  );
}
