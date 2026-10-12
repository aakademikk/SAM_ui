/**
 * SAM — notification click handling for the service worker (answer buttons, T16).
 *
 * Kept free of `self` and Serwist: sw.ts passes the real globals in as `deps`,
 * and a unit test passes fakes. An empty action (a tap on the body) focuses or
 * opens a window exactly as before. Action `a` or `b` posts the answer from the
 * lock screen without opening the app. The worker keeps no secret; the browser
 * sends the session cookie (same-origin fetch).
 */

export interface ClickWindow {
  url?: string;
  focus(): Promise<unknown>;
  navigate(url: URL): Promise<unknown>;
}

export interface ClickNotification {
  title: string;
  body?: string;
  tag?: string;
  data?: { url?: string; jobId?: string; questionId?: string } & Record<string, unknown>;
  actions?: ReadonlyArray<{ action: string; title: string }>;
  icon?: string;
  badge?: string;
  close(): void;
}

export interface ClickEvent {
  action: string;
  notification: ClickNotification;
  waitUntil(p: Promise<unknown>): void;
}

export interface ClickDeps {
  fetch(input: string, init: RequestInit): Promise<{ status: number; ok: boolean }>;
  showNotification(title: string, options: Record<string, unknown>): Promise<unknown>;
  matchAll(): Promise<ClickWindow[]>;
  openWindow(url: URL): Promise<unknown>;
  origin: string;
}

export const ANSWER_PATH = '/api/questions/answer';

/** The existing body-tap behaviour, moved here unchanged. */
async function openOrFocus(target: string, deps: ClickDeps): Promise<void> {
  const url = new URL(target, deps.origin);
  if (url.origin !== deps.origin) return;

  const wins = await deps.matchAll();

  // Prefer a window already sat on the exact target (path + query) —
  // just focus it. Comparing pathname alone would wrongly treat
  // /chat?c=A and /chat?c=B as the same destination.
  for (const win of wins) {
    if (win.url && new URL(win.url).pathname + new URL(win.url).search === url.pathname + url.search) {
      await win.focus();
      return;
    }
  }

  // Otherwise take the first window and drive it there.
  for (const win of wins) {
    await win.focus();
    if (win.url && new URL(win.url).pathname + new URL(win.url).search !== url.pathname + url.search) {
      await win.navigate(url);
    }
    return;
  }

  // No window open at all.
  await deps.openWindow(url);
}

async function answer(
  answerId: 'a' | 'b',
  jobId: string,
  questionId: string,
  saved: ClickNotification,
  deps: ClickDeps,
): Promise<void> {
  const reshow = () =>
    deps.showNotification(saved.title, {
      body: saved.body,
      tag: saved.tag,
      data: saved.data,
      actions: saved.actions,
      icon: saved.icon,
      badge: saved.badge,
      renotify: false,
    });

  let status: number;
  try {
    const res = await deps.fetch(ANSWER_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-answer-via': 'push' },
      body: JSON.stringify({ jobId, questionId, answer: answerId }),
    });
    status = res.status;
  } catch {
    await reshow();
    return;
  }

  // 2xx done; 404 and 409 mean unknown or already answered: show nothing.
  if (status === 401 || status >= 500) await reshow();
}

export function handleClick(event: ClickEvent, deps: ClickDeps): void {
  const n = event.notification;
  // Copy the fields now; the notification is closed straight after.
  const saved: ClickNotification = {
    title: n.title,
    body: n.body,
    tag: n.tag,
    data: n.data,
    actions: n.actions,
    icon: n.icon,
    badge: n.badge,
    close: () => {},
  };
  const action = event.action || '';
  n.close();

  if (action === '') {
    event.waitUntil(openOrFocus(saved.data?.url || '/', deps));
    return;
  }

  if (action !== 'a' && action !== 'b') return; // unknown button: just closed

  const jobId = saved.data?.jobId;
  const questionId = saved.data?.questionId;
  if (typeof jobId !== 'string' || !jobId || typeof questionId !== 'string' || !questionId) {
    event.waitUntil(openOrFocus(saved.data?.url || '/', deps));
    return;
  }

  event.waitUntil(answer(action, jobId, questionId, saved, deps));
}
