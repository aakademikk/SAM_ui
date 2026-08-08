/**
 * SAM — real task telemetry.
 *
 * Reads Colin's actual priorities file. Read-only: dashboard mutations
 * (add/toggle/delete) only touch the in-memory estate, not this file —
 * the vault stays the single source of truth and SAM updates it by hand.
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
