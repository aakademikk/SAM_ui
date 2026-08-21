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
  resumeSessionId?: string;
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
      resumeSessionId: params.resumeSessionId,
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
