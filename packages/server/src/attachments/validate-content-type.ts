import { fileTypeFromBuffer } from 'file-type';

export type DetectedContentType = {
  mimeType: string;
  isDifferent: boolean;
  declaredType: string | null;
};

/**
 * Detect the actual content type of file data using magic bytes.
 * Compares the detected MIME type against the declared (HTTP header) type
 * and reports whether they differ.
 *
 * Falls back to the declared type (or 'application/octet-stream') when
 * magic-byte detection returns no result (e.g. plain text files).
 */
export async function detectContentType(
  data: Buffer,
  declaredType: string | null,
): Promise<DetectedContentType> {
  const result = await fileTypeFromBuffer(data);
  const mimeType: string =
    result?.mime ?? declaredType ?? 'application/octet-stream';

  return {
    mimeType,
    isDifferent: declaredType != null && mimeType !== declaredType,
    declaredType,
  };
}
