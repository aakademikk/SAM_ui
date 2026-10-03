/**
 * SAM — Demo-mode leak scan (T21, Must 19; checks 13, 23, 30).
 *
 * An automated check that no real client name or home-folder path ever
 * reaches a demo-mode screen. `buildLeakPatterns` reads the vault's
 * `02 - Atwood Systems/10_Clients/` folder (names only, never file
 * contents — see the ticket's "Do not touch") through the `SAM_VAULT_DIR`
 * seam (same seam `src/lib/server/chat/handoff.ts` uses), plus a generic
 * home-folder path shape. `scanForLeaks` runs those patterns over any
 * string — in practice, the serialised JSON every route the Dashboard
 * polls in demo mode returns (`/api/fleet/floor`, `/api/fleet/schedule`,
 * `/api/fleet/spend`, `/api/fleet/jobs`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function vaultDir(): string {
  return process.env.SAM_VAULT_DIR ?? path.join(os.homedir(), 'ai-memory-vault');
}

const CLIENTS_SUBPATH = path.join('02 - Atwood Systems', '10_Clients');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One pattern per real client folder/file name, plus any home-folder path shape (`/home/<user>/...`, `~/...`). */
export function buildLeakPatterns(): RegExp[] {
  const dir = path.join(vaultDir(), CLIENTS_SUBPATH);

  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
  } catch {
    // No vault, or no 10_Clients folder, at this SAM_VAULT_DIR — an empty
    // client list, never an error (read-only, honest fallback).
    names = [];
  }

  const patterns = names.map((name) => new RegExp(escapeRegExp(name), 'i'));
  patterns.push(/\/home\/[a-z0-9_.-]+\//i);
  patterns.push(/~\/\S+/);
  return patterns;
}

/** Which leak patterns matched `text` (their source text) — empty when clean. */
export function scanForLeaks(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of buildLeakPatterns()) {
    if (pattern.test(text)) hits.push(pattern.source);
  }
  return hits;
}
