import type { StageStatus } from '@content-creator/shared';

const COLORS: Record<StageStatus, string> = {
  pending:       'bg-gray-100 text-gray-500',
  prompt_ready:  'bg-blue-100 text-blue-700',
  generating:    'bg-yellow-100 text-yellow-700 animate-pulse',
  review:        'bg-purple-100 text-purple-700',
  approved:      'bg-green-100 text-green-700',
  failed:        'bg-red-100 text-red-700',
  skipped:       'bg-gray-100 text-gray-400',
};

const LABELS: Record<StageStatus, string> = {
  pending:       'Locked',
  prompt_ready:  'Ready',
  generating:    'Generating…',
  review:        'Review',
  approved:      'Approved',
  failed:        'Failed',
  skipped:       'Skipped',
};

interface StatusBadgeProps {
  status: StageStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[status]}`}>
      {LABELS[status]}
    </span>
  );
}
