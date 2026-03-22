/**
 * Formats a cost in cents to a dollar string with appropriate precision.
 * - < 1 cent: show enough decimals to be meaningful (e.g. 0.3¢ → "$0.003")
 * - >= 1 cent: standard 2 decimal places (e.g. 24¢ → "$0.24")
 */
export function formatCostCents(cents: number): string {
  if (cents === 0) return '$0.00';

  const dollars: number = cents / 100;

  // Sub-cent: show 3 significant figures of the dollar value, ensuring at
  // least 3 decimal places so the leading "$0.00" is always visible
  if (cents < 1) {
    const sigFigs: string = parseFloat(dollars.toPrecision(3)).toString();
    const decimals: number = (sigFigs.split('.')[1] ?? '').length;
    return decimals >= 3 ? `$${sigFigs}` : `$${dollars.toFixed(3)}`;
  }

  return `$${dollars.toFixed(2)}`;
}

type ChatCostBadgeProps = {
  costCents: number;
};

export default function ChatCostBadge({ costCents }: ChatCostBadgeProps) {
  if (costCents <= 0) return null;

  return (
    <span className="inline-block text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">
      {formatCostCents(costCents)}
    </span>
  );
}
