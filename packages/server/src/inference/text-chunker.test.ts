import { describe, expect, it } from 'vitest';
import { splitText } from './text-chunker.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a paragraph of `n` characters using a repeated filler character. */
function makeText(n: number, filler: string = 'x'): string {
  return filler.repeat(n);
}

/** Build N paragraphs separated by double newlines. */
function makeParagraphs(lengths: number[]): string {
  return lengths.map((len: number) => makeText(len)).join('\n\n');
}

/** Build a single block of sentences (each ending with ". "). */
function makeSentences(count: number, charsPerSentence: number): string {
  const body: string = makeText(charsPerSentence - 2); // leave room for ". "
  return Array.from({ length: count }, () => body + '. ').join('');
}

// ---------------------------------------------------------------------------
// splitText — short texts (below threshold)
// ---------------------------------------------------------------------------

describe('splitText', () => {
  describe('text shorter than maxChars', () => {
    it('returns a single chunk for short text', () => {
      const text: string = 'Hello world';
      const result: string[] = splitText(text, 100, 0);
      expect(result).toEqual([text]);
    });

    it('returns a single chunk when text length equals maxChars', () => {
      const text: string = makeText(500);
      const result: string[] = splitText(text, 500, 0);
      expect(result).toEqual([text]);
    });

    it('returns a single chunk for empty text', () => {
      expect(splitText('', 100, 0)).toEqual(['']);
    });
  });

  // ---------------------------------------------------------------------------
  // Paragraph-level splitting
  // ---------------------------------------------------------------------------

  describe('paragraph boundary splitting', () => {
    it('splits at paragraph boundaries when paragraphs fit', () => {
      const text: string = makeParagraphs([40, 40, 40]);
      // Total = 40+2+40+2+40 = 164 chars. maxChars=50 should split into chunks.
      const result: string[] = splitText(text, 50, 0);
      expect(result.length).toBeGreaterThan(1);
      result.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(50);
      });
    });

    it('preserves all content across chunks (no overlap)', () => {
      const paras: string[] = ['alpha', 'bravo', 'charlie', 'delta'];
      const text: string = paras.join('\n\n');
      const result: string[] = splitText(text, 15, 0);
      const rejoined: string = result.join('\n\n');
      for (const p of paras) {
        expect(rejoined).toContain(p);
      }
    });

    it('accumulates small paragraphs into a single chunk', () => {
      const text: string = makeParagraphs([10, 10, 10]); // 34 chars total
      const result: string[] = splitText(text, 50, 0);
      expect(result).toEqual([text]);
    });
  });

  // ---------------------------------------------------------------------------
  // Sentence-level splitting (fallback)
  // ---------------------------------------------------------------------------

  describe('sentence boundary splitting', () => {
    it('splits a long paragraph at sentence boundaries', () => {
      // One paragraph with multiple sentences, total > maxChars
      const text: string = makeSentences(10, 30); // ~300 chars, no paragraph breaks
      const result: string[] = splitText(text, 100, 0);
      expect(result.length).toBeGreaterThan(1);
      result.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Hard character splitting (last resort)
  // ---------------------------------------------------------------------------

  describe('hard character splitting', () => {
    it('splits a single long word at maxChars boundary', () => {
      const text: string = makeText(250); // no spaces, no newlines
      const result: string[] = splitText(text, 100, 0);
      expect(result.length).toBe(3); // 100 + 100 + 50
      expect(result[0]!.length).toBe(100);
      expect(result[1]!.length).toBe(100);
      expect(result[2]!.length).toBe(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Overlap behavior
  // ---------------------------------------------------------------------------

  describe('overlap', () => {
    it('prepends overlap from previous chunk to subsequent chunks', () => {
      const p1: string = makeText(80, 'a');
      const p2: string = makeText(80, 'b');
      const text: string = p1 + '\n\n' + p2;
      const overlap: number = 20;
      const result: string[] = splitText(text, 90, overlap);

      expect(result.length).toBe(2);
      // Second chunk should start with the last 20 chars of the first chunk
      const expectedOverlap: string = result[0]!.slice(-overlap);
      expect(result[1]!.startsWith(expectedOverlap)).toBe(true);
    });

    it('does not add overlap to the first chunk', () => {
      const text: string = makeParagraphs([80, 80]);
      const result: string[] = splitText(text, 90, 20);
      expect(result[0]).toBe(makeText(80));
    });

    it('handles overlap of zero', () => {
      const text: string = makeParagraphs([60, 60]);
      const result: string[] = splitText(text, 70, 0);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(makeText(60));
      expect(result[1]).toBe(makeText(60));
    });
  });

  // ---------------------------------------------------------------------------
  // Invariants
  // ---------------------------------------------------------------------------

  describe('invariants', () => {
    it('every chunk respects the maxChars limit (paragraph path)', () => {
      const text: string = makeParagraphs([30, 50, 20, 45, 60, 10, 55]);
      const maxChars: number = 80;
      const result: string[] = splitText(text, maxChars, 10);
      result.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(maxChars + 10);
      });
    });

    it('all original paragraph content is present across chunks (no overlap)', () => {
      const paragraphs: string[] = [
        makeText(100, 'a'),
        makeText(80, 'b'),
        makeText(50, 'c'),
        makeText(120, 'd'),
      ];
      const text: string = paragraphs.join('\n\n');
      const result: string[] = splitText(text, 150, 0);
      const allContent: string = result.join('');
      for (const para of paragraphs) {
        expect(allContent).toContain(para);
      }
    });

    it('returns at least one chunk for any non-empty input', () => {
      const result: string[] = splitText('a', 1, 0);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('uses the default 500-char overlap when not specified', () => {
      const p1: string = makeText(1000, 'a');
      const p2: string = makeText(1000, 'b');
      const text: string = p1 + '\n\n' + p2;
      const result: string[] = splitText(text, 1100);
      expect(result.length).toBe(2);
      // Second chunk should start with 500 'a' chars from overlap
      expect(result[1]!.slice(0, 500)).toBe('a'.repeat(500));
    });
  });
});
