import { useState } from 'react';
import type { Project, VoiceoverResult, MusicResult } from '@content-creator/shared';
import { api } from '../../api/client.ts';
import { VersionBadges } from './VersionBadges.tsx';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ReviewAudioProps {
  project: Project;
  stageKey: 'voiceover' | 'music';
  onRefresh: () => void;
}

export function ReviewAudio({ project, stageKey, onRefresh }: ReviewAudioProps) {
  const [loading, setLoading] = useState(false);
  const [showScenes, setShowScenes] = useState(false);
  const stage = project.stages[stageKey];
  const result = stage.result as (VoiceoverResult | MusicResult) | undefined;

  if (!result) return <p className="text-sm text-gray-400">No audio result yet.</p>;

  const filename = 'filename' in result ? result.filename : undefined;
  if (!filename) return <p className="text-sm text-gray-400">No audio file yet.</p>;

  const audioUrl = `${API_BASE}/api/files/${project._id}/${filename}`;
  const versions = (stage.sceneVersions?.['0'] ?? []) as string[];
  const sceneAudio = stageKey === 'voiceover'
    ? (result as VoiceoverResult).sceneAudio
    : undefined;

  async function handleSelectVersion(selectedFilename: string) {
    setLoading(true);
    try {
      await api.selectStageVersion(project._id, stageKey, selectedFilename);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Full voiceover player */}
      <audio src={audioUrl} controls className="w-full" />
      <div className="flex items-center gap-3">
        {'durationSeconds' in result && (
          <p className="text-xs text-gray-500">Duration: {result.durationSeconds?.toFixed(1)}s</p>
        )}
        {sceneAudio && Object.keys(sceneAudio).length > 0 && (
          <button
            onClick={() => setShowScenes(s => !s)}
            className="text-xs text-blue-500 hover:underline"
          >
            {showScenes ? 'Hide scene previews' : `▶ Preview per scene (${Object.keys(sceneAudio).length})`}
          </button>
        )}
        <a
          href={audioUrl}
          download={filename}
          className="ml-auto text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1"
        >
          ↓ Download
        </a>
      </div>

      {/* Per-scene audio players */}
      {showScenes && sceneAudio && (
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-600 mb-2">Scene Previews</p>
          {Object.entries(sceneAudio)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([sceneId, audio]) => (
              <div key={sceneId} className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 font-medium">
                    Scene {sceneId}
                    <span className="ml-1 text-gray-400">({audio.durationSeconds.toFixed(1)}s)</span>
                  </p>
                </div>
                {audio.narrationUsed && (
                  <p className="text-xs text-gray-400 italic line-clamp-2">{audio.narrationUsed}</p>
                )}
                <audio
                  src={`${API_BASE}/api/files/${project._id}/${audio.filename}`}
                  controls
                  className="w-full h-8"
                  style={{ height: '2rem' }}
                />
              </div>
            ))}
        </div>
      )}

      <VersionBadges
        versions={versions}
        selectedFilename={filename}
        loading={loading}
        onSelect={handleSelectVersion}
      />
    </div>
  );
}
