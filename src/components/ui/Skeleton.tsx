'use client';

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  /** Milliseconds of shimmer delay — drives the staggered cascade. */
  delay?: number;
  rounded?: boolean;
  style?: CSSProperties;
}

export function Skeleton({ className, delay = 0, rounded = true, style }: SkeletonProps) {
  return (
    <div
      className={cn('shimmer', rounded ? 'rounded-[3px]' : '', className)}
      style={{ ...style, animationDelay: `${delay}ms` }}
      aria-hidden="true"
    />
  );
}

/**
 * Widget-shaped loading state. Each row is offset by `stagger` so a grid of
 * loading widgets reads as a wave crossing the console rather than eight
 * independent flashes.
 */
export function WidgetSkeleton({
  rows = 4,
  index = 0,
  stagger = 90,
  variant = 'list',
}: {
  rows?: number;
  index?: number;
  stagger?: number;
  variant?: 'list' | 'chart' | 'grid' | 'terminal';
}) {
  const base = index * stagger;

  if (variant === 'chart') {
    return (
      <div className="flex h-full flex-col gap-4 p-1">
        <div className="flex items-end justify-between gap-3">
          <Skeleton className="h-9 w-28" delay={base} />
          <Skeleton className="h-5 w-16" delay={base + 60} />
        </div>
        <Skeleton className="h-full min-h-16 w-full" delay={base + 120} />
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-3 flex-1" delay={base + 160 + i * 40} />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'grid') {
    return (
      <div className="grid h-full grid-cols-2 gap-2.5 p-1">
        {Array.from({ length: rows * 2 }, (_, i) => (
          <Skeleton key={i} className="min-h-12 w-full" delay={base + i * 55} />
        ))}
      </div>
    );
  }

  if (variant === 'terminal') {
    // Ragged widths read as lines of output; uniform bars read as a placeholder.
    const widths = ['62%', '84%', '41%', '73%', '55%', '90%', '48%'];
    return (
      <div className="flex h-full flex-col gap-2 p-1">
        {Array.from({ length: rows + 3 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-2.5"
            delay={base + i * 45}
            style={{ width: widths[i % widths.length] }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-7 shrink-0" delay={base + i * 70} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-2.5 w-[68%]" delay={base + i * 70 + 30} />
            <Skeleton className="h-2 w-[40%]" delay={base + i * 70 + 60} />
          </div>
          <Skeleton className="h-2.5 w-9 shrink-0" delay={base + i * 70 + 90} />
        </div>
      ))}
    </div>
  );
}

/** Full-console boot cascade, used before the first bootstrap settles. */
export function GridSkeleton({ count = 8 }: { count?: number }) {
  const spans = ['col-span-1 row-span-2', 'col-span-2', 'col-span-2 row-span-2', 'col-span-1'];

  return (
    <div className="grid auto-rows-[minmax(168px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn('glass brackets relative overflow-hidden rounded-md p-4', spans[i % spans.length])}
        >
          <div className="mb-4 flex items-center gap-2">
            <Skeleton className="size-4" delay={i * 90} />
            <Skeleton className="h-2.5 w-24" delay={i * 90 + 40} />
          </div>
          <WidgetSkeleton index={i} rows={3} />
        </div>
      ))}
    </div>
  );
}
