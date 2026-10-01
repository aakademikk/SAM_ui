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

export class StepUpRequiredError extends Error {
  constructor() {
    super('Biometric unlock required.');
    this.name = 'StepUpRequiredError';
  }
}

export async function startAgentTurn(params: {
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
}): Promise<StartTurnResult> {
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

  const json = (await response.json()) as { data: StartTurnResult };
  return json.data;
}
