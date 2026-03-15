import { type ReactNode } from 'react';

/**
 * Wrapper for Cosmograph visualizations providing a consistent dark background.
 *
 * The Cosmograph library renders a "Visualized by Cosmograph" badge with an opaque
 * background that matches the container's background color rather than being transparent.
 * By wrapping all Cosmograph instances in a dark container, the badge blends naturally
 * with the graph background instead of appearing as a floating white rectangle.
 */
export default function CosmographWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="rounded bg-[#1a1a2e]" style={{ backgroundColor: '#1a1a2e' }}>
      {children}
    </div>
  );
}
