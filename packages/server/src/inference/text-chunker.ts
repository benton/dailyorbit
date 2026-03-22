// ---------------------------------------------------------------------------
// Text splitting for map-reduce chunked summarization
// ---------------------------------------------------------------------------

import type { EmbeddingService } from './embedding-service.ts';
import type { EmbeddingResponse } from './types.ts';

// ---------------------------------------------------------------------------
// Embedding chunk-size constants (shared by CLI and pipeline)
// ---------------------------------------------------------------------------

/**
 * Conservative char limit for Titan V2's 8,192 token input.
 * Observed worst-case ratio on FCC legal text is ~2.28 chars/token
 * (abbreviation-heavy filings), so 16k chars ≈ 7,018 tokens — 14%
 * headroom under the 8,192 limit.
 */
export const EMBEDDING_MAX_CHARS: number = 16_000;

/** Overlap chars between consecutive chunks for context continuity. */
export const EMBEDDING_OVERLAP: number = 500;

/** Titan V2 hard token limit. */
const TOKEN_LIMIT: number = 8192;

/** Matches the token count from Bedrock's "Too many input tokens" error. */
const TOKEN_LIMIT_RE: RegExp = /request input token count: (\d+)/;

/**
 * Embed a chunk of text, retrying once with truncation if it exceeds the
 * token limit. Uses the reported token count to estimate the chars-per-token
 * ratio and truncates to fit within the limit with 10% headroom.
 */
export async function embedChunk(
  service: EmbeddingService,
  text: string,
  modelId: string,
  dimensions: number,
): Promise<EmbeddingResponse> {
  try {
    return await service.embedQuery(text, modelId, dimensions, true);
  } catch (err: unknown) {
    const msg: string = err instanceof Error ? err.message : String(err);
    const match: RegExpMatchArray | null = msg.match(TOKEN_LIMIT_RE);
    if (match == null) throw err;

    const actualTokens: number = parseInt(match[1]!, 10);
    const charsPerToken: number = text.length / actualTokens;
    const safeChars: number = Math.floor(TOKEN_LIMIT * 0.9 * charsPerToken);
    const truncated: string = text.slice(0, safeChars);

    return service.embedQuery(truncated, modelId, dimensions, true);
  }
}

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
