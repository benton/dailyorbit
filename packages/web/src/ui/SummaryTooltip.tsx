import { type ReactNode, useCallback, useRef, useState } from 'react';

type SummaryTooltipProps = {
  /** The element that triggers the tooltip on hover */
  children: ReactNode;
  /** The summary text to display on hover. Null/empty renders children without tooltip. */
  summary: string | null;
};

/**
 * Hover tooltip that shows a text summary in a floating popover.
 * Positions above the trigger element, falling back to below if near the top of the viewport.
 */
export function SummaryTooltip({ children, summary }: SummaryTooltipProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current == null) {
        return;
      }
      const rect: DOMRect = triggerRef.current.getBoundingClientRect();
      const spaceAbove: number = rect.top;
      const useBelow: boolean = spaceAbove < 200;
      setPlacement(useBelow ? 'below' : 'above');
      const tooltipHalfWidth: number = 224; // max-w-md / 2
      const rawLeft: number = rect.left + window.scrollX + rect.width / 2;
      const clampedLeft: number = Math.max(
        tooltipHalfWidth + 16,
        Math.min(rawLeft, window.innerWidth - tooltipHalfWidth - 16),
      );
      setPosition({
        left: clampedLeft,
        top: useBelow ? rect.bottom + window.scrollY + 8 : rect.top + window.scrollY - 8,
      });
      setVisible(true);
    }, 300);
  }, []);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
    }
    setVisible(false);
  }, []);

  if (summary == null || summary.trim() === '') {
    return <>{children}</>;
  }

  return (
    <>
      <span
        className="inline"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        ref={triggerRef}
      >
        {children}
      </span>
      {visible && (
        <div
          className="pointer-events-none fixed z-[100] max-w-md -translate-x-1/2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          style={{
            left: position.left,
            top: position.top,
            transform: placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          {summary}
        </div>
      )}
    </>
  );
}
