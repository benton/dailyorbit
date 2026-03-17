import type { ContentSearchHit } from './types.ts';

/**
 * Merge two ranked result lists using Reciprocal Rank Fusion (RRF).
 *
 * RRF score = 1/(k + bm25_rank) + 1/(k + vector_rank)
 *
 * Results that appear in only one list get a single-sided score.
 * The merged list is sorted by descending RRF score.
 *
 * @param bm25Hits  - Hits from BM25 search, ordered by BM25 score desc
 * @param vectorHits - Hits from vector search, ordered by similarity desc
 * @param k          - RRF constant (default 60, standard in literature)
 * @returns Merged hits with RRF score in the `score` field
 */
export function mergeWithRRF(
  bm25Hits: readonly ContentSearchHit[],
  vectorHits: readonly ContentSearchHit[],
  k: number = 60,
): ContentSearchHit[] {
  // Map file_number -> { hit, rrfScore }
  const merged = new Map<string, { hit: ContentSearchHit; rrfScore: number }>();

  // Add BM25 scores
  for (let rank = 0; rank < bm25Hits.length; rank++) {
    const hit: ContentSearchHit = bm25Hits[rank]!;
    const rrfScore: number = 1 / (k + rank + 1);
    merged.set(hit.file_number, { hit, rrfScore });
  }

  // Add vector scores
  for (let rank = 0; rank < vectorHits.length; rank++) {
    const hit: ContentSearchHit = vectorHits[rank]!;
    const vectorRrfScore: number = 1 / (k + rank + 1);
    const existing = merged.get(hit.file_number);
    if (existing != null) {
      existing.rrfScore += vectorRrfScore;
      // Keep the hit with the longer snippet (more informative)
      if (hit.snippet.length > existing.hit.snippet.length) {
        existing.hit = { ...hit, score: existing.rrfScore };
      }
    } else {
      merged.set(hit.file_number, { hit, rrfScore: vectorRrfScore });
    }
  }

  // Sort by RRF score descending and assign the fused score
  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ hit, rrfScore }) => ({ ...hit, score: rrfScore }));
}
