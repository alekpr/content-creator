interface CostBadgeProps {
  usd: number;
}

export function CostBadge({ usd }: CostBadgeProps) {
  return (
    <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 font-mono">
      ${usd.toFixed(3)}
    </span>
  );
}
