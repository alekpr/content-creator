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

  const isLocked = stage.status === 'pending';
  const canGenerate = stage.status === 'prompt_ready' || stage.status === 'failed';
  const canApprove = stage.status === 'review';
  const canSkip = stageKey === 'music' && (stage.status === 'review' || stage.status === 'prompt_ready');
  const canReopen = stage.status === 'approved';

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      await api.generateStage(project._id, stageKey);
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

          {/* Model picker — shown when about to generate */}
          {canGenerate && stageKey !== 'assembly' && (
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

          {/* Prompt editor (only when editable) */}
          {(stage.status === 'prompt_ready' || stage.status === 'failed') && (
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
            {canGenerate && (
              <GenerateButton loading={loading} onClick={handleGenerate} />
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
