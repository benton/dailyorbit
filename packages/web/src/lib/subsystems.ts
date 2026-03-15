/**
 * IBFS subsystem metadata — codes, labels, and consistent pastel colors
 * for use across the admin UI.
 */

type SubsystemInfo = {
  /** Pastel background color class (Tailwind) */
  bg: string;
  /** Hex color for use in charts (vgplot, SVG, canvas) */
  hex: string;
  /** Short human-readable label */
  label: string;
  /** Pastel text/accent color class for contrast on white */
  text: string;
};

/** Canonical ordering and metadata for all 13 IBFS subsystems. */
const SUBSYSTEM_MAP: Record<string, SubsystemInfo> = {
  '325': { bg: 'bg-stone-300', hex: '#a8a29e', label: 'Foreign Broadcast', text: 'text-stone-700' },
  ARC: { bg: 'bg-amber-200', hex: '#fbbf24', label: 'Accounting Rates', text: 'text-amber-700' },
  DNC: { bg: 'bg-lime-200', hex: '#a3e635', label: 'Data Network IDs', text: 'text-lime-700' },
  FCN: { bg: 'bg-orange-200', hex: '#fb923c', label: 'Foreign Carrier', text: 'text-orange-700' },
  IHF: { bg: 'bg-fuchsia-200', hex: '#e879f9', label: 'HF Broadcast', text: 'text-fuchsia-700' },
  IPF: { bg: 'bg-pink-200', hex: '#f472b6', label: 'Public Fixed Radio', text: 'text-pink-700' },
  ISP: { bg: 'bg-violet-200', hex: '#a78bfa', label: 'Special Projects', text: 'text-violet-700' },
  ITC: { bg: 'bg-sky-200', hex: '#38bdf8', label: 'Telecom Certificates', text: 'text-sky-700' },
  ROA: { bg: 'bg-rose-200', hex: '#fb7185', label: 'Operating Agency', text: 'text-rose-700' },
  SAT: { bg: 'bg-indigo-200', hex: '#818cf8', label: 'Space Stations', text: 'text-indigo-700' },
  SCL: { bg: 'bg-teal-200', hex: '#2dd4bf', label: 'Submarine Cable', text: 'text-teal-700' },
  SES: { bg: 'bg-emerald-200', hex: '#34d399', label: 'Earth Stations', text: 'text-emerald-700' },
  SPC: { bg: 'bg-cyan-200', hex: '#22d3ee', label: 'Signalling Point Codes', text: 'text-cyan-700' },
};

const FALLBACK: SubsystemInfo = {
  bg: 'bg-neutral-200',
  hex: '#d4d4d4',  // neutral-300
  label: 'Unknown',
  text: 'text-neutral-600',
};

/** Subsystem codes in canonical order — use as vgplot colorDomain. */
export const SUBSYSTEM_CODES: Array<string> = Object.keys(SUBSYSTEM_MAP);

/** Matching hex colors — use as vgplot colorRange. */
export const SUBSYSTEM_COLORS: Array<string> = Object.values(SUBSYSTEM_MAP).map(
  (s: SubsystemInfo) => s.hex,
);

export function getSubsystem(code: string): SubsystemInfo {
  return SUBSYSTEM_MAP[code] ?? FALLBACK;
}

export function getSubsystemLabel(code: string): string {
  return (SUBSYSTEM_MAP[code] ?? FALLBACK).label;
}

export function getSubsystemBg(code: string): string {
  return (SUBSYSTEM_MAP[code] ?? FALLBACK).bg;
}
