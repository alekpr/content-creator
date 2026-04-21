import { useState, useRef } from 'react';
import type { Project, SceneVideoResult, VideoModel } from '@content-creator/shared';
import { STAGE_MODEL_OPTIONS, DEFAULT_STAGE_MODELS } from '@content-creator/shared';
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
  // mode: 'refine' = append details; 'full' = new prompt; 'upload' = direct file upload
  const [regenMode, setRegenMode] = useState<'refine' | 'full' | 'upload'>('refine');
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [additionalPrompt, setAdditionalPrompt] = useState('');
  const [fullPrompt, setFullPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<VideoModel>(
    ((project.modelConfig as Record<string, string> | undefined)?.videos as VideoModel | undefined)
    ?? DEFAULT_STAGE_MODELS.videos
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sceneVersions = (project.stages.videos.sceneVersions ?? {}) as Record<string, string[]>;
  const versions = sceneVersions[String(video.sceneId)] ?? [];
  const videoUrl = `${API_BASE}/api/files/${project._id}/${video.filename}`;
  const isPortrait = project.input.platform === 'tiktok';
  const thumbStyle = isPortrait ? { aspectRatio: '9/16' } : { aspectRatio: '16/9' };
  const manualVideos = ((project.stages.videos.stageConfig as Record<string, unknown> | undefined)?.manualVideos ?? {}) as Record<string, string>;
  const isManual = !!manualVideos[String(video.sceneId)];

  const videoModelOptions = STAGE_MODEL_OPTIONS.videos;

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
    setError('');
    if (regenMode === 'full' && !fullPrompt.trim()) {
      setError('Please enter a prompt');
      return;
    }
    setLoading(true);
    try {
      if (regenMode === 'refine') {
        await api.regenerateSceneVideo(project._id, video.sceneId, {
          additionalPrompt: additionalPrompt.trim() || undefined,
          model: selectedModel,
        });
      } else {
        await api.regenerateSceneVideo(project._id, video.sceneId, {
          prompt: fullPrompt.trim(),
          model: selectedModel,
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
      await api.uploadSceneVideoDirect(project._id, video.sceneId, base64, file.type || 'video/mp4');
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
      await api.removeSceneVideoDirect(project._id, video.sceneId);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${isManual ? 'border-emerald-300' : 'border-gray-200'}`}>
      <video
        src={videoUrl}
        controls
        style={thumbStyle}
        className="w-full bg-black"
      />
      <input ref={uploadInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleDirectUpload} />
      <div className="p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Scene {video.sceneId} · {video.durationSeconds}s</span>
          <div className="flex items-center gap-2">
            {isManual && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Manual</span>
            )}
            <a
              href={videoUrl}
              download={video.filename}
              className="text-xs text-gray-500 hover:text-gray-700"
              title="Download clip"
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
          selectedFilename={video.filename}
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
                onChange={e => setSelectedModel(e.target.value as VideoModel)}
                disabled={loading}
                className="flex-1 text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {videoModelOptions.map(opt => (
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
                Refine prompt
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
                My video
              </button>
            </div>

            {regenMode === 'refine' ? (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400">
                  Keeps the original storyboard prompt. Add details you want to change or emphasise.
                </p>
                <textarea
                  value={additionalPrompt}
                  onChange={e => setAdditionalPrompt(e.target.value)}
                  rows={2}
                  placeholder="e.g. slow motion, add fog, dramatic lighting…"
                  disabled={loading}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400">
                  Replaces the prompt entirely. Enter a complete new video description.
                </p>
                <textarea
                  value={fullPrompt}
                  onChange={e => setFullPrompt(e.target.value)}
                  rows={3}
                  placeholder="Full prompt for new video clip…"
                  disabled={loading}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                />
              </div>
            )}

            {regenMode === 'upload' && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400">
                  Upload your own video clip — AI generation will be skipped for this scene.
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
                {loading ? 'Uploading…' : '↑ Select video file'}
              </button>
            ) : (
              <button
                onClick={handleRegenerate}
                disabled={loading || (regenMode === 'full' && !fullPrompt.trim())}
                className="w-full rounded bg-indigo-600 text-white px-2 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Regenerating…' : regenMode === 'refine' ? '⚡ Refine video' : '⚡ Generate new video'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
