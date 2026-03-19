/**
 * Build a client-side URL path for a filing detail page.
 * Encodes the file number to handle slashes in T/C and ASG filings
 * (e.g. SES-T/C-20250917-00144 → /filings/SES-T%2FC-20250917-00144).
 */
export function filingUrl(fileNumber: string): string {
  return `/filings/${encodeURIComponent(fileNumber)}`;
}
