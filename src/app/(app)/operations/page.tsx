/**
 * /operations — the named-operation registry: what a code word actually runs.
 *
 * Each card is a pipeline defined in the vault at
 * `00_SAM_Control/Named Operations.md` — trigger phrase, ordered steps, human
 * gates, and the run log. Launching dispatches the mapped General with the
 * vault's own step list as its brief and needs a biometric step-up, the same
 * bar as the Fleet tab.
 *
 * Honest scope, stated in the UI as well as here: a launch is a briefed agent,
 * not a pipeline engine. It works the steps and stops at any 🔒 gate.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Radio,
  Play,
  Lock,
  Loader2,
  Square,
  ChevronRight,
  ChevronDown,
  History,
  AlertTriangle,
} from 'lucide-react';

import { operationsService } from '@/lib/operationsService';
import { jobsService, type JobEvent } from '@/lib/jobsService';
import { AgentStreamParser, type AgentStreamState } from '@/lib/agentStream';
import { MessageBlocks } from '@/components/chat/MessageBlocks';
import { authService } from '@/lib/authService';

import type { Operation } from '@/types/operations';

const PHASE_LABEL: Record<AgentStreamState['phase'], string> = {
  starting: 'Starting session',
  thinking: 'Thinking',
  working: 'Working',
  streaming: 'Replying',
  done: '',
};

function OperationCard({
  operation,
  onLaunch,
  launching,
  disabled,
}: {
  operation: Operation;
  onLaunch: (op: Operation) => void;
  launching: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const gates = operation.steps.filter((s) => s.gate).length;

  return (
    <div className="rounded-lg border border-void-700 bg-void-900/60 overflow-hidden">
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-void-100">{operation.name}</h2>
            {operation.summary && (
              <p className="mt-0.5 text-[11.5px] text-dim-300">{operation.summary}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onLaunch(operation)}
            disabled={disabled || launching}
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-accent/30
                       bg-accent/12 px-3 py-1.5 text-[11px] font-medium text-accent
                       transition-colors hover:bg-accent/20
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            {launching ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {launching ? 'Launching' : 'Launch'}
          </button>
        </div>

        {/* The code word, quoted exactly as the vault defines it. */}
        <p className="mt-2.5 font-mono text-[10.5px] text-dim-400">
          &ldquo;{operation.trigger}&rdquo;
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-[3px] bg-void-800 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-dim-200 uppercase">
            {operation.persona ?? 'no persona'}
          </span>
          <span className="rounded-[3px] bg-void-800 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-dim-200 uppercase">
            {operation.steps.length} steps
          </span>
          {gates > 0 && (
            <span className="rounded-[3px] bg-amber-500/12 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 uppercase">
              {gates} human gate{gates === 1 ? '' : 's'}
            </span>
          )}
          <span
            className={`rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase ${
              operation.runs.length > 0
                ? 'bg-void-800 text-dim-200'
                : 'bg-void-800 text-dim-400'
            }`}
          >
            {operation.runs.length > 0 ? `${operation.runs.length} runs` : 'never run'}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 border-t border-void-800 px-4 py-2
                   text-[10.5px] text-dim-300 transition-colors hover:text-void-100"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? 'Hide' : 'Show'} pipeline
      </button>

      {open && (
        <div className="border-t border-void-800 px-4 py-3 space-y-3">
          {operation.purpose && (
            <p className="text-[11.5px] leading-relaxed text-dim-200">{operation.purpose}</p>
          )}

          <ol className="space-y-2">
            {operation.steps.map((step) => (
              <li key={step.index} className="flex gap-2.5">
                <span
                  className={`mt-[1px] flex size-[18px] shrink-0 items-center justify-center rounded-[3px]
                              font-mono text-[9.5px] ${
                                step.gate
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-void-800 text-dim-300'
                              }`}
                >
                  {step.index}
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-medium text-void-100">
                    {step.title}
                    {step.gate && (
                      <span className="ml-1.5 font-mono text-[9px] tracking-wider text-amber-300 uppercase">
                        human gate
                      </span>
                    )}
                  </p>
                  {step.detail && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-dim-300">{step.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {operation.defaults && (
            <p className="text-[11px] leading-relaxed text-dim-400 italic">
              Defaults to confirm: {operation.defaults}
            </p>
          )}

          <div>
            <p className="flex items-center gap-1.5 font-mono text-[9px] tracking-wider text-dim-400 uppercase">
              <History size={10} /> Run log
            </p>
            {operation.runs.length === 0 ? (
              <p className="mt-1 text-[11px] text-dim-400 italic">
                Never run. The first launch writes the first entry.
              </p>
            ) : (
              <ul className="mt-1 space-y-1">
                {operation.runs.slice(0, 5).map((run, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-dim-300">
                    {run.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OperationsPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<{
    jobId: string;
    operation: string;
    parser: AgentStreamParser;
  } | null>(null);
  const [streamState, setStreamState] = useState<AgentStreamState | null>(null);

  const streamRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await operationsService.registry();
      setOperations(payload.operations);
      setAvailable(payload.available);
      setAuthError(null);
    } catch {
      setAuthError('Not authenticated — log in to see your operations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The live run renders above the cards — scroll it into view so a launch
  // lands where the output appears.
  useEffect(() => {
    if (activeRun) streamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeRun]);

  const handleLaunch = useCallback(
    async (operation: Operation) => {
      if (activeRun || launchingId) return;
      setError(null);
      setNeedsStepUp(false);
      setStreamState(null);
      setLaunchingId(operation.id);

      try {
        const started = await operationsService.dispatch({ operationId: operation.id });
        const parser = new AgentStreamParser();
        setActiveRun({ jobId: started.jobId, operation: operation.name, parser });
        setStreamState({ ...parser.state });

        jobsService.stream(started.jobId, (event: JobEvent) => {
          if (event.type === 'output') {
            setStreamState({ ...parser.push(event.text) });
          } else if (event.type === 'closed') {
            setStreamState({ ...parser.finish(event.exitCode) });
            setActiveRun(null);
            // The launch wrote a run-log entry — re-read so it shows.
            void load();
          }
        });
      } catch (err) {
        if ((err as { stepUpRequired?: boolean }).stepUpRequired) {
          setNeedsStepUp(true);
          setError('Biometric unlock required before launching an operation.');
        } else {
          setError(err instanceof Error ? err.message : 'Launch failed.');
        }
      } finally {
        setLaunchingId(null);
      }
    },
    [activeRun, launchingId, load],
  );

  const handleStop = useCallback(async () => {
    if (!activeRun) return;
    try {
      await jobsService.kill(activeRun.jobId);
    } catch {
      /* already gone */
    }
  }, [activeRun]);

  const handleUnlock = useCallback(async () => {
    try {
      await authService.stepUp();
      setNeedsStepUp(false);
      setError(null);
    } catch {
      setError('Unlock failed.');
    }
  }, []);

  const phase = streamState ? PHASE_LABEL[streamState.phase] : '';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-base font-semibold text-void-100">
          <Radio size={17} className="text-accent" />
          Operations
        </h1>
        <p className="mt-1 text-[11.5px] leading-relaxed text-dim-300">
          Code-word pipelines defined in the vault. A launch dispatches the mapped General with the
          operation&rsquo;s own step list as its brief — it works the steps and stops at every human
          gate. It is not an unattended pipeline engine.
        </p>
      </header>

      {authError && (
        <p className="rounded-md border border-void-700 bg-void-900/60 px-3 py-2 text-[11.5px] text-dim-200">
          {authError}
        </p>
      )}

      {!loading && !authError && !available && (
        <p className="flex items-start gap-2 rounded-md border border-amber-700/30 bg-amber-900/12 px-3 py-2 text-[11.5px] text-amber-200">
          <AlertTriangle size={13} className="mt-[1px] shrink-0" />
          Vault note not readable — check{' '}
          <span className="font-mono text-[10.5px]">Named Operations.md</span> in 00_SAM_Control.
        </p>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-red-700/30 bg-red-900/12 px-3 py-2">
          <p className="text-[11.5px] text-red-300">{error}</p>
          {needsStepUp && (
            <button
              type="button"
              onClick={handleUnlock}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent/30
                         bg-accent/12 px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent/20"
            >
              <Lock size={11} /> Unlock
            </button>
          )}
        </div>
      )}

      {/* Live run */}
      {(activeRun || streamState) && (
        <section
          ref={streamRef}
          className="rounded-lg border border-void-700 bg-void-900/60 overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-void-800 px-4 py-2">
            {activeRun ? (
              <Loader2 size={12} className="animate-spin text-accent" />
            ) : (
              <Radio size={12} className="text-dim-300" />
            )}
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-void-100">
              {activeRun ? `Operation ${activeRun.operation}` : 'Last run'}
              {phase && <span className="ml-2 text-dim-400">{phase}…</span>}
            </span>
            {activeRun && (
              <button
                type="button"
                onClick={handleStop}
                className="flex shrink-0 items-center gap-1 rounded-md border border-void-600
                           px-2 py-1 text-[10.5px] text-dim-200 transition-colors hover:text-void-100"
              >
                <Square size={10} /> Stop
              </button>
            )}
          </div>
          <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
            {streamState && <MessageBlocks blocks={streamState.blocks} />}
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-[11.5px] text-dim-400">Reading the registry…</p>
      ) : (
        <div className="space-y-3">
          {operations.map((operation) => (
            <OperationCard
              key={operation.id}
              operation={operation}
              onLaunch={handleLaunch}
              launching={launchingId === operation.id}
              disabled={Boolean(activeRun) || Boolean(authError)}
            />
          ))}
          {!authError && available && operations.length === 0 && (
            <p className="text-[11.5px] text-dim-400 italic">
              No operations defined in the vault registry yet.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-dim-400">
        Operations are defined in the vault — edit{' '}
        <span className="font-mono text-[10.5px]">Named Operations.md</span> to change what a launch
        runs. Runs are costed and listed with every other job on the{' '}
        <Link href="/fleet" className="text-accent hover:underline">
          Fleet
        </Link>{' '}
        tab.
      </p>
    </div>
  );
}
