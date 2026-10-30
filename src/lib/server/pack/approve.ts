/**
 * SAM — approving the Monday pack's discrepancy set.
 *
 * The web side never writes the approval file. It validates the question id,
 * then runs `pack_approve.py` with execFile (no shell, fixed argument order),
 * which is the only code that records an approval. Same shape as
 * `questions/answer.ts`: exit 2 is "unknown", anything else is "failed".
 */

import { execFile } from 'node:child_process';

import type { AnswerVia } from '../questions/answer';

export const QUESTION_ID = /^q_[0-9a-f]{8}$/;
const DEFAULT_APPROVE_PY = '/home/col/timesheet-automation/work/parkfords-extract/pack_approve.py';
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024;
const PASSED_ENV = ['PATH', 'HOME', 'PF_PACK_DIR'];

export interface ApproveResult {
  questionId: string;
  state: string;
  changed: boolean;
  result: string | null;
}

export interface StatusResult {
  questionId: string;
  state: string;
}

export type RunOutcome<T> = { ok: true; result: T } | { ok: false; kind: 'invalid' | 'failed' };

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSED_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function run<T>(args: string[], read: (parsed: Record<string, unknown>) => T | null): Promise<RunOutcome<T>> {
  const script = process.env.SAM_PACK_APPROVE_PY || DEFAULT_APPROVE_PY;
  return new Promise((resolve) => {
    execFile(
      'python3',
      [script, ...args],
      { env: childEnv() as NodeJS.ProcessEnv, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          const code = (error as { code?: unknown }).code;
          resolve({ ok: false, kind: code === 2 ? 'invalid' : 'failed' });
          return;
        }
        try {
          const line = stdout.trim().split('\n').pop() ?? '';
          const result = read(JSON.parse(line) as Record<string, unknown>);
          resolve(result === null ? { ok: false, kind: 'failed' } : { ok: true, result });
        } catch {
          resolve({ ok: false, kind: 'failed' });
        }
      },
    );
  });
}

/** Record Colin's approval of the pending set behind this question id. */
export function runApprove(questionId: string, via: AnswerVia): Promise<RunOutcome<ApproveResult>> {
  return run([questionId, via], (parsed) => {
    if (typeof parsed.questionId !== 'string' || typeof parsed.state !== 'string') return null;
    return {
      questionId: parsed.questionId,
      state: parsed.state,
      changed: parsed.changed === true,
      result: typeof parsed.result === 'string' ? parsed.result : null,
    };
  });
}

/** Read-only: pending, approved, stale or unknown. */
export function runStatus(questionId: string): Promise<RunOutcome<StatusResult>> {
  return run(['--status', questionId], (parsed) => {
    if (typeof parsed.questionId !== 'string' || typeof parsed.state !== 'string') return null;
    return { questionId: parsed.questionId, state: parsed.state };
  });
}
