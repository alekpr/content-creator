import { useState } from 'react';
import type { Project, StageDoc, VoiceoverStageConfig, Storyboard } from '@content-creator/shared';
import { TTS_VOICE_METADATA } from '@content-creator/shared';
import { api } from '../../api/client.ts';

interface Props {
  project: Project;
  stage: StageDoc;
  onRefresh: () => void;
}

/**
 * Count spoken words after stripping audio tags.
 * Uses Intl.Segmenter (built-in, no extra deps) which handles Thai and other
 * languages that don't use spaces between words.
 * Falls back to space-splitting for environments that don't support Segmenter.
 */
function countSpokenWords(text: string, locale: string): number {
  const stripped = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  if (!stripped) return 0;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const seg = new (Intl as unknown as { Segmenter: new (locale: string, opts: object) => { segment: (s: string) => Iterable<{ isWordLike?: boolean }> } }).Segmenter(locale, { granularity: 'word' });
      return [...seg.segment(stripped)].filter(s => s.isWordLike).length;
    } catch { /* fall through */ }
  }
  return stripped.split(/\s+/).length;
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
  const brief = storyboard?.directorsBrief;

  // AI-recommended voice from storyboard analysis
  const recommendedVoice = brief?.voiceover.recommendedVoice;
  
  // Voice priority: stageConfig.voice (user override) > recommendedVoice (AI) > project.input.voice (default)
  const defaultVoice = stageConfig.voice ?? recommendedVoice ?? project.input.voice;

  // Brief-derived defaults — used as placeholder when user hasn't typed anything
  const briefStyle = brief
    ? [brief.voiceover.narratorPersona, brief.voiceover.emotionalArc, brief.voiceover.deliveryStyle].filter(Boolean).join('. ')
    : '';
  const briefPacing = brief?.voiceover.pacing ?? '';
  const briefAccent = brief?.voiceover.accent ?? '';

  const [voice, setVoice] = useState<string>(defaultVoice);
  const [style, setStyle] = useState(stageConfig.directorNotes?.style ?? '');
  const [pacing, setPacing] = useState(stageConfig.directorNotes?.pacing ?? '');
  const [accent, setAccent] = useState(stageConfig.directorNotes?.accent ?? '');
  const [sceneNarrations, setSceneNarrations] = useState<Record<string, string>>(
    stageConfig.sceneNarrations ?? {}
  );
  const [tagMoodInstruction, setTagMoodInstruction] = useState(stageConfig.tagMoodInstruction ?? '');

  const [saving, setSaving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [taggingScene, setTaggingScene] = useState<number | null>(null);
  const [fittingScene, setFittingScene] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [tagPreview, setTagPreview] = useState<Array<{ sceneId: number; original: string; enhanced: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);

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
        tagMoodInstruction: tagMoodInstruction.trim() || undefined,
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

  async function handleAutoTagScene(sceneId: number) {
    setTaggingScene(sceneId);
    setError(null);
    try {
      const result = await api.autoTagNarrations(project._id, false, sceneId);
      const scene = result.scenes[0];
      if (scene) {
        setSceneNarrations(prev => ({ ...prev, [String(sceneId)]: scene.enhanced }));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaggingScene(null);
    }
  }

  async function handleFitTranscript(sceneId: number) {
    setFittingScene(sceneId);
    setError(null);
    try {
      const result = await api.fitVoiceoverTranscript(project._id, sceneId);
      setSceneNarrations(prev => ({ ...prev, [String(sceneId)]: result.rewritten }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFittingScene(null);
    }
  }

  async function handleRegenerateScene(sceneId: number) {
    setRegeneratingScene(sceneId);
    setError(null);
    try {
      // Save latest narration overrides first so the backend uses the current text
      await api.saveVoiceoverSettings(project._id, { voice, sceneNarrations });
      await api.regenerateVoiceoverScene(project._id, sceneId);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegeneratingScene(null);
    }
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
        <div className="flex items-center gap-2">
          <label className="block text-xs font-medium text-gray-600">Voice</label>
          {recommendedVoice && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              ✦ AI selected: {recommendedVoice}
            </span>
          )}
        </div>
        <select
          value={voice}
          onChange={e => setVoice(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {TTS_VOICE_METADATA.map(v => (
            <option key={v.name} value={v.name}>
              {v.name} — {v.description} ({v.gender === 'female' ? 'Female' : 'Male'})
              {v.name === recommendedVoice ? ' ★ AI Recommended' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400">
          {recommendedVoice 
            ? 'AI analyzed your story and selected this voice. You can override it here.'
            : 'Choose a voice that matches your content tone. Will be used for all narrations.'}
        </p>
      </div>

      {/* Director's Notes */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-gray-600">Director's Notes</p>
          {brief && !stageConfig.directorNotes?.style && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
              ✦ AI pre-filled from storyboard brief
            </span>
          )}
          {stageConfig.directorNotes?.style && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              ✎ Custom
            </span>
          )}
        </div>
        {brief && !stageConfig.directorNotes?.style && (
          <div className="rounded-lg bg-violet-50 border border-violet-100 p-3 text-xs text-violet-800 space-y-1">
            <p className="font-medium text-violet-700">Director's Brief (auto-generated)</p>
            {brief.voiceover.narratorPersona && <p><span className="font-medium">Persona:</span> {brief.voiceover.narratorPersona}</p>}
            {brief.voiceover.emotionalArc     && <p><span className="font-medium">Emotional arc:</span> {brief.voiceover.emotionalArc}</p>}
            {brief.voiceover.deliveryStyle    && <p><span className="font-medium">Delivery:</span> {brief.voiceover.deliveryStyle}</p>}
            {brief.voiceover.pacing           && <p><span className="font-medium">Pacing:</span> {brief.voiceover.pacing}</p>}
            {brief.voiceover.accent           && <p><span className="font-medium">Accent:</span> {brief.voiceover.accent}</p>}
            <p className="text-violet-500 pt-1">Override below to customise — otherwise the brief is used automatically.</p>
          </div>
        )}
        <p className="text-xs text-gray-400">Override to fine-tune the AI narrator's delivery. Leave blank to use the auto brief above.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Style</label>
            <input
              type="text"
              value={style}
              onChange={e => setStyle(e.target.value)}
              placeholder={briefStyle || 'e.g. Enthusiastic, Warm'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pacing</label>
            <input
              type="text"
              value={pacing}
              onChange={e => setPacing(e.target.value)}
              placeholder={briefPacing || 'e.g. Slow and deliberate'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Accent</label>
            <input
              type="text"
              value={accent}
              onChange={e => setAccent(e.target.value)}
              placeholder={briefAccent || 'e.g. British RP, Neutral'}
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

          {/* Mood & Tone Instruction for AI tagger */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600">Mood &amp; Tone Direction</label>
                {tagMoodInstruction.trim() && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                    ✦ Active
                  </span>
                )}
              </div>
              <button
                onClick={() => setSystemPromptOpen(o => !o)}
                className="text-xs text-gray-400 hover:text-purple-600 hover:underline shrink-0"
              >
                {systemPromptOpen ? 'Hide default prompt' : 'View default AI prompt'}
              </button>
            </div>

            {/* Collapsible: show the default system prompt baked into the tagger */}
            {systemPromptOpen && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-2">
                <p className="font-medium text-gray-600">Default instructions sent to AI (always applied)</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>Maintain a <strong>consistent</strong> vocal tone across all scenes — as if one narrator records the whole video in a single session.</li>
                  <li>Tags must <strong>flow naturally</strong> across scene boundaries; the energy arc should match the narrative structure:
                    <ul className="list-none ml-4 mt-0.5 space-y-0.5 text-gray-500">
                      <li><code className="bg-gray-200 px-1 rounded">HOOK</code> — energetic, attention-grabbing, slightly faster pace</li>
                      <li><code className="bg-gray-200 px-1 rounded">CONTEXT</code> — clear, informative, steady and warm</li>
                      <li><code className="bg-gray-200 px-1 rounded">BUT</code> — tense, dramatic, slower for emphasis</li>
                      <li><code className="bg-gray-200 px-1 rounded">REVEAL</code> — satisfying, confident, authoritative or warm close</li>
                    </ul>
                  </li>
                  <li>Use tags <strong>sparingly</strong> — only where they meaningfully affect delivery.</li>
                  <li>Allowed tags: <code className="bg-gray-200 px-1 rounded">[pause]</code> <code className="bg-gray-200 px-1 rounded">[excitedly]</code> <code className="bg-gray-200 px-1 rounded">[softly]</code> <code className="bg-gray-200 px-1 rounded">[whispering]</code> <code className="bg-gray-200 px-1 rounded">[dramatically]</code> <code className="bg-gray-200 px-1 rounded">[warmly]</code> <code className="bg-gray-200 px-1 rounded">[confidently]</code> <code className="bg-gray-200 px-1 rounded">[slowly]</code> <code className="bg-gray-200 px-1 rounded">[laughs]</code> <code className="bg-gray-200 px-1 rounded">[sighs]</code> <code className="bg-gray-200 px-1 rounded">[emphasize]</code></li>
                </ol>
                <p className="text-gray-400 pt-1">Your Mood &amp; Tone Direction below overrides these defaults with <strong>highest priority</strong>.</p>
              </div>
            )}

            <textarea
              value={tagMoodInstruction}
              onChange={e => setTagMoodInstruction(e.target.value)}
              rows={2}
              placeholder="e.g. ให้โทนดาร์กและ mysterious ตลอด, ใช้ pause เยอะ, หลีกเลี่ยง excitedly — หรือ: dark and mysterious throughout, heavy use of pauses, avoid upbeat tags"
              className="w-full rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <p className="text-xs text-gray-400">Applied to <strong>all scenes</strong> when using ✦ Auto-tag or ✦ Tag. Save settings first, then run Auto-tag.</p>
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
            // Count spoken words using Intl.Segmenter — handles Thai (no spaces) and audio tags stripped first
            const wordCount = countSpokenWords(text, project.input.language);
            // Words-per-second estimate varies by language:
            //   Thai ~180 syllables/min ≈ ~2.2 words/sec (words are shorter morphemes)
            //   English/others ~150 wpm ≈ ~2.5 words/sec
            const wps = project.input.language === 'th' ? 2.2 : 2.5;
            const safeWords = Math.round(scene.duration * wps);
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
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500 shrink-0">Scene {scene.id} <span className="text-gray-400">({scene.duration}s)</span></label>
                  <div className="flex items-center gap-2 ml-auto">
                    {wordCount > 0 && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}
                        title={badgeTitle}
                      >
                        {wordCount}w / ~{safeWords}w
                        {warnLevel === 'over' && ' ⚠ video will freeze'}
                      </span>
                    )}
                    {/* Per-scene auto-tag */}
                    <button
                      onClick={() => handleAutoTagScene(scene.id)}
                      disabled={tagging || taggingScene !== null || fittingScene !== null || regeneratingScene !== null}
                      title="Auto-tag this scene's narration with expressive audio tags"
                      className="rounded px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 shrink-0"
                    >
                      {taggingScene === scene.id ? '…' : '✦ Tag'}
                    </button>
                    {/* Per-scene fit-to-duration */}
                    <button
                      onClick={() => handleFitTranscript(scene.id)}
                      disabled={tagging || taggingScene !== null || fittingScene !== null || regeneratingScene !== null}
                      title={`Rewrite narration with AI to fit ${scene.duration}s duration`}
                      className="rounded px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-700 hover:bg-teal-200 disabled:opacity-50 shrink-0"
                    >
                      {fittingScene === scene.id ? '…' : '✂ Fit'}
                    </button>
                    {/* Per-scene regenerate — only available after full voiceover has been generated */}
                    {!!stage.result && (
                      <button
                        onClick={() => handleRegenerateScene(scene.id)}
                        disabled={regeneratingScene !== null || taggingScene !== null || fittingScene !== null}
                        title="Save settings and regenerate audio for this scene only"
                        className="rounded px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 shrink-0"
                      >
                        {regeneratingScene === scene.id ? '…' : '↻ Regen'}
                      </button>
                    )}
                  </div>
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
