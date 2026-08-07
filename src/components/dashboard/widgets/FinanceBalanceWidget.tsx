'use client';

import { useMemo } from 'react';
import { Landmark, Wallet } from 'lucide-react';

import { cn, formatCurrency, formatNumber, trendOf } from '@/lib/utils';
import { verdict } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import { Delta, EmptyState, Meter, Pill, Stat, TONE_COLOR } from '@/components/ui/Indicators';
import { Sparkline } from '@/components/ui/Sparkline';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

export function FinanceBalanceWidget({
  size,
  index,
  dragHandleProps,
  isDragging,
  isOverlay,
}: WidgetProps) {
  const slice = useDashboardStore((s) => s.finance);
  const refresh = useDashboardStore((s) => s.refresh);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const finance = slice.data;

  const trend = useMemo(() => (finance ? trendOf(finance.balanceSeries) : 'flat'), [finance]);

  // Beyond ten years the number stops carrying information — the server sends a
  // sentinel when revenue covers burn outright.
  const runwayUnbounded = !!finance && finance.runwayDays >= 3650;
  const runwayLabel = !finance ? '—' : runwayUnbounded ? '∞' : `${finance.runwayDays}d`;

  const runwayTone = useMemo(() => {
    if (!finance) return 'muted' as const;
    if (runwayUnbounded) return 'success' as const;
    if (finance.runwayDays < 120) return 'critical' as const;
    if (finance.runwayDays < 270) return 'warning' as const;
    return 'success' as const;
  }, [finance, runwayUnbounded]);

  const commentary = useMemo(
    () => (finance ? verdict('Cash position', finance.deltaPct, true, 'finance', sarcasm) : null),
    [finance, sarcasm],
  );

  const netBurn = finance ? finance.monthlyBurn - finance.mrr : 0;

  return (
    <WidgetFrame
      id="finance-balance"
      title="Finance"
      subtitle={profile.compact ? undefined : finance ? `${runwayLabel} runway` : undefined}
      icon={<Wallet size={13} />}
      tone="success"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="chart"
      onRefresh={() => refresh('finance')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={finance && <Pill tone={runwayTone}>{runwayLabel}</Pill>}
      footer={
        !profile.compact &&
        commentary && (
          <p className="truncate text-[10.5px] text-slate-500 italic" title={commentary}>
            {commentary}
          </p>
        )
      }
    >
      {!finance ? (
        <EmptyState message="No ledger connection." icon={<Landmark size={20} />} />
      ) : profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div>
            <span
              className="tabular text-2xl leading-none font-semibold"
              style={{ color: TONE_COLOR.success }}
            >
              {formatCurrency(finance.totalBalance, finance.currency, true)}
            </span>
            <div className="mt-1 flex items-center gap-1.5">
              <Delta value={finance.deltaPct} />
              <span className="label">30d</span>
            </div>
          </div>

          <Sparkline
            points={finance.balanceSeries}
            height={30}
            color={trend === 'down' ? 'var(--color-alarm-400)' : 'var(--color-toxic-400)'}
          />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* Headline */}
          <div className="flex shrink-0 items-end justify-between gap-3 px-3 pt-3">
            <div>
              <span className="label">total balance</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className="tabular text-[26px] leading-none font-semibold"
                  style={{ color: TONE_COLOR.success }}
                >
                  {formatCurrency(finance.totalBalance, finance.currency)}
                </span>
                <Delta value={finance.deltaPct} />
              </div>
            </div>

            <div className="text-right">
              <span className="label">net burn</span>
              <p
                className="tabular mt-1 text-[15px] leading-none font-semibold"
                style={{ color: netBurn > 0 ? TONE_COLOR.warning : TONE_COLOR.success }}
              >
                {netBurn > 0 ? '−' : '+'}
                {formatCurrency(Math.abs(netBurn), finance.currency, true)}
                <span className="ml-0.5 text-[10px] text-slate-600">/mo</span>
              </p>
            </div>
          </div>

          <div className="shrink-0 px-3 pt-2">
            <Sparkline
              points={finance.balanceSeries}
              height={profile.large ? 52 : 34}
              color={trend === 'down' ? 'var(--color-alarm-400)' : 'var(--color-toxic-400)'}
            />
          </div>

          {/* Runway */}
          <div className="shrink-0 px-3 pt-2 pb-2">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="label">runway</span>
              <span
                className="tabular font-mono text-[10px]"
                style={{ color: TONE_COLOR[runwayTone] }}
              >
                {runwayUnbounded ? 'revenue covers burn' : `${finance.runwayDays} days`}
              </span>
            </div>
            {/* Scaled against an 18-month horizon — beyond that the bar stops meaning anything. */}
            <Meter
              value={runwayUnbounded ? 1 : Math.min(1, finance.runwayDays / 540)}
              tone={runwayTone}
              height={4}
              segmented
              label="Runway"
            />
          </div>

          {/* Accounts */}
          {(profile.tall || profile.large) && (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-void-500/35">
              <div className="divide-y divide-void-500/25">
                {finance.accounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-300">
                      {account.label}
                      <span className="ml-1.5 font-mono text-[9px] tracking-wider text-slate-600 uppercase">
                        {account.institution}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'tabular shrink-0 font-mono text-[11px]',
                        account.balance < 0 ? 'text-alarm-300' : 'text-slate-200',
                      )}
                    >
                      {formatCurrency(account.balance, account.currency, true)}
                    </span>
                    <Delta value={account.deltaPct} className="w-14 justify-end" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footline stats */}
          <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-void-500/35 px-3 py-2">
            <Stat label="mrr" value={formatCurrency(finance.mrr, finance.currency, true)} tone="success" />
            <Stat
              label="outstanding"
              value={formatCurrency(finance.outstandingValue, finance.currency, true)}
              hint={`${formatNumber(finance.outstandingInvoices)} invoices`}
            />
            <Stat
              label="burn"
              value={formatCurrency(finance.monthlyBurn, finance.currency, true)}
              tone="warning"
              align="right"
            />
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
