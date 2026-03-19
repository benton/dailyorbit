import type { RetrievedSource } from './types.ts';

/** Resolve a RetrievedSource to an in-app URL. */
export function resolveSourceUrl(source: RetrievedSource): string {
  switch (source.type) {
    case 'filing':
      return `/filings/${source.id}`;
    case 'attachment':
      return source.url ?? `/filings/${source.id}`;
    case 'pleading':
      return source.url ?? `/filings/${source.id}`;
    case 'news':
      return source.url ?? '#';
  }
}

/**
 * Build a map from citation ID strings (as they appear in `[brackets]` in the
 * answer text) to RetrievedSource objects.
 *
 * The generator uses `[Source N: type — id]` format, so we index by both the
 * full citation tag and the bare source ID for flexible matching.
 */
export function buildCitationMap(sources: Array<RetrievedSource>): Map<string, RetrievedSource> {
  const map = new Map<string, RetrievedSource>();
  for (let i = 0; i < sources.length; i++) {
    const s: RetrievedSource = sources[i];
    // Match "[Source 1: filing — SAT-LOA-...]"
    map.set(`Source ${i + 1}: ${s.type} — ${s.id}`, s);
    // Match bare ID "[SAT-LOA-...]"
    map.set(s.id, s);
  }
  return map;
}
