/**
 * SAM — content types and response headers for vault files (work area).
 * Every work-area response is no-store and nosniff; HTML, SVG and PDF add
 * their own lock-down so a direct open of the address cannot run with
 * SAM_ui's access.
 */

const TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
};

export function contentTypeFor(ext: string): string {
  return TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function headersFor(ext: string, size: number): Record<string, string> {
  const e = ext.toLowerCase();
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(e),
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (e === 'html') {
    headers['Content-Security-Policy'] = "sandbox allow-scripts; frame-ancestors 'self'";
  } else if (e === 'svg') {
    headers['Content-Security-Policy'] = "sandbox; script-src 'none'; frame-ancestors 'self'";
  } else if (e === 'pdf') {
    headers['Content-Disposition'] = 'attachment';
  }
  return headers;
}

export type RangeResult = { start: number; end: number } | 416 | null;

/**
 * One byte range only. `bytes=a-b`, `bytes=a-`, `bytes=-n` give the inclusive
 * slice; a malformed or multi-range header gives null (serve the whole file);
 * a well-formed but unsatisfiable one gives 416.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const n = Number(b);
    if (n === 0 || size === 0) return 416;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start) || start >= size) return 416;
  let end = b === '' ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end) || end < start) return null;
  if (end > size - 1) end = size - 1;
  return { start, end };
}

/** The one refusal answer: identical whatever the reason. */
export function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
