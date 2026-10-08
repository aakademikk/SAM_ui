/**
 * SAM — ping when an off-screen chat finishes a turn.
 *
 * Spec must-do 7a, 15; check 5a. Registered as a `startTurn.ts` exit hook
 * (T5's `onTurnExit`), alongside T7's title hook. Colin gets a ping that
 * opens the chat only when the chat that just finished was NOT on screen
 * anywhere (`focus.ts`'s 45s rule) — the whole point being: a chat he is
 * already looking at never pings him about its own answer.
 *
 * T18's handoff memo turn is a turn the server started on itself, not
 * something Colin is reading; it is marked `internal` on the exit event so
 * it never pings here — its continuation chat pings on its own first turn
 * instead, same as any other chat.
 *
 * Delivery is `sam-push` itself (T9, staged as `send.next.mjs` until T21
 * installs it) — this module only decides WHETHER to ping and what to say,
 * then spawns it detached and swallows every error: a ping failing must
 * never affect the turn that already finished, or the next one.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { readFrames } from '@/lib/server/jobs/manager';
import { AgentStreamParser } from '@/lib/agentStream';
import { spokenText } from '@/types/chat';

import { isOnScreen } from './focus';
import type { TurnExitEvent } from './startTurn';

/** Longest slice of the answer that goes into the push body. */
const ANSWER_CHARS = 100;

/** A reply ping is only worth a buzz when the turn took this long. */
export const REPLY_PING_MIN_MS = 300_000; // 5 minutes (Colin 2026-10-08; was 2)

/** `SAM_REPLY_PING_MIN_MS` overrides the threshold; read per call so tests can set it. */
export function replyPingMinMs(): number {
  const raw = process.env.SAM_REPLY_PING_MIN_MS;
  if (raw === undefined || raw.trim() === '') return REPLY_PING_MIN_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : REPLY_PING_MIN_MS;
}

/** Failed turns always ping; a clean one only when it ran past the threshold. */
export function shouldPingReply(event: TurnExitEvent, now: number = Date.now()): boolean {
  if (event.exitCode !== 0) return true;
  const started = event.record?.startedAt ? Date.parse(event.record.startedAt) : NaN;
  if (!Number.isFinite(started)) return true;
  const ended = event.record?.endedAt ? Date.parse(event.record.endedAt) : NaN;
  return (Number.isFinite(ended) ? ended : now) - started >= replyPingMinMs();
}

export function pushBin(): string {
  return process.env.SAM_PUSH_BIN ?? path.join(os.homedir(), '.local', 'bin', 'sam-push');
}

/**
 * Re-parses a finished turn's job output the same way the chat UI does
 * (`AgentStreamParser`, fed the whole stream then `finish()`), and returns
 * the spoken answer (`spokenText` — the last text block, never the tool
 * narration before it). The whole buffer is decoded at once rather than
 * frame-by-frame, so a multi-byte character split across two written
 * frames is never mangled.
 */
async function answerFor(jobId: string, exitCode: number | null): Promise<string> {
  const frames = await readFrames(jobId);
  const raw = Buffer.concat(frames.map((f) => f.data));
  const parser = new AgentStreamParser();
  parser.push(raw.toString('utf8'));
  const state = parser.finish(exitCode);
  return spokenText({ id: jobId, role: 'assistant', blocks: state.blocks, done: true });
}

function sendPing(chatId: string, body: string): void {
  const args = [
    '--title',
    'SAM replied',
    '--body',
    body,
    '--url',
    `/chat?c=${chatId}`,
    '--chat',
    chatId,
    '--tag',
    `chat-${chatId}`,
  ];
  try {
    const child = spawn(pushBin(), args, { detached: true, stdio: 'ignore' });
    // A push failure is never the chat turn's problem.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Swallowed — see the module comment.
  }
}

/**
 * The exit hook itself. `startTurn.ts` pushes this onto `onTurnExit`.
 */
export async function pingOffScreenChat(event: TurnExitEvent): Promise<void> {
  if (event.internal) return;
  if (isOnScreen(event.chatId)) return;
  if (!shouldPingReply(event)) return;

  const title = event.chat?.title ?? 'Chat';
  let body = title;
  try {
    const answer = await answerFor(event.jobId, event.exitCode);
    if (answer) body = `${title}: ${answer.slice(0, ANSWER_CHARS)}`;
  } catch {
    // Use the title alone (see the module comment).
  }

  sendPing(event.chatId, body);
}
