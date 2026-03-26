import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.ts';

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      className={cn(
        'flex h-9 w-full rounded-theme border border-border-theme bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-on-surface-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      type={type}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
