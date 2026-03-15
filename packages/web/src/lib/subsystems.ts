/**
 * IBFS subsystem metadata — codes, labels, and consistent pastel colors
 * for use across the admin UI.
 */

type SubsystemInfo = {
  /** Pastel background color class (Tailwind) */
  bg: string;
  /** Short human-readable label */
  label: string;
  /** Pastel text/accent color class for contrast on white */
  text: string;
};

/** Canonical ordering and metadata for all 13 IBFS subsystems. */
const SUBSYSTEM_MAP: Record<string, SubsystemInfo> = {
  '325': { bg: 'bg-stone-300', label: 'Foreign Broadcast', text: 'text-stone-700' },
  ARC: { bg: 'bg-amber-200', label: 'Accounting Rates', text: 'text-amber-700' },
  DNC: { bg: 'bg-lime-200', label: 'Data Network IDs', text: 'text-lime-700' },
  FCN: { bg: 'bg-orange-200', label: 'Foreign Carrier', text: 'text-orange-700' },
  IHF: { bg: 'bg-fuchsia-200', label: 'HF Broadcast', text: 'text-fuchsia-700' },
  IPF: { bg: 'bg-pink-200', label: 'Public Fixed Radio', text: 'text-pink-700' },
  ISP: { bg: 'bg-violet-200', label: 'Special Projects', text: 'text-violet-700' },
  ITC: { bg: 'bg-sky-200', label: 'Telecom Certificates', text: 'text-sky-700' },
  ROA: { bg: 'bg-rose-200', label: 'Operating Agency', text: 'text-rose-700' },
  SAT: { bg: 'bg-indigo-200', label: 'Space Stations', text: 'text-indigo-700' },
  SCL: { bg: 'bg-teal-200', label: 'Submarine Cable', text: 'text-teal-700' },
  SES: { bg: 'bg-emerald-200', label: 'Earth Stations', text: 'text-emerald-700' },
  SPC: { bg: 'bg-cyan-200', label: 'Signalling Point Codes', text: 'text-cyan-700' },
};

const FALLBACK: SubsystemInfo = {
  bg: 'bg-neutral-200',
  label: 'Unknown',
  text: 'text-neutral-600',
};

export function getSubsystem(code: string): SubsystemInfo {
  return SUBSYSTEM_MAP[code] ?? FALLBACK;
}

export function getSubsystemLabel(code: string): string {
  return (SUBSYSTEM_MAP[code] ?? FALLBACK).label;
}

export function getSubsystemBg(code: string): string {
  return (SUBSYSTEM_MAP[code] ?? FALLBACK).bg;
}
