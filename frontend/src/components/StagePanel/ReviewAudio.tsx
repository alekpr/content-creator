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
  const stage = project.stages[stageKey];
  const result = stage.result as (VoiceoverResult | MusicResult) | undefined;

  if (!result) return <p className="text-sm text-gray-400">No audio result yet.</p>;

  const filename = 'filename' in result ? result.filename : undefined;
  if (!filename) return <p className="text-sm text-gray-400">No audio file yet.</p>;

  const audioUrl = `${API_BASE}/api/files/${project._id}/${filename}`;
  const versions = (stage.sceneVersions?.['0'] ?? []) as string[];

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
    <div className="space-y-2">
      <audio src={audioUrl} controls className="w-full" />
      <div className="flex items-center gap-3">
        {'durationSeconds' in result && (
          <p className="text-xs text-gray-500">Duration: {result.durationSeconds}s</p>
        )}
        <a
          href={audioUrl}
          download={filename}
          className="ml-auto text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1"
        >
          ↓ Download
        </a>
      </div>
      <VersionBadges
        versions={versions}
        selectedFilename={filename}
        loading={loading}
        onSelect={handleSelectVersion}
      />
    </div>
  );
}
