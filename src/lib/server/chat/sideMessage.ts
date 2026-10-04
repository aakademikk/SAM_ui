/**
 * SAM — deliver a side message into a chat's already-running turn.
 *
 * Spec must-do 2, 3, 6, 7, 12. A side message is input to the turn already
 * running in a chat, never a second turn: `chat.runningJobId` names it, and
 * `JobManager.deliverSideMessage` (T2) is the one place that guarantees two
 * side messages — even from different devices, even fired without awaiting
 * one before the other — reach the turn's stdin in the order the server
 * received the calls, never interleaved. It also reports `false` when the
 * job is not live in this process — exactly the "sam-ui restarted mid-turn"
 * case (a reattached job is tracked by `watchOrphan`'s polling, never
 * re-added to `JobManager`'s own job map, so it has no stdin handle), which
 * is reported here as "the turn can no longer take side messages" rather
 * than silently doing nothing.
 *
 * This module also owns the stdin-close trigger T4 stubbed out: a Max/Max2
 * turn's stdin must close once the turn is truly done, but not while a side
 * message is still in flight for that job — `onResultSeen` is called from
 * `startTurn.ts`'s `onOutputChunk` for every `result` line (including a
 * second, post-side-message result), and only closes stdin once the short
 * grace window elapses with nothing pending.
 */

import { getJobManager } from '@/lib/server/jobs/manager';

import { getChat } from './chatStore';
import { recordSideMessageSent } from './sideMessageLog';
import { streamJsonUserLine } from './streamInput';

const CLOSE_DELAY_MS = 300;

interface JobCloseState {
  /** How many `sendSideMessage` calls for this job are currently writing. */
  pending: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const jobStates = new Map<string, JobCloseState>();

function stateFor(jobId: string): JobCloseState {
  let state = jobStates.get(jobId);
  if (!state) {
    state = { pending: 0, timer: null };
    jobStates.set(jobId, state);
  }
  return state;
}

/**
 * Called for every `result` line seen on a Max/Max2 turn's stdout
 * (`startTurn.ts`'s `onOutputChunk`). Reschedules that job's close-stdin
 * timer; the timer only actually closes stdin once it elapses with no side
 * message in flight for this job, so a message delivered in the gap between
 * the result landing and the timer firing is never raced out of the turn.
 */
export function onResultSeen(jobId: string): void {
  const state = stateFor(jobId);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.pending === 0) {
      getJobManager().closeStdin(jobId);
      jobStates.delete(jobId);
    }
  }, CLOSE_DELAY_MS);
}

export interface SendSideMessageInput {
  chatId: string;
  text: string;
  /** Human-readable device name, from the step-up payload. */
  device: string;
}

export type SendSideMessageResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Deliver one side message into `chatId`'s running turn.
 *
 * Mirrors `startTurn.ts`'s own tier resolution for a resumed chat (an
 * `unknown`-tier chat runs on whichever account its transcript belongs to),
 * so a side message sent into an imported, pre-tier chat resolves the same
 * tier that chat's own turns already run on.
 */
export async function sendSideMessage(input: SendSideMessageInput): Promise<SendSideMessageResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, status: 400, error: 'text is required.' };

  const chat = getChat(input.chatId);
  if (!chat) return { ok: false, status: 404, error: 'Chat not found.' };

  const tier = chat.tier === 'unknown' ? (chat.account === 'max2' ? 'max2' : 'max') : chat.tier;
  if (tier !== 'max' && tier !== 'max2') {
    return { ok: false, status: 400, error: 'Side messages are only supported on the Max tiers.' };
  }

  const jobId = chat.runningJobId;
  if (!jobId) return { ok: false, status: 409, error: 'No turn is running in this chat.' };

  const state = stateFor(jobId);
  state.pending++;
  try {
    const ok = await getJobManager().deliverSideMessage(
      jobId,
      streamJsonUserLine(text),
      JSON.stringify({ type: 'sam_side', message: { content: [{ type: 'text', text }] } }) + '\n',
    );
    if (!ok) {
      return { ok: false, status: 409, error: 'This turn can no longer take side messages.' };
    }
    recordSideMessageSent(input.chatId, text);
    return { ok: true };
  } finally {
    state.pending--;
  }
}
