import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useProject } from '../hooks/useProject.ts';
import { useSocket } from '../hooks/useSocket.ts';
import { useProjectStore } from '../store/projectStore.ts';
import { StagePanel } from '../components/StagePanel/StagePanel.tsx';
import { CostBadge } from '../components/CostBadge.tsx';
import { CostBreakdownModal } from '../components/CostBreakdownModal.tsx';
import type { StageKey } from '@content-creator/shared';

const STAGE_KEYS: StageKey[] = ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'];

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, refresh } = useProject(id);
  const { isConnected, costBreakdown } = useProjectStore();
  const [showCost, setShowCost] = useState(false);

  useSocket(id, refresh);

  // Re-fetch whenever socket reports a stage change
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  const totalCost = project.actualCostUSD ?? project.estimatedCostUSD;
  const activeCostBreakdown = costBreakdown ?? project.costBreakdown;

  return (
    <div className="min-h-screen bg-gray-50">
      {showCost && activeCostBreakdown && (
        <CostBreakdownModal breakdown={activeCostBreakdown} onClose={() => setShowCost(false)} />
      )}

      {/* Nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ← Back
          </button>
          <h1 className="text-lg font-semibold text-gray-900 truncate max-w-md">
            {project.title || 'Untitled Project'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Socket connection indicator */}
          <span className={`inline-flex items-center gap-1.5 text-xs ${isConnected ? 'text-green-600' : 'text-gray-400'}`}>
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
          <button
            onClick={() => setShowCost(true)}
            disabled={!activeCostBreakdown}
            className="flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-default"
            title={activeCostBreakdown ? 'View cost breakdown' : 'No breakdown yet'}
          >
            <CostBadge usd={totalCost} />
            {activeCostBreakdown && (
              <span className="text-xs text-gray-400 hover:text-gray-600">details ↗</span>
            )}
          </button>
        </div>
      </header>

      {/* Project metadata */}
      <div className="max-w-3xl mx-auto px-6 py-4">
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          <span className="rounded bg-gray-100 px-2 py-1">{project.input.platform}</span>
          <span className="rounded bg-gray-100 px-2 py-1">{project.input.duration}</span>
          <span className="rounded bg-gray-100 px-2 py-1">{project.input.style}</span>
          <span className="rounded bg-gray-100 px-2 py-1">{project.input.language}</span>
          <span className="rounded bg-gray-100 px-2 py-1">voice: {project.input.voice}</span>
          {project.input.includeMusic && (
            <span className="rounded bg-gray-100 px-2 py-1">🎵 music</span>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-600">{project.input.topic}</p>
      </div>

      {/* Stages */}
      <main className="max-w-3xl mx-auto px-6 pb-12 space-y-3">
        {STAGE_KEYS.map(key => (
          <StagePanel
            key={`${project._id}-${key}`}
            project={project}
            stageKey={key}
            stage={project.stages[key]}
            onRefresh={refresh}
          />
        ))}
      </main>
    </div>
  );
}
