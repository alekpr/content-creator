import type { Project, VoiceoverResult, MusicResult } from '@content-creator/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ReviewAudioProps {
  project: Project;
  stageKey: 'voiceover' | 'music';
}

export function ReviewAudio({ project, stageKey }: ReviewAudioProps) {
  const stage = project.stages[stageKey];
  const result = stage.result as (VoiceoverResult | MusicResult) | undefined;

  if (!result) return <p className="text-sm text-gray-400">No audio result yet.</p>;

  const filename = 'filename' in result ? result.filename : undefined;
  if (!filename) return <p className="text-sm text-gray-400">No audio file yet.</p>;

  const audioUrl = `${API_BASE}/api/files/${project._id}/${filename}`;

  return (
    <div className="space-y-2">
      <audio src={audioUrl} controls className="w-full" />
      {'durationSeconds' in result && (
        <p className="text-xs text-gray-500">Duration: {result.durationSeconds}s</p>
      )}
    </div>
  );
}
