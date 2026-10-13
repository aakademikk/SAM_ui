/**
 * SAM — the work area's recent-items record.
 *
 * One JSON line per item per finished reply, appended to
 * `~/.sam/work-area/recent.jsonl`. `recordTurnItems` is an exit hook; it never
 * throws. `readRecent` serves the Recent list: newest first, one entry per
 * path, flagged `missing` when the file has moved or gone. Neither audits.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { AgentStreamParser } from '@/lib/agentStream';
import type { TurnExitEvent } from '@/lib/server/chat/startTurn';
import { readFrames } from '@/lib/server/jobs/manager';
import { recentItemsPath, vaultDir } from '@/lib/server/livePaths';
import { resolveVaultFile } from '@/lib/server/vaultFiles';
import { metaFor } from '@/lib/server/vaultMeta';
import { fileName, parseMarkers } from '@/lib/workItems';

/** Readers look at no more than this much of the record's tail. */
export const RECENT_READ_BYTES = 262_144;

export interface RecentEntry {
  path: string;
  chatId: string;
  messageId: string;
  at: string;
  title: string;
  missing: boolean;
}

interface RecentLine {
  at: string;
  path: string;
  chatId: string;
  messageId: string;
  title: string;
}

function hostOf(address: string): string {
  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}

/** Every text block of the finished turn, joined, read the way the chat UI reads it. */
async function replyText(jobId: string, exitCode: number | null): Promise<string> {
  const frames = await readFrames(jobId);
  const raw = Buffer.concat(frames.map((f) => f.data));
  const parser = new AgentStreamParser();
  parser.push(raw.toString('utf8'));
  const state = parser.finish(exitCode);
  return state.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('\n');
}

export async function recordTurnItems(event: TurnExitEvent): Promise<void> {
  try {
    const text = await replyText(event.jobId, event.exitCode);
    const { markers } = parseMarkers(text, vaultDir());
    if (markers.length === 0) return;
    const seen = new Set<string>();
    const at = new Date().toISOString();
    let out = '';
    for (const m of markers) {
      if (seen.has(m.target)) continue;
      seen.add(m.target);
      let title: string;
      if (m.isWeb) {
        title = hostOf(m.target);
      } else {
        // metaFor audits a refusal; a marker that no longer resolves is recorded unaudited.
        const r = await resolveVaultFile(m.target);
        title = r.ok ? ((await metaFor(m.target)).title ?? fileName(m.target)) : fileName(m.target);
      }
      const line: RecentLine = { at, path: m.target, chatId: event.chatId, messageId: event.jobId, title };
      out += JSON.stringify(line) + '\n';
    }
    if (!out) return;
    const file = recentItemsPath();
    const dir = path.dirname(file);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await fsp.chmod(dir, 0o700); // mkdir's mode is masked by the umask
    await fsp.appendFile(file, out, { mode: 0o600 });
  } catch (err) {
    console.error('[work-area] recording recent items failed:', err);
  }
}

async function readTail(file: string): Promise<string> {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
  } catch {
    return '';
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - RECENT_READ_BYTES);
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl < 0 ? '' : text.slice(nl + 1);
    }
    return text;
  } finally {
    await fh.close();
  }
}

export async function readRecent(limit = 20): Promise<RecentEntry[]> {
  try {
    const text = await readTail(recentItemsPath());
    const lines = text.split('\n').filter(Boolean);
    const picked: RecentLine[] = [];
    const seen = new Set<string>();
    for (let i = lines.length - 1; i >= 0 && picked.length < limit; i--) {
      let row: Partial<RecentLine>;
      try {
        row = JSON.parse(lines[i]) as Partial<RecentLine>;
      } catch {
        continue;
      }
      if (typeof row.path !== 'string' || !row.path || seen.has(row.path)) continue;
      seen.add(row.path);
      picked.push({
        at: String(row.at ?? ''),
        path: row.path,
        chatId: String(row.chatId ?? ''),
        messageId: String(row.messageId ?? ''),
        title: String(row.title ?? fileName(row.path)),
      });
    }
    return await Promise.all(
      picked.map(async (r) => ({
        ...r,
        missing: /^https?:\/\//i.test(r.path) ? false : !(await resolveVaultFile(r.path)).ok,
      })),
    );
  } catch {
    return [];
  }
}

export type LabelledRecent = RecentEntry & { chatTitle: string; project: string };

/** First one or two vault path parts: `02 - Atwood Systems/<folder>` or `03 - Personal/<folder>`, else the first part. */
export function projectOf(p: string): string {
  if (/^https?:\/\//i.test(p)) return '';
  const parts = p.split('/').filter(Boolean);
  if (parts.length > 2 && (parts[0] === '02 - Atwood Systems' || parts[0] === '03 - Personal')) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? '';
}

/** Adds the chat's title (`Chat` when the chat is deleted or missing) and the project to each entry. */
export function labelRecent(
  entries: RecentEntry[],
  getTitle: (chatId: string) => string | null | undefined,
): LabelledRecent[] {
  return entries.map((e) => {
    let t: string | null | undefined;
    try {
      t = getTitle(e.chatId);
    } catch {
      t = null;
    }
    return { ...e, chatTitle: t && t.trim() ? t : 'Chat', project: projectOf(e.path) };
  });
}
