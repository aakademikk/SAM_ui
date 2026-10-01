/**
 * SAM — Notifications: every ping T9's `sam-push` (staged as `send.next.mjs`
 * until T21) logs to `SAM_PUSH_LOG` (default `~/.sam/push-log.jsonl`), newest
 * first.
 *
 * Spec must-do 17, 18, 19; check 12 (automated half). The log line shape is
 * fixed by T9: `{ id, ts, title, body, url, tag, chatId, jobId }`, one JSON
 * line per ping, oldest line first (it is append-only, occasionally trimmed
 * to its newest 1000 lines — see `send.next.mjs`). `notificationTarget`
 * mirrors the same link rule T9 already bakes into `url`, but is re-derived
 * here from `chatId`/`jobId` rather than trusting the logged `url` verbatim,
 * so a page that lists an old entry still lands on the right place even if
 * the url-building rule ever changes.
 *
 * The log path is resolved from `os.homedir()` inside `logFile()`, called
 * fresh on every read rather than cached at module load, so a test that sets
 * `process.env.HOME` (or `SAM_PUSH_LOG`) before importing this module reads
 * its own temp file, never Colin's real `~/.sam/push-log.jsonl`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface NotificationEntry {
  id: string;
  ts: number;
  title: string;
  body: string;
  url: string;
  tag: string;
  chatId: string | null;
  jobId: string | null;
}

function logFile(): string {
  return process.env.SAM_PUSH_LOG || path.join(os.homedir(), '.sam', 'push-log.jsonl');
}

/** Narrows a parsed JSON value to `NotificationEntry`, so a line that parses
 *  but has the wrong shape is skipped the same as one that fails to parse. */
function isNotificationEntry(value: unknown): value is NotificationEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.ts === 'number' &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    typeof v.url === 'string' &&
    typeof v.tag === 'string' &&
    (v.chatId === null || typeof v.chatId === 'string') &&
    (v.jobId === null || typeof v.jobId === 'string')
  );
}

/**
 * Reads the push log, skips any line that fails to parse or does not match
 * `NotificationEntry`, and returns at most `limit` entries, newest first.
 * The file is append-only oldest-first, so reversing it is enough — no
 * re-sort by `ts` is needed (and would misorder same-millisecond entries,
 * since a plain reverse keeps the later-appended one first while a stable
 * sort on equal keys would not).
 */
export function readNotifications(limit = 200): NotificationEntry[] {
  const file = logFile();
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const entries: NotificationEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isNotificationEntry(parsed)) entries.push(parsed);
    } catch {
      // Corrupt line — skipped, not thrown.
    }
  }

  entries.reverse();
  return entries.slice(0, limit);
}

/**
 * Where tapping an entry goes: its chat if it has one, else its job output,
 * else its own Notifications entry (spec must-do 18, 19).
 */
export function notificationTarget(entry: NotificationEntry): string {
  if (entry.chatId) return `/chat?c=${entry.chatId}`;
  if (entry.jobId) return `/jobs/${entry.jobId}`;
  return `/notifications?n=${entry.id}`;
}
