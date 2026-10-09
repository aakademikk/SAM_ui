/**
 * SAM — how a Notifications row looks when its ping asked a question
 * (answer buttons, spec must-do 16).
 *
 * Pure: joins a push-log entry to the question it carries (by `questionId`)
 * and decides which of six states the row is in. Dependency-free so the
 * client page and the unit test share it.
 */

/** What the row needs from a push-log entry. */
export interface QuestionEntryLike {
  id: string;
  questionId?: string | null;
}

/** Mirrors `QuestionView` in `src/lib/server/questions/questions.ts`. */
export interface QuestionLike {
  questionId: string;
  jobId: string;
  kind: string;
  text: string;
  options: string[];
  gated: boolean;
  state: string;
  answeredAt: string | null;
  answeredVia: string | null;
  result: string | null;
}

export type RowState = 'open' | 'gated-open' | 'accepted' | 'declined' | 'failed' | 'none';

export interface RowView {
  state: RowState;
  /** The words for the row: the question while open, else the outcome. */
  label: string;
  /** Button labels for an open row ([] otherwise). a first, then b. */
  buttons: string[];
  /** The `result` line to show under an answered or failed row, or null. */
  detail: string | null;
  /** When it was answered, ISO, or null. */
  answeredAt: string | null;
  question: QuestionLike | null;
}

const NONE: RowView = {
  state: 'none',
  label: '',
  buttons: [],
  detail: null,
  answeredAt: null,
  question: null,
};

/** Finds the question an entry points at, or null. */
export function questionFor(
  entry: QuestionEntryLike,
  questions: readonly QuestionLike[],
): QuestionLike | null {
  if (!entry.questionId) return null;
  return questions.find((q) => q.questionId === entry.questionId) ?? null;
}

function buttonLabels(q: QuestionLike): string[] {
  if (q.kind === 'choice2' && q.options.length === 2) return [q.options[0], q.options[1]];
  return ['Accept', 'Decline'];
}

/** Decides a row's state from the question itself. */
export function viewOfQuestion(q: QuestionLike): RowView {
  switch (q.state) {
    case 'open':
      return {
        state: q.gated ? 'gated-open' : 'open',
        label: q.text,
        buttons: buttonLabels(q),
        detail: null,
        answeredAt: null,
        question: q,
      };
    case 'accepted':
      return { state: 'accepted', label: 'Accepted', buttons: [], detail: q.result, answeredAt: q.answeredAt, question: q };
    case 'declined':
      return { state: 'declined', label: 'Declined', buttons: [], detail: q.result, answeredAt: q.answeredAt, question: q };
    case 'failed':
      return {
        state: 'failed',
        label: q.result && q.result.length > 0 ? q.result : 'Failed',
        buttons: [],
        detail: q.result,
        answeredAt: q.answeredAt,
        question: q,
      };
    default:
      return NONE;
  }
}

/** Joins an entry to its question and decides the row. No question, or one
 *  in a state this page does not know: `none` (the plain link row). */
export function rowView(entry: QuestionEntryLike, questions: readonly QuestionLike[]): RowView {
  const q = questionFor(entry, questions);
  return q ? viewOfQuestion(q) : NONE;
}
