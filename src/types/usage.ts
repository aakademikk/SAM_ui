// ---------------------------------------------------------------------------
// Usage limits tile: per-seat 5-hour and weekly Claude limit readings
// ---------------------------------------------------------------------------

export type UsageSeatId = 'main' | 'max2';

export interface UsageWindow {
  /** Integer 0 to 100; null when the window has already reset. */
  pct: number | null;
  /** ISO string of the window's reset time, or null when not recorded. */
  resetsAt: string | null;
  /** The reading row's `endedAt` (ISO): how old the reading is. */
  readAt: string;
  /** `reset`: the window has reset since the reading, so no percent is shown.
   *  `unknown-reset`: a five-hour row from before the reset time was recorded,
   *  younger than 5 h, so it may still be current. */
  state: 'current' | 'reset' | 'unknown-reset';
}

export interface UsageSeat {
  id: UsageSeatId;
  /** null: no reading ever. */
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

export interface UsagePayload {
  /** Always `main` then `max2`. */
  seats: UsageSeat[];
  generatedAt: string;
}
