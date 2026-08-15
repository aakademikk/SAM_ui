import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * POST /api/omni/desktop — proxy to the desktop OS bridge on 127.0.0.1:8790.
 *
 * Proxied rather than called from the browser, which is the opposite of how
 * the phone works — and deliberately so. On the phone the server *cannot*
 * reach the bridge, so the PWA must call loopback itself and hold the token.
 * Here the server sits on the same machine as the bridge, so the token never
 * has to leave it: the browser gets an authenticated endpoint, not a secret.
 *
 * A consequence worth being explicit about: because the *server* is the actor,
 * these work from any authenticated client, including the phone over the
 * tailnet. SAM_Omni_Plan originally said desktop actions were PC-only. That
 * was drawn from the phone's loopback constraint, which does not apply in this
 * direction — and it would be an odd line to hold when fleet dispatch already
 * runs arbitrary bash on this box from wherever Colin is logged in.
 *
 * `op` is an allowlist, not a path fragment. A caller can never name a bridge
 * route that this file does not already know about.
 */

const BRIDGE = process.env.SAM_OS_BRIDGE_URL ?? 'http://127.0.0.1:8790';
const TOKEN_PATH = path.join(os.homedir(), '.sam', 'os-bridge-token');
const TIMEOUT_MS = 6000;

/** op -> [method, bridge path]. Anything not listed here cannot be reached. */
const OPS: Record<string, ['GET' | 'POST', string]> = {
  apps: ['GET', '/os/apps'],
  open: ['POST', '/os/open'],
  notify: ['POST', '/os/notify'],
  media: ['POST', '/os/media'],
  volume: ['POST', '/os/volume'],
  lock: ['POST', '/os/lock'],
  health: ['GET', '/os/health'],
};

let cachedToken: string | null = null;

async function bridgeToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    // Written 0600 by the bridge on first run; the service generates it, this
    // only reads it.
    cachedToken = (await fsp.readFile(TOKEN_PATH, 'utf-8')).trim();
    return cachedToken || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);

  const op = typeof body.op === 'string' ? body.op : '';
  const route = OPS[op];
  if (!route) return failure(`Unknown desktop op '${op}'.`, 400);

  const token = await bridgeToken();
  if (!token) return failure('Desktop bridge token not found — is the voice service running?', 503);

  const [method, bridgePath] = route;
  const query = op === 'apps' && typeof body.q === 'string' ? `?q=${encodeURIComponent(body.q)}` : '';

  try {
    const res = await fetch(`${BRIDGE}${bridgePath}${query}`, {
      method,
      headers: { 'content-type': 'application/json', 'X-Sam-Token': token },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      return failure(`Desktop bridge returned ${res.status}.`, res.status === 401 ? 500 : 502);
    }
    return envelope(data, `sam.omni.desktop.${op}`, startedAt, estate.tick);
  } catch {
    // Voice service down or restarting. The caller falls through to the agent.
    return failure('Desktop bridge is unreachable.', 503);
  }
}
