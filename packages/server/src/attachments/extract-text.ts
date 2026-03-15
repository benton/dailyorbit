import { WasmPdfDocument } from 'pdf-oxide-wasm';

const MIN_TEXT_CHARS: number = 50;

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
export function extractTextFromPdf(bytes: Uint8Array): ExtractionResult {
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
    doc?.free();
  }
}
