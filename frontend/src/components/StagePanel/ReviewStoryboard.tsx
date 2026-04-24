import { useState } from 'react';
import type { Project, Storyboard, StoryboardScene } from '@content-creator/shared';
import { api } from '../../api/client.ts';

interface ReviewStoryboardProps {
  project: Project;
  onRefresh: () => void;
}

export function ReviewStoryboard({ project, onRefresh }: ReviewStoryboardProps) {
  const storyboard = project.stages.storyboard.result as Storyboard | undefined;
  if (!storyboard) return <p className="text-sm text-gray-400">No storyboard result yet.</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Title</p>
        <p className="text-sm text-gray-800">{storyboard.title}</p>
      </div>

      {storyboard.imageStyleBrief && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">✦ Image Style Brief (used by Stage 2)</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-gray-700"><span className="font-medium">Universe:</span> {storyboard.imageStyleBrief.visualUniverse}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Palette:</span> {storyboard.imageStyleBrief.palette}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Lighting:</span> {storyboard.imageStyleBrief.lightingStyle}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Composition:</span> {storyboard.imageStyleBrief.compositionStyle}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Rendering:</span> {storyboard.imageStyleBrief.renderingStyle}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-700"><span className="font-medium">Characters:</span> {storyboard.imageStyleBrief.characterConsistency}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Environment:</span> {storyboard.imageStyleBrief.environmentConsistency}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Mood arc:</span> {storyboard.imageStyleBrief.moodProgression}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Guardrails:</span> {storyboard.imageStyleBrief.negativeGuardrails}</p>
            </div>
          </div>
        </div>
      )}

      {/* Director's Brief — auto-generated alongside storyboard */}
      {storyboard.directorsBrief && (
        <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 space-y-3">
          <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">✦ Director's Brief (auto-generated)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-violet-600">🎙 Voiceover</p>
              {storyboard.directorsBrief.voiceover.narratorPersona && (
                <p className="text-xs text-gray-700"><span className="font-medium">Persona:</span> {storyboard.directorsBrief.voiceover.narratorPersona}</p>
              )}
              {storyboard.directorsBrief.voiceover.emotionalArc && (
                <p className="text-xs text-gray-700"><span className="font-medium">Arc:</span> {storyboard.directorsBrief.voiceover.emotionalArc}</p>
              )}
              {storyboard.directorsBrief.voiceover.deliveryStyle && (
                <p className="text-xs text-gray-700"><span className="font-medium">Style:</span> {storyboard.directorsBrief.voiceover.deliveryStyle}</p>
              )}
              {storyboard.directorsBrief.voiceover.pacing && (
                <p className="text-xs text-gray-700"><span className="font-medium">Pacing:</span> {storyboard.directorsBrief.voiceover.pacing}</p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-violet-600">🎵 Music</p>
              {storyboard.directorsBrief.music.genre && (
                <p className="text-xs text-gray-700"><span className="font-medium">Genre:</span> {storyboard.directorsBrief.music.genre}</p>
              )}
              {storyboard.directorsBrief.music.tempo && (
                <p className="text-xs text-gray-700"><span className="font-medium">Tempo:</span> {storyboard.directorsBrief.music.tempo}</p>
              )}
              {storyboard.directorsBrief.music.instruments && (
                <p className="text-xs text-gray-700"><span className="font-medium">Instruments:</span> {storyboard.directorsBrief.music.instruments}</p>
              )}
              {storyboard.directorsBrief.music.moodArc && (
                <p className="text-xs text-gray-700"><span className="font-medium">Mood arc:</span> {storyboard.directorsBrief.music.moodArc}</p>
              )}
              {storyboard.directorsBrief.music.promptText && (
                <p className="text-xs text-gray-500 italic pt-1">"{storyboard.directorsBrief.music.promptText}"</p>
              )}
            </div>
          </div>
        </div>
      )}

      {storyboard.scenes.map((scene, i) => (
        <SceneCard
          key={scene.id}
          index={i}
          scene={scene}
          project={project}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function SceneCard({
  index,
  scene,
  project,
  onRefresh,
}: {
  index: number;
  scene: StoryboardScene;
  project: Project;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const [visualPrompt, setVisualPrompt] = useState(scene.visual_prompt);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateScene(project._id, scene.id, { narration, visual_prompt: visualPrompt });
      setEditing(false);
      onRefresh();
    } catch {
      // no-op
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
        <span className="text-xs font-semibold text-gray-600">Scene {index + 1} · {scene.duration}s</span>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-blue-600 hover:underline"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      <div className="p-3 space-y-2">
        {editing ? (
          <>
            <label className="block text-xs text-gray-500">Visual Prompt</label>
            <textarea
              value={visualPrompt}
              onChange={e => setVisualPrompt(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <label className="block text-xs text-gray-500">Narration</label>
            <textarea
              value={narration}
              onChange={e => setNarration(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-blue-600 text-white px-3 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">{scene.visual_prompt}</p>
            {scene.narration && (
              <p className="text-xs italic text-gray-500">"{scene.narration}"</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
