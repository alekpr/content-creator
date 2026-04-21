import { useState } from 'react';
import type { StageKey, StageModelConfig } from '@content-creator/shared';
import { STAGE_MODEL_OPTIONS, DEFAULT_STAGE_MODELS } from '@content-creator/shared';
import { api } from '../../api/client.ts';

type ModelStageKey = keyof StageModelConfig; // storyboard | images | videos | voiceover | music

const MODEL_STAGE_KEYS: ModelStageKey[] = ['storyboard', 'images', 'videos', 'voiceover', 'music'];

function isModelStageKey(key: StageKey): key is ModelStageKey {
  return (MODEL_STAGE_KEYS as string[]).includes(key);
}

interface ModelPickerProps {
  projectId: string;
  stageKey: StageKey;
  modelConfig?: Partial<StageModelConfig>;
  onUpdate?: () => void;
}

export function ModelPicker({ projectId, stageKey, modelConfig, onUpdate }: ModelPickerProps) {
  if (!isModelStageKey(stageKey)) return null;

  const options = STAGE_MODEL_OPTIONS[stageKey];
  const rawCurrent = modelConfig?.[stageKey] ?? DEFAULT_STAGE_MODELS[stageKey];
  // If the saved model is no longer in the options list (e.g. model was deprecated),
  // fall back to the default so the select renders a valid selection.
  const isValid = options.some(o => o.value === rawCurrent);
  const current = isValid ? rawCurrent : DEFAULT_STAGE_MODELS[stageKey];
  const [saving, setSaving] = useState(false);

  async function handleChange(value: string) {
    setSaving(true);
    try {
      await api.updateStageModel(projectId, stageKey, value);
      onUpdate?.();
    } catch {
      // silently keep current selection; user can retry
    } finally {
      setSaving(false);
    }
  }

  // Auto-fix: if the persisted model is invalid, save the corrected default immediately
  const needsAutoFix = !isValid && !!modelConfig?.[stageKey];
  if (needsAutoFix) {
    void api.updateStageModel(projectId, stageKey, current).catch(() => {});
  }

  const currentOption = options.find(o => o.value === current);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 whitespace-nowrap">AI Model:</span>
      <div className="relative">
        <select
          value={current}
          onChange={e => { void handleChange(e.target.value); }}
          disabled={saving}
          className="text-xs rounded-md border border-gray-200 bg-gray-50 px-2 py-1 pr-6 text-gray-700 appearance-none cursor-pointer hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label} — {opt.description}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▾</span>
      </div>
      {saving && <span className="text-xs text-indigo-500">saving…</span>}
      {!saving && currentOption && (
        <span className="text-xs text-gray-400">{currentOption.description}</span>
      )}
    </div>
  );
}
