/**
 * SAM — registry of session ids SAM_ui itself created.
 *
 * The chat agent route only resumes sessions that were born from a SAM_ui job.
 * A foreign id — most importantly the live interactive terminal session, which
 * the phone's localStorage once borrowed — would spawn a second `claude`
 * process on a conversation another process already owns, and the two race the
 * same session file (the mobile turn streams a duplicate of the terminal's
 * working and never lands an answer). That collision is what this registry
 * exists to prevent: unknown ids are refused a resume and get a fresh
 * server-assigned session instead.
 *
 * Persisted to disk (not just globalThis) so a SAM_ui restart does not forget
 * which sessions it owns — an in-memory-only registry would reset the mobile
 * conversation on every restart.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY_FILE = path.join(os.homedir(), '.sam', 'samui-sessions.json');

/** Cached on globalThis so all route handlers see one set across module reloads. */
const globalForSam = globalThis as unknown as { __samuiSessions?: Set<string> };

function load(): Set<string> {
  const cached = globalForSam.__samuiSessions;
  if (cached) return cached;

  let set = new Set<string>();
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      set = new Set(parsed.filter((s): s is string => typeof s === 'string'));
    }
  } catch {
    // First run, or a corrupt/missing file — start empty.
  }
  globalForSam.__samuiSessions = set;
  return set;
}

export function isSamuiSession(id: string): boolean {
  return load().has(id);
}

/** Record a session id as SAM_ui-owned. Idempotent. Persistence is best-effort. */
export function registerSamuiSession(id: string): void {
  const set = load();
  if (set.has(id)) return;
  set.add(id);
  try {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify([...set], null, 2));
  } catch {
    // A lost registry only means a future resume falls back to a fresh session.
  }
}
