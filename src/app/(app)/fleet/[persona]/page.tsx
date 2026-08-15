/**
 * /fleet/<persona> — one General's run history.
 *
 * Reached from the Fleet roster. Shows the persona's last 10 dispatched jobs
 * with cost, tokens and duration, and reopens any run's output inline through
 * the same stream → parse → render path the Fleet page uses to replay a past
 * run. Read-only — no step-up needed; the dispatch form stays on /fleet.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Bot, ChevronRight, Loader2, Wallet, AlertTriangle } from 'lucide-react';

import { fleetService } from '@/lib/fleetService';
import { jobsService, type JobEvent } from '@/lib/jobsService';
import { AgentStreamParser, type AgentStreamState } from '@/lib/agentStream';
import { MessageBlocks } from '@/components/chat/MessageBlocks';
import { computeRunCost, formatCost, formatTokens } from '@/lib/costing';

import type { FleetPersona, FleetPersonaJob } from '@/types/fleet';

const PHASE_LABEL: Record<AgentStreamState['phase'], string> = {
  starting: 'Starting session',
  thinking: 'Thinking',
  working: 'Working',
  streaming: 'Replying',
  done: '',
};

/** Strip the `fleet:<persona> (<model>) — ` label prefix, leaving the brief. */
function briefFromCommand(command: string): string {
  return command.replace(/^fleet:[a-z0-9_-]+(?: \([^)]+\))? — /, '').trim();
}

function jobDurationMs(job: FleetPersonaJob): number | null {
  if (typeof job.durationMs === 'number') return job.durationMs;
  if (job.endedAt && job.createdAt) {
    return Math.max(0, new Date(job.endedAt).getTime() - new Date(job.createdAt).getTime());
  }
  return null;
}

export default function PersonaJobsPage() {
  const params = useParams();
  const personaName = typeof params.persona === 'string' ? params.persona : '';

  const [persona, setPersona] = useState<FleetPersona | null>(null);
  const [jobs, setJobs] = useState<FleetPersonaJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<AgentStreamState | null>(null);
  const streamRef = useRef<{ close: () => void } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [roster, runs] = await Promise.all([
          fleetService.registry(),
          fleetService.jobsByPersona(personaName),
        ]);
        if (!alive) return;
        setPersona(roster.find((p) => p.name === personaName) ?? null);
        setJobs(runs.jobs);
      } catch (err) {
        if (alive) {
          setAuthError(
            (err as { message?: string }).message ?? 'Not authenticated — log in to view the fleet.',
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [personaName]);

  // Tear down any open stream on unmount.
  useEffect(() => () => streamRef.current?.close(), []);

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  /** Refresh the snapshot so a run that finished since load shows real cost. */
  const refresh = useCallback(async () => {
    try {
      const runs = await fleetService.jobsByPersona(personaName);
      setJobs(runs.jobs);
    } catch {
      // Keep what we have — the list is a convenience, not a contract.
    }
  }, [personaName]);

  const toggleExpand = useCallback(
    (job: FleetPersonaJob) => {
      if (expandedId === job.id) {
        closeStream();
        setExpandedId(null);
        setStreamState(null);
        return;
      }

      closeStream();
      setExpandedId(job.id);

      const parser = new AgentStreamParser();
      setStreamState({ ...parser.state });

      streamRef.current = jobsService.stream(job.id, (event: JobEvent) => {
        if (event.type === 'output') {
          setStreamState({ ...parser.push(event.text) });
        } else if (event.type === 'closed') {
          setStreamState({ ...parser.finish(event.exitCode) });
          streamRef.current = null;
          void refresh();
        }
      });
    },
    [expandedId, closeStream, refresh],
  );

  /* ── Derived ──────────────────────────────────────────────────────────── */

  const totalSpend = jobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);
  const expandedJob = jobs.find((j) => j.id === expandedId) ?? null;
  const usage = streamState?.usage;
  const shownCost = streamState?.done
    ? computeRunCost(expandedJob?.model ?? '', usage, streamState.reportedCostUsd)
    : undefined;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 pb-24">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/fleet"
            className="inline-flex items-center gap-1 text-xs text-dim-400 hover:text-dim-200 mb-2 transition-colors"
          >
            <ArrowLeft size={12} /> Fleet
          </Link>
          <h1 className="text-xl font-bold text-void-100 flex items-center gap-2">
            <Bot size={20} className="text-accent" /> {persona?.name ?? personaName}
          </h1>
          <p className="text-xs text-dim-400 mt-1">{persona?.description}</p>
          {persona && (
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-void-950 border border-void-700 text-dim-300">
                {persona.model}
              </span>
              {persona.tools.map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-void-950 border border-void-700 text-dim-400"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1.5 justify-end text-xs text-dim-300">
            <Wallet size={12} className="text-accent" />
            <span className="font-mono text-void-100">{formatCost(totalSpend)}</span>
          </div>
          <span className="text-[10px] text-dim-500">last {jobs.length} run{jobs.length === 1 ? '' : 's'}</span>
        </div>
      </header>

      {authError && (
        <p className="text-xs text-amber-400 bg-amber-900/15 border border-amber-700/25 rounded px-3 py-2">
          {authError}
        </p>
      )}

      {loading && <p className="text-xs text-dim-400">Loading runs...</p>}

      {!loading && !persona && !authError && (
        <p className="text-xs text-dim-400">
          Unknown persona — <Link href="/fleet" className="text-accent hover:underline">back to Fleet</Link>.
        </p>
      )}

      {!loading && persona && jobs.length === 0 && (
        <p className="text-xs text-dim-400">
          No fleet runs for this persona in the 7-day window yet. Dispatch one from the{' '}
          <Link href="/fleet" className="text-accent hover:underline">Fleet</Link> tab.
        </p>
      )}

      {/* Run history */}
      {jobs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">Run history</h2>
            <span className="text-[10px] text-dim-500">click a run to reopen its output</span>
          </div>
          <div className="rounded-xl border border-void-700 divide-y divide-void-700 overflow-hidden">
            {jobs.map((job) => {
              const expanded = job.id === expandedId;
              const dur = jobDurationMs(job);
              return (
                <div key={job.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(job)}
                    aria-expanded={expanded}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      expanded ? 'bg-void-800/60' : 'bg-void-900/60 hover:bg-void-900'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        job.status === 'running'
                          ? 'bg-accent animate-pulse'
                          : job.status === 'exited'
                            ? 'bg-emerald-400'
                            : job.status === 'killed'
                              ? 'bg-amber-400'
                              : 'bg-dim-500'
                      }`}
                    />
                    {job.modelMismatch && (
                      <span title="Served a different model than dispatched — spend attributed to the wrong model">
                        <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                      </span>
                    )}
                    <span className="text-xs font-medium text-dim-100 shrink-0">{job.model || '—'}</span>
                    <span className="flex-1 text-xs text-dim-400 truncate">{briefFromCommand(job.command)}</span>
                    <span className="text-[10px] font-mono text-dim-500 shrink-0">
                      {new Date(job.createdAt).toLocaleString([], {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {dur !== null && (
                      <span className="text-[10px] font-mono text-dim-500 shrink-0">
                        {(dur / 1000).toFixed(0)}s
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-mono shrink-0 ${
                        job.costUsd === null ? 'text-dim-500' : 'text-dim-200'
                      }`}
                      title={job.costBasis === 'computed' ? 'Computed from DeepSeek rates' : 'CLI-reported'}
                    >
                      {job.costUsd === null ? '—' : formatCost(job.costUsd)}
                    </span>
                    <ChevronRight
                      size={12}
                      className={`text-dim-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {expanded && streamState && (
                    <div className="border-t border-void-700 bg-void-950/40 px-3 py-3">
                      <div className="space-y-2">
                        {streamState.blocks.length === 0 && !streamState.done && (
                          <p className="text-xs text-dim-500 flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" /> Waiting for the agent...
                          </p>
                        )}
                        <MessageBlocks blocks={streamState.blocks} />
                        {!streamState.done && (
                          <p className="text-xs text-accent animate-pulse">
                            {PHASE_LABEL[streamState.phase] || 'Working'}…
                          </p>
                        )}
                      </div>

                      {streamState.done && (
                        <div className="mt-2 pt-2 border-t border-void-700 grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                          {shownCost && (
                            <div title={shownCost.basis === 'computed' ? 'Computed from DeepSeek rates' : 'CLI-reported'}>
                              <p className="text-dim-500 uppercase tracking-wide">Cost</p>
                              <p className="font-mono text-void-100">
                                {formatCost(shownCost.usd)}
                                {shownCost.basis === 'computed' && <span className="text-dim-500"> *</span>}
                              </p>
                            </div>
                          )}
                          {usage && (
                            <div>
                              <p className="text-dim-500 uppercase tracking-wide">Tokens</p>
                              <p className="font-mono text-void-100">
                                {formatTokens(usage.inputTokens + usage.cacheReadTokens + usage.outputTokens)}
                              </p>
                            </div>
                          )}
                          {streamState.durationMs !== undefined && (
                            <div>
                              <p className="text-dim-500 uppercase tracking-wide">Duration</p>
                              <p className="font-mono text-void-100">
                                {(streamState.durationMs / 1000).toFixed(1)}s
                              </p>
                            </div>
                          )}
                          {streamState.model && (
                            <div>
                              <p className="text-dim-500 uppercase tracking-wide">Model</p>
                              <p className="font-mono text-void-100 truncate">{streamState.model}</p>
                            </div>
                          )}
                          {streamState.sessionId && (
                            <div>
                              <p className="text-dim-500 uppercase tracking-wide">Session</p>
                              <p className="font-mono text-dim-300 truncate">{streamState.sessionId.slice(0, 8)}…</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
