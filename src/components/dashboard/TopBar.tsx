'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Loader2, Radio } from 'lucide-react';

import { cn, formatClock } from '@/lib/utils';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { ControlDeck } from '@/components/dashboard/ControlDeck';
import { StatusDot, TONE_COLOR, type ToneName } from '@/components/ui/Indicators';
import { useMounted } from '@/hooks/useLiveClock';

/* ========================================================================== */

function SyncBadge() {
  const syncState = useUserPreferencesStore((s) => s.syncState);
  const syncError = useUserPreferencesStore((s) => s.syncError);

  const config: Record<string, { label: string; tone: ToneName; icon: typeof Cloud }> = {
    idle: { label: 'layout saved', tone: 'muted', icon: Cloud },
    pending: { label: 'queued', tone: 'warning', icon: Loader2 },
    saving: { label: 'syncing', tone: 'accent-2', icon: Loader2 },
    saved: { label: 'synced', tone: 'success', icon: Cloud },
    error: { label: 'sync failed', tone: 'critical', icon: CloudOff },
  };

  const { label, tone, icon: Icon } = config[syncState] ?? config.idle;
  const spinning = syncState === 'saving';

  return (
    <span
      className="hidden items-center gap-1.5 font-mono text-[9px] tracking-[0.14em] uppercase lg:inline-flex"
      style={{ color: TONE_COLOR[tone] }}
      title={syncError ?? label}
    >
      <Icon size={11} className={cn(spinning && 'animate-spin')} />
      {label}
    </span>
  );
}

/* ========================================================================== */

function EstateChip({
  label,
  value,
  tone = 'accent-2',
  pulse = false,
}: {
  label: string;
  value: string;
  tone?: ToneName;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 border-l border-void-500/60 pl-3 first:border-l-0 first:pl-0">
      <StatusDot tone={tone} pulse={pulse} size={5} />
      <span className="label">{label}</span>
      <span className="tabular font-mono text-[11px] font-medium" style={{ color: TONE_COLOR[tone] }}>
        {value}
      </span>
    </div>
  );
}

/* ========================================================================== */

export function TopBar() {
  const system = useDashboardStore((s) => s.system.data);
  const polling = useDashboardStore((s) => s.polling);

  const operatorName = useUserPreferencesStore((s) => s.operatorName);

  const mounted = useMounted();
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    const update = () => setClock(formatClock(Date.now()));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  const score = system?.overallScore ?? 0;
  const scoreTone: ToneName = score >= 92 ? 'success' : score >= 78 ? 'warning' : 'critical';

  return (
    <header className="glass sticky top-0 z-30 mb-4 flex items-center gap-3 rounded-md px-4 py-2.5">
      {/* Wordmark */}
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="relative">
          <Radio
            size={16}
            className={cn('text-[var(--sam-accent)]', polling && 'animate-[sam-breathe_3.4s_ease-in-out_infinite]')}
          />
        </div>
        <div className="leading-none">
          <h1 className="neon font-mono text-[13px] font-bold tracking-[0.34em] text-slate-100 uppercase">
            SAM
          </h1>
          <p className="mt-0.5 hidden font-mono text-[8px] tracking-[0.16em] text-slate-600 uppercase sm:block">
            core dashboard
          </p>
        </div>
      </div>

      <div className="hidden h-7 w-px bg-void-500/60 md:block" />

      {/* Live estate readout */}
      <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
        <EstateChip label="health" value={score.toFixed(1)} tone={scoreTone} pulse={score < 78} />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <SyncBadge />

        <span
          className="tabular hidden font-mono text-[11px] tracking-wider text-slate-400 sm:inline"
          suppressHydrationWarning
        >
          {mounted ? clock : '--:--:--'}
          <span className="ml-1 text-[8.5px] text-slate-600">UTC</span>
        </span>

        <span className="hidden font-mono text-[9px] tracking-[0.14em] text-slate-600 uppercase lg:inline">
          {operatorName}
        </span>

        <ControlDeck />
      </div>
    </header>
  );
}
