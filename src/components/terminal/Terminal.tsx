/**
 * Terminal component — single instance, single SSE connection.
 *
 * Handles Android soft keyboard via VisualViewport API + 100dvh.
 * Includes the KeyBar for mobile (Ctrl/Esc/Tab/arrows/Ctrl-C).
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { JobRecord, JobSummary } from '@/types/jobs';
import { jobsService, type JobEvent } from '@/lib/jobsService';
import { useVisualViewport } from '@/components/shell/useVisualViewport';
import { useDevDuplicateCheck } from '@/components/shell/useDevDuplicateCheck';
import { KeyBar } from './KeyBar';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { authService } from '@/lib/authService';

interface TerminalProps {
  /** If set, attach to this specific job ID. Otherwise show job list + launcher. */
  jobId?: string;
}

export function Terminal({ jobId: initialJobId }: TerminalProps) {
  useDevDuplicateCheck('Terminal');

  const containerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [closed, setClosed] = useState(false);
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check auth on mount
  useEffect(() => {
    authService.checkSession().then((s) => {
      setIsLoggedIn(s.authenticated);
      setAuthChecked(true);
    });
  }, []);

  // Keyboard height tracking for Android
  useVisualViewport({ containerRef, keyBarHeight: 44 });

  /* ── Job list (when no specific job is selected) ─────────────────────── */

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await jobsService.list());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (jobId) return; // already attached
    refreshJobs();
    const t = setInterval(refreshJobs, 3000);
    return () => clearInterval(t);
  }, [jobId, refreshJobs]);

  /* ── Attach to a job ─────────────────────────────────────────────────── */

  const attachToJob = useCallback((id: string) => {
    setJobId(id);
    setOutput('');
    setClosed(false);
    setLastSeq(0);
    jobsService.get(id).then(setJob).catch(() => {});
  }, []);

  /* ── SSE stream ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!jobId) return;
    setOutput('');
    setClosed(false);

    const handle = jobsService.stream(jobId, (event: JobEvent) => {
      switch (event.type) {
        case 'meta':
          setJob(event.job);
          break;
        case 'output':
          setOutput((prev) => prev + event.text);
          setLastSeq(event.seq);
          break;
        case 'closed':
          setClosed(true);
          jobsService.get(jobId).then(setJob).catch(() => {});
          break;
      }
    }, lastSeq > 0 ? { fromSeq: lastSeq } : {});

    return () => handle.close();
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-scroll output ──────────────────────────────────────────────── */

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  /* ── Run command ─────────────────────────────────────────────────────── */

  const runCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;
    setLoading(true);
    try {
      const j = await jobsService.create(cmd.trim());
      setCommand('');
      attachToJob(j.id);
      await refreshJobs();
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [attachToJob, refreshJobs]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runCommand(command);
  };

  const onKill = useCallback(async (id: string) => {
    try { await jobsService.kill(id); await refreshJobs(); }
    catch { /* silent */ }
  }, [refreshJobs]);

  /* ── Key bar handler ─────────────────────────────────────────────────── */

  const onKeyBarKey = useCallback((key: string) => {
    const el = inputRef.current;
    if (!el) return;

    switch (key) {
      case 'ctrl':
        // Toggle a ctrl-prefix mode? For now, send ^ as a marker.
        // Properly we'd track a ctrl flag and prepend to next input,
        // but for a basic terminal this is enough.
        el.focus();
        break;
      case 'esc':
        el.value += '\x1b';
        el.focus();
        break;
      case 'tab':
        el.value += '\t';
        el.focus();
        break;
      case 'arrowleft':
        el.focus();
        break;
      case 'arrowright':
        el.focus();
        break;
      case 'ctrl-c':
        if (jobId && job?.status === 'running') {
          onKill(jobId);
        }
        break;
    }
  }, [jobId, job?.status, onKill]);

  /* ── Render: Job detail view ─────────────────────────────────────────── */

  if (jobId && job) {
    return (
      <div
        ref={containerRef}
        className="flex flex-col"
        style={{ height: 'calc(var(--sam-vv-height, 100dvh) - 3.5rem)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-void-700 bg-void-900/80 shrink-0">
          <button
            type="button"
            onClick={() => { setJobId(null); setJob(null); }}
            className="text-void-500 hover:text-accent text-sm transition-colors"
          >
            ← Back
          </button>
          <code className="text-sm text-void-200 truncate flex-1">{job.command}</code>
          <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${
            job.status === 'running' ? 'bg-blue-900/40 text-blue-400 border-blue-700/30' :
            job.status === 'exited' && job.exitCode === 0 ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/30' :
            'bg-red-900/40 text-red-400 border-red-700/30'
          }`}>
            {job.status} {job.exitCode !== null ? `(${job.exitCode})` : ''}
          </span>
        </div>

        {/* Output */}
        <pre
          ref={outputRef}
          className="flex-1 overflow-y-auto px-3 py-2 text-sm font-mono text-void-200
                     whitespace-pre-wrap break-all bg-void-980/80"
        >
          {output || (job.status === 'running' ? 'Waiting for output...\n' : '(no output)\n')}
          {job.status === 'running' && !closed && (
            <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />
          )}
        </pre>

        {/* Input line */}
        {(job.status === 'running' || job.status === 'queued') && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const inp = form.elements.namedItem('stdin') as HTMLInputElement;
              if (inp?.value) {
                jobsService.sendInput(jobId, inp.value + '\n').catch(() => {});
                inp.value = '';
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 border-t border-void-700 bg-void-900 shrink-0"
          >
            <span className="text-void-500 text-xs font-mono shrink-0">$</span>
            <input
              name="stdin"
              type="text"
              placeholder="stdin..."
              className="flex-1 bg-transparent text-sm font-mono text-void-200
                         placeholder-void-600 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        )}

        {/* Key accessory bar for mobile */}
        <KeyBar onKey={onKeyBarKey} />
      </div>
    );
  }

  /* ── Render: Job list + launcher ─────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      className="flex flex-col"
      style={{ minHeight: 'calc(var(--sam-vv-height, 100dvh) - 3.5rem)' }}
    >
      <div className="flex-1 p-3 md:p-6 max-w-2xl mx-auto w-full space-y-4">
        <h1 className="text-xl font-bold text-accent">Terminal</h1>

        {/* Quick launcher */}
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Enter a command..."
            className="flex-1 bg-void-900 border border-void-600 rounded px-3 py-2
                       text-void-100 font-mono text-sm
                       focus:border-accent focus:outline-none
                       placeholder:text-void-600"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={loading || !command.trim()}
            className="px-4 py-2 bg-accent/20 border border-accent/40 rounded
                       text-accent text-sm font-medium
                       hover:bg-accent/30 disabled:opacity-40 transition-colors shrink-0"
          >
            {loading ? '...' : 'Run'}
          </button>
        </form>

        {/* Voice input — requires auth for the transcription endpoint */}
        {!authChecked ? null : isLoggedIn ? (
          <VoiceRecordButton onTranscribe={(text) => setCommand(text)} />
        ) : (
          <div className="flex items-center gap-3 p-3 bg-amber-900/10 border border-amber-700/20 rounded-lg">
            <p className="text-sm text-amber-300/80 flex-1">
              Log in to use voice commands and terminal.
            </p>
            <button
              type="button"
              onClick={async () => {
                try {
                  await authService.authenticate();
                  setIsLoggedIn(true);
                } catch {
                  // user cancelled or error
                }
              }}
              className="px-4 py-2 bg-accent/20 border border-accent/40 rounded-lg
                         text-accent text-sm font-medium hover:bg-accent/30 transition-colors shrink-0"
            >
              Login
            </button>
          </div>
        )}

        {/* Job list */}
        <div className="space-y-2">
          {jobs.length === 0 && (
            <p className="text-void-500 text-sm">No jobs yet.</p>
          )}
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => attachToJob(j.id)}
              className="w-full text-left bg-void-900 border border-void-700 rounded p-3
                         hover:border-accent/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <code className="text-sm text-void-200 truncate flex-1">{j.command}</code>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${
                    j.status === 'running' ? 'bg-blue-900/40 text-blue-400 border-blue-700/30' :
                    j.status === 'exited' && j.exitCode === 0 ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/30' :
                    'bg-red-900/40 text-red-400 border-red-700/30'
                  }`}>
                    {j.status} {j.exitCode !== null ? `(${j.exitCode})` : ''}
                  </span>
                  <span className="text-xs text-void-600 font-mono">{j.id.slice(-8)}</span>
                  {j.status === 'running' && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onKill(j.id); }}
                      className="px-2 py-0.5 text-xs bg-red-900/30 border border-red-700/20
                                 rounded text-red-400 hover:bg-red-900/50"
                    >
                      kill
                    </button>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Key bar — always mounted, hidden on desktop */}
      <KeyBar onKey={onKeyBarKey} />
    </div>
  );
}
