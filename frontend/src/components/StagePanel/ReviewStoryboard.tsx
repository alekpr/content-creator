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
