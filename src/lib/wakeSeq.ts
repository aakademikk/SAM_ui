/**
 * SAM — wake counters.
 *
 * The desktop bridge and the phone bridge each publish a counter that bumps on
 * every wake-word detection, and an open chat page polls it. The page acts on
 * a *change*, never the value, so a page opened long after a detection does
 * not think it was just woken.
 */

export interface WakeTracker {
  seen: number | null;
}

export function newWakeTracker(): WakeTracker {
  return { seen: null };
}

/**
 * Feed one poll result in; true means "a wake happened since the last poll".
 * The first read only sets the baseline. A failed read (null) changes nothing.
 * A counter that went backwards means the bridge restarted: new baseline.
 */
export function observeWakeSeq(t: WakeTracker, seq: number | null): boolean {
  if (seq === null) return false;
  const prev = t.seen;
  t.seen = seq;
  return prev !== null && seq > prev;
}
