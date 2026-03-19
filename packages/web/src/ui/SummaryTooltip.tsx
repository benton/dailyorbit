import { type MouseEvent, type ReactNode, type ReactPortal, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type SummaryTooltipProps = {
  /** The element that triggers the tooltip on hover */
  children: ReactNode;
  /** The summary text to display on hover. Null/empty renders children without tooltip. */
  summary: string | null;
};

type TooltipState = {
  left: number;
  placement: 'above' | 'below';
  text: string;
  top: number;
};

const TOOLTIP_CLASSES: string =
  'pointer-events-none fixed z-[9999] max-w-md rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';

function computePosition(rect: DOMRect): { left: number; placement: 'above' | 'below'; top: number } {
  const useBelow: boolean = rect.top < 200;
  const tooltipHalfWidth: number = 224; // max-w-md ≈ 448px / 2
  const rawLeft: number = rect.left + rect.width / 2;
  const clampedLeft: number = Math.max(
    tooltipHalfWidth + 16,
    Math.min(rawLeft, window.innerWidth - tooltipHalfWidth - 16),
  );
  return {
    left: clampedLeft,
    placement: useBelow ? 'below' : 'above',
    top: useBelow ? rect.bottom + 8 : rect.top - 8,
  };
}

function renderTooltipPortal(state: TooltipState): ReactPortal {
  return createPortal(
    <div
      className={TOOLTIP_CLASSES}
      style={{
        left: state.left,
        top: state.top,
        transform: state.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {state.text}
    </div>,
    document.body,
  );
}

/**
 * Hover tooltip that shows a text summary in a floating popover.
 * Renders via portal to escape any overflow/containment ancestors.
 */
export function SummaryTooltip({ children, summary }: SummaryTooltipProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback(() => {
    if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current == null) return;
      const rect: DOMRect = triggerRef.current.getBoundingClientRect();
      const pos = computePosition(rect);
      setTooltip({ left: pos.left, placement: pos.placement, text: summary ?? '', top: pos.top });
    }, 300);
  }, [summary]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    setTooltip(null);
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
      {tooltip != null && renderTooltipPortal(tooltip)}
    </>
  );
}

/**
 * Hook for row-level tooltip support in tables.
 * Returns a function to get row mouse handlers and a portal element to render.
 *
 * Usage:
 *   const { getRowTooltipProps, tooltipPortal } = useRowTooltip(row => row.summary);
 *   <TableRow {...getRowTooltipProps(row)}> ... </TableRow>
 *   {tooltipPortal}
 */
export function useRowTooltip<TData>(
  rowTooltip?: (row: TData) => string | null,
): {
  getRowTooltipProps: (row: TData) => {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  };
  tooltipPortal: ReactPortal | null;
} {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getRowTooltipProps = useCallback(
    (row: TData) => ({
      onMouseEnter: (e: MouseEvent<HTMLElement>) => {
        const text: string | null | undefined = rowTooltip?.(row);
        if (text == null || text.trim() === '') return;
        // Capture rect immediately — React nullifies synthetic event properties after handler
        const rect: DOMRect = e.currentTarget.getBoundingClientRect();
        if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          const pos = computePosition(rect);
          setTooltip({ left: pos.left, placement: pos.placement, text, top: pos.top });
        }, 300);
      },
      onMouseLeave: () => {
        if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
        setTooltip(null);
      },
    }),
    [rowTooltip],
  );

  return {
    getRowTooltipProps,
    tooltipPortal: tooltip != null ? renderTooltipPortal(tooltip) : null,
  };
}
