/**
 * SAM — answering a closer question.
 *
 * The web side never writes `closer.json`. It validates the request, then runs
 * `closer_answer.py` with execFile (no shell, fixed argument order) which is the
 * only code that changes a question's state. Gated status is read from the
 * question record here, never from the request.
 */

import { execFile } from 'node:child_process';

import { ANSWER_LETTERS, type AnswerLetter } from '../../answerLetters';
import { readQuestions } from './questions';

const JOB_ID = /^job_[A-Za-z0-9._-]+$/;
const QUESTION_ID = /^q_[0-9a-f]{8}$/;
const DEFAULT_ANSWER_PY = '/home/col/.sam/closer/closer_answer.py';
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024;
const PASSED_ENV = ['PATH', 'HOME', 'SAM_JOB_STORE', 'SAM_DISPATCH_BIN', 'SAM_PUSH_BIN'];

export type AnswerVia = 'push' | 'tab';

export interface AnswerRequest {
  jobId: string;
  questionId: string;
  answer: AnswerLetter;
}

export interface AnswerResult {
  questionId: string;
  state: string;
  changed: boolean;
  result: string | null;
}

export type Checked =
  | { ok: true; request: AnswerRequest; gated: boolean }
  | { ok: false; status: 400 | 404; error: string };

/** Shape checks, then the question must exist in that job's closer.json. */
export function checkAnswer(body: Record<string, unknown>): Checked {
  const { jobId, questionId, answer } = body;
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) {
    return { ok: false, status: 400, error: 'bad jobId' };
  }
  if (typeof questionId !== 'string' || !QUESTION_ID.test(questionId)) {
    return { ok: false, status: 400, error: 'bad questionId' };
  }
  if (typeof answer !== 'string' || !(ANSWER_LETTERS as readonly string[]).includes(answer)) {
    return { ok: false, status: 400, error: 'bad answer' };
  }
  const found = readQuestions([jobId]).find((q) => q.questionId === questionId);
  if (!found) return { ok: false, status: 404, error: 'unknown question' };
  // c to f only mean something on a question that lists that many choices.
  const choices = found.kind === 'choice' ? found.options.length : 2;
  if (ANSWER_LETTERS.indexOf(answer as AnswerLetter) >= choices) {
    return { ok: false, status: 400, error: 'bad answer' };
  }
  return { ok: true, request: { jobId, questionId, answer: answer as AnswerLetter }, gated: found.gated };
}

/** `tab` unless the service worker said `push`. */
export function viaFromHeader(value: string | null): AnswerVia {
  return value === 'push' ? 'push' : 'tab';
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSED_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export type RunOutcome =
  | { ok: true; result: AnswerResult }
  | { ok: false; kind: 'invalid' | 'failed' };

export function runAnswer(req: AnswerRequest, via: AnswerVia): Promise<RunOutcome> {
  const script = process.env.SAM_CLOSER_ANSWER_PY || DEFAULT_ANSWER_PY;
  return new Promise((resolve) => {
    execFile(
      'python3',
      [script, req.jobId, req.questionId, req.answer, via],
      { env: childEnv() as NodeJS.ProcessEnv, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          const code = (error as { code?: unknown }).code;
          resolve({ ok: false, kind: code === 2 ? 'invalid' : 'failed' });
          return;
        }
        try {
          const line = stdout.trim().split('\n').pop() ?? '';
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (typeof parsed.questionId !== 'string' || typeof parsed.state !== 'string') {
            resolve({ ok: false, kind: 'failed' });
            return;
          }
          resolve({
            ok: true,
            result: {
              questionId: parsed.questionId,
              state: parsed.state,
              changed: parsed.changed === true,
              result: typeof parsed.result === 'string' ? parsed.result : null,
            },
          });
        } catch {
          resolve({ ok: false, kind: 'failed' });
        }
      },
    );
  });
}
