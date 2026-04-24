import { useState } from 'react';
import type { Project, StageKey, StageDoc } from '@content-creator/shared';
import { StatusBadge } from '../StatusBadge.tsx';
import { PromptEditor } from './PromptEditor.tsx';
import { GenerateButton } from './GenerateButton.tsx';
import { ReviewStoryboard } from './ReviewStoryboard.tsx';
import { ReviewImages } from './ReviewImages.tsx';
import { ReviewVideos } from './ReviewVideos.tsx';
import { ReviewAudio } from './ReviewAudio.tsx';
import { ReviewAssembly } from './ReviewAssembly.tsx';
import { api } from '../../api/client.ts';
import { ModelPicker } from './ModelPicker.tsx';
import { SceneReferenceUpload } from './SceneReferenceUpload.tsx';
import { SceneImageSetupPanel } from './SceneImageSetupPanel.tsx';
import { SceneVideoSetupPanel } from './SceneVideoSetupPanel.tsx';
import { VoiceoverSettingsPanel } from './VoiceoverSettingsPanel.tsx';
import { MusicSettingsPanel } from './MusicSettingsPanel.tsx';
import { AssemblySettingsPanel } from './AssemblySettingsPanel.tsx';
import { useProjectStore } from '../../store/projectStore.ts';

const STAGE_LABELS: Record<StageKey, string> = {
  storyboard: '1 · Storyboard',
  images:     '2 · Images',
  videos:     '3 · Videos',
  voiceover:  '4 · Voiceover',
  music:      '5 · Music',
  assembly:   '6 · Assembly',
};

interface StagePanelProps {
  project: Project;
  stageKey: StageKey;
  stage: StageDoc;
  onRefresh: () => void;
}

export function StagePanel({ project, stageKey, stage, onRefresh }: StagePanelProps) {
  const [expanded, setExpanded] = useState(
    stage.status !== 'pending'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [musicPromptOverride, setMusicPromptOverride] = useState<string | null>(null);

  const progress = useProjectStore(s => s.stageProgress[stageKey]);

  const isLocked = stage.status === 'pending';
  const isGenerating = stage.status === 'generating';
  const canGenerate = stage.status === 'prompt_ready' || stage.status === 'failed';
  const canApprove = stage.status === 'review';
  const canSkip = stageKey === 'music' && (stage.status === 'review' || stage.status === 'prompt_ready');

  // Videos stage: detect when ALL scenes have manual videos → allow skipping AI generation
  const allScenesManual = (() => {
    if (stageKey !== 'videos' || !canGenerate) return false;
    const storyboard = project.stages.storyboard.result as { scenes?: { id: number }[] } | undefined;
    const sceneCount = storyboard?.scenes?.length ?? 0;
    if (sceneCount === 0) return false;
    const manualVideos = ((project.stages.videos.stageConfig as Record<string, unknown> | undefined)?.manualVideos ?? {}) as Record<string, unknown>;
    return Object.keys(manualVideos).length >= sceneCount;
  })();
  const canReopen = stage.status === 'approved';
  // Voiceover can be regenerated at any time after first generation (review or approved)
  const canVoiceoverRegenerate = stageKey === 'voiceover' && (stage.status === 'review' || stage.status === 'approved');
  // Music can be regenerated after first generation (review or approved)
  const canMusicRegenerate = stageKey === 'music' && (stage.status === 'review' || stage.status === 'approved');
  // Assembly can be regenerated after first generation (review or approved) — adjust settings & re-run
  const canAssemblyRegenerate = stageKey === 'assembly' && (stage.status === 'review' || stage.status === 'approved');
  // Storyboard can be regenerated after first generation (review or approved)
  const canStoryboardRegenerate = stageKey === 'storyboard' && (stage.status === 'review' || stage.status === 'approved');
  // Images can be reset to prompt_ready to re-upload ref images and regenerate (e.g. after storyboard change)
  const canImagesRegenerate = stageKey === 'images' && (stage.status === 'review' || stage.status === 'approved');

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const data = stageKey === 'music' && musicPromptOverride ? { musicMood: musicPromptOverride } : undefined;
      await api.generateStage(project._id, stageKey, data);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      await api.approveStage(project._id, stageKey);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSkip() {
    setLoading(true);
    setError(null);
    try {
      await api.skipStage(project._id, stageKey);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReopen() {
    setLoading(true);
    setError(null);
    try {
      await api.reopenStage(project._id, stageKey);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForceReset() {
    setLoading(true);
    setError(null);
    try {
      await api.retryStage(project._id, stageKey);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleImagesReset() {
    setLoading(true);
    setError(null);
    try {
      await api.resetStage(project._id, stageKey);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-xl border ${isLocked ? 'border-gray-200 opacity-60' : 'border-gray-300'} bg-white overflow-hidden`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
        disabled={isLocked}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-800">{STAGE_LABELS[stageKey]}</span>
          <StatusBadge status={stage.status} />
        </div>
        <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Progress bar + stuck-generation warning */}
          {isGenerating && (
            <div className="space-y-2">
              {/* Progress bar — shown when we have real percent data from socket */}
              {progress && progress.percent > 0 ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                      {progress.message}
                    </span>
                    <span className="font-mono">{progress.percent}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              ) : (
                /* Indeterminate spinner while waiting for first progress event */
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
                  <span>{progress?.message ?? 'Starting generation…'}</span>
                </div>
              )}

              {/* Force-reset hint (subtle, not alarming) */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">If this appears stuck, you can force-reset it.</span>
                <button
                  onClick={handleForceReset}
                  disabled={loading}
                  className="text-xs text-gray-400 underline hover:text-gray-600 disabled:opacity-50"
                >
                  Force Reset
                </button>
              </div>
            </div>
          )}

          {/* Model picker — shown when about to generate (or for voiceover/music/storyboard at any non-locked state) */}
          {(canGenerate || canVoiceoverRegenerate || canMusicRegenerate || canStoryboardRegenerate) && stageKey !== 'assembly' && (
            <ModelPicker
              projectId={project._id}
              stageKey={stageKey}
              modelConfig={project.modelConfig}
              onUpdate={onRefresh}
            />
          )}

          {/* Reference image upload — images stage only, before generating */}
          {canGenerate && stageKey === 'images' && (
            <SceneReferenceUpload project={project} onRefresh={onRefresh} />
          )}

          {/* Manual image upload per scene — images stage, before generating */}
          {canGenerate && stageKey === 'images' && (
            <SceneImageSetupPanel project={project} onRefresh={onRefresh} />
          )}

          {/* Manual video upload per scene — videos stage, before generating */}
          {canGenerate && stageKey === 'videos' && (
            <SceneVideoSetupPanel project={project} onRefresh={onRefresh} />
          )}

          {/* Voiceover settings — always shown once unlocked so user can adjust and regenerate */}
          {!isLocked && stageKey === 'voiceover' && (
            <VoiceoverSettingsPanel project={project} stage={stage} onRefresh={onRefresh} />
          )}

          {/* Music settings — shown when about to generate or regenerate */}
          {!isLocked && stageKey === 'music' && (
            <MusicSettingsPanel
              project={project}
              stage={stage}
              onSaved={prompt => setMusicPromptOverride(prompt)}
            />
          )}

          {/* Assembly settings — shown when generating for first time, after failure, or when regenerating */}
          {(canGenerate || canAssemblyRegenerate) && stageKey === 'assembly' && (
            <AssemblySettingsPanel project={project} stage={stage} onRefresh={onRefresh} />
          )}

          {/* Prompt editor (only when editable; not for voiceover/assembly/images — those have dedicated panels) */}
          {(stage.status === 'prompt_ready' || stage.status === 'failed') && stageKey !== 'voiceover' && stageKey !== 'assembly' && stageKey !== 'images' && (
            <PromptEditor
              projectId={project._id}
              stageKey={stageKey}
              initialPrompt={typeof stage.prompt === 'string' ? stage.prompt : JSON.stringify(stage.prompt)}
              onSave={onRefresh}
            />
          )}

          {/* Review panels */}
          {stage.status === 'review' || stage.status === 'approved' ? (
            <>
              {stageKey === 'storyboard' && <ReviewStoryboard project={project} onRefresh={onRefresh} />}
              {stageKey === 'images'     && <ReviewImages project={project} onRefresh={onRefresh} />}
              {stageKey === 'videos'     && <ReviewVideos project={project} onRefresh={onRefresh} />}
              {stageKey === 'voiceover'  && <ReviewAudio project={project} stageKey="voiceover" onRefresh={onRefresh} />}
              {stageKey === 'music'      && <ReviewAudio project={project} stageKey="music" onRefresh={onRefresh} />}
              {stageKey === 'assembly'   && <ReviewAssembly project={project} />}
            </>
          ) : null}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {canGenerate && !allScenesManual && (
              <GenerateButton loading={loading} onClick={handleGenerate} />
            )}
            {allScenesManual && (
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading ? 'Processing…' : 'Use My Videos →'}
              </button>
            )}
            {canVoiceoverRegenerate && (
              <GenerateButton loading={loading} onClick={handleGenerate} label="Regenerate" />
            )}
            {canMusicRegenerate && (
              <GenerateButton loading={loading} onClick={handleGenerate} label="Regenerate Music" />
            )}
            {canAssemblyRegenerate && (
              <GenerateButton loading={loading} onClick={handleGenerate} label="Regenerate Video" />
            )}
            {canStoryboardRegenerate && (
              <GenerateButton loading={loading} onClick={handleGenerate} label="Regenerate Storyboard" />
            )}
            {canImagesRegenerate && (
              <button
                onClick={handleImagesReset}
                disabled={loading}
                className="rounded-lg border border-orange-300 text-orange-600 px-4 py-2 text-sm font-medium hover:bg-orange-50 disabled:opacity-50"
                title="Reset images stage — clears all generated & uploaded images so you can re-configure and regenerate with the new storyboard"
              >
                {loading ? 'Resetting…' : '↺ Reset & Regenerate Images'}
              </button>
            )}
            {canApprove && (
              <button
                onClick={handleApprove}
                disabled={loading}
                className="rounded-lg bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Approve & Continue
              </button>
            )}
            {canSkip && (
              <button
                onClick={handleSkip}
                disabled={loading}
                className="rounded-lg bg-gray-200 text-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-300 disabled:opacity-50"
              >
                Skip Music
              </button>
            )}
            {canReopen && (
              <button
                onClick={handleReopen}
                disabled={loading}
                className="rounded-lg border border-gray-300 text-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Re-open
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
