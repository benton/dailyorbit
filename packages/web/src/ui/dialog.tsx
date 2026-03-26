import {
  Close,
  Content,
  Description,
  Overlay,
  Portal,
  Root,
  Title,
  Trigger,
} from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ComponentPropsWithoutRef, type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.ts';

const Dialog = Root;
const DialogTrigger = Trigger;
const DialogPortal = Portal;
const DialogClose = Close;

const DialogOverlay = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Overlay>>(
  ({ className, ...props }, ref) => (
    <Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
DialogOverlay.displayName = Overlay.displayName;

const DialogContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Content>>(
  ({ children, className, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <Content
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border-theme bg-surface-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-theme',
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
        <Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-surface-card transition-opacity hover:opacity-100 focus:ring-2 focus:ring-border-theme focus:ring-offset-2 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-surface">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Close>
      </Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = Content.displayName;

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

const DialogTitle = forwardRef<HTMLHeadingElement, ComponentPropsWithoutRef<typeof Title>>(
  ({ className, ...props }, ref) => (
    <Title
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      ref={ref}
      {...props}
    />
  ),
);
DialogTitle.displayName = Title.displayName;

const DialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof Description>
>(({ className, ...props }, ref) => (
  <Description className={cn('text-sm text-on-surface-muted', className)} ref={ref} {...props} />
));
DialogDescription.displayName = Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
