import { useState } from 'react';
import type { Project, StageDoc, VoiceoverStageConfig, Storyboard } from '@content-creator/shared';
import { TTS_VOICES } from '@content-creator/shared';
import { api } from '../../api/client.ts';

interface Props {
  project: Project;
  stage: StageDoc;
  onRefresh: () => void;
}

const AUDIO_TAG_EXAMPLES = [
  { tag: '[excitedly]', desc: 'Excited, energetic delivery' },
  { tag: '[whispering]', desc: 'Soft, hushed voice' },
  { tag: '[pause]', desc: 'Short dramatic pause' },
  { tag: '[laughs]', desc: 'Light laughter' },
  { tag: '[sadly]', desc: 'Sorrowful tone' },
  { tag: '[firmly]', desc: 'Authoritative, confident' },
  { tag: '[gently]', desc: 'Warm, tender delivery' },
  { tag: '[dramatically]', desc: 'Heightened emotion' },
];

export function VoiceoverSettingsPanel({ project, stage, onRefresh }: Props) {
  const stageConfig = (stage.stageConfig ?? {}) as VoiceoverStageConfig;
  const storyboard = project.stages.storyboard.result as Storyboard | undefined;

  const [voice, setVoice] = useState<string>(stageConfig.voice ?? project.input.voice);
  const [style, setStyle] = useState(stageConfig.directorNotes?.style ?? '');
  const [pacing, setPacing] = useState(stageConfig.directorNotes?.pacing ?? '');
  const [accent, setAccent] = useState(stageConfig.directorNotes?.accent ?? '');
  const [sceneNarrations, setSceneNarrations] = useState<Record<string, string>>(
    stageConfig.sceneNarrations ?? {}
  );

  const [saving, setSaving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [saved, setSaved] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [tagPreview, setTagPreview] = useState<Array<{ sceneId: number; original: string; enhanced: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function getNarration(sceneId: number): string {
    return sceneNarrations[String(sceneId)]
      ?? storyboard?.scenes.find(s => s.id === sceneId)?.narration
      ?? '';
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const directorNotes = (style || pacing || accent)
        ? { style, pacing, accent }
        : undefined;
      await api.saveVoiceoverSettings(project._id, {
        voice,
        directorNotes,
        sceneNarrations,
      });
      setSaved(true);
      onRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoTag() {
    setTagging(true);
    setTagPreview(null);
    setError(null);
    try {
      // First save current narration overrides so the backend uses them as input
      await api.saveVoiceoverSettings(project._id, { voice, sceneNarrations });
      const result = await api.autoTagNarrations(project._id, false);
      setTagPreview(result.scenes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTagging(false);
    }
  }

  function handleApplyTags() {
    if (!tagPreview) return;
    const updated = { ...sceneNarrations };
    for (const scene of tagPreview) updated[String(scene.sceneId)] = scene.enhanced;
    setSceneNarrations(updated);
    setTagPreview(null);
  }

  const scenes = storyboard?.scenes ?? [];

  return (
    <div className="space-y-5 border-t border-gray-100 pt-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Voiceover Settings</h3>
        <p className="text-xs text-gray-400">These settings are used when you click <strong>Generate</strong>. Save before generating.</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">{error}</div>
      )}

      {/* Voice Picker */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">Voice</label>
        <select
          value={voice}
          onChange={e => setVoice(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {TTS_VOICES.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400">Overrides the project-level voice for this stage.</p>
      </div>

      {/* Director's Notes */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-gray-600">Director's Notes <span className="font-normal text-gray-400">(optional — guide the AI narrator's delivery)</span></p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Style</label>
            <input
              type="text"
              value={style}
              onChange={e => setStyle(e.target.value)}
              placeholder="e.g. Enthusiastic, Warm"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pacing</label>
            <input
              type="text"
              value={pacing}
              onChange={e => setPacing(e.target.value)}
              placeholder="e.g. Slow and deliberate"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Accent</label>
            <input
              type="text"
              value={accent}
              onChange={e => setAccent(e.target.value)}
              placeholder="e.g. British RP, Neutral"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
      </div>

      {/* Per-scene narrations */}
      {scenes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Scene Narrations</p>
              <p className="text-xs text-gray-400">Pre-filled from storyboard. Edit here to override what the AI will speak per scene.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGuideOpen(o => !o)}
                className="text-xs text-blue-500 hover:underline"
              >
                {guideOpen ? 'Hide guide' : 'Audio tag guide'}
              </button>
              <button
                onClick={handleAutoTag}
                disabled={tagging}
                className="rounded-lg bg-purple-100 text-purple-700 px-3 py-1 text-xs font-medium hover:bg-purple-200 disabled:opacity-50"
              >
                {tagging ? 'Generating tags…' : '✦ Auto-tag with AI'}
              </button>
            </div>
          </div>

          {/* Collapsible audio tag guide */}
          {guideOpen && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 space-y-2">
              <p className="font-medium">Audio tag reference</p>
              <p className="text-blue-600">Insert tags directly in the narration text to control delivery, e.g. <code className="bg-blue-100 px-1 rounded">[excitedly] Great news!</code></p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {AUDIO_TAG_EXAMPLES.map(({ tag, desc }) => (
                  <div key={tag} className="flex gap-2">
                    <code className="bg-blue-100 px-1 rounded shrink-0">{tag}</code>
                    <span className="text-blue-600">{desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-blue-500">Note: Audio tags work best with <strong>gemini-3.1-flash-tts-preview</strong> and <strong>gemini-2.5-pro-preview-tts</strong>.</p>
            </div>
          )}

          {/* Auto-tag preview */}
          {tagPreview && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-purple-800">AI-generated tag preview</p>
                <div className="flex gap-2">
                  <button onClick={handleApplyTags} className="rounded-lg bg-purple-600 text-white px-3 py-1 text-xs font-medium hover:bg-purple-700">Apply all</button>
                  <button onClick={() => setTagPreview(null)} className="rounded-lg bg-gray-100 text-gray-600 px-3 py-1 text-xs font-medium hover:bg-gray-200">Discard</button>
                </div>
              </div>
              {tagPreview.map(scene => (
                <div key={scene.sceneId} className="space-y-1">
                  <p className="text-xs font-medium text-purple-700">Scene {scene.sceneId}</p>
                  <p className="text-xs text-gray-500 line-through">{scene.original}</p>
                  <p className="text-xs text-purple-900">{scene.enhanced}</p>
                </div>
              ))}
            </div>
          )}

          {scenes.map(scene => {
            const text = getNarration(scene.id);
            const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
            // ~150 wpm is comfortable spoken pace; scene.duration is the video clip length
            const safeWords = Math.round(scene.duration * 2.5); // 150wpm
            const ratio = wordCount / (safeWords || 1);
            const warnLevel: 'ok' | 'caution' | 'over' =
              ratio <= 1.0 ? 'ok' : ratio <= 1.3 ? 'caution' : 'over';
            const badgeClass =
              warnLevel === 'ok'      ? 'bg-green-100 text-green-700' :
              warnLevel === 'caution' ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-red-100 text-red-700';
            const badgeTitle =
              warnLevel === 'ok'      ? 'Fits comfortably within scene duration' :
              warnLevel === 'caution' ? 'Slightly long — speech may be marginally sped up' :
                                        'Too long — audio will overflow scene; video will hold last frame';
            return (
              <div key={scene.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500">Scene {scene.id} <span className="text-gray-400">({scene.duration}s)</span></label>
                  {wordCount > 0 && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}
                      title={badgeTitle}
                    >
                      {wordCount}w / ~{safeWords}w
                      {warnLevel === 'over' && ' ⚠ video will freeze'}
                    </span>
                  )}
                </div>
                <textarea
                  value={text}
                  onChange={e => setSceneNarrations(prev => ({ ...prev, [String(scene.id)]: e.target.value }))}
                  rows={2}
                  className={`w-full rounded-lg border px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 ${
                    warnLevel === 'over'
                      ? 'border-red-300 focus:ring-red-400'
                      : warnLevel === 'caution'
                      ? 'border-yellow-300 focus:ring-yellow-400'
                      : 'border-gray-300 focus:ring-blue-400'
                  }`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {saved && <span className="text-sm text-green-600">Settings saved</span>}
      </div>
    </div>
  );
}
