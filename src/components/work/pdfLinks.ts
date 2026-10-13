/**
 * SAM — the only part of a PDF's annotations the work panel acts on (Must 32).
 * Keeps Link annotations whose `url` is an http or https address. Everything
 * else (javascript:, other schemes in unsafeUrl, named, launch, submit and
 * every other action) is dropped. Pure, so it loads in the test build.
 */
export interface PdfAnnotationLike {
  subtype?: unknown;
  url?: unknown;
  unsafeUrl?: unknown;
  action?: unknown;
  dest?: unknown;
  rect?: unknown;
}

export interface SafePdfLink {
  url: string;
  /** [x1, y1, x2, y2] in PDF user space. */
  rect: [number, number, number, number];
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function safePdfLinks(annotations: readonly PdfAnnotationLike[] | null | undefined): SafePdfLink[] {
  const out: SafePdfLink[] = [];
  for (const a of annotations ?? []) {
    if (!a || a.subtype !== 'Link') continue;
    const url = httpUrl(a.url);
    if (!url) continue;
    const r = a.rect;
    if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    out.push({ url, rect: [r[0], r[1], r[2], r[3]] });
  }
  return out;
}
