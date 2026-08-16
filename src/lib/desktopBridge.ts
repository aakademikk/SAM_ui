'use client';

/**
 * SAM — desktop OS bridge client.
 *
 * Talks to /api/omni/desktop, which proxies to the bridge inside the voice
 * service. Unlike osBridge.ts (the phone), nothing here holds a token: the
 * server sits on the same machine as the bridge and keeps it.
 *
 * Every call resolves to a result object rather than throwing, so a bridge
 * that is down degrades to "not handled" and the message falls through to the
 * agent — never a dead end.
 */

interface DesktopResult {
  ok: boolean;
  reason?: string;
  ambiguous?: string[];
  app?: string;
  level?: number;
  action?: string;
}

let available: boolean | null = null;

async function call(body: Record<string, unknown>): Promise<DesktopResult | null> {
  try {
    const res = await fetch('/api/omni/desktop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // 503 means the bridge is down — remember, so every subsequent device
      // command does not pay a round trip to rediscover it.
      if (res.status === 503) available = false;
      return null;
    }
    const json = (await res.json()) as { data?: DesktopResult };
    available = true;
    return json.data ?? null;
  } catch {
    available = false;
    return null;
  }
}

/** Cheap probe. Null means "not yet known". */
export function desktopBridgeAvailable(): boolean | null {
  return available;
}

export async function probeDesktopBridge(): Promise<boolean> {
  const res = await call({ op: 'health' });
  return res !== null;
}

export const openDesktopApp = (app: string) => call({ op: 'open', app });
export const desktopNotify = (title: string, body: string) => call({ op: 'notify', title, body });
export const desktopMedia = (action: string) => call({ op: 'media', action });
export const desktopVolume = (level: number) => call({ op: 'volume', level });
export const desktopLock = () => call({ op: 'lock' });

/**
 * Latest wake-word event. The counter only ever increments, so a client acts
 * on a *change*, never on the value — which means a page opened long after a
 * detection does not immediately think it was woken.
 */
export async function desktopWakeSeq(): Promise<number | null> {
  const res = (await call({ op: 'wake' })) as unknown as { seq?: number } | null;
  return typeof res?.seq === 'number' ? res.seq : null;
}
