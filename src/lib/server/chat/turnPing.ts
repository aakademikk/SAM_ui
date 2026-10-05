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
