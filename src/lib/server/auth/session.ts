/**
 * SAM — Session management.
 *
 * Two tiers via httpOnly cookies:
 *   - sam-session  (30 days): read access — view dashboards, logs, job status.
 *   - sam-stepup   (12 hours): write access — run commands, kill jobs, settings.
 *
 * JWTs are signed with a key persisted to ~/.sam/auth/session-key, so sessions
 * survive server restarts. (This previously said they did not; the key was made
 * persistent and the comment was left behind.)
 */

import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ========================================================================== */
/* Key management — persisted to disk so sessions survive restarts              */
/* ========================================================================== */

const KEY_PATH = path.join(os.homedir(), '.sam', 'auth', 'session-key');

function generateKey(): Uint8Array {
  return randomBytes(32);
}

function loadOrCreateKey(): Uint8Array {
  try {
    // Try to load existing key from disk.
    const raw = fs.readFileSync(KEY_PATH);
    if (raw.length === 32) return new Uint8Array(raw);
  } catch {
    // Key doesn't exist yet — create and persist it.
  }

  const key = generateKey();
  try {
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    fs.writeFileSync(KEY_PATH, key);
  } catch {
    // Can't persist — key lives only in memory this session.
  }
  return key;
}

const globalForSam = globalThis as unknown as {
  __samSessionKey?: Uint8Array;
};
function getKey(): Uint8Array {
  if (!globalForSam.__samSessionKey) {
    globalForSam.__samSessionKey = loadOrCreateKey();
  }
  return globalForSam.__samSessionKey;
}

/* ========================================================================== */
/* Desktop-presence binding (Cerberus item 2, 2026-08-15)                      */
/* ========================================================================== */
//
// The step-up cookie is a stateless JWT, so it cannot be revoked on its own.
// The desktop-presence watcher (sam-presence.timer → sam-presence-check.sh)
// bumps ~/.sam/presence-epoch the moment the desktop locks or idles. Step-up
// cookies carry the epoch at issuance; verifyStepUp rejects any whose epoch is
// stale — so the 12-hour cross-platform window dies within one timer tick of
// the desktop going idle. Re-arm is one fresh biometric.
const PRESENCE_EPOCH_PATH = path.join(os.homedir(), '.sam', 'presence-epoch');

async function getPresenceEpoch(): Promise<number> {
  try {
    const raw = await fs.promises.readFile(PRESENCE_EPOCH_PATH, 'utf-8');
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/* ========================================================================== */
/* Cookie helpers                                                              */
/* ========================================================================== */

export const SESSION_COOKIE = 'sam-session';
export const STEPUP_COOKIE = 'sam-stepup';

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
// Step-up needs a fresh passkey assertion when it lapses, so the right window
// depends on what re-authenticating actually costs — not on which device it is.
//
//   platform        the authenticator is built into the machine being used.
//                   On the phone that is a fingerprint: instant, so there is
//                   no reason to widen the window, and the phone is both the
//                   most losable device and the one with Terminal and Jobs
//                   behind it. Kept short.
//
//   cross-platform  the authenticator lives elsewhere — the hybrid/QR flow a
//                   Linux desktop must use, since it has no platform
//                   authenticator of its own. That means physically reaching
//                   for the phone, which at 10 minutes made desktop write
//                   access unusable.
//
// The long window leans on a physical control instead: the desktop's screen
// lock (enabled 2026-08-11; it was found switched off) plus the origin being
// reachable only from the tailnet. If that screen lock is ever turned off, the
// long window is protecting nothing and should come back down.
//
// A USB security key on the desktop would make it a platform-grade touch and
// let both windows be short again.
const STEPUP_MAX_AGE_PLATFORM = 10 * 60;          // 10 minutes
const STEPUP_MAX_AGE_CROSS_PLATFORM = 12 * 60 * 60; // 12 hours

/** WebAuthn reports this on the assertion; absent on older browsers. */
export type AuthenticatorAttachment = 'platform' | 'cross-platform';

/**
 * Unknown attachment falls back to the short window on purpose. The field is
 * client-reported, so failing closed is the only safe default.
 */
export function stepUpMaxAge(attachment?: AuthenticatorAttachment | null): number {
  return attachment === 'cross-platform'
    ? STEPUP_MAX_AGE_CROSS_PLATFORM
    : STEPUP_MAX_AGE_PLATFORM;
}

function cookieString(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/* ========================================================================== */
/* Payload                                                                    */
/* ========================================================================== */

export interface SessionPayload {
  /** credentialId of the authenticated WebAuthn credential. */
  sub: string;
  /** Human-readable device name. */
  device: string;
  /** When the session was created (epoch seconds). */
  iat: number;
  /**
   * Desktop-presence epoch at issuance. Only step-up cookies carry it;
   * verifyStepUp rejects any cookie whose epoch is stale. Absent on cookies
   * issued before the presence binding landed (2026-08-15) — those are
   * rejected, failing closed.
   */
  presEpoch?: number;
}

/* ========================================================================== */
/* Sign / verify                                                               */
/* ========================================================================== */

async function sign(payload: SessionPayload, maxAge: number): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .sign(getKey());
}

async function verify(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ['HS256'] });
    return {
      sub: payload.sub as string,
      device: payload.device as string,
      iat: payload.iat as number,
      presEpoch: payload.presEpoch as number | undefined,
    };
  } catch {
    return null;
  }
}

/* ========================================================================== */
/* Public API                                                                  */
/* ========================================================================== */

/** Create both session + step-up cookies after a successful WebAuthn auth. */
export async function createSessionCookies(
  payload: SessionPayload,
  attachment?: AuthenticatorAttachment | null,
): Promise<string[]> {
  const stepUpAge = stepUpMaxAge(attachment);
  const sessionJwt = await sign(payload, SESSION_MAX_AGE);
  const stepupJwt = await sign(
    { ...payload, presEpoch: await getPresenceEpoch() },
    stepUpAge,
  );

  return [
    cookieString(SESSION_COOKIE, sessionJwt, SESSION_MAX_AGE),
    cookieString(STEPUP_COOKIE, stepupJwt, stepUpAge),
  ];
}

/** Refresh just the step-up cookie (re-auth with biometric). */
export async function createStepUpCookie(
  payload: SessionPayload,
  attachment?: AuthenticatorAttachment | null,
): Promise<string> {
  const stepUpAge = stepUpMaxAge(attachment);
  const stepupJwt = await sign(
    { ...payload, presEpoch: await getPresenceEpoch() },
    stepUpAge,
  );
  return cookieString(STEPUP_COOKIE, stepupJwt, stepUpAge);
}

/** Verify the long-lived session cookie. */
export async function verifySession(cookieHeader: string | null): Promise<SessionPayload | null> {
  const token = extractCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  return verify(token);
}

/** Verify the short-lived step-up cookie. */
export async function verifyStepUp(cookieHeader: string | null): Promise<SessionPayload | null> {
  const token = extractCookie(cookieHeader, STEPUP_COOKIE);
  if (!token) return null;
  const payload = await verify(token);
  if (!payload) return null;
  // Desktop-presence binding: if the desktop has locked or idled since this
  // cookie was issued, the write window is dead. Fails closed — a cookie with
  // no presEpoch (issued before the binding landed) is rejected too.
  if (payload.presEpoch !== (await getPresenceEpoch())) return null;
  return payload;
}

/** Remove all auth cookies. */
export function clearSessionCookies(): string[] {
  return [
    cookieString(SESSION_COOKIE, '', 0),
    cookieString(STEPUP_COOKIE, '', 0),
  ];
}

function extractCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const cookie of header.split(';')) {
    const [key, ...rest] = cookie.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
