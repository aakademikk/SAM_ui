/**
 * SAM — turns a push payload into the title and options for showNotification.
 *
 * Kept free of `self` and Serwist so a unit test can import it; src/app/sw.ts
 * calls it from the push handler. A question push carries up to two action
 * buttons (`a` and `b`); anything else in `actions` is dropped.
 */

export const MAX_ACTIONS = 2;
export const MAX_ACTION_TITLE = 20;

const QUESTION_ID = /^q_[0-9a-f]{8}$/;
const JOB_ID = /^job_[A-Za-z0-9._-]+$/;

export interface PushAction {
  action: 'a' | 'b';
  title: string;
}

export interface NotificationData {
  url: string;
  questionId?: string;
  jobId?: string;
  ts: number;
}

export interface BuiltNotification {
  title: string;
  options: {
    body: string;
    tag: string;
    data: NotificationData;
    actions: PushAction[];
    icon: string;
    badge: string;
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function cleanActions(raw: unknown): PushAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PushAction[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ACTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const { action, title } = item as { action?: unknown; title?: unknown };
    if (action !== 'a' && action !== 'b') continue;
    if (typeof title !== 'string' || !title) continue;
    if (out.some((o) => o.action === action)) continue;
    out.push({ action, title: title.slice(0, MAX_ACTION_TITLE) });
  }
  return out;
}

export function buildNotification(payload: unknown, now: number = Date.now()): BuiltNotification {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  const questionId =
    typeof p.questionId === 'string' && QUESTION_ID.test(p.questionId) ? p.questionId : undefined;
  const jobId = typeof p.jobId === 'string' && JOB_ID.test(p.jobId) ? p.jobId : undefined;

  let url = str(p.url);
  if (!url) url = questionId && jobId ? `/jobs/${jobId}` : '/';

  const tag = questionId ? `q-${questionId}` : (str(p.tag) ?? 'sam');

  const data: NotificationData = { url, ts: now };
  if (questionId) data.questionId = questionId;
  if (jobId) data.jobId = jobId;

  return {
    title: str(p.title) ?? 'SAM',
    options: {
      body: typeof p.body === 'string' ? p.body : '',
      tag,
      data,
      actions: cleanActions(p.actions),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    },
  };
}
