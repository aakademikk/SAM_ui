import type { LoadState, WidgetSize } from '@/types/dashboard';
import type { Slice } from '@/store/dashboardStore';

/**
 * A slice that already holds data must never fall back to a skeleton on a
 * routine poll — that would make the whole console strobe every four seconds.
 * Skeletons are for the cold start only.
 */
export function resolveStatus<T>(slice: Slice<T>): LoadState {
  if (slice.status === 'error' && !slice.data) return 'error';
  if (slice.data) return 'ready';
  return slice.status === 'error' ? 'error' : 'loading';
}

export interface SizeProfile {
  /** 1×1 — headline number only. */
  compact: boolean;
  /** 2 columns wide. */
  wide: boolean;
  /** 2 rows tall. */
  tall: boolean;
  /** 2×2 — the full expression of the widget. */
  large: boolean;
  /** Rows of a list this footprint can show without scrolling. */
  rows: number;
}

export function sizeProfile(size: WidgetSize): SizeProfile {
  switch (size) {
    case 'sm':
      return { compact: true, wide: false, tall: false, large: false, rows: 3 };
    case 'md-wide':
      return { compact: false, wide: true, tall: false, large: false, rows: 3 };
    case 'md-tall':
      return { compact: false, wide: false, tall: true, large: false, rows: 7 };
    case 'lg':
      return { compact: false, wide: true, tall: true, large: true, rows: 8 };
  }
}
