/**
 * SAM — the logic behind the inline Unlock button (UnlockPrompt.tsx), kept
 * free of React so it is testable under plain `node --test`.
 *
 * UI only: the step-up itself is authService.stepUp(), the same call the
 * sidebar button makes. Nothing here touches the guard or its lifetime.
 */

export const STEP_UP_MESSAGE = 'Biometric unlock required before SAM can run anything.';
export const UNLOCKED_MESSAGE = 'Unlocked, try again.';

/** An error that means "needs a biometric step-up". */
export function isStepUpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'StepUpRequiredError') return true;
  if ((err as { stepUpRequired?: boolean }).stepUpRequired) return true;
  return /step-?up|biometric/i.test(err.message);
}

export interface CallFailure {
  message: string;
  stepUp: boolean;
}

/** Turn a thrown error from a step-up gated call into something to show. */
export function classifyCallError(err: unknown, fallback: string): CallFailure {
  if (isStepUpError(err)) return { message: STEP_UP_MESSAGE, stepUp: true };
  return { message: err instanceof Error ? err.message : fallback, stepUp: false };
}

/** The same, for POST /api/uploads' status and JSON body. */
export function classifyUploadFailure(
  status: number,
  body: { error?: string; stepUpRequired?: boolean },
): CallFailure {
  if (status === 401 && body.stepUpRequired) return { message: STEP_UP_MESSAGE, stepUp: true };
  return { message: body.error ?? `Upload failed (${status})`, stepUp: false };
}

/** The user dismissed the OS/biometric prompt. */
export function isCancel(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotAllowedError';
}

export type UnlockResult =
  | { status: 'retried' }
  | { status: 'unlocked' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
  | { status: 'retry-failed'; message: string };

/**
 * Step up, then run `retry` exactly once. A failed or cancelled step-up never
 * retries. A retry that returns `false` found nothing to retry, so the result
 * is plain 'unlocked' (the caller says "Unlocked, try again").
 */
export async function runUnlock(opts: {
  stepUp: () => Promise<void>;
  retry?: () => Promise<boolean | void>;
}): Promise<UnlockResult> {
  try {
    await opts.stepUp();
  } catch (err) {
    if (isCancel(err)) return { status: 'cancelled' };
    return { status: 'failed', message: (err instanceof Error ? err.message : 'Unlock failed.').slice(0, 120) };
  }
  if (!opts.retry) return { status: 'unlocked' };
  try {
    const did = await opts.retry();
    return did === false ? { status: 'unlocked' } : { status: 'retried' };
  } catch (err) {
    return { status: 'retry-failed', message: err instanceof Error ? err.message : 'Retry failed.' };
  }
}
