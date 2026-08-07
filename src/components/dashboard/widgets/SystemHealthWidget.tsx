'use client';

import { useMemo } from 'react';
import { Activity, ServerCrash } from 'lucide-react';

import type { ServiceState } from '@/types/dashboard';
import { cn, formatDuration, formatNumber } from '@/lib/utils';
import { verdict } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import { EmptyState, Meter, Pill, Stat, StatusDot, type ToneName } from '@/components/ui/Indicators';
import { Gauge } from '@/components/ui/Gauge';
import { Sparkline } from '@/components/ui/Sparkline';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const SERVICE_TONE: Record<ServiceState, ToneName> = {
  operational: 'success',
  degraded: 'warning',
  down: 'critical',
  maintenance: 'info',
};

export function SystemHealthWidget({
  size,
  index,
  dragHandleProps,
  isDragging,
  isOverlay,
}: WidgetProps) {
  const slice = useDashboardStore((s) => s.system);
  const refresh = useDashboardStore((s) => s.refresh);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const system = slice.data;

  const failureRate = useMemo(() => {
    if (!system || system.automationRuns24h === 0) return 0;
    return (system.automationFailures24h / system.automationRuns24h) * 100;
  }, [system]);

  const degraded = useMemo(
    () => (system?.services ?? []).filter((s) => s.state !== 'operational'),
    [system],
  );

  const scoreVerdict = useMemo(() => {
    if (!system || system.cpuSeries.length < 2) return null;
    const first = system.cpuSeries[0].v;
    const last = system.cpuSeries[system.cpuSeries.length - 1].v;
    const delta = first === 0 ? 0 : ((last - first) / first) * 100;
    return verdict('CPU load', delta, false, 'system-health', sarcasm);
  }, [system, sarcasm]);

  return (
    <WidgetFrame
      id="system-health"
      title="System Health"
      subtitle={profile.compact ? undefined : system ? `${formatDuration(system.uptimeSec)} uptime` : undefined}
      icon={<Activity size={13} />}
      tone="accent-2"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="chart"
      onRefresh={() => refresh('system')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        degraded.length > 0 ? (
          <Pill tone="warning">{degraded.length} degraded</Pill>
        ) : (
          <Pill tone="success">all green</Pill>
        )
      }
      footer={
        !profile.compact &&
        scoreVerdict && (
          <p className="truncate text-[10.5px] text-slate-500 italic" title={scoreVerdict}>
            {scoreVerdict}
          </p>
        )
      }
    >
      {!system ? (
        <EmptyState message="No host telemetry." icon={<ServerCrash size={20} />} />
      ) : profile.compact ? (
        <div className="flex h-full items-center justify-center p-2">
          <Gauge value={system.overallScore} label="health" size={106} warnAt={88} criticalAt={72} />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-4 px-3 py-3">
            <Gauge
              value={system.overallScore}
              label="health"
              size={profile.large ? 118 : 96}
              warnAt={88}
              criticalAt={72}
            />

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="label">cpu</span>
                  <span className="tabular font-mono text-[10px] text-slate-300">
                    {system.cpuPct.toFixed(0)}%
                  </span>
                </div>
                <Sparkline points={system.cpuSeries} height={20} color="var(--sam-accent-2)" />
              </div>

              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="label">memory</span>
                  <span className="tabular font-mono text-[10px] text-slate-300">
                    {system.memPct.toFixed(0)}%
                  </span>
                </div>
                <Sparkline points={system.memSeries} height={20} color="var(--sam-accent)" />
              </div>

              {(profile.tall || profile.large) && (
                <>
                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="label">network</span>
                      <span className="tabular font-mono text-[10px] text-slate-300">
                        {system.netMbps.toFixed(0)}Mb
                      </span>
                    </div>
                    <Sparkline points={system.netSeries} height={20} color="var(--color-magenta-400)" />
                  </div>

                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="label">disk</span>
                      <span className="tabular font-mono text-[10px] text-slate-300">
                        {system.diskPct.toFixed(0)}%
                      </span>
                    </div>
                    <Meter
                      value={system.diskPct / 100}
                      tone={system.diskPct > 85 ? 'critical' : system.diskPct > 70 ? 'warning' : 'accent-2'}
                      height={5}
                      segmented
                      className="mt-1.5"
                      label="Disk usage"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Services */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-void-500/35">
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {system.services
                .slice(0, profile.large ? 8 : profile.tall ? 6 : 4)
                .map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center gap-2 border-b border-void-500/20 px-3 py-1.5"
                  >
                    <StatusDot
                      tone={SERVICE_TONE[service.state]}
                      pulse={service.state === 'down' || service.state === 'degraded'}
                      size={5}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-300">
                      {service.name}
                    </span>
                    <span
                      className={cn(
                        'tabular shrink-0 font-mono text-[9.5px]',
                        service.latencyMs > 120 ? 'text-ember-300' : 'text-slate-600',
                      )}
                    >
                      {service.latencyMs}ms
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Automation reliability */}
          <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-void-500/35 px-3 py-2">
            <Stat label="load avg" value={system.loadAvg[0].toFixed(2)} hint={`5m ${system.loadAvg[1].toFixed(2)}`} />
            <Stat
              label="runs 24h"
              value={formatNumber(system.automationRuns24h)}
              hint={`${system.automationFailures24h} failed`}
              tone="accent-2"
            />
            <Stat
              label="failure rate"
              value={`${failureRate.toFixed(1)}%`}
              tone={failureRate > 1.5 ? 'critical' : failureRate > 0.6 ? 'warning' : 'success'}
              align="right"
            />
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
