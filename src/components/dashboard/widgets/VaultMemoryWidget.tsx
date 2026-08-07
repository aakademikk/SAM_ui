'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Brain, Database, Search } from 'lucide-react';

import type { VaultMemoryPayload } from '@/types/dashboard';
import { cn, formatCompact, formatNumber } from '@/lib/utils';
import { emptyState } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import { EmptyState, Meter, Pill, RelativeTime, Stat, TONE_COLOR } from '@/components/ui/Indicators';
import { MiniBars } from '@/components/ui/Sparkline';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

/* ========================================================================== */
/* Memory core                                                                */
/* ========================================================================== */

/**
 * The vault rendered as a rotating index core. Each ring is a cluster, sized by
 * its share of the corpus; the inner pulse fires while notes are still queued
 * for embedding, so a backlog is visible without reading a number.
 */
function MemoryCore({ vault, size = 96 }: { vault: VaultMemoryPayload; size?: number }) {
  const reducedMotion = useUserPreferencesStore((s) => s.reducedMotion);
  const indexing = vault.pendingIndex > 0;
  const rings = vault.clusters.slice(0, 5);
  const coverage = vault.totalNotes > 0 ? vault.indexedNotes / vault.totalNotes : 1;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        {rings.map((cluster, i) => {
          const radius = 44 - i * 7.5;
          const circumference = 2 * Math.PI * radius;
          const dash = circumference * Math.max(0.08, cluster.weight);
          const color = i % 2 === 0 ? 'var(--sam-accent)' : 'var(--sam-accent-2)';

          return (
            <g key={cluster.name}>
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={color}
                strokeOpacity={0.12}
                strokeWidth={2.5}
              />
              <motion.circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                style={{ transformOrigin: '50px 50px', filter: `drop-shadow(0 0 3px ${color})` }}
                animate={reducedMotion ? undefined : { rotate: i % 2 === 0 ? 360 : -360 }}
                transition={{ duration: 22 + i * 9, repeat: Infinity, ease: 'linear' }}
              />
            </g>
          );
        })}

        {/* Coverage core */}
        <circle cx="50" cy="50" r="9" fill="var(--sam-accent)" fillOpacity={0.14} />
        <motion.circle
          cx="50"
          cy="50"
          r={4 + coverage * 4}
          fill="var(--sam-accent-2)"
          style={{ filter: 'drop-shadow(0 0 7px var(--sam-accent-2))' }}
          animate={
            reducedMotion || !indexing
              ? { opacity: 0.9 }
              : { opacity: [0.5, 1, 0.5], scale: [0.9, 1.12, 0.9] }
          }
          transition={{ duration: 1.7, repeat: indexing ? Infinity : 0, ease: 'easeInOut' }}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular mt-9 font-mono text-[9px] tracking-wider text-slate-500 uppercase">
          {(coverage * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

/* ========================================================================== */

export function VaultMemoryWidget({ size, index, dragHandleProps, isDragging, isOverlay }: WidgetProps) {
  const slice = useDashboardStore((s) => s.vault);
  const refresh = useDashboardStore((s) => s.refresh);
  const queryVault = useDashboardStore((s) => s.queryVault);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const [query, setQuery] = useState('');

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const vault = slice.data;

  const coverage = useMemo(
    () => (vault && vault.totalNotes > 0 ? vault.indexedNotes / vault.totalNotes : 0),
    [vault],
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    void queryVault(query);
    setQuery('');
  };

  return (
    <WidgetFrame
      id="vault-memory"
      title="Vault Memory"
      subtitle={profile.compact ? undefined : vault ? `${formatCompact(vault.embeddings)} vectors` : undefined}
      icon={<Brain size={13} />}
      tone="accent"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="chart"
      onRefresh={() => refresh('vault')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        vault && vault.pendingIndex > 0 ? (
          <Pill tone={vault.pendingIndex > 150 ? 'warning' : 'info'}>{vault.pendingIndex} queued</Pill>
        ) : vault ? (
          <Pill tone="success">synced</Pill>
        ) : null
      }
      footer={
        !profile.compact &&
        vault && (
          <div className="flex items-center gap-2 font-mono text-[9.5px] tracking-wider text-slate-600 uppercase">
            <span>p95 {vault.retrievalP95Ms}ms</span>
            <span className="text-void-300">·</span>
            <span>cache {(vault.cacheHitRate * 100).toFixed(0)}%</span>
            <span className="text-void-300">·</span>
            <RelativeTime value={vault.lastSync} prefix="sync " />
          </div>
        )
      }
    >
      {!vault ? (
        <EmptyState message={emptyState('generic', 'vault', sarcasm)} icon={<Database size={20} />} />
      ) : profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div>
            <span className="tabular text-3xl leading-none font-semibold text-[var(--sam-accent)]">
              {formatCompact(vault.indexedNotes)}
            </span>
            <span className="label mt-1 block">notes indexed</span>
          </div>
          <Meter value={coverage} tone="accent" height={4} label="Index coverage" />
          <div className="flex items-center justify-between font-mono text-[9.5px] text-slate-500">
            <span>{formatCompact(vault.embeddings)} vec</span>
            <span className={cn(vault.pendingIndex > 0 && 'text-ember-300')}>
              {vault.pendingIndex} queued
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* Core + headline stats */}
          <div className="flex shrink-0 items-center gap-4 px-3 py-3">
            <MemoryCore vault={vault} size={profile.large ? 104 : 84} />

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2.5">
              <Stat
                label="indexed"
                value={formatNumber(vault.indexedNotes)}
                hint={`of ${formatNumber(vault.totalNotes)} notes`}
                tone="accent"
              />
              <Stat
                label="embeddings"
                value={formatCompact(vault.embeddings)}
                hint={`${(vault.vaultSizeMb / 1024).toFixed(2)} GB on disk`}
                tone="accent-2"
              />
              {(profile.tall || profile.large) && (
                <>
                  <Stat
                    label="ingest"
                    value={`${vault.ingestPerMin}/min`}
                    hint={vault.pendingIndex > 0 ? `${vault.pendingIndex} pending` : 'queue drained'}
                  />
                  <Stat
                    label="retrieval p95"
                    value={`${vault.retrievalP95Ms}ms`}
                    hint={`${(vault.cacheHitRate * 100).toFixed(0)}% cache hits`}
                  />
                </>
              )}
            </div>
          </div>

          {/* Index throughput */}
          <div className="shrink-0 px-3 pb-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="label">index throughput</span>
              <span className="tabular font-mono text-[9.5px] text-slate-500">
                {vault.ingestPerMin} chunks/min
              </span>
            </div>
            <MiniBars points={vault.indexThroughput} height={profile.large ? 30 : 22} />
          </div>

          {/* Clusters */}
          {(profile.tall || profile.large) && vault.clusters.length > 0 && (
            <div className="shrink-0 border-t border-void-500/35 px-3 py-2">
              <span className="label mb-1.5 block">corpus distribution</span>
              <div className="flex flex-col gap-1.5">
                {vault.clusters.slice(0, profile.large ? 5 : 3).map((cluster, i) => (
                  <div key={cluster.name} className="flex items-center gap-2">
                    <span className="w-[36%] truncate text-[10.5px] text-slate-400">{cluster.name}</span>
                    <Meter
                      value={cluster.weight * 2.2}
                      tone={i % 2 === 0 ? 'accent' : 'accent-2'}
                      height={3}
                      className="flex-1"
                      label={`${cluster.name} share`}
                    />
                    <span className="tabular w-11 text-right font-mono text-[9.5px] text-slate-500">
                      {formatCompact(cluster.notes)}
                    </span>
                    <span
                      className="tabular w-9 text-right font-mono text-[9.5px]"
                      style={{
                        color: cluster.driftPct > 0 ? TONE_COLOR.success : TONE_COLOR.muted,
                      }}
                    >
                      {cluster.driftPct > 0 ? '+' : ''}
                      {cluster.driftPct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent retrievals */}
          {profile.large && (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-void-500/35">
              <div className="divide-y divide-void-500/25">
                {vault.recentQueries.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 px-3 py-1.5">
                    <Search size={10} className="shrink-0 text-void-300" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                      {entry.text}
                    </span>
                    <span className="tabular shrink-0 font-mono text-[9.5px] text-slate-600">
                      {entry.hits} hits
                    </span>
                    <span className="tabular shrink-0 font-mono text-[9.5px] text-[var(--sam-accent-2)]">
                      {entry.latencyMs}ms
                    </span>
                    <span className="hidden shrink-0 font-mono text-[9px] tracking-wider text-slate-600 uppercase sm:inline">
                      {entry.agent}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Retrieval input */}
          {(profile.tall || profile.large) && (
            <form
              onSubmit={handleSubmit}
              className="flex shrink-0 items-center gap-2 border-t border-void-500/35 px-3 py-2"
            >
              <Search size={12} className="shrink-0 text-void-300" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Query persistent memory…"
                aria-label="Query the vault"
                className="min-w-0 flex-1 bg-transparent text-[11.5px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!query.trim()}
                className="shrink-0 rounded-[3px] border border-[var(--sam-accent)]/35 bg-[var(--sam-accent)]/12 px-2 py-[3px] font-mono text-[9.5px] tracking-wider text-[var(--sam-accent)] uppercase transition-colors hover:bg-[var(--sam-accent)]/22 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Recall
              </button>
            </form>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
