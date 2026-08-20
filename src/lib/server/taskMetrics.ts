/**
 * SAM — real task telemetry.
 *
 * Reads Colin's actual priorities file and, since 2026-08-20, writes to it:
 * a dashboard toggle flips the checkbox mark in the vault (`setTaskDone`),
 * so the vault stays the single source of truth and the done-state survives
 * restarts and re-reads. The completion log / custom tasks live separately
 * in taskState.ts.
 */

import fs from 'node:fs';

import type { DailyTask, TaskPriority } from '@/types/dashboard';

const PRIORITIES_PATH = '/home/col/ai-memory-vault/Active Priorities.md';
const CACHE_MS = 8_000;

const SECTION_META: Record<string, { tag: string; priority: TaskPriority }> = {
  Now: { tag: 'now', priority: 'p1' },
  Next: { tag: 'next', priority: 'p2' },
  Later: { tag: 'later', priority: 'p3' },
};

const CHECKBOX_RE = /^-\s*\[( |x|X)\]\s*(.+)$/;

/** Match groups: 1 = `- [`, 2 = mark, 3 = `] `, 4 = body. Preserves spacing. */
const MARK_RE = /^(-\s*\[)( |x|X)(\]\s*)(.+)$/;

function cleanTitle(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/`/g, '')
    .trim();
}

function parsePriorities(text: string): DailyTask[] {
  const now = new Date().toISOString();
  const tasks: DailyTask[] = [];
  let section: string | null = null;
  let index = 0;

  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }

    const match = line.match(CHECKBOX_RE);
    if (!match || !section || !(section in SECTION_META)) continue;

    const [, mark, body] = match;
    const title = cleanTitle(body);
    if (!title) continue;

    const meta = SECTION_META[section];
    tasks.push({
      id: `task_priorities_${index++}`,
      title,
      done: mark.toLowerCase() === 'x',
      priority: meta.priority,
      tag: meta.tag,
      dueAt: null,
      createdAt: now,
      origin: 'operator',
    });
  }

  return tasks;
}

let cached: { at: number; tasks: DailyTask[] } | null = null;

function readNow(): DailyTask[] {
  try {
    const text = fs.readFileSync(PRIORITIES_PATH, 'utf-8');
    return parsePriorities(text);
  } catch {
    return [];
  }
}

/** Cached for CACHE_MS so a burst of concurrent widget polls doesn't re-read the file. */
export function readTasks(): DailyTask[] {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.tasks;
  const tasks = readNow();
  cached = { at: Date.now(), tasks };
  return tasks;
}

/** Drops the readTasks cache so a just-written vault line is seen immediately. */
export function invalidateTasksCache() {
  cached = null;
}

/**
 * Flips the checkbox mark for the vault task matching `task.title` in
 * Active Priorities.md. Best-effort: a title that no longer exists in the file
 * (edited or removed in the vault) is left alone — the in-memory estate still
 * flips for the response, and the next file read settles it.
 */
export function setTaskDone(task: DailyTask, done: boolean): void {
  try {
    const text = fs.readFileSync(PRIORITIES_PATH, 'utf-8');
    const lines = text.split('\n');
    let section: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const heading = lines[i].match(/^##\s+(.+)$/);
      if (heading) {
        section = heading[1].trim();
        continue;
      }
      if (!section || !(section in SECTION_META)) continue;

      const match = lines[i].match(MARK_RE);
      if (!match) continue;
      if (cleanTitle(match[4]) !== task.title) continue;

      lines[i] = `${match[1]}${done ? 'x' : ' '}${match[3]}${match[4]}`;
      fs.writeFileSync(PRIORITIES_PATH, lines.join('\n'), 'utf-8');
      return;
    }
  } catch {
    // Vault write failures are swallowed — the API response still reflects the toggle.
  }
}
