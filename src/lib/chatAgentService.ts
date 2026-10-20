/**
 * SAM — Agent chat client.
 *
 * Starting a turn returns a job id; output is consumed through the existing
 * job SSE stream, so a dropped connection resumes the same way a terminal
 * job does.
 */

import type { TierId, TierInfo } from '@/types/chat';

export interface StartTurnResult {
  jobId: string;
  /** The chat this turn ran in — the new chat's id when none was passed. */
  chatId: string;
  tier: TierInfo;
}

/**
 * T10 (audit B-01/B-03): the chat's context had reached 400k, so the server
 * started a handoff instead of running the message. There is deliberately no
 * `jobId`: `memoJobId` is SAM writing the handoff memo, not the reply, and
 * must not be streamed into the chat as one. The message waits on the server
 * for the new chat's first turn; follow the chat's `handedOffTo` exactly as
 * after a manual handoff.
 */
export interface AutoHandoffStart {
  autoHandoff: true;
  memoJobId: string;
  /** The OLD chat, the one being handed off. */
  chatId: string;
  tier: TierInfo;
}

export function isAutoHandoffStart(
  started: StartTurnResult | AutoHandoffStart,
): started is AutoHandoffStart {
  return (started as AutoHandoffStart).autoHandoff === true;
}

interface StartAgentTurnParams {
  message: string;
  tier: TierId;
  /** The chat to continue; omit to start a new chat. */
  chatId?: string;
  /**
   * Uploaded files: the absolute path returned by POST /api/uploads plus the
   * name to show for it. The name rides along so the agent sees what Colin
   * called the file rather than a generated one. The server re-validates both.
   */
  attachments?: { path: string; name: string }[];
  signal?: AbortSignal;
  /**
   * T10: set only by a caller that follows an automatic handoff (the chat
   * page). Without it a turn always runs normally, whatever the context size.
   */
  autoHandoff?: boolean;
}

export class StepUpRequiredError extends Error {
  constructor() {
    super('Biometric unlock required.');
    this.name = 'StepUpRequiredError';
  }
}

export async function startAgentTurn(
  params: StartAgentTurnParams & { autoHandoff: true },
): Promise<StartTurnResult | AutoHandoffStart>;
export async function startAgentTurn(
  params: StartAgentTurnParams & { autoHandoff?: false },
): Promise<StartTurnResult>;
export async function startAgentTurn(
  params: StartAgentTurnParams,
): Promise<StartTurnResult | AutoHandoffStart> {
  const response = await fetch('/api/chat/agent', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    signal: params.signal,
    body: JSON.stringify({
      message: params.message,
      tier: params.tier,
      chatId: params.chatId,
      attachments: params.attachments,
      ...(params.autoHandoff ? { autoHandoff: true } : {}),
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      stepUpRequired?: boolean;
    };
    if (response.status === 401 && body.stepUpRequired) throw new StepUpRequiredError();
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }

  const json = (await response.json()) as { data: StartTurnResult | AutoHandoffStart };
  return json.data;
}
