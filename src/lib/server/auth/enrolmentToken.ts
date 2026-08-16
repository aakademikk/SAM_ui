/**
 * SAM — Enrolment token store (passkey Policy B).
 *
 * Every passkey enrolment — including the first — requires a short-lived,
 * single-use token minted by the desktop CLI (`sam-enrol`). Tokens are stored
 * as SHA-256 hashes, never plaintext, with a 10-minute TTL. Verification is
 * timing-safe and single-use: a consumed or expired token is removed.
 *
 * This is the file the server reads. The desktop CLI (`~/.local/bin/sam-enrol`)
 * writes the same store — keep the on-disk contract in sync if either side
 * changes.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const AUTH_DIR = path.join(os.homedir(), '.sam', 'auth');
const TOKEN_PATH = path.join(AUTH_DIR, 'enrolment-token.json');
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** On-disk record — hash only, never the token itself. */
interface TokenRecord {
  hash: string; // sha256 hex of the token (64 chars)
  expiresAt: number; // epoch ms
}

/* ========================================================================== */
/* Persistence                                                                 */
/* ========================================================================== */

async function ensureDir() {
  await fsp.mkdir(AUTH_DIR, { recursive: true });
}

async function readTokens(): Promise<TokenRecord[]> {
  try {
    const raw = await fsp.readFile(TOKEN_PATH, 'utf-8');
    const list = JSON.parse(raw) as TokenRecord[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeTokens(tokens: TokenRecord[]) {
  await ensureDir();
  await fsp.writeFile(TOKEN_PATH, JSON.stringify(tokens), {
    mode: 0o600,
    flag: 'w',
  });
}

/* ========================================================================== */
/* Operations                                                                  */
/* ========================================================================== */

/** Mint a new token and return its plaintext. Printed once by the CLI. */
export async function createEnrolmentToken(ttlMs: number = DEFAULT_TTL_MS): Promise<string> {
  const now = Date.now();
  const tokens = (await readTokens()).filter((t) => t.expiresAt > now);

  const token = 'sam-enrol-' + crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  tokens.push({ hash, expiresAt: now + ttlMs });
  await writeTokens(tokens);

  return token;
}

/**
 * Consume a token. Returns true only on a live, matching, unused token — in
 * which case it is removed (single-use). Expired tokens are pruned on the way
 * through even when the presented token does not match.
 */
export async function consumeEnrolmentToken(token: string): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0) return false;

  const now = Date.now();
  const tokens = await readTokens();
  const live = tokens.filter((t) => t.expiresAt > now);

  const presentedHex = crypto.createHash('sha256').update(token).digest('hex');
  const presented = Buffer.from(presentedHex);
  let matched = false;

  for (const t of live) {
    const stored = Buffer.from(t.hash);
    if (stored.length === presented.length && crypto.timingSafeEqual(stored, presented)) {
      matched = true;
      break;
    }
  }

  if (matched) {
    // Single-use: drop the consumed hash.
    await writeTokens(live.filter((t) => !timingSafeHexEqual(t.hash, presentedHex)));
  } else if (live.length !== tokens.length) {
    await writeTokens(live); // prune expired even on a non-match
  }

  return matched;
}

/** Revoke every pending token. Returns how many were removed. */
export async function clearEnrolmentTokens(): Promise<number> {
  const tokens = await readTokens();
  await writeTokens([]);
  return tokens.length;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
