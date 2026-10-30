/**
 * The Approve part of a Notifications row for a Monday-pack ping (spec must-do 10).
 *
 * A pack ping carries a questionId and no jobId, and matches no closer question,
 * so QuestionRow never shows for it. On mount this asks GET /api/pack/approve for
 * the state: pending shows an Approve button that POSTs and shows the result text;
 * approved shows "Approved" and the time; stale or unknown shows "No longer
 * current" with no button; a failed fetch shows nothing (the row stays a plain link).
 */

'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

const BUTTON =
  'min-h-[44px] min-w-[44px] flex-1 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-50';

export type PackApproveState = 'loading' | 'failed' | 'pending' | 'approved' | 'stale' | 'unknown';

export interface PackApproveViewProps {
  state: PackApproveState;
  busy?: boolean;
  message?: string | null;
  result?: string | null;
  approvedAt?: string | null;
  onApprove: () => void;
}

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function PackApproveView({ state, busy, message, result, approvedAt, onApprove }: PackApproveViewProps) {
  if (state === 'loading' || state === 'failed') return null;

  if (state === 'pending') {
    return (
      <div className="px-4 pb-3 bg-void-900/60 space-y-2" data-pack-state="pending">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className={cn(BUTTON, 'border-accent/40 bg-accent/20 text-accent hover:bg-accent/30')}
          >
            Approve
          </button>
        </div>
        {message && <p className="text-xs text-alarm-400">{message}</p>}
      </div>
    );
  }

  if (state === 'approved') {
    const at = when(approvedAt);
    return (
      <div className="px-4 pb-3 bg-void-900/60 space-y-0.5" data-pack-state="approved">
        <p className="text-sm font-medium text-void-100">
          Approved
          {at && <span className="ml-2 text-[12px] font-mono text-dim-500">{at}</span>}
        </p>
        {result && <p className="text-xs text-dim-400">{result}</p>}
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 bg-void-900/60" data-pack-state={state}>
      <p className="text-sm text-dim-400">No longer current</p>
    </div>
  );
}

interface PackEnvelope {
  data?: { state?: string; result?: string | null };
}

function asState(raw: unknown): PackApproveState | null {
  return raw === 'pending' || raw === 'approved' || raw === 'stale' || raw === 'unknown' ? raw : null;
}

export function PackApproveRow({ questionId }: { questionId: string }) {
  const [state, setState] = useState<PackApproveState>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // no-store: the service worker would otherwise serve /api/ GETs for up to 60 s.
        const res = await fetch(`/api/pack/approve?questionId=${encodeURIComponent(questionId)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as PackEnvelope;
        const next = asState(json.data?.state);
        if (alive) setState(next ?? 'failed');
      } catch {
        if (alive) setState('failed');
      }
    })();
    return () => {
      alive = false;
    };
  }, [questionId]);

  async function approve() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/pack/approve', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-answer-via': 'tab' },
        body: JSON.stringify({ questionId }),
      });
      if (res.status === 404) {
        setState('stale');
        return;
      }
      const json = (await res.json().catch(() => ({}))) as PackEnvelope;
      const next = asState(json.data?.state);
      if (!res.ok || !next) {
        setMessage(`Could not send (${res.status}).`);
        return;
      }
      setState(next);
      setResult(typeof json.data?.result === 'string' ? json.data.result : null);
      if (next === 'approved') setApprovedAt(new Date().toISOString());
    } catch {
      setMessage('Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PackApproveView
      state={state}
      busy={busy}
      message={message}
      result={result}
      approvedAt={approvedAt}
      onApprove={() => void approve()}
    />
  );
}
