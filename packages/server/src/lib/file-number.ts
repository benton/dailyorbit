/**
 * Branded type and normalization for FCC IBFS/ICFS file numbers.
 *
 * File numbers identify individual filings. They follow the pattern:
 *   {SUBSYSTEM}-{APP_TYPE}-{YYYYMMDD}-{SEQ}
 * e.g. "SES-LIC-19860303-00312"
 *
 * The legacy XML bulk data used an unhyphenated format:
 *   {SUBSYSTEM}{APP_TYPE}{YYYYMMDD}{SEQ}
 * e.g. "SESLIC1986030300312"
 *
 * Some filings have interim file numbers with "INTR" instead of a date:
 *   {SUBSYSTEM}{APP_TYPE}INTR{YYYY}{SEQ}
 * e.g. "SPCNEWINTR200200136" → "SPC-NEW-INTR2002-00136"
 *
 * This module normalizes all formats to the canonical hyphenated form.
 */

/** Branded string type — always in canonical hyphenated format */
export type FileNumber = string & { readonly __brand: unique symbol };

/** Known IBFS subsystem codes (3 characters except "325") */
const SUBSYSTEM_CODES: ReadonlySet<string> = new Set([
  '325',
  'ARC',
  'DNC',
  'FCN',
  'IHF',
  'IPF',
  'ISP',
  'ITC',
  'ROA',
  'SAT',
  'SCL',
  'SES',
  'SPC',
]);

/** Known IBFS application type codes */
const APP_TYPE_CODES: ReadonlySet<string> = new Set([
  '214',
  'A/O',
  'AFS',
  'AMD',
  'APL',
  'ASG',
  'C/P',
  'DBE',
  'DBA',
  'DBM',
  'DRZ',
  'EXT',
  'ISP',
  'ITC',
  'L/A',
  'LFS',
  'LIC',
  'LOA',
  'LOI',
  'LPN',
  'MFS',
  'MOD',
  'MPL',
  'MSC',
  'NDS',
  'NEW',
  'NOT',
  'NTC',
  'OTH',
  'PDR',
  'PPL',
  'REG',
  'RPL',
  'RWL',
  'STA',
  'T/C',
  'TAO',
  'TOA',
  'WAV',
  'WVZ',
]);

/** Sorted by length descending so longer codes match first */
const APP_TYPE_BY_LENGTH: string[] = [...APP_TYPE_CODES].sort(
  (a: string, b: string) => b.length - a.length,
);

export type NormalizeResult =
  | { ok: true; fileNumber: FileNumber }
  | { ok: false; reason: 'empty' | 'draft' | 'unparseable'; raw: string };

/** Hyphenated format: SUB-APP-YYYYMMDD-SEQ or SUB-APP-INTRYYYY-SEQ */
const HYPHENATED_RE: RegExp =
  /^[A-Z0-9]{3}-[A-Z0-9/]{2,3}-(?:\d{8}|INTR\d{4})-\d{3,5}$/;

/**
 * Normalize a raw file number string to the canonical hyphenated format.
 */
export function normalizeFileNumber(raw: string): NormalizeResult {
  const trimmed: string = raw.trim();

  if (trimmed === '') {
    return { ok: false, reason: 'empty', raw };
  }

  if (trimmed.startsWith('DRAFT-')) {
    return { ok: false, reason: 'draft', raw };
  }

  // Already in canonical form
  if (HYPHENATED_RE.test(trimmed)) {
    return { ok: true, fileNumber: trimmed as FileNumber };
  }

  // Try to parse unhyphenated format: {SUBSYSTEM}{APP_TYPE}{DATE_OR_INTR}{SEQ}
  const parsed: string | null = parseUnhyphenated(trimmed);
  if (parsed !== null) {
    return { ok: true, fileNumber: parsed as FileNumber };
  }

  return { ok: false, reason: 'unparseable', raw };
}

function parseUnhyphenated(raw: string): string | null {
  // Find subsystem prefix
  let subsystem: string | null = null;
  for (const code of SUBSYSTEM_CODES) {
    if (raw.startsWith(code)) {
      subsystem = code;
      break;
    }
  }
  if (subsystem === null) return null;

  const afterSub: string = raw.slice(subsystem.length);

  // Find app type (try longest match first).
  // In unhyphenated form, slash may be present or absent:
  //   "SEST/C1960..." has the slash, "SESTC1960..." would not.
  let appType: string | null = null;
  let matchLength: number = 0;
  for (const code of APP_TYPE_BY_LENGTH) {
    if (afterSub.startsWith(code)) {
      appType = code;
      matchLength = code.length;
      break;
    }
    const withoutSlash: string = code.replace('/', '');
    if (withoutSlash !== code && afterSub.startsWith(withoutSlash)) {
      appType = code;
      matchLength = withoutSlash.length;
      break;
    }
  }
  if (appType === null) return null;

  const remainder: string = afterSub.slice(matchLength);

  // Remainder should be date(8) + seq(5) = 13 chars, or INTR(4) + year(4) + seq(5) = 13 chars
  if (remainder.startsWith('INTR')) {
    // Interim: INTRYYYYseq
    const afterIntr: string = remainder.slice(4);
    if (afterIntr.length < 5) return null;
    const year: string = afterIntr.slice(0, 4);
    const seq: string = afterIntr.slice(4).padStart(5, '0');
    return `${subsystem}-${appType}-INTR${year}-${seq}`;
  }

  // Normal: YYYYMMDDseq
  if (remainder.length < 13) return null;
  const date: string = remainder.slice(0, 8);
  const seq: string = remainder.slice(8).padStart(5, '0');
  return `${subsystem}-${appType}-${date}-${seq}`;
}
