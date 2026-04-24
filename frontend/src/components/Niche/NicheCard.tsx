import type { NicheResult, NicheCompetition } from '@content-creator/shared';

const COMPETITION_COLORS: Record<NicheCompetition, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

const GROWTH_LABELS = {
  growing: '↑ Growing',
  stable: '→ Stable',
  declining: '↓ Declining',
};

interface NicheCardProps {
  result: NicheResult;
  isTop: boolean;
  onUse: () => void;
  isUsing: boolean;
}

export function NicheCard({ result, isTop, onUse, isUsing }: NicheCardProps) {
  return (
    <div className={`rounded-xl border bg-white p-5 space-y-4 ${isTop ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-900 text-base">{result.name}</h3>
          {isTop && (
            <span className="inline-flex items-center rounded-full bg-blue-600 text-white text-xs font-medium px-2 py-0.5">
              Top Pick
            </span>
          )}
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COMPETITION_COLORS[result.competition]}`}>
          {result.competition} competition
        </span>
      </div>

      <p className="text-sm text-gray-600">{result.description}</p>

      {/* Fit score bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-500">Fit Score</span>
          <span className="text-xs font-semibold text-gray-700">{result.fitScore}/100</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${result.fitScore >= 70 ? 'bg-blue-500' : result.fitScore >= 40 ? 'bg-yellow-400' : 'bg-red-400'}`}
            style={{ width: `${result.fitScore}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">{result.whyFit}</p>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        <div>
          <span className="font-medium">RPM:</span>{' '}
          ฿{result.rpmRangeTHB.min}–฿{result.rpmRangeTHB.max}
        </div>
        <div>
          <span className="font-medium">Trend:</span>{' '}
          {GROWTH_LABELS[result.growthTrend]}
        </div>
      </div>

      {/* Monetization */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Monetization</p>
        <div className="flex flex-wrap gap-1">
          {result.monetizationMethods.map(m => (
            <span key={m} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{m}</span>
          ))}
        </div>
      </div>

      {/* Content ideas */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Content Ideas</p>
        <ul className="space-y-0.5">
          {result.contentIdeas.slice(0, 5).map((idea, i) => (
            <li key={i} className="text-xs text-gray-600 flex gap-1.5">
              <span className="text-gray-400 shrink-0">{i + 1}.</span>
              {idea}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <button
        onClick={onUse}
        disabled={isUsing}
        className="w-full rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isUsing ? 'Loading…' : 'Use this Niche →'}
      </button>
    </div>
  );
}
