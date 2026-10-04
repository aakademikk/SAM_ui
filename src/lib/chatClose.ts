/**
 * SAM — how a chat run's closing stream event reads in the transcript.
 *
 * Only 'exited' means the agent finished a turn. 'lost' (connection dropped),
 * 'killed' (service restarted under the run) and 'unauthorized' (the session
 * expired or was revoked mid-turn — the job keeps running server-side, only
 * this device's view of it is cut off) all leave a reply that is partial, and
 * each says so in an error block instead of passing the partial text off as a
 * finished answer. A cut-off reply is never spoken.
 */

import type { ChatBlock } from '@/types/chat';

export type CloseStatus = 'exited' | 'killed' | 'lost' | 'unauthorized';

export const SIGNED_OUT_NOTICE =
  'You were signed out before this reply finished, so it is cut off. Sign in again and reopen this chat to see the rest.';
const LOST_NOTICE = 'Lost connection to this run.';
const INTERRUPTED_NOTICE = 'This run was interrupted — the service restarted. Send your message again.';

export interface CloseTail {
  blocks: ChatBlock[];
  /** True when the reply is a whole answer that may be read aloud. */
  complete: boolean;
  /** True when the notice replaces the parser's "exited with code" error. */
  suppressExitError: boolean;
}

/** What the close says about the run, before the parser has finished it. */
export function closeKind(status: CloseStatus, stopInitiated: boolean) {
  const lost = status === 'lost';
  const signedOut = status === 'unauthorized';
  const selfStopped = status === 'killed' && stopInitiated;
  const interrupted = status === 'killed' && !stopInitiated;
  return { lost, signedOut, selfStopped, interrupted, suppressExitError: lost || selfStopped || signedOut };
}

/** The notice block for a cut-off reply, or null when the run ended on its own. */
export function cutOffNotice(status: CloseStatus, stopInitiated: boolean): ChatBlock | null {
  const k = closeKind(status, stopInitiated);
  if (k.lost) return { kind: 'error', text: LOST_NOTICE };
  if (k.signedOut) return { kind: 'error', text: SIGNED_OUT_NOTICE };
  if (k.interrupted) return { kind: 'error', text: INTERRUPTED_NOTICE };
  return null;
}
