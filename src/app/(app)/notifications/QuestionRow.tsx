/**
 * The question part of a Notifications row (answer buttons, spec must-do 16).
 *
 * Open: the question text with one button per choice, two to six (a gated one
 * shows Open first, and the buttons appear after the biometric step-up). Answered: "Accepted" or
 * "Declined" with the time and result, no buttons. Failed: the reason. A press
 * POSTs /api/questions/answer and the row updates from the response, no reload.
 */

'use client';

import { useState } from 'react';

import { authService } from '@/lib/authService';
import { viewOfQuestion, type QuestionLike } from '@/lib/questionView';
import { ANSWER_LETTERS, type AnswerLetter } from '@/lib/answerLetters';
import { cn } from '@/lib/utils';

const BUTTON =
  'min-h-[44px] min-w-[44px] flex-1 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-50';
// Three or more choices wrap two to a row on a phone; a long label wraps inside its button.
const BUTTON_MANY = 'min-w-[calc(50%-0.25rem)] break-words py-2';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function QuestionRow({ question }: { question: QuestionLike }) {
  const [current, setCurrent] = useState<QuestionLike>(question);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const view = viewOfQuestion(current);
  if (view.state === 'none') return null;

  async function unlock() {
    setBusy(true);
    setMessage(null);
    try {
      await authService.stepUp();
      setUnlocked(true);
    } catch {
      setMessage('Biometric check did not complete.');
    } finally {
      setBusy(false);
    }
  }

  async function press(answer: AnswerLetter) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/questions/answer', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: current.jobId, questionId: current.questionId, answer }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { state?: string; result?: string | null };
        stepUpRequired?: boolean;
      };
      if (res.status === 401 && json.stepUpRequired) {
        setUnlocked(false);
        setMessage('Biometric unlock needed.');
        return;
      }
      if (!res.ok || !json.data || typeof json.data.state !== 'string') {
        setMessage(`Could not send (${res.status}).`);
        return;
      }
      const { state, result } = json.data;
      setCurrent((prev) => ({
        ...prev,
        state,
        result: typeof result === 'string' ? result : null,
        answeredAt: prev.answeredAt ?? new Date().toISOString(),
        answeredVia: prev.answeredVia ?? 'tab',
      }));
    } catch {
      setMessage('Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (view.state === 'open' || view.state === 'gated-open') {
    const showButtons = view.state === 'open' || unlocked;
    return (
      <div className="px-4 pb-3 bg-void-900/60 space-y-2" data-question-state={view.state}>
        <p className="text-sm text-void-100 break-words" data-role="question-text">{view.label}</p>
        <div className="flex flex-wrap gap-2" data-role="question-buttons">
          {showButtons ? (
            view.buttons.map((label, i) => (
              <button
                key={ANSWER_LETTERS[i]}
                type="button"
                disabled={busy}
                onClick={() => void press(ANSWER_LETTERS[i])}
                className={cn(
                  BUTTON,
                  view.buttons.length > 2 && BUTTON_MANY,
                  i === 0
                    ? 'border-accent/40 bg-accent/20 text-accent hover:bg-accent/30'
                    : 'border-void-700 text-void-100 hover:bg-void-900',
                )}
              >
                {label}
              </button>
            ))
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void unlock()}
              className={cn(BUTTON, 'border-accent/40 bg-accent/20 text-accent hover:bg-accent/30')}
            >
              Open
            </button>
          )}
        </div>
        {message && <p className="text-xs text-alarm-400">{message}</p>}
      </div>
    );
  }

  const answered = when(view.answeredAt);
  return (
    <div className="px-4 pb-3 bg-void-900/60 space-y-0.5" data-question-state={view.state}>
      {view.state === 'failed' ? (
        <p className="text-sm text-alarm-400" data-role="question-outcome">{view.label}</p>
      ) : (
        <>
          <p className="text-sm font-medium text-void-100" data-role="question-outcome">
            {view.label}
            {answered && <span className="ml-2 text-[12px] font-mono text-dim-500">{answered}</span>}
          </p>
          {view.detail && view.detail !== view.label && (
            <p className="text-xs text-dim-400">{view.detail}</p>
          )}
        </>
      )}
    </div>
  );
}
