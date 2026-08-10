/**
 * /jobs/[id] — Single job view with live output stream.
 *
 * Minimal Phase 3 UI for testing job streaming and resume.
 */

'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import type { JobRecord } from '@/types/jobs';
import { jobsService, type JobEvent } from '@/lib/jobsService';

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [output, setOutput] = useState<string>('');
  const [closed, setClosed] = useState(false);
  const [lastSeq, setLastSeq] = useState(0);
  const outputRef = useRef<HTMLPreElement>(null);

  // Load job metadata
  useEffect(() => {
    jobsService.get(id).then(setJob).catch(() => {});
  }, [id]);

  // Stream output
  useEffect(() => {
    setOutput('');
    setClosed(false);

    const handle = jobsService.stream(id, (event: JobEvent) => {
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
          jobsService.get(id).then(setJob).catch(() => {});
          break;
      }
    }, lastSeq > 0 ? { fromSeq: lastSeq } : {});

    return () => handle.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  if (!job) {
    return (
      <main className="min-h-screen bg-void-950 text-void-100 p-8 flex items-center justify-center">
        <p className="text-void-500">Loading job {id.slice(-8)}...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-void-950 text-void-100 flex flex-col p-4 md:p-8">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/jobs" className="text-void-500 hover:text-accent transition-colors">
          ← Jobs
        </Link>
        <h1 className="text-lg font-bold text-accent font-mono truncate">
          {job.command}
        </h1>
        <span className={`text-xs px-2 py-0.5 rounded border ${
          job.status === 'running' ? 'bg-blue-900/40 text-blue-400 border-blue-700/30' :
          job.status === 'exited' && job.exitCode === 0 ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/30' :
          'bg-red-900/40 text-red-400 border-red-700/30'
        }`}>
          {job.status} {job.exitCode !== null ? `(${job.exitCode})` : ''}
        </span>
      </div>

      {/* Output terminal */}
      <pre
        ref={outputRef}
        className="flex-1 bg-void-980 border border-void-700 rounded p-4 text-sm font-mono text-void-200 overflow-y-auto whitespace-pre-wrap break-all min-h-[60vh] max-h-[80vh]"
      >
        {output || (job.status === 'running' ? 'Waiting for output...' : '(no output)')}
        {job.status === 'running' && !closed && (
          <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-1 align-text-bottom" />
        )}
      </pre>

      <div className="mt-3 text-xs text-void-500 font-mono flex justify-between">
        <span>id: {job.id}</span>
        <span>created: {new Date(job.createdAt).toLocaleTimeString()}</span>
        {job.endedAt && <span>ended: {new Date(job.endedAt).toLocaleTimeString()}</span>}
      </div>
    </main>
  );
}
