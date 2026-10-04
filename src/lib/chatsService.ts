/**
 * SAM — Chats client: list, open, archive, restore, delete, adopt, handoff.
 *
 * Every read comes from the server (spec must-do 4, 5) — phone and PC always
 * see the same list and history, so these wrappers take no device input of
 * their own; they just call the API and unwrap its envelope. In the style of
 * chatAgentService.ts: a 401 with `stepUpRequired` becomes
 * `StepUpRequiredError` so a caller can prompt for biometric unlock instead
 * of showing a generic failure. Reused from chatAgentService.ts rather than
 * redefined here, so callers can check either wrapper's rejection with one
 * `instanceof`.
 */

import { StepUpRequiredError } from '@/lib/chatAgentService';
import type { ChatMessage, ChatRecord, ChatSummary, TierId } from '@/types/chat';

export { StepUpRequiredError };

export interface OpenChatResult {
  chat: ChatRecord;
  messages: ChatMessage[];
  runningJobId: string | null;
  /** The in-flight turn's prompt text (review finding 7) — set whenever a
   *  turn is running and its job is still found live server-side. */
  pendingPrompt?: string;
}

interface ErrorBody {
  error?: string;
  stepUpRequired?: boolean;
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    if (response.status === 401 && body.stepUpRequired) throw new StepUpRequiredError();
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  const json = (await response.json()) as { data: T };
  return json.data;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  return unwrap<T>(response);
}

async function send<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(response);
}

export function listChats(options: { archived?: boolean; q?: string } = {}): Promise<ChatSummary[]> {
  const params = new URLSearchParams();
  if (options.archived) params.set('archived', '1');
  if (options.q) params.set('q', options.q);
  const qs = params.toString();
  return getJson<ChatSummary[]>(`/api/chats${qs ? `?${qs}` : ''}`);
}

export function openChat(id: string): Promise<OpenChatResult> {
  return getJson<OpenChatResult>(`/api/chats/${encodeURIComponent(id)}`);
}

export function archiveChat(id: string): Promise<ChatRecord> {
  return send<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`, 'PATCH', { action: 'archive' });
}

export function restoreChat(id: string): Promise<ChatRecord> {
  return send<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`, 'PATCH', { action: 'restore' });
}

export function deleteChat(id: string): Promise<{ deleted: string }> {
  return send<{ deleted: string }>(`/api/chats/${encodeURIComponent(id)}`, 'DELETE');
}

export function adopt(id: string): Promise<ChatRecord> {
  return send<ChatRecord>('/api/chats/adopt', 'POST', { id });
}

/**
 * Hands the chat off to a new chat on `tier` (spec must-do 9b). Resolves as
 * soon as the old chat's memo turn is running: follow `memoJobId` on the job
 * stream, then open the old chat's `handedOffTo` once it is set (or show its
 * `handoffError`).
 */
export function handoff(id: string, tier: TierId): Promise<{ memoJobId: string }> {
  return send<{ memoJobId: string }>(
    `/api/chats/${encodeURIComponent(id)}/handoff`,
    'POST',
    { tier },
  );
}

/**
 * Sends a side message into this chat's running turn (spec must-do 2, 6).
 * Rejects (via `unwrap`) with the server's own message on failure — e.g. a
 * 409 once the turn's input channel is gone, or a 400 off the Claude tiers —
 * so a caller's `catch` sees the same text the server reported.
 */
export function sendSideMessage(id: string, text: string): Promise<{ ok: true }> {
  return send<{ ok: true }>(`/api/chats/${encodeURIComponent(id)}/side`, 'POST', { text });
}

/**
 * Reports the chat this device currently has on screen (`null` for none —
 * hidden, unmounted, or a draft), so the server can tell whether a chat that
 * just finished a turn was being looked at (T10's `isOnScreen`). Fire and
 * forget: a failure here — including a 401, since this device may not even
 * be past step-up yet — must never surface as a chat error, so it is never
 * awaited and its rejection is always swallowed.
 *
 * `tabId` (from `@/lib/tabId`) rides along so the server can key its focus
 * map by device AND tab (review finding 9) — without it, two tabs or windows
 * on one device overwrite each other's report, so a chat Colin still has
 * open in the other window can read as off-screen.
 *
 * The `null` report has to survive the moment the page is hidden or
 * unmounted, which an ordinary fetch does not reliably do — the browser can
 * cancel an in-flight request once the page is gone. `sendBeacon` is built
 * for exactly this; `fetch` with `keepalive` is the fallback where it is
 * unavailable (sendBeacon needs no response, so its own failure is nothing
 * to catch).
 */
export function sendFocus(chatId: string | null, tabId: string): void {
  const body = JSON.stringify({ chatId, tabId });

  if (chatId === null && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      '/api/chats/focus',
      new Blob([body], { type: 'application/json' }),
    );
    if (sent) return;
    // sendBeacon can refuse (payload/queue limits) — fall through to fetch.
  }

  void fetch('/api/chats/focus', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body,
    // Lets the `null` report outlive the page when it's sent on hide/unmount;
    // a harmless no-op for the periodic in-view reports.
    keepalive: true,
  }).catch(() => { /* fire-and-forget */ });
}
