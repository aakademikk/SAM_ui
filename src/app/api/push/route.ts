/**
 * GET    /api/push         → VAPID public key (session required)
 * POST   /api/push         → save a Web Push subscription (session required)
 * DELETE /api/push         → remove a Web Push subscription
 *
 * Subscriptions are stored at ~/.sam/push-subs.json — the same file
 * ~/.sam/sam-push/send.mjs reads when a script fires a ping. The browser
 * never touches that file; the server owns it.
 *
 * Cross-origin guard (same as /api/os): a page from another origin must not
 * be able to subscribe or unsubscribe Colin's devices, so non-same-origin
 * requests are refused even with a valid session cookie.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

const SUBS_PATH = path.join(os.homedir(), '.sam', 'push-subs.json');
const VAPID_PATH = path.join(os.homedir(), '.sam', 'push-vapid.json');
const MAX_SUBS = 16;

function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  // No header = non-browser client, which the session check already rejects.
  return !site || site === 'same-origin';
}

async function loadSubs(): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fsp.readFile(SUBS_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

async function saveSubs(subs: Record<string, unknown>[]): Promise<void> {
  await fsp.mkdir(path.dirname(SUBS_PATH), { recursive: true });
  await fsp.writeFile(SUBS_PATH, JSON.stringify(subs, null, 2) + '\n', {
    mode: 0o600,
  });
}

function looksLikePushSubscription(v: unknown): v is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  if (typeof v !== 'object' || v === null) return false;
  const sub = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('https://') &&
    typeof sub.keys?.p256dh === 'string' &&
    sub.keys.p256dh.length > 0 &&
    typeof sub.keys.auth === 'string' &&
    sub.keys.auth.length > 0
  );
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  let publicKey = '';
  try {
    const raw = await fsp.readFile(VAPID_PATH, 'utf8');
    publicKey = (JSON.parse(raw) as { publicKey?: string }).publicKey ?? '';
  } catch {
    return failure('VAPID keys not provisioned.', 503);
  }
  if (!publicKey) return failure('VAPID keys not provisioned.', 503);

  return envelope({ publicKey }, 'sam.push.vapid', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!sameOrigin(request)) return failure('Cross-origin request refused.', 403);

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);

  if (!looksLikePushSubscription(body.subscription)) {
    return failure('Malformed push subscription.', 400);
  }

  const subs = await loadSubs();
  const endpoint = body.subscription.endpoint;
  const filtered = subs.filter(
    (s) => (s as { endpoint?: string }).endpoint !== endpoint,
  );
  const device =
    typeof body.device === 'string' ? body.device.slice(0, 60) : 'unknown-device';
  filtered.push({
    endpoint,
    keys: body.subscription.keys,
    device,
    createdAt: new Date().toISOString(),
  });

  // Keep the newest MAX_SUBS; drop the oldest beyond that.
  const trimmed = filtered.slice(-MAX_SUBS);
  await saveSubs(trimmed);

  return envelope({ devices: trimmed.length }, 'sam.push.subscribe', startedAt, estate.tick);
}

export async function DELETE(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!sameOrigin(request)) return failure('Cross-origin request refused.', 403);

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  if (!endpoint) return failure('endpoint is required.', 400);

  const subs = await loadSubs();
  const remaining = subs.filter(
    (s) => (s as { endpoint?: string }).endpoint !== endpoint,
  );
  await saveSubs(remaining);

  return envelope({ devices: remaining.length }, 'sam.push.unsubscribe', startedAt, estate.tick);
}
