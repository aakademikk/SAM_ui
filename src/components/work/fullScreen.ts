/**
 * Full-screen history helper. Entering full screen pushes one history entry
 * carrying a marker, so the phone's back gesture pops it and leaves full
 * screen without leaving the chat. Leaving by button calls history.back() so
 * no stray entry is left. The URL is never passed, so `?c=` is untouched.
 */

export interface HistoryLike {
  state: unknown;
  pushState(state: unknown, unused: string): void;
  back(): void;
}

export const FULL_STATE = { samWorkFull: true } as const;

export function isFullState(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { samWorkFull?: unknown }).samWorkFull === true
  );
}

/** Push the marker entry once. Returns true if it pushed. */
export function enterFull(history: HistoryLike): boolean {
  if (isFullState(history.state)) return false;
  history.pushState({ ...FULL_STATE }, '');
  return true;
}

/** popstate handler logic: true when full screen should stay on. */
export function onPop(state: unknown): boolean {
  return isFullState(state);
}

/** Leave by button: pop our marker entry once. Returns true if it popped. */
export function leaveFull(history: HistoryLike): boolean {
  if (!isFullState(history.state)) return false;
  history.back();
  return true;
}
