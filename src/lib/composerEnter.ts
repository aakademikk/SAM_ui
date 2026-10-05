/**
 * SAM — what Enter does in the chat composer.
 *
 * On a desktop keyboard Enter sends and Shift+Enter starts a new line. On a
 * phone's on-screen keyboard there is no Shift+Enter, so Enter sending meant a
 * message could never have more than one line (Colin, 2026-10-05): on a touch
 * screen Enter starts a new line and the send button sends.
 */

/** True when the device's main pointer is a finger (phones, tablets). */
export const isTouchKeyboard = () => window.matchMedia('(pointer: coarse)').matches;

/** True when this keydown should send the message instead of typing. */
export function enterSends(
  e: { key: string; shiftKey: boolean },
  touchKeyboard: boolean,
): boolean {
  return e.key === 'Enter' && !e.shiftKey && !touchKeyboard;
}
