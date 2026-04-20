import { useState } from 'react';
import type { StageKey } from '@content-creator/shared';
import { api } from '../../api/client.ts';

interface PromptEditorProps {
  projectId: string;
  stageKey: StageKey;
  initialPrompt: string;
  onSave: () => void;
}

export function PromptEditor({ projectId, stageKey, initialPrompt, onSave }: PromptEditorProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.updatePrompt(projectId, stageKey, { prompt });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSave();
    } catch {
      // ignore — parent shows error
    } finally {
      setSaving(false);
    }
  }

  const changed = prompt !== initialPrompt;

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Prompt</label>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={4}
        maxLength={5000}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{prompt.length}/5000</span>
        {changed && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Prompt'}
          </button>
        )}
      </div>
    </div>
  );
}
