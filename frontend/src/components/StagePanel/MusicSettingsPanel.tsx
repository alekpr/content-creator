import { useState } from 'react';
import type { Project, StageDoc, MusicStageConfig, Storyboard } from '@content-creator/shared';
import { api } from '../../api/client.ts';

interface Props {
  project: Project;
  stage: StageDoc;
  onSaved: (customPrompt: string) => void;
}

export function MusicSettingsPanel({ project, stage, onSaved }: Props) {
  const stageConfig = (stage.stageConfig ?? {}) as MusicStageConfig;
  const storyboard = project.stages.storyboard.result as Storyboard | undefined;
  const brief = storyboard?.directorsBrief?.music;

  // Effective prompt source order: customPrompt → briefPromptText → music_mood
  const autoPrompt = brief?.promptText || storyboard?.music_mood || 'upbeat, positive';
  const [customPrompt, setCustomPrompt] = useState(stageConfig.customPrompt ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);

  const isCustom = customPrompt.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.saveMusicSettings(project._id, {
        customPrompt: customPrompt.trim() || undefined,
      });
      setSaved(true);
      onSaved(customPrompt.trim() || autoPrompt);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleUseBrief() {
    setCustomPrompt(autoPrompt);
  }

  return (
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-gray-600">Music Prompt</p>
          {isCustom ? (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">✎ Custom</span>
          ) : brief ? (
            <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">✦ Auto from brief</span>
          ) : null}
        </div>
        {brief && (
          <button onClick={() => setShowBrief(o => !o)} className="text-xs text-violet-600 hover:underline">
            {showBrief ? 'Hide brief' : 'View auto brief'}
          </button>
        )}
      </div>

      {/* Auto director's brief preview */}
      {showBrief && brief && (
        <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 text-xs text-violet-800 space-y-1">
          <p className="font-semibold text-violet-700">🎵 Director's Music Brief</p>
          {brief.genre       && <p><span className="font-medium">Genre:</span> {brief.genre}</p>}
          {brief.tempo       && <p><span className="font-medium">Tempo:</span> {brief.tempo}</p>}
          {brief.instruments && <p><span className="font-medium">Instruments:</span> {brief.instruments}</p>}
          {brief.moodArc     && <p><span className="font-medium">Mood arc:</span> {brief.moodArc}</p>}
          {brief.promptText  && (
            <div className="pt-1 border-t border-violet-200 mt-1">
              <p className="font-medium text-violet-600 mb-1">Ready-to-use prompt:</p>
              <p className="italic">"{brief.promptText}"</p>
            </div>
          )}
          <button
            onClick={handleUseBrief}
            className="mt-2 rounded bg-violet-200 text-violet-800 px-2 py-1 text-[10px] font-medium hover:bg-violet-300"
          >
            Copy to editor ↓
          </button>
        </div>
      )}

      {/* Prompt editor */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Custom prompt <span className="text-gray-400">(leave blank to use auto brief)</span>
        </label>
        <textarea
          rows={4}
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          placeholder={`Auto: ${autoPrompt}`}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          Describe the music style, mood, instruments, and tempo. The generator adds "No lyrics. Loopable." automatically.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs">{error}</div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  );
}
