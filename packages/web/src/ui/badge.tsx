import type { HTMLAttributes } from 'react';
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from '../lib/cn.ts';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default:
          'border-transparent bg-neutral-900 text-neutral-50 shadow-sm dark:bg-neutral-50 dark:text-neutral-900',
        destructive:
          'border-transparent bg-red-500 text-neutral-50 shadow-sm dark:bg-red-900 dark:text-neutral-50',
        outline: 'text-neutral-950 dark:text-neutral-50',
        secondary:
          'border-transparent bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50',
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
