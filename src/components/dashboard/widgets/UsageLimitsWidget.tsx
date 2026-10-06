'use client';

import { Gauge as GaugeIcon } from 'lucide-react';

import type { UsageSeat, UsageWindow } from '@/types/usage';
import { useDashboardStore } from '@/store/dashboardStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import { EmptyState, Meter, TONE_COLOR, type ToneName } from '@/components/ui/Indicators';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';
import { formatAge, formatReset, windowLine, type UsageTone } from '@/components/dashboard/widgets/usageFormat';

const TEXT_TONE: Record<UsageTone, ToneName> = {
  ok: 'accent-2',
  warn: 'accent-2',
  high: 'warning',
  reset: 'muted',
  none: 'muted',
};

function toneFor(tone: UsageTone, pct: number | null): ToneName {
  return tone === 'high' && pct !== null && pct >= 95 ? 'critical' : TEXT_TONE[tone];
}

/** Spoken form: "main seat, 5-hour limit, 12 percent, resets 18:40". */
function windowLabel(seat: string, name: string, w: UsageWindow | null, now: number): string {
  const head = `${seat} seat, ${name} limit`;
  if (w === null) return `${head}, no reading yet`;
  if (w.state === 'reset') return `${head}, reset, ${windowLine(w, now).sub}`;
  if (w.pct === null) return `${head}, no reading yet`;
  return `${head}, ${w.pct} percent, ${formatReset(w.resetsAt, now)}`;
}

/** The newer of the two windows' readAt, or null when there is no reading at all. */
function newestRead(seat: UsageSeat): string | null {
  const times = [seat.fiveHour?.readAt, seat.sevenDay?.readAt].filter((t): t is string => Boolean(t));
  if (times.length === 0) return null;
  return times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

function WindowRow({ seat, name, w, now }: { seat: string; name: string; w: UsageWindow | null; now: number }) {
  const line = windowLine(w, now);
  const tone = toneFor(line.tone, w?.pct ?? null);
  const showMeter = w !== null && w.state !== 'reset' && w.pct !== null;
  return (
    <div role="group" aria-label={windowLabel(seat, name, w, now)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">{name}</span>
        <span
          className="tabular font-mono text-[12px] font-semibold"
          style={{ color: line.tone === 'none' ? undefined : TONE_COLOR[tone] }}
        >
          {line.text}
        </span>
      </div>
      {showMeter && (
        <Meter value={(w.pct ?? 0) / 100} tone={tone} height={5} className="mt-1" label={`${seat} ${name} usage`} />
      )}
      <p className="mt-0.5 truncate text-[12px] text-slate-500" title={line.sub}>
        {line.sub}
      </p>
    </div>
  );
}

/** Compact: the seat's higher live percent only, with a meter and the age. */
function CompactSeat({ seat, now }: { seat: UsageSeat; now: number }) {
  const live = [seat.fiveHour, seat.sevenDay].filter(
    (w): w is UsageWindow => w !== null && w.state !== 'reset' && w.pct !== null,
  );
  const top = live.length > 0 ? live.reduce((a, b) => ((b.pct ?? 0) > (a.pct ?? 0) ? b : a)) : null;
  const name = top === null ? null : top === seat.fiveHour ? '5-hour' : 'Weekly';
  const anyReset = [seat.fiveHour, seat.sevenDay].some((w) => w?.state === 'reset');
  const line = windowLine(top, now);
  const tone = toneFor(line.tone, top?.pct ?? null);
  const read = newestRead(seat);
  const label =
    top && name
      ? windowLabel(seat.id, name, top, now)
      : `${seat.id} seat, ${read === null ? 'no reading yet' : 'reset, not checked since the last reading'}`;
  return (
    <div role="group" aria-label={label} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">{seat.id}</span>
        <span className="tabular font-mono text-[12px] font-semibold" style={{ color: TONE_COLOR[tone] }}>
          {top ? `${line.text} ${name}` : anyReset ? 'reset' : 'no reading'}
        </span>
      </div>
      {top && <Meter value={(top.pct ?? 0) / 100} tone={tone} height={5} className="mt-1" label={`${seat.id} usage`} />}
      <p className="mt-0.5 truncate text-[12px] text-slate-500">{read ? formatAge(read, now) : 'no reading yet'}</p>
    </div>
  );
}

function FullSeat({ seat, now }: { seat: UsageSeat; now: number }) {
  const read = newestRead(seat);
  return (
    <section aria-label={`${seat.id} seat`} className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-[12px] font-semibold text-slate-200">{seat.id}</h3>
        <span className="text-[12px] text-slate-500">{read ? formatAge(read, now) : 'no reading yet'}</span>
      </div>
      <WindowRow seat={seat.id} name="5-hour" w={seat.fiveHour} now={now} />
      <WindowRow seat={seat.id} name="Weekly" w={seat.sevenDay} now={now} />
    </section>
  );
}

export function UsageLimitsWidget({ size, index, dragHandleProps, isDragging, isOverlay, tile }: WidgetProps) {
  const slice = useDashboardStore((s) => s.usage);
  const refresh = useDashboardStore((s) => s.refresh);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const usage = slice.data;
  // No timers: "now" is the moment the payload was built, so ages move on each poll.
  const now = usage ? Date.parse(usage.generatedAt) || slice.updatedAt || 0 : 0;

  return (
    <WidgetFrame
      id="usage-limits"
      title="Usage limits"
      icon={<GaugeIcon size={13} />}
      tone="accent-2"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="chart"
      onRefresh={() => refresh('usage')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      tile={tile}
    >
      {!usage ? (
        <EmptyState message="No usage readings." icon={<GaugeIcon size={20} />} />
      ) : profile.compact ? (
        <div className="flex h-full flex-col justify-center gap-3 px-3 py-2">
          {usage.seats.map((seat) => (
            <CompactSeat key={seat.id} seat={seat} now={now} />
          ))}
        </div>
      ) : (
        <div className="scrollbar-thin h-full min-h-0 overflow-y-auto px-3 py-3">
          <div className={profile.wide ? 'grid grid-cols-2 gap-x-6 gap-y-4' : 'space-y-4'}>
            {usage.seats.map((seat) => (
              <FullSeat key={seat.id} seat={seat} now={now} />
            ))}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
