import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * POST /api/os — relay to the phone's OS bridge over the tailnet.
 *
 * The phone's bridge used to be called directly from the browser on
 * 127.0.0.1:8765. That died: Brave and Chrome both refuse HTTPS-page fetches
 * to loopback (Brave Shields, Chrome Local Network Access), so the PWA now
 * calls this same-origin route and the *server* forwards to the bridge over
 * the encrypted tailnet. Browser never holds the bridge token; the server
 * adds it.
 *
 * Mirrors POST /api/omni/desktop — same auth, same op-allowlist, same
 * token-from-disk pattern — pointed at the phone instead of the desktop.
 *
 * `op` is an allowlist, not a path fragment. A caller can never name a bridge
 * route that this file does not already know about, and the phone's tailnet
 * address is fixed in env, so there is no user-controllable host to SSRF.
 */

const BRIDGE = process.env.SAM_PHONE_BRIDGE_URL ?? 'http://100.78.229.65:8765';
const TOKEN_PATH = path.join(os.homedir(), '.sam', 'os-bridge-phone-token');
const TIMEOUT_MS = 6000;

/** op -> [method, bridge path]. Anything not listed here cannot be reached. */
const OPS: Record<string, ['GET' | 'POST', string]> = {
  health: ['GET', '/os/health'],
  apps: ['GET', '/os/apps'],
  contacts: ['GET', '/os/contacts'],
  open: ['POST', '/os/open'],
  dial: ['POST', '/os/dial'],
  call: ['POST', '/os/call'],
  sms: ['POST', '/os/sms'],
  torch: ['POST', '/os/torch'],
  notify: ['POST', '/os/notify'],
};

let cachedToken: string | null = null;

async function bridgeToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    // Generated at build time into the APK and written here at setup; this
    // only reads the server's copy.
    cachedToken = (await fsp.readFile(TOKEN_PATH, 'utf-8')).trim();
    return cachedToken || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  // Cross-origin pages must never drive the phone, even with a session cookie:
  // a malicious page in Colin's browser could otherwise POST here and text or
  // call from his phone. The browser sets Sec-Fetch-Site itself and cannot be
  // tricked into forging it. (Requests with no header are non-browser clients,
  // which the session check above already rejects.)
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') {
    return failure('Cross-origin request refused.', 403);
  }

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);

  const op = typeof body.op === 'string' ? body.op : '';
  const route = OPS[op];
  if (!route) return failure(`Unknown phone op '${op}'.`, 400);

  const token = await bridgeToken();
  if (!token) return failure('Phone bridge token not found — is the SAM app configured?', 503);

  const [method, bridgePath] = route;
  const query =
    (op === 'apps' || op === 'contacts') && typeof body.q === 'string'
      ? `?q=${encodeURIComponent(body.q)}`
      : '';

  try {
    const res = await fetch(`${BRIDGE}${bridgePath}${query}`, {
      method,
      headers: { 'content-type': 'application/json', 'X-Sam-Token': token },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 401 from the bridge means a token mismatch — a config problem, not a
      // client problem, so surface it as a 500 rather than echoing a 401 the
      // browser would read as a login failure.
      return failure(`Phone bridge returned ${res.status}.`, res.status === 401 ? 500 : 502);
    }
    return envelope(data, `sam.os.${op}`, startedAt, estate.tick);
  } catch {
    // Phone offline or the bridge stopped. The caller falls through cleanly.
    return failure('Phone bridge is unreachable.', 503);
  }
}
