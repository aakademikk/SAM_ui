/**
 * SAM — streamTail: bounded tail read of claude-stream.jsonl and the job's
 * last real activity (job ticket panel T7; spec must-do 7, check 5).
 *
 * The stream is 600 KB to 1 MB on a long job, so only the last TAIL_BYTES are
 * ever read. Only assistant and user lines carry "timestamp"; heartbeat
 * tool_progress lines never count as activity. No timestamp in the tail means
 * null (unknown), never the file's modified time.
 */

import { open } from 'node:fs/promises';

export const TAIL_BYTES = 262144;

/** Read at most maxBytes from the end of path; drop the first partial line. Missing file gives []. */
export async function readStreamTail(path: string, maxBytes: number = TAIL_BYTES): Promise<string[]> {
  let fh;
  try {
    fh = await open(path, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = await fh.stat();
    if (size === 0 || maxBytes <= 0) return [];
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const { bytesRead } = await fh.read(buf, got, len - got, start + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line is probably cut mid-way
    return lines.filter((l) => l.trim() !== '');
  } catch {
    return [];
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** Timestamp of the last non-heartbeat line that has one, else null. */
export function lastActivity(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: unknown;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as { heartbeat?: unknown; timestamp?: unknown };
    if (o.heartbeat === true) continue;
    if (typeof o.timestamp === 'string' && o.timestamp !== '') return o.timestamp;
  }
  return null;
}

/** A Bash command counts as a test or build when it contains any of these (job ticket panel T8). */
export const TEST_BUILD_MARKERS: readonly string[] = [
  'npm test',
  'npm run test',
  'npm run build',
  'tsc',
  'vitest',
  'node --test',
  'run-tests',
  'pytest',
  'vite build',
  'next build',
  '/tests/',
  'test-',
  '.test.',
  'node scripts/t-',
];

export const COMMAND_NOT_IN_LOG = '(command not in the recent log)';
const RECENT_FAILED_MAX = 5;
const COMMAND_MAX = 120;

export interface FailedRun {
  command: string;
  exitCode: number;
  timedOut: boolean;
  at: string | null;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .join('');
  }
  return '';
}

/**
 * Failed test and build runs within the tail: Bash results beginning "Exit code N" (N not 0)
 * whose command is a test or build. A result whose tool_use is outside the tail cannot be
 * ruled out, so it counts with a placeholder command. Newest first, at most 5 listed.
 */
export function failedRuns(lines: string[]): { count: number; recent: FailedRun[] } {
  const commands = new Map<string, string>();
  const found: FailedRun[] = [];
  for (const raw of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as { type?: unknown; timestamp?: unknown; message?: { content?: unknown } };
    const blocks = o.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const blk = b as { type?: unknown; id?: unknown; name?: unknown; input?: { command?: unknown }; tool_use_id?: unknown; content?: unknown };
      if (blk.type === 'tool_use' && typeof blk.id === 'string') {
        if (typeof blk.input?.command === 'string') commands.set(blk.id, blk.input.command);
      } else if (blk.type === 'tool_result') {
        const m = /^Exit code (\d+)/.exec(resultText(blk.content));
        if (!m) continue;
        const exitCode = Number(m[1]);
        if (exitCode === 0) continue;
        const cmd = typeof blk.tool_use_id === 'string' ? commands.get(blk.tool_use_id) : undefined;
        if (cmd !== undefined && !TEST_BUILD_MARKERS.some((k) => cmd.includes(k))) continue;
        const command = cmd === undefined ? COMMAND_NOT_IN_LOG : cmd.replace(/\s+/g, ' ').trim().slice(0, COMMAND_MAX);
        found.push({
          command,
          exitCode,
          timedOut: exitCode === 124 || exitCode === 143,
          at: typeof o.timestamp === 'string' && o.timestamp !== '' ? o.timestamp : null,
        });
      }
    }
  }
  return { count: found.length, recent: found.slice(-RECENT_FAILED_MAX).reverse() };
}
