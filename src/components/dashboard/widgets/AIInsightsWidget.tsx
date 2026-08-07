'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Sparkles, Zap } from 'lucide-react';

import type { Insight, Severity } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { frameInsight } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import {
  EmptyState,
  Pill,
  RelativeTime,
  SEVERITY_TONE,
  StatusDot,
  TONE_COLOR,
} from '@/components/ui/Indicators';
import { emptyState } from '@/lib/personalityEngine';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, success: 2, info: 3 };

/* ========================================================================== */

function InsightRow({ insight, index, showAction }: { insight: Insight; index: number; showAction: boolean }) {
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);
  const acknowledge = useDashboardStore((s) => s.acknowledgeInsight);
  const [expanded, setExpanded] = useState(false);

  const tone = SEVERITY_TONE[insight.severity];
  const color = TONE_COLOR[tone];
  const framed = useMemo(() => frameInsight(insight, sarcasm), [insight, sarcasm]);

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: insight.acknowledged ? 0.42 : 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.24), ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'group/insight relative border-l-2 bg-void-900/40 py-2.5 pr-3 pl-3 transition-colors',
        'hover:bg-white/[0.025]',
      )}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start gap-2">
        <StatusDot
          tone={tone}
          pulse={insight.severity === 'critical' && !insight.acknowledged}
          size={6}
          className="mt-[5px]"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[12.5px] leading-snug font-medium text-slate-100">
              {insight.headline}
            </h3>
            {insight.evidence && (
              <span
                className="tabular shrink-0 font-mono text-[10px] whitespace-nowrap"
                style={{ color }}
              >
                {insight.evidence}
              </span>
            )}
          </div>

          {/* SAM's editorial framing wraps the analytical body. */}
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
            {framed.lead && <span style={{ color }} className="font-medium">{framed.lead} </span>}
            {framed.body}
            {framed.sting && <span className="text-slate-500 italic"> {framed.sting}</span>}
          </p>

          {showAction && insight.suggestedAction && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 flex items-center gap-1 font-mono text-[10px] tracking-wider text-slate-500 uppercase transition-colors hover:text-slate-300"
            >
              <ChevronRight
                size={10}
                className={cn('transition-transform', expanded && 'rotate-90')}
              />
              Recommended action
            </button>
          )}

          <AnimatePresence initial={false}>
            {expanded && insight.suggestedAction && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-1.5 overflow-hidden rounded-[3px] border-l border-[var(--sam-accent-2)]/50 bg-black/30 py-1.5 pr-2 pl-2.5 text-[11px] leading-relaxed text-slate-300"
              >
                <Zap size={10} className="mr-1 inline text-[var(--sam-accent-2)]" />
                {insight.suggestedAction}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="mt-1.5 flex items-center gap-2">
            <span className="truncate font-mono text-[9.5px] tracking-wider text-slate-600 uppercase">
              {insight.source}
            </span>
            <span className="text-void-300">·</span>
            <RelativeTime
              value={insight.createdAt}
              className="font-mono text-[9.5px] text-slate-600"
            />
            <span className="text-void-300">·</span>
            <span className="tabular font-mono text-[9.5px] text-slate-600">
              {(insight.confidence * 100).toFixed(0)}% conf
            </span>
          </div>
        </div>

        {!insight.acknowledged && (
          <button
            type="button"
            onClick={() => acknowledge(insight.id)}
            aria-label={`Acknowledge: ${insight.headline}`}
            title="Acknowledge"
            className="shrink-0 rounded-[3px] p-1 text-void-300 opacity-0 transition hover:bg-white/8 hover:text-slate-200 focus-visible:opacity-100 group-hover/insight:opacity-100"
          >
            <Check size={12} />
          </button>
        )}
      </div>
    </motion.article>
  );
}

/* ========================================================================== */

export function AIInsightsWidget({ size, index, dragHandleProps, isDragging, isOverlay }: WidgetProps) {
  const slice = useDashboardStore((s) => s.insights);
  const refresh = useDashboardStore((s) => s.refresh);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const profile = sizeProfile(size);
  const status = resolveStatus(slice);

  const insights = useMemo(() => {
    const all = slice.data ?? [];
    const filtered = showAcknowledged ? all : all.filter((i) => !i.acknowledged);
    return [...filtered].sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }, [slice.data, showAcknowledged]);

  const counts = useMemo(() => {
    const all = (slice.data ?? []).filter((i) => !i.acknowledged);
    return {
      critical: all.filter((i) => i.severity === 'critical').length,
      warning: all.filter((i) => i.severity === 'warning').length,
      total: all.length,
    };
  }, [slice.data]);

  const visible = insights.slice(0, profile.compact ? 1 : profile.rows + 2);

  return (
    <WidgetFrame
      id="ai-insights"
      title="SAM Insights"
      subtitle={profile.compact ? undefined : `${counts.total} open`}
      icon={<Sparkles size={13} />}
      tone="accent"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="list"
      onRefresh={() => refresh('insights')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        !profile.compact && (
          <button
            type="button"
            onClick={() => setShowAcknowledged((v) => !v)}
            className={cn(
              'rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase transition-colors',
              showAcknowledged
                ? 'bg-[var(--sam-accent)]/18 text-[var(--sam-accent)]'
                : 'text-slate-600 hover:text-slate-400',
            )}
          >
            All
          </button>
        )
      }
      footer={
        !profile.compact && (
          <div className="flex items-center gap-1.5">
            {counts.critical > 0 && <Pill tone="critical">{counts.critical} critical</Pill>}
            {counts.warning > 0 && <Pill tone="warning">{counts.warning} warning</Pill>}
            {counts.critical === 0 && counts.warning === 0 && (
              <span className="font-mono text-[9.5px] tracking-wider text-slate-600 uppercase">
                No escalations
              </span>
            )}
          </div>
        )
      }
    >
      {/* --- 1×1: the number and the worst headline ------------------------ */}
      {profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-baseline gap-2">
            <span
              className="tabular text-4xl leading-none font-semibold"
              style={{ color: counts.critical > 0 ? TONE_COLOR.critical : TONE_COLOR.accent }}
            >
              {counts.total}
            </span>
            <span className="label">open</span>
          </div>

          {visible[0] ? (
            <p className="line-clamp-3 text-[11px] leading-relaxed text-slate-400">
              {visible[0].headline}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-600 italic">
              {emptyState('insights', 'compact', sarcasm)}
            </p>
          )}

          <div className="flex gap-1.5">
            {counts.critical > 0 && <Pill tone="critical">{counts.critical}</Pill>}
            {counts.warning > 0 && <Pill tone="warning">{counts.warning}</Pill>}
          </div>
        </div>
      ) : (
        <div className="scrollbar-thin h-full overflow-y-auto">
          {visible.length === 0 ? (
            <EmptyState
              message={emptyState('insights', 'feed', sarcasm)}
              icon={<Sparkles size={20} />}
            />
          ) : (
            <div className="divide-y divide-void-500/35">
              {/* AnimatePresence must directly parent the animated children,
                  or the wrapper never unmounts and exits are skipped. */}
              <AnimatePresence mode="popLayout" initial={false}>
                {visible.map((insight, i) => (
                  <InsightRow
                    key={insight.id}
                    insight={insight}
                    index={i}
                    showAction={profile.tall || profile.large}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
