/**
 * /jobs — Job list page.
 *
 * Minimal Phase 3 UI for testing the job system. The full terminal widget
 * arrives in Phase 4 alongside the responsive layout work.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { JobSummary } from '@/types/jobs';
import { jobsService } from '@/lib/jobsService';

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const list = await jobsService.list();
      setJobs(list);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    setLoading(true);
    try {
      await jobsService.create(command.trim());
      setCommand('');
      await refresh();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const onKill = async (id: string) => {
    try {
      await jobsService.kill(id);
      await refresh();
    } catch {
      // silent
    }
  };

  return (
    <main className="min-h-screen bg-void-950 text-void-100 p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-6 text-accent">SAM · Jobs</h1>

      {/* Quick launcher */}
      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter a command..."
          className="flex-1 bg-void-900 border border-void-600 rounded px-3 py-2 text-void-100 font-mono text-sm focus:border-accent focus:outline-none"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !command.trim()}
          className="px-4 py-2 bg-accent/20 border border-accent/40 rounded text-accent text-sm font-medium hover:bg-accent/30 disabled:opacity-40 transition-colors"
        >
          {loading ? '...' : 'Run'}
        </button>
      </form>

      {/* Job list */}
      <div className="space-y-2">
        {jobs.length === 0 && (
          <p className="text-void-500 text-sm">No jobs yet.</p>
        )}
        {jobs.map((job) => (
          <Link
            key={job.id}
            href={`/jobs/${job.id}`}
            className="block bg-void-900 border border-void-700 rounded p-3 hover:border-accent/30 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <code className="text-sm text-void-200 truncate flex-1">
                {job.command}
              </code>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={job.status} exitCode={job.exitCode} />
                <span className="text-xs text-void-500 font-mono">
                  {job.id.slice(-8)}
                </span>
                {job.status === 'running' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onKill(job.id);
                    }}
                    className="px-2 py-0.5 text-xs bg-red-900/40 border border-red-700/30 rounded text-red-400 hover:bg-red-900/60"
                  >
                    kill
                  </button>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

function StatusBadge({ status, exitCode }: { status: string; exitCode: number | null }) {
  const colours: Record<string, string> = {
    queued: 'bg-void-700 text-void-300',
    running: 'bg-blue-900/40 text-blue-400 border-blue-700/30',
    exited: exitCode === 0
      ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/30'
      : 'bg-red-900/40 text-red-400 border-red-700/30',
    killed: 'bg-amber-900/40 text-amber-400 border-amber-700/30',
  };

  const label = status === 'exited' && exitCode !== null
    ? `${status} (${exitCode})`
    : status;

  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colours[status] ?? 'bg-void-700 text-void-300'}`}>
      {label}
    </span>
  );
}
