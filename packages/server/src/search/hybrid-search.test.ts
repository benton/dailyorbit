import { describe, it, expect } from 'vitest';
import { mergeWithRRF } from './hybrid-search.ts';
import type { ContentSearchHit } from './types.ts';

/** Create a minimal ContentSearchHit for testing. */
function hit(
  file_number: string,
  score: number,
  source: 'filing' | 'attachment' | 'pleading' = 'filing',
): ContentSearchHit {
  return {
    file_number,
    source,
    source_key: null,
    score,
    snippet: `Snippet for ${file_number}`,
    callsign: null,
    address_attention: null,
    subsystem_code: 'SAT',
    app_type_code: 'LOA',
    status_code: null,
    date_filed: null,
    company_name: null,
  };
}

describe('mergeWithRRF', () => {
  it('merges hits from both lists, boosting items present in both', () => {
    const bm25: ContentSearchHit[] = [hit('A', 10), hit('B', 8), hit('C', 5)];
    const vector: ContentSearchHit[] = [
      hit('B', 0.95),
      hit('D', 0.9),
      hit('A', 0.8),
    ];

    const merged = mergeWithRRF(bm25, vector, 60);

    // B appears in both at rank 2 (bm25) and rank 1 (vector) — should be boosted
    const fileNumbers: string[] = merged.map((h) => h.file_number);
    expect(fileNumbers).toContain('A');
    expect(fileNumbers).toContain('B');
    expect(fileNumbers).toContain('C');
    expect(fileNumbers).toContain('D');

    // B should rank higher than C and D (present in both lists)
    const bIdx: number = fileNumbers.indexOf('B');
    const cIdx: number = fileNumbers.indexOf('C');
    const dIdx: number = fileNumbers.indexOf('D');
    expect(bIdx).toBeLessThan(cIdx);
    expect(bIdx).toBeLessThan(dIdx);
  });

  it('returns results sorted by descending RRF score', () => {
    const bm25: ContentSearchHit[] = [hit('A', 10), hit('B', 5)];
    const vector: ContentSearchHit[] = [hit('C', 0.9), hit('A', 0.8)];

    const merged = mergeWithRRF(bm25, vector, 60);

    for (let i = 1; i < merged.length; i++) {
      expect(merged[i - 1]!.score).toBeGreaterThanOrEqual(merged[i]!.score);
    }
  });

  it('handles empty BM25 list', () => {
    const vector: ContentSearchHit[] = [hit('A', 0.9), hit('B', 0.8)];
    const merged = mergeWithRRF([], vector, 60);

    expect(merged).toHaveLength(2);
    expect(merged[0]!.file_number).toEqual('A');
    expect(merged[1]!.file_number).toEqual('B');
  });

  it('handles empty vector list', () => {
    const bm25: ContentSearchHit[] = [hit('A', 10), hit('B', 5)];
    const merged = mergeWithRRF(bm25, [], 60);

    expect(merged).toHaveLength(2);
    expect(merged[0]!.file_number).toEqual('A');
    expect(merged[1]!.file_number).toEqual('B');
  });

  it('handles both lists empty', () => {
    const merged = mergeWithRRF([], [], 60);
    expect(merged).toHaveLength(0);
  });

  it('assigns RRF score according to formula 1/(k+rank)', () => {
    const k: number = 60;
    const bm25: ContentSearchHit[] = [hit('A', 10)]; // rank 1
    const vector: ContentSearchHit[] = [hit('A', 0.9)]; // rank 1

    const merged = mergeWithRRF(bm25, vector, k);

    // A is rank 1 in both: score = 1/(60+1) + 1/(60+1) = 2/61
    const expectedScore: number = 2 / (k + 1);
    expect(merged[0]!.score).toBeCloseTo(expectedScore, 10);
  });

  it('single-sided items get lower scores than dual-sided items at similar ranks', () => {
    const k: number = 60;
    // A is rank 1 in both, B is rank 2 in BM25 only
    const bm25: ContentSearchHit[] = [hit('A', 10), hit('B', 8)];
    const vector: ContentSearchHit[] = [hit('A', 0.9)];

    const merged = mergeWithRRF(bm25, vector, k);

    const aScore: number = merged.find((h) => h.file_number === 'A')!.score;
    const bScore: number = merged.find((h) => h.file_number === 'B')!.score;
    expect(aScore).toBeGreaterThan(bScore);
  });

  it('is commutative: swapping input order produces same set of file_numbers', () => {
    const bm25: ContentSearchHit[] = [hit('A', 10), hit('B', 5)];
    const vector: ContentSearchHit[] = [hit('B', 0.9), hit('C', 0.8)];

    const merged1 = mergeWithRRF(bm25, vector, 60);
    const merged2 = mergeWithRRF(vector, bm25, 60);

    const files1: Set<string> = new Set(merged1.map((h) => h.file_number));
    const files2: Set<string> = new Set(merged2.map((h) => h.file_number));
    expect(files1).toEqual(files2);
  });

  it('respects custom k parameter', () => {
    const bm25: ContentSearchHit[] = [hit('A', 10)];
    const vector: ContentSearchHit[] = [hit('A', 0.9)];

    const merged1 = mergeWithRRF(bm25, vector, 10);
    const merged2 = mergeWithRRF(bm25, vector, 100);

    // Smaller k gives higher scores
    expect(merged1[0]!.score).toBeGreaterThan(merged2[0]!.score);
  });
});
