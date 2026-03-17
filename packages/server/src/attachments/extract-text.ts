import { execFileSync } from 'node:child_process';
import { WasmPdfDocument } from 'pdf-oxide-wasm';

const MIN_TEXT_CHARS: number = 50;

/**
 * Returns true if text looks like raw binary content rather than extracted text.
 * Checks for %PDF- prefix or >10% non-printable characters among non-whitespace.
 */
export function looksLikeBinary(text: string): boolean {
  if (text.length === 0) return false;
  if (text.startsWith('%PDF-')) return true;

  let nonWhitespace: number = 0;
  let nonPrintable: number = 0;

  for (let i: number = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    // Skip whitespace (space, tab, newline, carriage return)
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      continue;
    }
    nonWhitespace++;
    // Non-printable: control chars (0x00-0x1F except tab/LF/CR) and DEL (0x7F)
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      nonPrintable++;
    }
  }

  if (nonWhitespace === 0) return false;
  return nonPrintable / nonWhitespace > 0.1;
}

/**
 * Extracts text from a PDF file using the system `pdftotext` binary (poppler-utils).
 * Falls back to this when WASM extraction returns binary content.
 */
export function extractWithPdftotext(filePath: string): ExtractionResult {
  try {
    const stdout: string = execFileSync(
      'pdftotext',
      ['-layout', filePath, '-'],
      {
        timeout: 60_000,
        maxBuffer: 50 * 1024 * 1024,
        encoding: 'utf-8',
      },
    );

    const pages: string[] = stdout
      .split('\f')
      .filter((p: string) => p.trim().length > 0);
    const text: string = pages.join('\n\n---\n\n');
    const textLength: number = text.replace(/\s/g, '').length;

    if (textLength < MIN_TEXT_CHARS) {
      return {
        status: 'skipped_no_text',
        text,
        textLength,
        pageCount: pages.length,
      };
    }

    return { status: 'extracted', text, textLength, pageCount: pages.length };
  } catch (e: unknown) {
    const error: string = e instanceof Error ? e.message : String(e);
    return { status: 'failed', text: null, textLength: 0, pageCount: 0, error };
  }
}

export type ExtractionResult =
  | { status: 'extracted'; text: string; textLength: number; pageCount: number }
  | {
      status: 'skipped_no_text';
      text: string;
      textLength: number;
      pageCount: number;
    }
  | {
      status: 'failed';
      text: null;
      textLength: 0;
      pageCount: 0;
      error: string;
    };

/**
 * Extract markdown-formatted text from a PDF byte array.
 *
 * Uses pdf-oxide-wasm to extract per-page markdown with heading detection.
 * Images are excluded to avoid base64 noise from scanned documents.
 * PDFs with fewer than MIN_TEXT_CHARS non-whitespace characters are classified
 * as scanned/image-only and returned with status 'skipped_no_text'.
 */
function extractWithWasm(bytes: Uint8Array): ExtractionResult {
  let doc: WasmPdfDocument | null = null;
  try {
    doc = new WasmPdfDocument(bytes);
    const pageCount: number = doc.pageCount();
    const pages: string[] = [];

    for (let i: number = 0; i < pageCount; i++) {
      const pageText: string = doc.toMarkdown(i, true, false);
      pages.push(pageText);
    }

    const text: string = pages.join('\n\n---\n\n');
    const textLength: number = text.replace(/\s/g, '').length;

    if (textLength < MIN_TEXT_CHARS) {
      return { status: 'skipped_no_text', text, textLength, pageCount };
    }

    return { status: 'extracted', text, textLength, pageCount };
  } catch (e: unknown) {
    const error: string = e instanceof Error ? e.message : String(e);
    return { status: 'failed', text: null, textLength: 0, pageCount: 0, error };
  } finally {
    try { doc?.free(); } catch { /* WASM cleanup may throw after a panic */ }
  }
}

export function extractTextFromPdf(
  bytes: Uint8Array,
  filePath?: string,
): ExtractionResult {
  const wasmResult: ExtractionResult = extractWithWasm(bytes);

  const needsFallback: boolean =
    (wasmResult.status === 'extracted' && looksLikeBinary(wasmResult.text)) ||
    wasmResult.status === 'failed';

  if (needsFallback && filePath) {
    const fallbackResult: ExtractionResult = extractWithPdftotext(filePath);
    if (fallbackResult.status !== 'failed') {
      return fallbackResult;
    }
    // Both methods failed — report both errors
    const wasmError: string =
      wasmResult.status === 'failed'
        ? wasmResult.error
        : 'returned binary content';
    return {
      status: 'failed',
      text: null,
      textLength: 0,
      pageCount: 0,
      error: `WASM ${wasmError}; pdftotext fallback failed: ${fallbackResult.error}`,
    };
  }

  if (needsFallback && !filePath) {
    const reason: string =
      wasmResult.status === 'failed'
        ? wasmResult.error
        : 'returned binary content';
    return {
      status: 'failed',
      text: null,
      textLength: 0,
      pageCount: 0,
      error: `WASM ${reason} and no filePath provided for pdftotext fallback`,
    };
  }

  return wasmResult;
}
