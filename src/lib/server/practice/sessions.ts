/**
 * SAM — registry of session ids the practice agent created.
 *
 * Deliberately SEPARATE from samuiSessions, and the separation is the feature:
 * a practice session is a roleplay with no tools and a persona system prompt,
 * and resuming one as SAM would put Colin's real assistant inside a
 * conversation where it had been told it was a plumber from Rayleigh. The chat
 * route only resumes ids in its own registry and this route only resumes ids in
 * this one, so neither can reach the other's sessions — the refusal is
 * structural rather than a check somebody has to remember to write.
 *
 * Persisted to disk for the same reason samuiSessions is: an in-memory-only
 * registry would forget its sessions on restart and strand a rehearsal
 * mid-conversation.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY_FILE = path.join(os.homedir(), '.sam', 'practice-sessions.json');

/** Cached on globalThis so all route handlers see one set across module reloads. */
const globalForSam = globalThis as unknown as { __practiceSessions?: Set<string> };

function load(): Set<string> {
  const cached = globalForSam.__practiceSessions;
  if (cached) return cached;

  let set = new Set<string>();
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      set = new Set(parsed.filter((id): id is string => typeof id === 'string'));
    }
  } catch {
    // First run, or a corrupt/missing file — start empty.
  }
  globalForSam.__practiceSessions = set;
  return set;
}

export function isPracticeSession(id: string): boolean {
  return load().has(id);
}

/** Record a session id as practice-owned. Idempotent. Persistence is best-effort. */
export function registerPracticeSession(id: string): void {
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
