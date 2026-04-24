import { useRef, useState } from 'react';
import type { Project, Storyboard, StoryboardScene } from '@content-creator/shared';
import { api } from '../../api/client.ts';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Mirrors buildVideoPrompt() from stage3-videos.ts */
function assemblePrompt(scene: StoryboardScene): string {
  const parts: string[] = [];
  parts.push(`Scene:\n${scene.visual_prompt}`);
  if (scene.subject)     parts.push(`Subject:\n${scene.subject}`);
  parts.push(`Shot / Camera Motion:\n${scene.camera_motion}`);
  if (scene.action)      parts.push(`Action:\n${scene.action}`);
  if (scene.composition) parts.push(`Composition:\n${scene.composition}`);
  parts.push(`Emotion:\n${scene.mood}`);
  if (scene.lighting)    parts.push(`Ambiance / Lighting:\n${scene.lighting}`);
  parts.push(`Quality / Constraints:\n4K UHD resolution, HDR lighting, sharp focus, hyper-realistic textures, professional cinematic color grading, no text on screen.`);
  return parts.join('\n\n');
}

interface SceneVideoSetupPanelProps {
  project: Project;
  onRefresh: () => void;
}

/**
 * Pre-generation panel for Stage 3 Videos.
 * Shows each scene from the approved storyboard.
 * Users can either let AI generate the video, or upload their own video directly.
 * Manually uploaded videos bypass AI generation and are used as-is.
 */
export function SceneVideoSetupPanel({ project, onRefresh }: SceneVideoSetupPanelProps) {
  const storyboard = project.stages.storyboard.result as Storyboard | undefined;
  if (!storyboard?.scenes?.length) return null;

  const stageConfig = (project.stages.videos.stageConfig ?? {}) as Record<string, unknown>;
  const manualVideos = (stageConfig.manualVideos ?? {}) as Record<string, string>;
  const scenePromptOverrides = (stageConfig.scenePromptOverrides ?? {}) as Record<string, string>;
  const results = (project.stages.videos.result as Array<{ sceneId: number; filename: string; previewUrl: string }> | undefined) ?? [];
  const resultMap = Object.fromEntries(results.map(r => [String(r.sceneId), r]));

  const manualCount = Object.keys(manualVideos).length;
  const overrideCount = Object.keys(scenePromptOverrides).length;
  const aiCount = storyboard.scenes.length - manualCount;
  const isPortrait = project.input.platform === 'tiktok';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 font-medium">Scene video setup</p>
        <span className="text-[11px] text-gray-400 flex items-center gap-1.5">
          {aiCount > 0 && <span className="text-indigo-600 font-medium">{aiCount} AI</span>}
          {aiCount > 0 && manualCount > 0 && <span className="text-gray-300">·</span>}
          {manualCount > 0 && <span className="text-emerald-600 font-medium">{manualCount} manual</span>}
          {overrideCount > 0 && <span className="text-amber-600 font-medium">· {overrideCount} custom prompt</span>}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {storyboard.scenes.map(scene => (
          <SceneVideoCard
            key={scene.id}
            scene={scene}
            projectId={project._id}
            manualFilename={manualVideos[String(scene.id)]}
            promptOverride={scenePromptOverrides[String(scene.id)]}
            existingResult={resultMap[String(scene.id)]}
            onRefresh={onRefresh}
            isPortrait={isPortrait}
          />
        ))}
      </div>
    </div>
  );
}

function SceneVideoCard({
  scene,
  projectId,
  manualFilename,
  promptOverride,
  existingResult,
  onRefresh,
  isPortrait,
}: {
  scene: StoryboardScene;
  projectId: string;
  manualFilename?: string;
  promptOverride?: string;
  existingResult?: { filename: string; previewUrl: string };
  onRefresh: () => void;
  isPortrait: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sceneId = scene.id;
  const autoPrompt = assemblePrompt(scene);
  const activePrompt = promptOverride ?? autoPrompt;
  const isCustom = !!promptOverride;
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
      await api.uploadSceneVideoDirect(projectId, sceneId, base64, file.type || 'video/mp4');
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
      await api.removeSceneVideoDirect(projectId, sceneId);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(activePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function startEdit() {
    setEditValue(activePrompt);
    setEditMode(true);
    setShowPrompt(true);
  }

  async function handleSavePrompt() {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      if (trimmed === autoPrompt) {
        await api.removeSceneVideoPrompt(projectId, sceneId);
      } else {
        await api.saveSceneVideoPrompt(projectId, sceneId, trimmed);
      }
      setEditMode(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPrompt() {
    setSaving(true);
    try {
      await api.removeSceneVideoPrompt(projectId, sceneId);
      setEditMode(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${isManual ? 'border-emerald-300 bg-emerald-50/40' : isCustom ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200 bg-white'}`}>
      {/* Video preview or placeholder */}
      {previewUrl && isManual ? (
        <video
          src={previewUrl}
          style={thumbStyle}
          className="w-full object-cover bg-black"
          muted
          playsInline
          onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play()}
          onMouseLeave={e => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
        />
      ) : (
        <div style={thumbStyle} className="w-full bg-gray-100 flex flex-col items-center justify-center gap-1">
          <span className="text-2xl text-gray-300">🤖</span>
          <span className="text-[10px] text-gray-400">AI will generate</span>
        </div>
      )}

      <div className="p-1.5 space-y-1.5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-medium text-gray-600 truncate">Scene {sceneId}</span>
          <div className="flex items-center gap-1 shrink-0">
            {isManual && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Manual</span>}
            {isCustom && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">✎ Custom</span>}
          </div>
        </div>

        {/* Prompt preview line */}
        <button
          onClick={() => setShowPrompt(v => !v)}
          className="w-full text-left text-[10px] text-gray-400 hover:text-gray-600 line-clamp-2 leading-relaxed"
          title="Click to expand prompt"
        >
          {activePrompt}
        </button>

        {/* Expanded prompt panel */}
        {showPrompt && !editMode && (
          <div className="rounded bg-gray-50 border border-gray-200 p-2 space-y-1.5">
            <p className="text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap break-words">{activePrompt}</p>
            {isCustom && (
              <p className="text-[10px] text-gray-400 italic">Auto: {autoPrompt}</p>
            )}
            <div className="flex gap-1 pt-0.5">
              <button
                onClick={handleCopy}
                className="text-[10px] rounded border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-gray-100"
              >
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
              <button
                onClick={startEdit}
                className="text-[10px] rounded border border-blue-200 px-2 py-0.5 text-blue-600 hover:bg-blue-50"
              >
                ✎ Edit
              </button>
              {isCustom && (
                <button
                  onClick={handleResetPrompt}
                  disabled={saving}
                  className="text-[10px] rounded border border-gray-200 px-2 py-0.5 text-gray-400 hover:bg-gray-50 disabled:opacity-50"
                >
                  ↺ Reset
                </button>
              )}
            </div>
          </div>
        )}

        {/* Edit mode */}
        {editMode && (
          <div className="space-y-1">
            <textarea
              rows={4}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className="w-full text-[11px] rounded border border-gray-300 px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
            <p className="text-[10px] text-gray-400">Edit then save — or reset to auto. Copy to use in Veo/Kling/Runway.</p>
            <div className="flex gap-1">
              <button
                onClick={handleSavePrompt}
                disabled={saving || !editValue.trim()}
                className="text-[10px] rounded bg-blue-600 text-white px-2 py-1 hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={handleCopy}
                className="text-[10px] rounded border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-gray-100"
              >
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
              <button
                onClick={() => { setEditMode(false); setEditValue(''); }}
                className="text-[10px] rounded border border-gray-200 px-2 py-0.5 text-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-[10px] text-red-500">{error}</p>}

        <div className="flex gap-1">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="flex-1 text-[11px] rounded border border-dashed border-gray-300 px-2 py-1 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
          >
            {loading ? '…' : isManual ? '↑ Replace' : '↑ Upload my video'}
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
      <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleUpload} />
    </div>
  );
}
