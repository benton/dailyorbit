// ---------------------------------------------------------------------------
// Text splitting for map-reduce chunked summarization
// ---------------------------------------------------------------------------

const PARAGRAPH_BOUNDARY: RegExp = /\n\n+/;
const SENTENCE_BOUNDARY: RegExp = /(?<=\.\s)/;

const DEFAULT_OVERLAP: number = 500;

/**
 * Split text into chunks that each fit within `maxChars`, preferring clean
 * breaks at paragraph or sentence boundaries. A small overlap is prepended
 * to each chunk after the first so the model has context continuity.
 */
export function splitText(
  text: string,
  maxChars: number,
  overlap: number = DEFAULT_OVERLAP,
): string[] {
  if (text.length <= maxChars) return [text];

  const paragraphs: string[] = text.split(PARAGRAPH_BOUNDARY);
  const chunks: string[] = [];
  let current: string = '';

  for (const para of paragraphs) {
    const candidate: string =
      current.length === 0 ? para : current + '\n\n' + para;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    // Current accumulator is non-empty — flush it as a chunk
    if (current.length > 0) {
      chunks.push(current);
      // Cap overlap so the next chunk stays within maxChars
      const availOverlap: number = Math.max(0, maxChars - para.length);
      const overlapText: string = extractOverlap(
        current,
        Math.min(overlap, availOverlap),
      );
      current = overlapText + para;
    } else {
      // Single paragraph exceeds maxChars — split at sentence boundaries
      const sentenceChunks: string[] = splitBySentence(para, maxChars, overlap);
      // All but the last sentence chunk are complete chunks
      for (let i = 0; i < sentenceChunks.length - 1; i++) {
        chunks.push(sentenceChunks[i]!);
      }
      current = sentenceChunks[sentenceChunks.length - 1]!;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Split a single block of text at sentence boundaries. Falls back to
 * hard character splits when no sentence boundary is found.
 */
function splitBySentence(
  text: string,
  maxChars: number,
  overlap: number,
): string[] {
  const sentences: string[] = text.split(SENTENCE_BOUNDARY);
  const chunks: string[] = [];
  let current: string = '';

  for (const sentence of sentences) {
    const candidate: string = current + sentence;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      // Cap overlap so the next chunk stays within maxChars
      const availOverlap: number = Math.max(0, maxChars - sentence.length);
      const overlapText: string = extractOverlap(
        current,
        Math.min(overlap, availOverlap),
      );
      current = overlapText + sentence;
    } else {
      // Single sentence exceeds maxChars — hard split
      const hardChunks: string[] = hardSplit(sentence, maxChars, overlap);
      for (let i = 0; i < hardChunks.length - 1; i++) {
        chunks.push(hardChunks[i]!);
      }
      current = hardChunks[hardChunks.length - 1]!;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/** Hard character split as a last resort. */
function hardSplit(text: string, maxChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  let offset: number = 0;

  while (offset < text.length) {
    const end: number = Math.min(offset + maxChars, text.length);
    chunks.push(text.slice(offset, end));
    if (end === text.length) break;
    offset = end - overlap;
  }

  return chunks;
}

/** Extract the last `n` characters from a string for use as overlap context. */
function extractOverlap(text: string, n: number): string {
  if (n <= 0 || text.length === 0) return '';
  return text.slice(-n);
}
