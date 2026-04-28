import { useState } from 'react';
import type { Project, StageDoc, AssemblyStageConfig, VideoFitMode, SceneTransitionMode } from '@content-creator/shared';
import { api } from '../../api/client.ts';

interface Props {
  project: Project;
  stage: StageDoc;
  onRefresh: () => void;
}

const DEFAULT_VOICE_VOLUME   = 1.0;
const DEFAULT_MUSIC_VOLUME   = 0.2;
const DEFAULT_FADE_IN        = 0.5;
const DEFAULT_FADE_OUT       = 1.0;

function pct(v: number) { return Math.round(v * 100); }
function fromPct(p: number) { return Math.round(p) / 100; }

export function AssemblySettingsPanel({ project, stage, onRefresh }: Props) {
  const saved = (stage.stageConfig ?? {}) as AssemblyStageConfig;

  const hasMusicApproved =
    project.stages.music.status === 'approved' ||
    project.stages.music.status === 'review';

  const [voiceVolume,   setVoiceVolume]   = useState(pct(saved.voiceVolume   ?? DEFAULT_VOICE_VOLUME));
  const [musicVolume,   setMusicVolume]   = useState(pct(saved.musicVolume   ?? DEFAULT_MUSIC_VOLUME));
  const [fadeIn,        setFadeIn]        = useState(saved.fadeInSeconds  ?? DEFAULT_FADE_IN);
  const [fadeOut,       setFadeOut]       = useState(saved.fadeOutSeconds ?? DEFAULT_FADE_OUT);
  const [quality,       setQuality]       = useState<'standard' | 'high'>(saved.outputQuality ?? 'standard');
  const [fitMode,       setFitMode]       = useState<VideoFitMode>(saved.videoFitMode ?? 'freeze');
  const [maxSpeedRatio, setMaxSpeedRatio] = useState(saved.maxSpeedRatio ?? 1.5);
  const [loopBackgroundMusic, setLoopBackgroundMusic] = useState(saved.loopBackgroundMusic ?? true);
  const [transitionMode, setTransitionMode] = useState<SceneTransitionMode>(saved.sceneTransitionMode ?? 'cut');
  const [transitionDuration, setTransitionDuration] = useState(saved.transitionDurationSeconds ?? 0.5);

  const [saving,   setSaving]   = useState(false);
  const [savedOk,  setSavedOk]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSavedOk(false);
    setError(null);
    try {
      const payload: AssemblyStageConfig = {
        voiceVolume: fromPct(voiceVolume),
        musicVolume: fromPct(musicVolume),
        fadeInSeconds:  fadeIn,
        fadeOutSeconds: fadeOut,
        outputQuality:  quality,
        videoFitMode:   fitMode,
        maxSpeedRatio,
        loopBackgroundMusic,
        sceneTransitionMode: transitionMode,
        transitionDurationSeconds: transitionDuration,
      };
      await api.saveAssemblySettings(project._id, payload);
      setSavedOk(true);
      onRefresh();
      setTimeout(() => setSavedOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-5">
      <h3 className="text-sm font-semibold text-gray-700">Assembly Settings</h3>

      {/* Volume Controls */}
      <div className="space-y-4">
        {/* Voiceover volume */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">Voiceover Volume</label>
            <span className="text-xs font-mono text-gray-500 w-10 text-right">{voiceVolume}%</span>
          </div>
          <input
            type="range"
            min={0} max={100} step={1}
            value={voiceVolume}
            onChange={e => setVoiceVolume(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
        </div>

        {/* Music volume — only shown when music stage is available */}
        {hasMusicApproved ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">Background Music Volume</label>
              <span className="text-xs font-mono text-gray-500 w-10 text-right">{musicVolume}%</span>
            </div>
            <input
              type="range"
              min={0} max={100} step={1}
              value={musicVolume}
              onChange={e => setMusicVolume(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Music volume unavailable — no music approved yet</p>
        )}
      </div>

      {/* Music Loop Mode */}
      {hasMusicApproved && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-600">Background Music Playback</label>
          <div className="flex gap-2">
            {([
              { value: true, label: 'Loop Music', note: 'Repeat the music until the voiceover ends.' },
              { value: false, label: 'Play Once', note: 'Do not loop. Music ends when the source track ends.' },
            ] as const).map(option => (
              <button
                key={String(option.value)}
                onClick={() => setLoopBackgroundMusic(option.value)}
                className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  loopBackgroundMusic === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <div>{option.label}</div>
                <div className="mt-1 text-[11px] font-normal text-current/80">{option.note}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fade Controls */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Audio Fade In</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0} max={5} step={0.1}
              value={fadeIn}
              onChange={e => setFadeIn(Math.max(0, Math.min(5, Number(e.target.value))))}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-center"
            />
            <span className="text-xs text-gray-400">sec</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Audio Fade Out</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0} max={5} step={0.1}
              value={fadeOut}
              onChange={e => setFadeOut(Math.max(0, Math.min(5, Number(e.target.value))))}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-center"
            />
            <span className="text-xs text-gray-400">sec</span>
          </div>
        </div>
      </div>

      {/* Video Fit Mode */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Video–Voiceover Sync</label>
        <div className="flex gap-2">
          {(['freeze', 'speed'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setFitMode(mode)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                fitMode === mode
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {mode === 'freeze' ? '🧊 Freeze / Trim' : '⏩ Speed Up / Slow Down'}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {fitMode === 'freeze'
            ? 'Freeze last frame when audio is longer; trim when audio is shorter.'
            : 'Retime video speed to match voiceover duration exactly.'}
        </p>

        {/* Max speed ratio — only relevant in speed mode */}
        {fitMode === 'speed' && (
          <div className="flex items-center gap-3 pt-1">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Max ratio</label>
            <input
              type="range"
              min={1.1} max={3.0} step={0.1}
              value={maxSpeedRatio}
              onChange={e => setMaxSpeedRatio(Number(e.target.value))}
              className="flex-1 accent-blue-600"
            />
            <span className="text-xs font-mono text-gray-500 w-10 text-right">{maxSpeedRatio.toFixed(1)}×</span>
          </div>
        )}
        {fitMode === 'speed' && maxSpeedRatio > 2.0 && (
          <p className="text-xs text-amber-600">⚠ Ratios above 2× may look unnatural. Clips beyond the limit will fall back to freeze/trim.</p>
        )}
      </div>

      {/* Scene Transition Mode */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Scene Transitions</label>
        <div className="flex gap-2">
          {(['cut', 'xfade'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setTransitionMode(mode)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                transitionMode === mode
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {mode === 'cut' ? '✂️ Hard Cut' : '🔄 Crossfade'}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {transitionMode === 'cut'
            ? 'Fast concat with no visual transition between scenes.'
            : 'Smooth crossfade between scenes (slower, requires re-encoding).'}
        </p>

        {/* Transition duration — only relevant in xfade mode */}
        {transitionMode === 'xfade' && (
          <div className="flex items-center gap-3 pt-1">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Duration</label>
            <input
              type="range"
              min={0.1} max={2.0} step={0.1}
              value={transitionDuration}
              onChange={e => setTransitionDuration(Number(e.target.value))}
              className="flex-1 accent-blue-600"
            />
            <span className="text-xs font-mono text-gray-500 w-12 text-right">{transitionDuration.toFixed(1)}s</span>
          </div>
        )}
        {transitionMode === 'xfade' && (
          <p className="text-xs text-amber-600">
            ⚠ Crossfade mode is significantly slower than cut mode due to re-encoding.
          </p>
        )}
      </div>

      {/* Output Quality */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Output Quality</label>
        <div className="flex gap-2">
          {(['standard', 'high'] as const).map(q => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                quality === q
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {q === 'standard' ? '⚡ Standard (CRF 23)' : '✦ High (CRF 18)'}
            </button>
          ))}
        </div>
        {quality === 'high' && (
          <p className="text-xs text-amber-600">
            ⚠ High quality produces significantly larger files (~2–3× size).
          </p>
        )}
      </div>

      {/* Save */}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-gray-700 text-white px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : savedOk ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  );
}
