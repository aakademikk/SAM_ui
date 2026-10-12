/**
 * Usage limits: reads what the quota harvester has already written to
 * `~/.sam/quota/runs.jsonl`, plus the newest rate-limit reading in each running
 * job's stream (see `readLiveRows`), and builds the tile's payload. It only
 * reads files. It never starts a Claude run, spawns a process or calls the
 * network (spec U3), so polling it costs nothing.
 *
 * The file grows by about 100 rows a day and is polled every 30 s, so the
 * parsed rows are cached on the file's path, mtime and size.
 */

import fs from 'node:fs';
import path from 'node:path';

import { quotaRunsPath, samStateDir } from '@/lib/server/livePaths';
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

// Rate-limit events are sparse (on 2026-10-12 the newest sat 939 KB from the end of a live stream), so the tail
// read widens from 1 MB to 64 MB until one turns up. Results are cached per stream path and size: the tile polls
// every 30 s and most polls find the stream unchanged.
const STREAM_TAILS = [1, 4, 16, 64].map((mb) => mb * 1024 * 1024);
const liveCache = new Map<string, QuotaRow | null>();

/** The newest `rate_limit_event` in a stream-json tail, as a quota row; null when there is none. */
export function liveRowFromStream(text: string, seat: string, at: string): QuotaRow | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limit_event"')) continue;
    try {
      const ev = JSON.parse(lines[i]) as { rate_limit_info?: { unifiedWindows?: Record<string, unknown> } };
      const w = ev.rate_limit_info?.unifiedWindows ?? {};
      const five = (w.five_hour ?? {}) as Record<string, unknown>;
      const seven = (w.seven_day ?? {}) as Record<string, unknown>;
      const row: QuotaRow = {
        endedAt: at,
        seat,
        fiveHour: num(five.utilization),
        sevenDay: num(seven.utilization),
        fiveHourResetsAt: num(five.resetsAt),
        sevenDayResetsAt: num(seven.resetsAt),
      };
      if (row.fiveHour !== null || row.sevenDay !== null) return row;
    } catch {
      // a line cut by the tail read; try the one before
    }
  }
  return null;
}

/**
 * Live readings from jobs still running (2026-10-12): `runs.jsonl` only gains a row when a job ends, so a long
 * job left the tile hours stale. Each running job's stream carries `rate_limit_event`s; its newest one counts,
 * timed at the stream's last write. The seat is max2 when the job's cmd.sh points at `.claude-max2`.
 */
export function readLiveRows(): QuotaRow[] {
  const root = path.join(samStateDir(), 'jobs');
  const rows: QuotaRow[] = [];
  let ids: string[];
  try {
    ids = fs.readdirSync(root);
  } catch {
    return rows;
  }
  for (const id of ids) {
    const dir = path.join(root, id);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { status?: unknown };
      if (meta.status !== 'running') continue;
      const seat = fs.readFileSync(path.join(dir, 'cmd.sh'), 'utf8').includes('.claude-max2') ? 'max2' : 'main';
      const stream = path.join(dir, 'claude-stream.jsonl');
      const st = fs.statSync(stream);
      const key = `${stream}:${st.size}:${st.mtimeMs}`;
      let row = liveCache.get(key);
      if (row === undefined) {
        row = null;
        const fd = fs.openSync(stream, 'r');
        try {
          for (const tail of STREAM_TAILS) {
            const len = Math.min(st.size, tail);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, st.size - len);
            row = liveRowFromStream(buf.toString('utf8'), seat, new Date(st.mtimeMs).toISOString());
            if (row || len === st.size) break;
          }
        } finally {
          fs.closeSync(fd);
        }
        for (const k of liveCache.keys()) if (k.startsWith(`${stream}:`)) liveCache.delete(k);
        liveCache.set(key, row);
      }
      if (row) rows.push(row);
    } catch {
      // no meta, no cmd.sh or no stream yet: nothing live to read
    }
  }
  return rows;
}

export function getUsage(now: number = Date.now()): UsagePayload {
  return buildUsage([...readQuotaRows(), ...readLiveRows()], now);
}
