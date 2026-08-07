'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Gauge as GaugeIcon, Pause, Play, Square, Zap } from 'lucide-react';

import type { AgentStatus, FleetAgent } from '@/types/dashboard';
import { cn, formatCompact, formatDuration } from '@/lib/utils';
import { emptyState } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import { EmptyState, Meter, Pill, Stat, TONE_COLOR, type ToneName } from '@/components/ui/Indicators';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const STATUS_TONE: Record<AgentStatus, ToneName> = {
  executing: 'success',
  idle: 'muted',
  blocked: 'critical',
  spawning: 'info',
  offline: 'muted',
  throttled: 'warning',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  executing: 'exec',
  idle: 'idle',
  blocked: 'blocked',
  spawning: 'spawn',
  offline: 'offline',
  throttled: 'throttled',
};

/* ========================================================================== */
/* Node indicator                                                             */
/* ========================================================================== */

/**
 * Per-agent activity node. The core brightness tracks CPU, the orbiting arc
 * only spins while the agent is actually executing, and a blocked agent gets a
 * static red ring — the animation *is* the status readout.
 */
function AgentNode({ agent, size = 26 }: { agent: FleetAgent; size?: number }) {
  const tone = STATUS_TONE[agent.status];
  const color = TONE_COLOR[tone];
  const active = agent.status === 'executing';
  const load = Math.min(1, agent.cpuPct / 100);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={`${agent.codename} — ${agent.status} @ ${agent.cpuPct.toFixed(0)}% CPU`}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={2} />

        {active && (
          <motion.circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="26 81"
            style={{ transformOrigin: '20px 20px', filter: `drop-shadow(0 0 3px ${color})` }}
            animate={{ rotate: 360 }}
            transition={{
              // Faster spin under heavier load.
              duration: 3.4 - load * 2,
              repeat: Infinity,
              ease: 'linear',
            }}
          />
        )}

        {agent.status === 'blocked' && (
          <motion.circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="4 6"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.3, repeat: Infinity }}
          />
        )}

        <motion.circle
          cx="20"
          cy="20"
          r={4 + load * 4}
          fill={color}
          style={{ filter: `drop-shadow(0 0 ${3 + load * 6}px ${color})` }}
          animate={active ? { opacity: [0.65, 1, 0.65] } : { opacity: agent.status === 'offline' ? 0.25 : 0.8 }}
          transition={{ duration: 1.8, repeat: active ? Infinity : 0, ease: 'easeInOut' }}
        />
      </svg>
    </div>
  );
}

/* ========================================================================== */
/* Row                                                                        */
/* ========================================================================== */

function AgentRow({ agent, detailed, index }: { agent: FleetAgent; detailed: boolean; index: number }) {
  const commandAgent = useDashboardStore((s) => s.commandAgent);
  const tone = STATUS_TONE[agent.status];
  const memRatio = agent.memMb / agent.memCapMb;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.035, 0.25) }}
      className="group/agent relative flex items-center gap-2.5 bg-void-900/40 px-3 py-2 transition-colors hover:bg-white/[0.028]"
    >
      <AgentNode agent={agent} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11.5px] font-semibold tracking-wider text-slate-100">
            {agent.codename}
          </span>
          <Pill tone={tone}>{STATUS_LABEL[agent.status]}</Pill>
          {detailed && (
            <span className="truncate font-mono text-[9.5px] tracking-wider text-slate-600 uppercase">
              {agent.role} · {agent.swarm}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-[11px] text-slate-400">{agent.currentTask}</p>

        {agent.status === 'executing' && (
          <Meter
            value={agent.progress}
            tone="success"
            height={2}
            striped
            className="mt-1.5"
            label={`${agent.codename} task progress`}
          />
        )}
      </div>

      {/* Live resource consumption */}
      <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
        <span className="tabular font-mono text-[10px] text-slate-300">
          {agent.cpuPct.toFixed(0)}
          <span className="text-slate-600">% cpu</span>
        </span>
        <span
          className="tabular font-mono text-[10px]"
          style={{ color: memRatio > 0.85 ? TONE_COLOR.warning : '#94a3b8' }}
        >
          {agent.memMb.toFixed(0)}
          <span className="text-slate-600">M</span>
        </span>
        {detailed && (
          <span className="tabular font-mono text-[9.5px] text-slate-500">
            {formatCompact(agent.tokensPerMin)}
            <span className="text-slate-600"> tok/m</span>
          </span>
        )}
      </div>

      {/* Supervisor controls */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100 focus-within:opacity-100">
        {agent.status === 'executing' || agent.status === 'spawning' ? (
          <button
            type="button"
            onClick={() => commandAgent(agent.id, 'pause')}
            aria-label={`Throttle ${agent.codename}`}
            title="Throttle"
            className="rounded-[3px] p-1 text-void-300 transition hover:bg-white/8 hover:text-ember-300"
          >
            <Pause size={11} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => commandAgent(agent.id, 'resume')}
            aria-label={`Resume ${agent.codename}`}
            title="Resume"
            className="rounded-[3px] p-1 text-void-300 transition hover:bg-white/8 hover:text-toxic-300"
          >
            <Play size={11} />
          </button>
        )}

        <button
          type="button"
          onClick={() => commandAgent(agent.id, 'boost')}
          aria-label={`Boost ${agent.codename}`}
          title="Raise priority"
          className="rounded-[3px] p-1 text-void-300 transition hover:bg-white/8 hover:text-[var(--sam-accent-2)]"
        >
          <Zap size={11} />
        </button>

        <button
          type="button"
          onClick={() => commandAgent(agent.id, 'kill')}
          aria-label={`Terminate ${agent.codename}`}
          title="Terminate"
          className="rounded-[3px] p-1 text-void-300 transition hover:bg-alarm-500/15 hover:text-alarm-300"
        >
          <Square size={11} />
        </button>
      </div>
    </motion.div>
  );
}

/* ========================================================================== */

export function AgentFleetWidget({ size, index, dragHandleProps, isDragging, isOverlay }: WidgetProps) {
  const slice = useDashboardStore((s) => s.fleet);
  const refresh = useDashboardStore((s) => s.refresh);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const [swarmFilter, setSwarmFilter] = useState<string | null>(null);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const fleet = slice.data;

  const agents = useMemo(() => {
    const list = fleet?.agents ?? [];
    return swarmFilter ? list.filter((a) => a.swarm === swarmFilter) : list;
  }, [fleet, swarmFilter]);

  const stats = useMemo(() => {
    const list = fleet?.agents ?? [];
    return {
      executing: list.filter((a) => a.status === 'executing').length,
      blocked: list.filter((a) => a.status === 'blocked').length,
      total: list.length,
    };
  }, [fleet]);

  const visible = agents.slice(0, profile.rows + (profile.large ? 2 : 0));

  return (
    <WidgetFrame
      id="agent-fleet"
      title="Agent Fleet"
      subtitle={profile.compact ? undefined : `${stats.executing}/${stats.total} executing`}
      icon={<Bot size={13} />}
      tone="accent-2"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="list"
      onRefresh={() => refresh('fleet')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        !profile.compact &&
        fleet && (
          <span className="tabular hidden font-mono text-[9.5px] tracking-wider text-slate-500 uppercase sm:inline">
            {formatCompact(fleet.totalTokensPerMin)} tok/m
          </span>
        )
      }
      footer={
        !profile.compact &&
        fleet && (
          <p className="truncate text-[10.5px] text-slate-500 italic" title={fleet.supervisorVerdict}>
            {fleet.supervisorVerdict}
          </p>
        )
      }
    >
      {profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-baseline gap-1.5">
            <span className="tabular text-4xl leading-none font-semibold text-[var(--sam-accent-2)]">
              {stats.executing}
            </span>
            <span className="tabular text-lg leading-none text-slate-600">/{stats.total}</span>
          </div>
          <span className="label">agents executing</span>

          <div className="flex items-center gap-1.5">
            {stats.blocked > 0 ? (
              <Pill tone="critical">{stats.blocked} blocked</Pill>
            ) : (
              <Pill tone="success">nominal</Pill>
            )}
            {fleet && (
              <span className="tabular font-mono text-[9.5px] text-slate-600">
                {fleet.aggregateCpuPct.toFixed(0)}% cpu
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* Swarm summary + filter */}
          {fleet && fleet.swarms.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-void-500/35 px-3 py-2">
              <button
                type="button"
                onClick={() => setSwarmFilter(null)}
                className={cn(
                  'rounded-[3px] px-1.5 py-[3px] font-mono text-[9.5px] tracking-[0.12em] uppercase transition-colors',
                  swarmFilter === null
                    ? 'bg-[var(--sam-accent-2)]/18 text-[var(--sam-accent-2)]'
                    : 'text-slate-600 hover:text-slate-400',
                )}
              >
                all
              </button>
              {fleet.swarms.map((swarm) => (
                <button
                  key={swarm.name}
                  type="button"
                  onClick={() => setSwarmFilter(swarmFilter === swarm.name ? null : swarm.name)}
                  className={cn(
                    'rounded-[3px] px-1.5 py-[3px] font-mono text-[9.5px] tracking-[0.12em] uppercase transition-colors',
                    swarmFilter === swarm.name
                      ? 'bg-[var(--sam-accent-2)]/18 text-[var(--sam-accent-2)]'
                      : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  {swarm.name}
                  <span className="ml-1 text-slate-600">
                    {swarm.active}/{swarm.total}
                  </span>
                </button>
              ))}

              {profile.large && fleet && (
                <div className="ml-auto flex items-center gap-3">
                  <Stat
                    label="aggregate cpu"
                    value={`${fleet.aggregateCpuPct.toFixed(0)}%`}
                    align="right"
                    className="gap-0.5"
                  />
                </div>
              )}
            </div>
          )}

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <EmptyState message={emptyState('agents', 'fleet', sarcasm)} icon={<GaugeIcon size={20} />} />
            ) : (
              <div className="divide-y divide-void-500/30">
                {/* AnimatePresence must be the direct parent of the animated
                    children, otherwise the wrapper never unmounts and exit
                    animations are silently skipped. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  {visible.map((agent, i) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      detailed={profile.large || profile.wide}
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {profile.large && fleet && (
            <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-void-500/35 px-3 py-2">
              <Stat label="executing" value={stats.executing} tone="success" />
              <Stat label="blocked" value={stats.blocked} tone={stats.blocked > 0 ? 'critical' : 'muted'} />
              <Stat label="tokens/min" value={formatCompact(fleet.totalTokensPerMin)} tone="accent-2" />
              <Stat
                label="oldest uptime"
                value={formatDuration(Math.max(0, ...(fleet.agents.map((a) => a.uptimeSec) ?? [0])))}
                align="right"
              />
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
