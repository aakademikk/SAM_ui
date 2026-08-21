/**
 * SAM — client for the phone's OS bridge.
 *
 * The Android app runs a tiny HTTP server exposing the things the web platform
 * cannot reach: launching apps, dialling, texting, the torch, contacts, local
 * notifications.
 *
 * This module used to call that bridge directly on http://127.0.0.1:8765.
 * That stopped working on modern mobile browsers — Brave's Shields and
 * Chrome's Local Network Access both refuse an HTTPS page fetching loopback.
 * So the PWA now calls the same-origin relay /api/os and the *server* forwards
 * to the bridge over the encrypted tailnet, presenting the shared token the
 * browser never sees. No code here needs to know the phone's address or hold
 * a secret.
 */

'use client';

const TIMEOUT_MS = 6000;

/**
 * How long a failed probe keeps the bridge marked absent before we try again.
 * A single transient failure — the phone's network dropping, a slow moment —
 * must not brick phone controls for the rest of the session, which is what a
 * permanent "absent" latch did: one refused fetch and every later "open torch"
 * reported the app as not installed even though the service was up.
 */
const ABSENT_RETRY_MS = 10_000;

let availability: 'unknown' | 'present' | 'absent' = 'unknown';
let lastAbsentAt = 0;

export interface OsApp {
  label: string;
  pkg: string;
}

export interface OsContact {
  name: string;
  number: string;
}

/**
 * Record the bridge port advertised in the launch URL. Kept for the wake
 * launch (?os_port=...); with the server relay the port no longer matters, but
 * the caller's contract is unchanged.
 */
export function configureOsBridge(_port?: number | null) {
  /* no-op — the relay owns the transport now */
}

/**
 * The relay is reachable from any authenticated client, including the
 * desktop — but the phone bridge must only be *used* when we are actually on
 * the phone, or "open calculator" at the desk would open it on the phone
 * instead of the PC.
 */
function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function call<T>(op: string, args?: Record<string, unknown>): Promise<T | null> {
  // Fast-fail only while the last failure is fresh, so a client that never had
  // a phone (desktop) does not pay the timeout on every command, but a phone
  // whose app just came up recovers after the cooldown.
  if (availability === 'absent' && Date.now() - lastAbsentAt < ABSENT_RETRY_MS) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/api/os', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...args }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      // 503 is the relay failing to reach the phone — bridge genuinely down.
      // Anything else (401 session gone, 502 the bridge refused this call,
      // e.g. a permission the user declined) means the bridge exists but did
      // not do it.
      if (res.status === 503) {
        availability = 'absent';
        lastAbsentAt = Date.now();
      } else {
        availability = 'present';
      }
      return null;
    }
    availability = 'present';
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    // Network error to the relay: treat as absent with a cooldown, same as a
    // 503, so a later probe can retry rather than being latched forever.
    availability = 'absent';
    lastAbsentAt = Date.now();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True once a call has succeeded, and only on a phone. */
export function osBridgeAvailable(): boolean {
  return availability === 'present' && isPhone();
}

export async function osHealth(): Promise<{ wakeWord: string } | null> {
  return call<{ wakeWord: string }>('health');
}

export async function findApps(query: string): Promise<OsApp[]> {
  const res = await call<{ apps: OsApp[] }>('apps', { q: query });
  return res?.apps ?? [];
}

export async function findContacts(query: string): Promise<OsContact[]> {
  const res = await call<{ contacts: OsContact[] }>('contacts', { q: query });
  return res?.contacts ?? [];
}

export async function openApp(pkg: string): Promise<boolean> {
  const res = await call<{ ok: boolean }>('open', { pkg });
  return Boolean(res?.ok);
}

/**
 * @returns `placed` false means the dialler was opened pre-filled rather than
 * the call being put through — CALL_PHONE was refused. Worth surfacing, so SAM
 * does not claim to have rung someone it hasn't.
 */
export async function callNumber(
  number: string,
  place: boolean,
): Promise<{ ok: boolean; placed: boolean }> {
  const res = await call<{ ok: boolean; placed: boolean }>(place ? 'call' : 'dial', {
    number,
  });
  return { ok: Boolean(res?.ok), placed: Boolean(res?.placed) };
}

export async function sendSms(number: string, body: string): Promise<boolean> {
  const res = await call<{ ok: boolean }>('sms', { number, body });
  return Boolean(res?.ok);
}

export async function setTorch(on: boolean): Promise<boolean> {
  const res = await call<{ ok: boolean }>('torch', { on });
  return Boolean(res?.ok);
}

export async function notify(title: string, body: string, whenMs = 0): Promise<boolean> {
  const res = await call<{ ok: boolean }>('notify', { title, body, whenMs });
  return Boolean(res?.ok);
}
