/**
 * SAM — meta for the item cards under a reply. Each attempt gets the same 15 s
 * as an opened item; a stall, network error or 5xx is retried twice, then the
 * cards read "not available" instead of sitting on a bare file name for good
 * (seen live on the A16, 2026-10-13). A 4xx is final: retrying will not change it.
 */
import type { ItemMeta } from './workItems.js';

export const CARD_META_TIMEOUT_MS = 15_000;
export const CARD_META_ATTEMPTS = 3;

type FetchLike = (url: string, init?: { signal?: AbortSignal; credentials?: RequestCredentials }) => Promise<Response>;

export interface LoadCardMetaOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retryDelayMs?: number;
}

function unavailable(p: string): ItemMeta {
  return { path: p, available: false, kind: null, title: null, size: null };
}

class FinalError extends Error {}

export async function loadCardMeta(paths: string[], opts: LoadCardMetaOptions = {}): Promise<ItemMeta[]> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? CARD_META_TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? 1_000;
  const url = `/api/vault/meta?${paths.map((p) => `path=${encodeURIComponent(p)}`).join('&')}`;

  for (let attempt = 1; attempt <= CARD_META_ATTEMPTS; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctl.signal, credentials: 'same-origin' });
      if (res.status >= 400 && res.status < 500) throw new FinalError(String(res.status));
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items?: ItemMeta[] };
      const got = Array.isArray(data.items) ? data.items : [];
      return paths.map((p, i) => got[i] ?? unavailable(p));
    } catch (err) {
      if (err instanceof FinalError || attempt === CARD_META_ATTEMPTS) break;
      if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    } finally {
      clearTimeout(timer);
    }
  }
  return paths.map(unavailable);
}
