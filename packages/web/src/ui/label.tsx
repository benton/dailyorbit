import { type LabelHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.ts';

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      className={cn(
        'text-sm font-medium leading-none font-body peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Label };
