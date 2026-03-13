/**
 * Convert a compact file number (e.g. 'SATSTA2023061400142') to the
 * hyphenated format used by fcc.report URLs (e.g. 'SAT-STA-20230614-00142').
 *
 * The compact format concatenates subsystem + appType (with '/' stripped) + date + sequence.
 * We need the subsystem and appType codes to know where to split.
 */
export function compactToHyphenated(
  compact: string,
  subsystemCode: string,
  appTypeCode: string,
): string {
  // The compact format strips '/' from app type codes like 'T/C' -> 'TC'
  const strippedAppType: string = appTypeCode.replace(/\//g, '');
  const prefixLength: number = subsystemCode.length + strippedAppType.length;
  const remainder: string = compact.slice(prefixLength);
  // Next 8 chars are the date (YYYYMMDD), rest is the sequence number
  const datePart: string = remainder.slice(0, 8);
  const sequencePart: string = remainder.slice(8);

  return `${subsystemCode}-${appTypeCode}-${datePart}-${sequencePart}`;
}
