/**
 * SAM — client for the phone's OS bridge.
 *
 * The Android app runs a tiny HTTP server on 127.0.0.1 that exposes the things
 * the web platform cannot reach: launching apps, dialling, texting, the torch,
 * contacts, local notifications. This module is the only place that talks to
 * it.
 *
 * Browsers treat http://127.0.0.1 as a trustworthy origin, so an HTTPS page is
 * allowed to call it without tripping mixed-content blocking. It only exists
 * inside the installed Android app — on the desktop, or in a plain browser
 * tab, every call here fails fast and the caller falls back to the agent.
 */

'use client';

const DEFAULT_PORT = 8765;
const TIMEOUT_MS = 4000;

/** Set from ?os_port= on wake, so the native side owns the port number. */
let bridgePort: number | null = null;
let availability: 'unknown' | 'present' | 'absent' = 'unknown';

export interface OsApp {
  label: string;
  pkg: string;
}

export interface OsContact {
  name: string;
  number: string;
}

/**
 * Record the bridge port advertised in the launch URL. Called once on mount;
 * the port is remembered for the rest of the session so ordinary navigation
 * does not lose it.
 */
export function configureOsBridge(port?: number | null) {
  if (port && Number.isFinite(port)) {
    bridgePort = port;
    availability = 'unknown';
    try {
      sessionStorage.setItem('sam:osPort', String(port));
    } catch {
      /* private mode — the in-memory value still works for this page */
    }
    return;
  }
  if (bridgePort === null) {
    try {
      const stored = sessionStorage.getItem('sam:osPort');
      if (stored) bridgePort = Number(stored);
    } catch {
      /* ignore */
    }
  }
}

function baseUrl(): string | null {
  const port = bridgePort ?? DEFAULT_PORT;
  return `http://127.0.0.1:${port}`;
}

async function call<T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T | null> {
  const base = baseUrl();
  if (!base) return null;
  if (availability === 'absent') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + path, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      // A 4xx is the bridge answering — it exists, it just refused this call
      // (usually a permission the user declined).
      availability = 'present';
      return null;
    }
    availability = 'present';
    return (await res.json()) as T;
  } catch {
    // Connection refused means no Android app: this is a browser or desktop.
    // Remember that so we stop paying the timeout on every command.
    availability = 'absent';
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True once a call has succeeded. Cheap to poll — never re-probes after a miss. */
export function osBridgeAvailable(): boolean {
  return availability === 'present';
}

export async function osHealth(): Promise<{ wakeWord: string } | null> {
  return call<{ wakeWord: string }>('/os/health');
}

export async function findApps(query: string): Promise<OsApp[]> {
  const res = await call<{ apps: OsApp[] }>(`/os/apps?q=${encodeURIComponent(query)}`);
  return res?.apps ?? [];
}

export async function findContacts(query: string): Promise<OsContact[]> {
  const res = await call<{ contacts: OsContact[] }>(
    `/os/contacts?q=${encodeURIComponent(query)}`,
  );
  return res?.contacts ?? [];
}

export async function openApp(pkg: string): Promise<boolean> {
  const res = await call<{ ok: boolean }>('/os/open', { method: 'POST', body: { pkg } });
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
  const res = await call<{ ok: boolean; placed: boolean }>(place ? '/os/call' : '/os/dial', {
    method: 'POST',
    body: { number },
  });
  return { ok: Boolean(res?.ok), placed: Boolean(res?.placed) };
}

export async function sendSms(number: string, body: string): Promise<boolean> {
  const res = await call<{ ok: boolean }>('/os/sms', {
    method: 'POST',
    body: { number, body },
  });
  return Boolean(res?.ok);
}

export async function setTorch(on: boolean): Promise<boolean> {
  const res = await call<{ ok: boolean }>('/os/torch', { method: 'POST', body: { on } });
  return Boolean(res?.ok);
}

export async function notify(
  title: string,
  body: string,
  whenMs = 0,
): Promise<boolean> {
  const res = await call<{ ok: boolean }>('/os/notify', {
    method: 'POST',
    body: { title, body, whenMs },
  });
  return Boolean(res?.ok);
}
