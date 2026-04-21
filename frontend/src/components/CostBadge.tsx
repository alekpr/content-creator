interface CostBadgeProps {
  usd: number;
  label?: string;
}

export function CostBadge({ usd, label }: CostBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 font-mono">
      ${(usd ?? 0).toFixed(3)}
      {label && <span className="text-gray-400 font-sans">{label}</span>}
    </span>
  );
}
