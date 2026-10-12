/**
 * SAM — ticket-job resolver (job ticket panel, T3).
 *
 * Decides from a job folder whether the job is a ticket job and where its
 * tickets file is. Reads `brief.md` first, else the file `meta.closerCtx.brief`
 * points at, and resolves any `implementation/<name>-tickets.md` it mentions
 * against `meta.closerCtx.cwd`. The first mentioned path that exists wins.
 *
 * A mentioned path that does not exist is `missing` only when the job is a
 * build (`closerCtx.task` is `build`); a ticket-writing brief names a file that
 * is not there yet, so that case is `none`.
 *
 * Spec: must-do 1, 9, 10; check 7.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type TicketJob =
  | { kind: 'none' }
  | { kind: 'ok'; ticketsPath: string }
  | { kind: 'missing'; ticketsPath: string };

const TICKETS_PATH = /implementation\/[A-Za-z0-9._-]+-tickets\.md/g;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function resolveTicketJob(jobDir: string): Promise<TicketJob> {
  let ctx: { cwd?: unknown; brief?: unknown; task?: unknown } = {};
  const metaText = await readText(join(jobDir, 'meta.json'));
  if (metaText !== null) {
    try {
      const meta = JSON.parse(metaText) as { closerCtx?: typeof ctx } | null;
      if (meta && typeof meta.closerCtx === 'object' && meta.closerCtx) ctx = meta.closerCtx;
    } catch {
      /* unreadable meta: treat as no context */
    }
  }

  let brief = await readText(join(jobDir, 'brief.md'));
  if (brief === null && typeof ctx.brief === 'string' && ctx.brief) {
    brief = await readText(ctx.brief);
  }
  if (brief === null) return { kind: 'none' };

  const mentions = [...new Set(brief.match(TICKETS_PATH) ?? [])];
  if (mentions.length === 0 || typeof ctx.cwd !== 'string' || !ctx.cwd) return { kind: 'none' };

  const paths = mentions.map((m) => resolve(ctx.cwd as string, m));
  for (const p of paths) {
    if (await isFile(p)) return { kind: 'ok', ticketsPath: p };
  }
  return ctx.task === 'build' ? { kind: 'missing', ticketsPath: paths[0] } : { kind: 'none' };
}
