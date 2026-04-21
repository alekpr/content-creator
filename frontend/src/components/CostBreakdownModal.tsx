import type { CostBreakdown, StageKey } from '@content-creator/shared';

interface CostBreakdownModalProps {
  breakdown: CostBreakdown;
  onClose: () => void;
}

const STAGE_LABELS: Record<StageKey, string> = {
  storyboard: 'Storyboard',
  images:     'Images',
  videos:     'Videos',
  voiceover:  'Voiceover',
  music:      'Music',
  assembly:   'Assembly',
};

const STAGE_ICONS: Record<StageKey, string> = {
  storyboard: '📝',
  images:     '🖼️',
  videos:     '🎬',
  voiceover:  '🎙️',
  music:      '🎵',
  assembly:   '⚙️',
};

function fmtCost(usd: number) {
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n?: number) {
  if (n === undefined || n === 0) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtMs(ms?: number) {
  if (!ms) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function CostBreakdownModal({ breakdown, onClose }: CostBreakdownModalProps) {
  const stageOrder: StageKey[] = ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'];
  const rows = stageOrder.map(key => ({ key, entry: breakdown.stages[key] })).filter(r => r.entry);

  const isOver = breakdown.totalCostUSD > breakdown.estimatedCostUSD;
  const diff = breakdown.totalCostUSD - breakdown.estimatedCostUSD;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cost Breakdown</h2>
            <p className="text-xs text-gray-500 mt-0.5">Token usage and cost per stage</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 text-left">Stage</th>
                <th className="px-4 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 text-right">Duration</th>
                <th className="px-4 py-2 text-right">Attempts</th>
                <th className="px-4 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ key, entry }) => (
                <tr key={key} className="hover:bg-gray-50">
                  <td className="px-4 py-3 flex items-center gap-2">
                    <span>{STAGE_ICONS[key]}</span>
                    <span className="font-medium text-gray-800">{STAGE_LABELS[key]}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600">
                    {fmtTokens(entry!.totalTokens)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {fmtMs(entry!.durationMs)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {entry!.attempts}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-800">
                    {fmtCost(entry!.costUSD)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 space-y-2">
          {breakdown.totalTokens > 0 && (
            <div className="flex justify-between text-xs text-gray-500">
              <span>Total tokens</span>
              <span className="font-mono">{fmtTokens(breakdown.totalTokens)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs text-gray-500">
            <span>Estimated</span>
            <span className="font-mono">{fmtCost(breakdown.estimatedCostUSD)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold">
            <span className="text-gray-800">Actual total</span>
            <span className={`font-mono ${isOver ? 'text-red-600' : 'text-green-700'}`}>
              {fmtCost(breakdown.totalCostUSD)}
              {diff !== 0 && (
                <span className="ml-1.5 text-xs font-normal">
                  ({isOver ? '+' : ''}{fmtCost(diff)})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
