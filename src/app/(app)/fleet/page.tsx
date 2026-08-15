/**
 * /fleet — the single interface for dispatching the Tier 2 General fleet.
 *
 * Roster (read live from the persona files), a dispatch form (persona + model
 * tier + brief), the live run via the job SSE stream, cost per run and
 * cost-to-date per persona, and a recent-runs list. Dispatching needs a
 * biometric step-up — a General has file and bash reach.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, Send, Square, Lock, Loader2, Wallet, Clock, ChevronRight } from 'lucide-react';

import { fleetService } from '@/lib/fleetService';
import { jobsService, type JobEvent } from '@/lib/jobsService';
import { AgentStreamParser, type AgentStreamState } from '@/lib/agentStream';
import { MessageBlocks } from '@/components/chat/MessageBlocks';
import { authService } from '@/lib/authService';
import { computeRunCost, formatCost, formatTokens } from '@/lib/costing';
import { modelsForPersona } from '@/lib/fleetModels';

import type { FleetPersona, FleetSpend } from '@/types/fleet';
import type { JobSummary } from '@/types/jobs';


const PHASE_LABEL: Record<AgentStreamState['phase'], string> = {
  starting: 'Starting session',
  thinking: 'Thinking',
  working: 'Working',
  streaming: 'Replying',
  done: '',
};

function personaFromLabel(command: string): { persona: string; model: string } {
  // Model ids are no longer bare aliases — `deepseek-v4-flash` carries digits
  // and hyphens, and an `[a-z]+` class would silently fail to match it.
  const m = command.match(/^fleet:([a-z0-9_-]+) \(([a-z0-9.-]+)\)/);
  return m
    ? { persona: m[1], model: m[2] }
    : { persona: command.slice(0, 16), model: '' };
}

export default function FleetPage() {
  const [personas, setPersonas] = useState<FleetPersona[]>([]);
  const [spend, setSpend] = useState<FleetSpend | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);

  const [selectedPersona, setSelectedPersona] = useState('');
  const [model, setModel] = useState<string>('sonnet');
  const [brief, setBrief] = useState('');

  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  const [activeRun, setActiveRun] = useState<{ jobId: string; parser: AgentStreamParser; startedAt: number } | null>(null);
  const [streamState, setStreamState] = useState<AgentStreamState | null>(null);
  const [, setTick] = useState(0);

  // Re-opening a past run's output. The stream replays the persisted stdout.log
  // into the same parser, so cost/tokens/duration come back too. No activeRun —
  // it's a finished job, so no stop button / elapsed timer.
  const replayRef = useRef<{ close: () => void } | null>(null);
  const [replayLabel, setReplayLabel] = useState<{ persona: string; model: string } | null>(null);

  /* ── Load roster, spend, recent runs ───────────────────────────────────── */

  const refreshLists = useCallback(async () => {
    try {
      const [s, jobs] = await Promise.all([fleetService.spend(), jobsService.list()]);
      setSpend(s);
      setRecentJobs(jobs.filter((j) => j.command.startsWith('fleet:')).slice(0, 8));
    } catch {
      // roster still usable without spend
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const roster = await fleetService.registry();
        if (!alive) return;
        setPersonas(roster);
        if (roster.length > 0) setSelectedPersona((prev) => prev || roster[0].name);
      } catch {
        if (alive) setAuthError('Not authenticated — log in to use the fleet.');
      }
      if (alive) {
        setLoading(false);
        void refreshLists();
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshLists]);

  /* ── Elapsed timer for a live run ─────────────────────────────────────── */

  useEffect(() => {
    if (!activeRun) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [activeRun]);

  /* ── Reopen a past run's output ────────────────────────────────────────── */

  const closeReplay = useCallback(() => {
    replayRef.current?.close();
    replayRef.current = null;
  }, []);

  // Tear down any replay stream on unmount.
  useEffect(() => closeReplay, [closeReplay]);

  // A replay renders in the stream section *above* the run list — scroll it
  // into view so the click lands where the output appears, not off-screen.
  const streamSectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (replayLabel) {
      streamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [replayLabel]);

  const handleReplay = useCallback((job: JobSummary) => {
    closeReplay();
    setError(null);

    const { persona, model: jobModel } = personaFromLabel(job.command);
    setReplayLabel({ persona, model: jobModel });

    const parser = new AgentStreamParser();
    setStreamState({ ...parser.state });

    replayRef.current = jobsService.stream(job.id, (event: JobEvent) => {
      if (event.type === 'output') {
        setStreamState({ ...parser.push(event.text) });
      } else if (event.type === 'closed') {
        setStreamState({ ...parser.finish(event.exitCode) });
        replayRef.current = null;
      }
    });
  }, [closeReplay]);

  /* ── Dispatch ─────────────────────────────────────────────────────────── */

  const handleDispatch = useCallback(async () => {
    const text = brief.trim();
    if (!text || !selectedPersona || activeRun) return;

    setError(null);
    setNeedsStepUp(false);
    setStreamState(null);
    closeReplay();
    setReplayLabel(null);

    try {
      const started = await fleetService.dispatch({ persona: selectedPersona, model, brief: text });
      const parser = new AgentStreamParser();
      const run = { jobId: started.jobId, parser, startedAt: Date.now() };
      setActiveRun(run);
      setStreamState({ ...parser.state });

      jobsService.stream(started.jobId, (event: JobEvent) => {
        if (event.type === 'output') {
          const next = parser.push(event.text);
          setStreamState({ ...next });
        } else if (event.type === 'closed') {
          const next = parser.finish(event.exitCode);
          setStreamState({ ...next });
          setActiveRun(null);
          void refreshLists();
        }
      });
    } catch (err) {
      const stepUpRequired = (err as { stepUpRequired?: boolean }).stepUpRequired;
      if (stepUpRequired) {
        setNeedsStepUp(true);
        setError('Biometric unlock required before dispatching a job.');
      } else {
        setError(err instanceof Error ? err.message : 'Dispatch failed.');
      }
    }
  }, [brief, selectedPersona, model, activeRun, refreshLists, closeReplay]);

  const handleStop = useCallback(async () => {
    if (!activeRun) return;
    try { await jobsService.kill(activeRun.jobId); } catch { /* already gone */ }
  }, [activeRun]);

  const handleUnlock = useCallback(async () => {
    try {
      await authService.stepUp();
      setNeedsStepUp(false);
      setError(null);
      await handleDispatch();
    } catch { /* cancelled */ }
  }, [handleDispatch]);

  const selectPersona = useCallback((name: string) => {
    setSelectedPersona(name);
    const allowed = modelsForPersona(name).map((m) => m.id);
    const p = personas.find((x) => x.name === name);

    if (p && allowed.includes(p.model)) {
      setModel(p.model);
      return;
    }
    // Switching from a DeepSeek-cleared General to one that is not would
    // otherwise leave a disallowed model selected and dispatch would 400.
    setModel((current) => (allowed.includes(current) ? current : allowed[0] ?? 'sonnet'));
  }, [personas]);

  /* ── Render ───────────────────────────────────────────────────────────── */

  const selected = personas.find((p) => p.name === selectedPersona);
  const running = activeRun !== null;
  const elapsed = activeRun ? Math.max(0, Math.floor((Date.now() - activeRun.startedAt) / 1000)) : 0;
  const totalSpend = spend?.totalCostUsd ?? 0;
  const fleetCost = Object.values(spend?.personas ?? {}).reduce((s, e) => s + e.costUsd, 0);
  const claudeTokens = spend?.claude?.tokens ?? 0;
  const usage = streamState?.usage;

  // DeepSeek runs are priced locally from token counts — the CLI's own figure
  // is Opus-priced and must never be shown for them (see lib/costing.ts).
  const shownCost =
    streamState?.done
      ? computeRunCost(replayLabel?.model ?? model, usage, streamState.reportedCostUsd)
      : undefined;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 pb-24">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-void-100 flex items-center gap-2">
            <Bot size={20} className="text-accent" /> Fleet
          </h1>
          <p className="text-xs text-dim-400 mt-1">
            Dispatch Tier 2 Generals as stateless jobs. Personas read from{' '}
            <code className="text-dim-300">~/.claude/agents/</code>.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1.5 justify-end text-xs text-dim-300">
            <Wallet size={12} className="text-accent" />
            <span className="font-mono text-void-100">{formatCost(totalSpend)}</span>
          </div>
          <span className="text-[10px] text-dim-500">total spend (7d)</span>
          <span className="block text-[9px] text-dim-500">
            fleet {formatCost(fleetCost)} · sessions {formatTokens(claudeTokens)}
          </span>
          {/* Silent model substitution would otherwise only show up as spend
              drifting from expectation, which is exactly what nobody checks. */}
          {(spend?.modelMismatches ?? 0) > 0 && (
            <span className="block text-[10px] text-amber-400">
              {spend?.modelMismatches} run
              {spend?.modelMismatches === 1 ? '' : 's'} served a different model
            </span>
          )}
        </div>
      </header>

      {authError && (
        <p className="text-xs text-amber-400 bg-amber-900/15 border border-amber-700/25 rounded px-3 py-2">
          {authError}
        </p>
      )}

      {loading && <p className="text-xs text-dim-400">Loading roster...</p>}

      {!loading && personas.length === 0 && !authError && (
        <p className="text-xs text-dim-400">
          No personas found in <code className="text-dim-300">~/.claude/agents/</code>.
        </p>
      )}

      {/* Dispatch form */}
      <section className="space-y-3 rounded-xl border border-void-700 bg-void-900/60 p-4">
        <div className="flex flex-wrap gap-1.5">
          {personas.map((p) => {
            const active = p.name === selectedPersona;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => selectPersona(p.name)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  active
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-void-700 bg-void-950 text-dim-300 hover:border-void-600'
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {modelsForPersona(selectedPersona).map((m) => {
            const active = model === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                disabled={running}
                className={`px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-void-700 bg-void-950 text-dim-300 hover:border-void-600'
                }`}
              >
                <span className="font-semibold">{m.label}</span>
                <span className="block text-[9px] text-dim-500">{m.hint}</span>
              </button>
            );
          })}
        </div>

        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={running}
          placeholder={
            selected
              ? `Brief ${selected.name} — what's the job, what does done look like, what are the constraints?`
              : 'Select a persona and write the brief.'
          }
          rows={3}
          className="w-full bg-void-950 border border-void-600 rounded-lg px-3 py-2
                     text-sm text-void-100 placeholder:text-dim-500 focus:border-accent
                     focus:outline-none disabled:opacity-50 resize-none"
        />

        <div className="flex items-center justify-between">
          <p className="text-[10px] text-dim-500">
            {selected?.description.slice(0, 90)}{selected && selected.description.length > 90 ? '…' : ''}
          </p>
          <button
            type="button"
            onClick={handleDispatch}
            disabled={running || !brief.trim() || !selectedPersona}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent/20 border border-accent/40
                       rounded-lg text-accent text-sm font-medium hover:bg-accent/30
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={13} /> Dispatch
          </button>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-red-400 bg-red-900/15 border border-red-700/25 rounded px-3 py-1.5">
            {error}
          </p>
          {needsStepUp && (
            <button
              type="button"
              onClick={handleUnlock}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 border
                         border-accent/40 rounded-lg text-accent text-xs font-medium
                         hover:bg-accent/30 transition-colors"
            >
              <Lock size={12} /> Unlock
            </button>
          )}
        </div>
      )}

      {/* Live run / last result */}
      {streamState && (
        <section
          ref={streamSectionRef}
          className="rounded-xl border border-void-700 bg-void-900/60 overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-void-700 bg-void-950/40">
            <span className="text-xs font-semibold text-dim-100 uppercase tracking-wide">
              {replayLabel?.persona || selectedPersona || 'run'}
            </span>
            <span className="text-[10px] font-mono text-dim-500">{replayLabel?.model || model}</span>
            {replayLabel && <span className="text-[10px] font-mono text-dim-500">replayed</span>}
            <span className="flex-1" />
            {running && (
              <>
                <span className="text-xs text-accent animate-pulse">
                  {PHASE_LABEL[streamState.phase] || 'Working'}…
                </span>
                <span className="font-mono text-dim-500 text-xs">{elapsed}s</span>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-1 text-[10px] text-dim-400
                             hover:text-red-400 transition-colors"
                >
                  <Square size={9} /> stop
                </button>
              </>
            )}
          </div>

          <div className="px-3 py-3 max-h-[24rem] overflow-y-auto">
            {streamState.blocks.length === 0 && (
              <p className="text-xs text-dim-500 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Waiting for the agent...
              </p>
            )}
            <MessageBlocks blocks={streamState.blocks} />
          </div>

          {streamState.done && (
            <div className="px-3 py-2.5 border-t border-void-700 bg-void-950/40 grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
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
        </section>
      )}

      {/* Roster */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">Roster</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {personas.map((p) => {
            const entry = spend?.personas[p.name];
            return (
              <Link
                key={p.name}
                href={`/fleet/${encodeURIComponent(p.name)}`}
                title={`View ${p.name}'s last 10 runs`}
                className={`group text-left rounded-xl border p-3 transition-colors ${
                  p.name === selectedPersona
                    ? 'border-accent/40 bg-accent/5'
                    : 'border-void-700 bg-void-900/60 hover:border-void-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-void-100 uppercase tracking-wide">{p.name}</span>
                  <span
                    className={`flex items-center gap-1 text-[10px] font-mono ${
                      entry?.jobs ? 'text-emerald-400' : 'text-dim-500'
                    }`}
                  >
                    <Clock size={10} />
                    {entry?.jobs ? `${entry.jobs} run${entry.jobs > 1 ? 's' : ''} · ${formatCost(entry.costUsd)}` : 'idle'}
                  </span>
                </div>
                <p className="text-xs text-dim-400 mt-1 line-clamp-2">{p.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-void-950 border border-void-700 text-dim-300">
                    {p.model}
                  </span>
                  {p.tools.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-void-950 border border-void-700 text-dim-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <span className="mt-2 flex items-center gap-0.5 text-[10px] text-dim-500 group-hover:text-accent transition-colors">
                  view runs
                  <ChevronRight
                    size={11}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Claude Code session usage — subscription turns are tokens, not dollars */}
      {spend?.claude && spend.claude.sessions > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">
            Claude sessions (7d)
          </h2>
          <p className="text-[10px] text-dim-500 -mt-1">
            Pro is flat — sessions show tokens; only DeepSeek turns are priced.
          </p>
          <div className="rounded-xl border border-void-700 divide-y divide-void-700 overflow-hidden">
            {Object.entries(spend.claude.projects)
              .sort(([, a], [, b]) => b.tokens - a.tokens)
              .map(([name, p]) => (
                <div key={name} className="flex items-center justify-between px-3 py-2 bg-void-900/60">
                  <span className="text-xs font-medium text-dim-100">{name}</span>
                  <span className="text-[10px] font-mono text-dim-500">
                    {p.sessions} session{p.sessions > 1 ? 's' : ''} · {formatTokens(p.tokens)}
                    {p.costUsd > 0 ? ` · ${formatCost(p.costUsd)}` : ''}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Recent fleet runs */}
      {recentJobs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">Recent runs</h2>
            <span className="text-[10px] text-dim-500">click a run to reopen its output</span>
          </div>
          <div className="rounded-xl border border-void-700 divide-y divide-void-700 overflow-hidden">
            {recentJobs.map((job) => {
              const { persona, model: jobModel } = personaFromLabel(job.command);
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => handleReplay(job)}
                  className="w-full flex items-center gap-3 px-3 py-2 bg-void-900/60 text-left
                             hover:bg-void-900 transition-colors"
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
                  <span className="text-xs font-medium text-dim-100 shrink-0">{persona}</span>
                  {jobModel && <span className="text-[10px] font-mono text-dim-500 shrink-0">{jobModel}</span>}
                  <span className="flex-1 text-xs text-dim-400 truncate">
                    {job.command.replace(/^fleet:[a-z0-9_-]+ \([a-z]+\) — /, '')}
                  </span>
                  <span className="text-[10px] font-mono text-dim-500 shrink-0">
                    {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <ChevronRight size={12} className="text-dim-500 shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
