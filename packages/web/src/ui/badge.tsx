import type { HTMLAttributes } from 'react';
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from '../lib/cn.ts';

const badgeVariants = cva(
  'inline-flex items-center rounded-theme border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-border-theme focus:ring-offset-2',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: 'border-transparent bg-on-surface text-surface shadow-sm',
        destructive:
          'border-transparent bg-red-500 text-neutral-50 shadow-sm dark:bg-red-900 dark:text-neutral-50',
        outline: 'text-on-surface',
        secondary: 'border-transparent bg-surface-card text-on-surface',
      },
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
export type { BadgeProps };
