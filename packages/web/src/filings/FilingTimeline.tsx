import { vg } from '@cosmograph/react';
import { useEffect, useRef, useState } from 'react';

type TimelineEventSource = 'filing_field' | 'pleading';

type TimelineEvent = {
  actor: string | null;
  date: string;
  label: string;
  source: TimelineEventSource;
  type: string;
};

/** Map from event category (used as colorDomain key) to hex color. */
const CATEGORY_COLORS: Record<string, string> = {
  // Filing milestones
  effective: '#059669', // emerald-600
  expired: '#dc2626', // red-600
  filed: '#2563eb', // blue-600
  granted: '#16a34a', // green-600
  last_action: '#b45309', // amber-700
  signed: '#7c3aed', // violet-600
  // Pleading types
  comment: '#525252', // neutral-600
  decision: '#9333ea', // purple-600
  letter: '#2563eb', // blue-600
  other: '#737373', // neutral-500
  petition: '#d97706', // amber-600
  supplement: '#0d9488', // teal-600
};

/** Derive a color category from a timeline event. */
function eventCategory(e: TimelineEvent): string {
  if (e.source === 'filing_field') {
    return CATEGORY_COLORS[e.type] != null ? e.type : 'last_action';
  }
  return CATEGORY_COLORS[e.type] != null ? e.type : 'other';
}

/**
 * Two-lane timeline visualization for a filing's lifecycle.
 * Top lane: filing milestones (date fields).
 * Bottom lane: pleading activity (comments, petitions, etc.).
 */
export function FilingTimeline({ events }: { events: Array<TimelineEvent> }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<boolean>(false);

  useEffect(() => {
    if (chartRef.current == null || events.length === 0) {
      return;
    }

    // Collect the distinct categories present in data
    const categories: Array<string> = [];
    const seen = new Set<string>();
    for (const e of events) {
      const cat: string = eventCategory(e);
      if (!seen.has(cat)) {
        seen.add(cat);
        categories.push(cat);
      }
    }

    // Prepare data: parse dates to Date objects for proper time scale
    const plotData = events.map((e: TimelineEvent) => ({
      category: eventCategory(e),
      date: new Date(e.date),
      label: e.label,
      lane: e.source === 'filing_field' ? 'Milestones' : 'Pleadings',
    }));

    const chart = vg.plot(
      vg.dot(plotData, {
        fill: 'category',
        r: 5,
        tip: true,
        title: 'label',
        x: 'date',
        y: 'lane',
      }),
      vg.colorDomain(categories),
      vg.colorRange(categories.map((c: string) => CATEGORY_COLORS[c] ?? '#737373')),
      vg.colorLegend(false),
      vg.height(120),
      vg.width(700),
      vg.xLabel(''),
      vg.yLabel(''),
      vg.yDomain(['Pleadings', 'Milestones']),
      vg.marginLeft(70),
      vg.marginTop(10),
      vg.marginBottom(30),
    );

    chartRef.current.replaceChildren(chart);
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setRendered(true);

    // vgplot renders its built-in legend asynchronously — observe and remove it.
    const plotEl: HTMLElement | null = chartRef.current.querySelector('.plot');
    if (plotEl != null) {
      const removeLegend = (): void => {
        const legend: HTMLElement | null = plotEl.querySelector(':scope > .legend');
        if (legend != null) {
          legend.remove();
        }
      };
      removeLegend(); // in case it's already there
      const observer = new MutationObserver(removeLegend);
      observer.observe(plotEl, { childList: true });
      return () => observer.disconnect();
    }
  }, [events]);

  if (events.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Timeline
      </h2>
      <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <div ref={chartRef} />
        {rendered && <TimelineLegend events={events} />}
      </div>
    </section>
  );
}

/** Compact legend showing event type colors. */
function TimelineLegend({ events }: { events: Array<TimelineEvent> }) {
  const categories: Array<string> = [];
  const seen = new Set<string>();
  for (const e of events) {
    const cat: string = eventCategory(e);
    if (!seen.has(cat)) {
      seen.add(cat);
      categories.push(cat);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
      {categories.map((cat: string) => (
        <LegendItem
          color={CATEGORY_COLORS[cat] ?? '#737373'}
          key={cat}
          label={cat.charAt(0).toUpperCase() + cat.slice(1)}
        />
      ))}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs text-neutral-600 dark:text-neutral-400">{label}</span>
    </div>
  );
}
