/**
 * Work-area routes the service worker must never cache (no offline copies).
 * Kept pure so it can be tested under node; used by src/app/sw.ts.
 */
const WORK_AREA_PATHS = new Set(['/api/vault/file', '/api/vault/meta', '/api/vault/recent']);

export function isWorkAreaPath(pathname: string): boolean {
  return WORK_AREA_PATHS.has(pathname);
}
