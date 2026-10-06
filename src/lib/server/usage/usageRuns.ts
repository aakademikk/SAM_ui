/**
 * Usage limits: reads what the quota harvester has already written to
 * `~/.sam/quota/runs.jsonl` and builds the tile's payload from it. It only
 * reads that file. It never starts a Claude run, spawns a process or calls the
 * network (spec U3), so polling it costs nothing.
 *
 * The file grows by about 100 rows a day and is polled every 30 s, so the
 * parsed rows are cached on the file's path, mtime and size.
 */

import fs from 'node:fs';

import { quotaRunsPath } from '@/lib/server/livePaths';
import { buildUsage, type QuotaRow } from '@/lib/server/usage/usageReadings';
import type { UsagePayload } from '@/types/usage';

let cache: { key: string; rows: QuotaRow[] } | null = null;

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseRows(text: string): QuotaRow[] {
  const rows: QuotaRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    rows.push({
      endedAt: str(r.endedAt),
      seat: str(r.seat),
      fiveHour: num(r.fiveHour),
      sevenDay: num(r.sevenDay),
      fiveHourResetsAt: num(r.fiveHourResetsAt),
      sevenDayResetsAt: num(r.sevenDayResetsAt),
    });
  }
  return rows;
}

/** The slim rows from the quota log; `[]` when the file is missing or unreadable. */
export function readQuotaRows(): QuotaRow[] {
  const file = quotaRunsPath();
  try {
    const st = fs.statSync(file);
    const key = `${file}:${st.mtimeMs}:${st.size}`;
    if (cache && cache.key === key) return cache.rows;
    const rows = parseRows(fs.readFileSync(file, 'utf8'));
    cache = { key, rows };
    return rows;
  } catch {
    cache = null;
    return [];
  }
}

export function getUsage(now: number = Date.now()): UsagePayload {
  return buildUsage(readQuotaRows(), now);
}
