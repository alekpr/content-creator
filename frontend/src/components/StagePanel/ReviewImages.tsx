import { useState, useRef } from 'react';
import type { Project, SceneImageResult, ImageModel } from '@content-creator/shared';
import { STAGE_MODEL_OPTIONS, DEFAULT_STAGE_MODELS } from '@content-creator/shared';
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
  // mode: 'refine' = keep existing image as reference + add details; 'full' = fresh generate; 'upload' = direct file upload
  const [regenMode, setRegenMode] = useState<'refine' | 'full' | 'upload'>('refine');
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [additionalPrompt, setAdditionalPrompt] = useState('');
  const [fullPrompt, setFullPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<ImageModel>(
    ((project.modelConfig as Record<string, string> | undefined)?.images as ImageModel | undefined)
    ?? DEFAULT_STAGE_MODELS.images
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refInputRef = useRef<HTMLInputElement>(null);

  const sceneVersions = (project.stages.images.sceneVersions ?? {}) as Record<string, string[]>;
  const versions = sceneVersions[String(img.sceneId)] ?? [];
  const imageUrl = `${API_BASE}/api/files/${project._id}/${img.filename}`;
  const isPortrait = project.input.platform === 'tiktok';
  const thumbStyle = isPortrait ? { aspectRatio: '9/16' } : { aspectRatio: '16/9' };
  const refImages = (project.stages.images.referenceImages ?? {}) as Record<string, string>;
  const refFilename = refImages[String(img.sceneId)];
  const refUrl = refFilename ? `${API_BASE}/api/files/${project._id}/${refFilename}` : null;
  const manualImages = ((project.stages.images.stageConfig as Record<string, unknown> | undefined)?.manualImages ?? {}) as Record<string, string>;
  const isManual = !!manualImages[String(img.sceneId)];

  const imageModelOptions = STAGE_MODEL_OPTIONS.images;

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
    setError('');
    setLoading(true);
    try {
      if (regenMode === 'refine') {
        await api.regenerateSceneImage(project._id, img.sceneId, {
          additionalPrompt: additionalPrompt.trim() || undefined,
          model: selectedModel,
          refineFromCurrent: true,
        });
      } else {
        if (!fullPrompt.trim()) { setError('Please enter a prompt'); setLoading(false); return; }
        await api.regenerateSceneImage(project._id, img.sceneId, {
          prompt: fullPrompt.trim(),
          model: selectedModel,
          refineFromCurrent: false,
        });
      }
      setShowRegenerate(false);
      setAdditionalPrompt('');
      setFullPrompt('');
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Regeneration failed');
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

  async function handleDirectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setLoading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => { const r = reader.result as string; resolve(r.slice(r.indexOf(',') + 1)); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.uploadSceneImageDirect(project._id, img.sceneId, base64, file.type || 'image/jpeg');
      setShowRegenerate(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  async function handleRemoveManual() {
    setLoading(true);
    try {
      await api.removeSceneImageDirect(project._id, img.sceneId);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${isManual ? 'border-emerald-300' : 'border-gray-200'}`}>
      <img
        src={imageUrl}
        alt={`Scene ${img.sceneId}`}
        style={thumbStyle}
        className="w-full object-cover bg-gray-100"
      />
      <input ref={uploadInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleDirectUpload} />
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
            {isManual && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Manual</span>
            )}
            <button
              onClick={() => {
                setShowRegenerate(true);
                setRegenMode('upload');
                setError('');
              }}
              disabled={loading}
              className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
              title="Use your own image for this scene"
            >
              {isManual ? 'Replace my image' : 'Use my image'}
            </button>
            <a
              href={imageUrl}
              download={img.filename}
              className="text-xs text-gray-500 hover:text-gray-700"
              title="Download image"
            >
              ↓
            </a>
            {isManual && (
              <button onClick={handleRemoveManual} disabled={loading} className="text-[11px] text-red-400 hover:underline">
                Remove
              </button>
            )}
            <button
              onClick={() => { setShowRegenerate(v => !v); setError(''); }}
              className="text-xs text-blue-600 hover:underline"
            >
              {showRegenerate ? 'Cancel' : 'Change'}
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
          <div className="space-y-2 border-t border-gray-100 pt-2">
            {/* Model selector */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 shrink-0">Model:</span>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value as ImageModel)}
                disabled={loading}
                className="flex-1 text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {imageModelOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label} — {opt.description}</option>
                ))}
              </select>
            </div>

            {/* Mode toggle */}
            <div className="flex rounded overflow-hidden border border-gray-200 text-[11px]">
              <button
                onClick={() => setRegenMode('refine')}
                disabled={loading}
                className={`flex-1 py-1 font-medium transition-colors ${regenMode === 'refine' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Refine existing
              </button>
              <button
                onClick={() => setRegenMode('full')}
                disabled={loading}
                className={`flex-1 py-1 font-medium transition-colors ${regenMode === 'full' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Full regenerate
              </button>
              <button
                onClick={() => setRegenMode('upload')}
                disabled={loading}
                className={`flex-1 py-1 font-medium transition-colors ${regenMode === 'upload' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                My image
              </button>
            </div>

            {regenMode === 'refine' ? (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400">
                  Sends the current image as reference. Add details you want to change or improve.
                </p>
                <textarea
                  value={additionalPrompt}
                  onChange={e => setAdditionalPrompt(e.target.value)}
                  rows={2}
                  placeholder="e.g. add warm sunset lighting, remove background clutter…"
                  disabled={loading}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400">
                  Fresh generation — ignores the current image. Enter a complete new prompt.
                </p>
                <textarea
                  value={fullPrompt}
                  onChange={e => setFullPrompt(e.target.value)}
                  rows={3}
                  placeholder="Full prompt for new image…"
                  disabled={loading}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                />
              </div>
            )}

            {regenMode === 'upload' && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400">
                  Upload your own image — AI generation will be skipped for this scene.
                </p>
              </div>
            )}

            {error && <p className="text-[11px] text-red-500">{error}</p>}

            {regenMode === 'upload' ? (
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={loading}
                className="w-full rounded bg-emerald-600 text-white px-2 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading ? 'Uploading…' : '↑ Select image file'}
              </button>
            ) : (
              <button
                onClick={handleRegenerate}
                disabled={loading || (regenMode === 'full' && !fullPrompt.trim())}
                className="w-full rounded bg-indigo-600 text-white px-2 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Regenerating…' : regenMode === 'refine' ? '⚡ Refine image' : '⚡ Generate new image'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
