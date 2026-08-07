'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, FolderKanban, GitBranch } from 'lucide-react';

import type { Project, ProjectHealth, ProjectPhase } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { emptyState } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import {
  EmptyState,
  Meter,
  Pill,
  RelativeTime,
  Stat,
  StatusDot,
  type ToneName,
} from '@/components/ui/Indicators';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const HEALTH_TONE: Record<ProjectHealth, ToneName> = {
  'on-track': 'success',
  'at-risk': 'warning',
  critical: 'critical',
  shipped: 'accent-2',
};

const PHASE_LABEL: Record<ProjectPhase, string> = {
  discovery: 'discovery',
  build: 'build',
  qa: 'qa',
  staging: 'staging',
  production: 'prod',
  blocked: 'blocked',
};

function ProjectRow({ project, detailed, index }: { project: Project; detailed: boolean; index: number }) {
  const tone = HEALTH_TONE[project.health];
  const overBudget = project.budgetUsedPct > 100;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.24) }}
      className="px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={project.health === 'critical'} size={6} />

        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-100">
          {project.name}
        </span>

        <Pill tone={tone}>{PHASE_LABEL[project.phase]}</Pill>

        <span className="tabular w-9 shrink-0 text-right font-mono text-[10.5px] text-slate-300">
          {(project.progress * 100).toFixed(0)}%
        </span>
      </div>

      <Meter
        value={project.progress}
        tone={tone}
        height={3}
        striped={project.phase !== 'production' && project.health !== 'shipped'}
        className="mt-1.5"
        label={`${project.name} progress`}
      />

      <div className="mt-1.5 flex items-center gap-2 font-mono text-[9.5px] tracking-wider text-slate-600 uppercase">
        <span className="truncate">{project.client}</span>

        {detailed && (
          <>
            <span className="text-void-300">·</span>
            <span className="flex items-center gap-1 truncate">
              <GitBranch size={9} />
              {project.deployTarget}
            </span>
          </>
        )}

        <span className="text-void-300">·</span>
        <span>{project.openIssues} issues</span>

        {project.blockers > 0 && (
          <>
            <span className="text-void-300">·</span>
            <span className="flex items-center gap-1 text-alarm-300">
              <AlertTriangle size={9} />
              {project.blockers} blocked
            </span>
          </>
        )}

        {detailed && (
          <span className={cn('ml-auto shrink-0', overBudget ? 'text-ember-300' : 'text-slate-600')}>
            {project.budgetUsedPct.toFixed(0)}% budget
          </span>
        )}
      </div>

      {detailed && (
        <div className="mt-1 flex items-center gap-2 font-mono text-[9px] tracking-wider text-slate-600 uppercase">
          <span>owner {project.owner}</span>
          <span className="text-void-300">·</span>
          <RelativeTime value={project.lastDeploy} prefix="deployed " />
          {project.etaDays > 0 && (
            <>
              <span className="text-void-300">·</span>
              <span>eta {project.etaDays}d</span>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function ActiveProjectsWidget({
  size,
  index,
  dragHandleProps,
  isDragging,
  isOverlay,
}: WidgetProps) {
  const slice = useDashboardStore((s) => s.projects);
  const refresh = useDashboardStore((s) => s.refresh);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const projects = useMemo(() => slice.data ?? [], [slice.data]);

  const stats = useMemo(
    () => ({
      active: projects.filter((p) => p.health !== 'shipped').length,
      blockers: projects.reduce((sum, p) => sum + p.blockers, 0),
      critical: projects.filter((p) => p.health === 'critical').length,
      avgProgress:
        projects.length > 0
          ? projects.reduce((sum, p) => sum + p.progress, 0) / projects.length
          : 0,
    }),
    [projects],
  );

  const visible = projects.slice(0, profile.rows);

  return (
    <WidgetFrame
      id="active-projects"
      title="Active Projects"
      subtitle={profile.compact ? undefined : `${stats.active} in flight`}
      icon={<FolderKanban size={13} />}
      tone="info"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="list"
      onRefresh={() => refresh('projects')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={stats.blockers > 0 && <Pill tone="critical">{stats.blockers} blocked</Pill>}
      footer={
        !profile.compact && (
          <span className="font-mono text-[9.5px] tracking-wider text-slate-600 uppercase">
            avg completion {(stats.avgProgress * 100).toFixed(0)}% · Atwood Systems
          </span>
        )
      }
    >
      {profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-4xl leading-none font-semibold text-flux-300">
              {stats.active}
            </span>
            <span className="label">active</span>
          </div>
          <Meter value={stats.avgProgress} tone="info" height={4} label="Average completion" />
          <div className="flex gap-1.5">
            {stats.critical > 0 ? (
              <Pill tone="critical">{stats.critical} critical</Pill>
            ) : (
              <Pill tone="success">on track</Pill>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <EmptyState
                message={emptyState('projects', 'list', sarcasm)}
                icon={<FolderKanban size={20} />}
              />
            ) : (
              <div className="divide-y divide-void-500/30">
                {visible.map((project, i) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    detailed={profile.large || profile.tall}
                    index={i}
                  />
                ))}
              </div>
            )}
          </div>

          {profile.large && (
            <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-void-500/35 px-3 py-2">
              <Stat label="in flight" value={stats.active} tone="info" />
              <Stat
                label="blockers"
                value={stats.blockers}
                tone={stats.blockers > 0 ? 'critical' : 'muted'}
              />
              <Stat
                label="avg complete"
                value={`${(stats.avgProgress * 100).toFixed(0)}%`}
                align="right"
              />
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
