/**
 * Browser event that says "the phone's screening flag just changed".
 *
 * The voice/text intent runner fires it after a successful change; the switch
 * in the app shell listens and re-reads the phone. The event carries no value
 * on purpose — listeners ask the phone, they never trust the event.
 */

export const SCREENING_CHANGED_EVENT = 'sam:screening-changed';

export function announceScreeningChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SCREENING_CHANGED_EVENT));
}

/** Calls `onChange` on every screening change; returns the unsubscribe. */
export function subscribeScreeningChanged(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SCREENING_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(SCREENING_CHANGED_EVENT, onChange);
}
