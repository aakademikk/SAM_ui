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
const TIMEOUT_MS = 6000;

/**
 * Per-machine desktop bridges. Device-class commands must act on the machine
 * the user is on, not always this one — "open calculator" from the laptop
 * should open the laptop's calculator. The relay sees the connecting client's
 * tailnet IP in X-Forwarded-For (set by `tailscale serve`; browsers cannot
 * forge it), so it routes to that machine's bridge. Anything unmapped — the
 * server itself, the phone for desktop-class actions — falls back to this
 * box's own bridge. Shared token: every desktop bridge holds the same
 * OS_BRIDGE_TOKEN, so one secret works for all of them.
 */
const CLIENT_BRIDGES = new Map<string, string>();
for (const entry of (process.env.SAM_CLIENT_BRIDGES ?? '').split(',')) {
  const [ip, url] = entry.split('=', 2).map((s) => s?.trim());
  if (ip && url) CLIENT_BRIDGES.set(ip, url);
}

function bridgeFor(forwardedFor: string | null): string {
  const ip = forwardedFor?.split(',')[0]?.trim();
  return (ip && CLIENT_BRIDGES.get(ip)) || BRIDGE;
}

/** op -> [method, bridge path]. Anything not listed here cannot be reached. */
const OPS: Record<string, ['GET' | 'POST', string]> = {
  apps: ['GET', '/os/apps'],
  open: ['POST', '/os/open'],
  notify: ['POST', '/os/notify'],
  media: ['POST', '/os/media'],
  volume: ['POST', '/os/volume'],
  lock: ['POST', '/os/lock'],
  health: ['GET', '/os/health'],
  wake: ['GET', '/os/wake'],
};

/** Read per request (not at module load): the build runs without the launcher. */
function bridgeToken(): string | null {
  // The bridge service generates the token; the keystore holds the copy that
  // reaches this process as OS_BRIDGE_TOKEN through the launcher.
  return (process.env.OS_BRIDGE_TOKEN ?? '').trim() || null;
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

  const token = bridgeToken();
  if (!token) return failure('Desktop bridge token not found — is the voice service running?', 503);

  const [method, bridgePath] = route;
  const query = op === 'apps' && typeof body.q === 'string' ? `?q=${encodeURIComponent(body.q)}` : '';

  try {
    const target = bridgeFor(request.headers.get('x-forwarded-for'));
    const res = await fetch(`${target}${bridgePath}${query}`, {
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
