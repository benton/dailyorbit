const MIME_TO_EXTENSION: Map<string, string> = new Map([
  // Documents
  ['application/pdf', 'pdf'],
  ['application/msword', 'doc'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'docx',
  ],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.ms-powerpoint', 'ppt'],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'pptx',
  ],
  ['application/rtf', 'rtf'],
  ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['application/vnd.oasis.opendocument.presentation', 'odp'],

  // Text
  ['text/plain', 'txt'],
  ['text/html', 'html'],
  ['text/css', 'css'],
  ['text/csv', 'csv'],
  ['text/xml', 'xml'],
  ['text/javascript', 'js'],
  ['text/markdown', 'md'],
  ['text/tab-separated-values', 'tsv'],
  ['text/richtext', 'rtx'],

  // Images
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/tiff', 'tiff'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/avif', 'avif'],

  // Audio
  ['audio/mpeg', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
  ['audio/webm', 'weba'],
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac'],
  ['audio/midi', 'mid'],
  ['audio/x-midi', 'mid'],

  // Video
  ['video/mp4', 'mp4'],
  ['video/mpeg', 'mpeg'],
  ['video/webm', 'webm'],
  ['video/ogg', 'ogv'],
  ['video/x-msvideo', 'avi'],
  ['video/quicktime', 'mov'],
  ['video/x-matroska', 'mkv'],

  // Archives
  ['application/zip', 'zip'],
  ['application/gzip', 'gz'],
  ['application/x-tar', 'tar'],
  ['application/x-bzip2', 'bz2'],
  ['application/x-7z-compressed', '7z'],
  ['application/x-rar-compressed', 'rar'],
  ['application/vnd.rar', 'rar'],

  // Data / structured
  ['application/json', 'json'],
  ['application/xml', 'xml'],
  ['application/xhtml+xml', 'xhtml'],
  ['application/atom+xml', 'atom'],
  ['application/rss+xml', 'rss'],
  ['application/ld+json', 'jsonld'],

  // Fonts
  ['font/woff', 'woff'],
  ['font/woff2', 'woff2'],
  ['font/ttf', 'ttf'],
  ['font/otf', 'otf'],

  // Binary / misc
  ['application/octet-stream', 'bin'],
  ['application/x-shockwave-flash', 'swf'],
  ['application/wasm', 'wasm'],
  ['application/epub+zip', 'epub'],
  ['application/vnd.amazon.ebook', 'azw'],
  ['application/x-httpd-php', 'php'],
]);

/**
 * Return a file extension (without leading dot) for a given Content-Type header value.
 * Strips parameters (e.g. `text/html; charset=UTF-8` → `text/html`).
 * Falls back to `'bin'` for unknown types.
 */
export function extensionForContentType(contentType: string): string {
  const baseType: string = contentType.split(';')[0]!.trim().toLowerCase();
  return MIME_TO_EXTENSION.get(baseType) ?? 'bin';
}
