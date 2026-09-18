/**
 * SAM — practice agent client.
 *
 * Opening a session and every following turn both return a job id; the output
 * is consumed through the job SSE stream, so a dropped connection on the phone
 * resumes the same way the chat does.
 *
 * No step-up equivalent of `StepUpRequiredError` here: this route is gated on
 * the session cookie alone, because a roleplay turn with no tools cannot act.
 */

import type { PracticeBrief, PracticeBriefsResult, PracticeTurnResult } from '@/types/practice';

async function postTurn(
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<PracticeTurnResult> {
  const response = await fetch('/api/practice/turn', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    signal,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  const json = (await response.json()) as { data: PracticeTurnResult };
  return json.data;
}

/** The scenarios on disk, newest set as written. */
export async function listBriefs(signal?: AbortSignal): Promise<PracticeBrief[]> {
  const response = await fetch('/api/practice/briefs', {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Could not load briefs (${response.status})`);
  const json = (await response.json()) as { data: PracticeBriefsResult };
  return json.data.briefs;
}

/** Open a rehearsal: the first message of the session is the brief itself. */
export function startSession(brief: string, signal?: AbortSignal): Promise<PracticeTurnResult> {
  return postTurn({ brief }, signal);
}

/** One turn, resuming the session the character is already in. */
export function sendTurn(
  sessionId: string,
  brief: string,
  message: string,
  signal?: AbortSignal,
): Promise<PracticeTurnResult> {
  return postTurn({ sessionId, brief, message }, signal);
}
