/**
 * SAM — reload an open page when a newer build is live (2026-10-14).
 *
 * An installed PWA brought back from the background keeps running whatever
 * bundle it loaded, however many deploys ago. On the A16 that meant the chat
 * page ran a pre-13-Oct build for two days: no Items button, and the
 * `<!-- more -->` line shown as text, until a trip to the dashboard reloaded it.
 *
 * BuildWatch remembers the build ID it first saw, asks /api/build again when
 * the page comes back into view, and reloads on a change. This module is the
 * pure decision, so the rules are testable without a browser.
 */

export interface ReloadInput {
  /** The build ID this page saw when it loaded; null until the first answer. */
  loaded: string | null;
  /** The build ID the server reports now; null if the check failed. */
  served: string | null;
  /** A reply is streaming, or a message is half typed. */
  busy: boolean;
  /** The served build this tab already reloaded for (sessionStorage). */
  alreadyReloadedFor: string | null;
}

export function shouldReload({ loaded, served, busy, alreadyReloadedFor }: ReloadInput): boolean {
  if (!loaded || !served) return false; // nothing to compare
  if (loaded === served) return false; // current
  if (busy) return false; // never drop a stream or a draft; the next check retries
  if (alreadyReloadedFor === served) return false; // one reload per build, so a bad cache cannot loop
  return true;
}

/** Pull the build ID out of the /api/build envelope; null on any other shape. */
export function parseBuildId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const id = (data as { buildId?: unknown }).buildId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export const RELOADED_KEY = 'sam-build-reloaded-for';
