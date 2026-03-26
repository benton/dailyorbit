import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-theme text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-4 py-2',
        icon: 'h-9 w-9',
        lg: 'h-10 px-8',
        sm: 'h-8 px-3 text-xs',
      },
      variant: {
        default: 'bg-on-surface text-surface shadow-sm hover:bg-on-surface/90',
        destructive:
          'bg-red-500 text-neutral-50 shadow-sm hover:bg-red-600 dark:bg-red-900 dark:text-neutral-50 dark:hover:bg-red-800',
        ghost: 'hover:bg-surface-card hover:text-on-surface',
        link: 'text-on-surface underline-offset-4 hover:underline',
        outline:
          'border border-border-theme bg-transparent shadow-sm hover:bg-surface-card hover:text-on-surface',
        secondary: 'bg-surface-card text-on-surface shadow-sm hover:bg-surface-card/80',
      },
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ className, size, variant }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
export type { ButtonProps };
