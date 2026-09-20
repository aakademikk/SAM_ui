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

/**
 * How many session ids to keep, newest last.
 *
 * This registry only has to answer one question: "did SAM_ui create the session
 * this client is asking to resume?" A client resumes the session it is holding,
 * which is the one from its last turn — so the useful window is small, and the
 * set was growing without any bound at all (SAM_ui_Audit_2026-09-20 finding 12).
 * Every fresh turn added a UUID, nothing ever removed one, and the whole set was
 * held in memory and rewritten to disk on every single add.
 *
 * 500 is far more than any real resume window and still bounds the file at
 * roughly 20 KB. The cost of trimming too aggressively is mild and self-healing:
 * an unrecognised id falls back to a fresh server-assigned session, which is
 * exactly what happens for a foreign id today.
 */
const MAX_SESSIONS = 500;

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

  // A Set iterates in insertion order, so the oldest ids are simply the first
  // ones out. Trim before writing so the file and the in-memory set never
  // disagree about what is retained.
  while (set.size > MAX_SESSIONS) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }

  try {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    // Atomic: a truncating write that is interrupted leaves a corrupt file, and
    // load() swallows the parse failure and starts empty — which silently makes
    // every in-flight conversation unresumable. Same reasoning as the passkey
    // store; see lib/server/auth/store.ts.
    const tmp = `${REGISTRY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...set], null, 2));
    fs.renameSync(tmp, REGISTRY_FILE);
  } catch {
    // A lost registry only means a future resume falls back to a fresh session.
  }
}
