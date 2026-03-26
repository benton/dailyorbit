/**
 * Formats a cost in cents to a dollar string, rounded to the nearest cent
 * with a minimum display of $0.01 for any non-zero amount.
 */
export function formatCostCents(cents: number): string {
  if (cents <= 0) {
    return '$0.00';
  }

  const rounded: number = Math.max(1, Math.round(cents));
  return `$${(rounded / 100).toFixed(2)}`;
}

type ChatCostBadgeProps = {
  costCents: number;
};

export default function ChatCostBadge({ costCents }: ChatCostBadgeProps) {
  if (costCents <= 0) {
    return null;
  }

  return (
    <span className="inline-block text-xs text-on-surface-muted tabular-nums dark:text-on-surface-muted">
      {formatCostCents(costCents)}
    </span>
  );
}
