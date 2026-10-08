/**
 * SAM — the chat follows new text only while you are at the bottom (Colin,
 * 2026-10-08: "make it so I can still scroll while SAM is thinking").
 *
 * Every streamed chunk used to scroll the thread to the bottom, so scrolling
 * up mid-reply was dragged straight back down. Now the thread follows only
 * when it was already pinned to the bottom, or when you have just sent a
 * message (sending always brings you back down).
 */

/** How close to the bottom (px) still counts as "at the bottom". */
export const FOLLOW_SLACK_PX = 80;

export interface ScrollBox {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** True when the scroll box is at, or within `slack` px of, its bottom. */
export function isNearBottom(el: ScrollBox, slack: number = FOLLOW_SLACK_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

/** Follow new content when pinned to the bottom, or when the user has just sent a message. */
export function shouldFollow(pinned: boolean, userJustSent: boolean): boolean {
  return pinned || userJustSent;
}

/**
 * The id of the newest user message when it is new since `lastSeenId`, else null.
 * Lets the page tell "you just sent" apart from "SAM's reply grew".
 */
export function newUserMessageId(
  messages: ReadonlyArray<{ id: string; role: string }>,
  lastSeenId: string | null,
): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || last.id === lastSeenId) return null;
  return last.id;
}
