/**
 * SignedOutOverlay — blocks the app once useAuthGate notices this device has
 * been revoked (open question 1, ux-fixes-spec.md §6, resolved: an explicit
 * sign-out message, not a silently-stale screen).
 *
 * There is no separate /login route in this app — the whole shell renders
 * regardless of auth state — so "returns to the login screen" means this: a
 * full-screen panel above everything else that blocks interaction with the
 * stale content behind it and offers the same passkey re-auth affordance the
 * Sidebar's LoginButton uses, without navigating anywhere.
 *
 * This renders `null` the moment the gate is `'ok'`, which is the whole of
 * its effect on an authenticated session.
 */

'use client';

import { useState } from 'react';
import { LogIn, ShieldOff } from 'lucide-react';

import { useAuthGate } from '@/lib/useAuthGate';
import { authService } from '@/lib/authService';

export function SignedOutOverlay() {
  const gate = useAuthGate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (gate !== 'signed-out') {
    return null;
  }

  const onReauth = async () => {
    setLoading(true);
    setError(null);
    try {
      await authService.authenticate();
      // useAuthGate's poll has already stopped (by design — see its own
      // comment on why 'signed-out' is terminal for a hook lifetime), so the
      // only way to make the rest of the app trust the new session again
      // is a fresh page load, which also gives every other service's own
      // local state (chat, fleet, etc.) a clean start rather than papering
      // over up to 5s of stale polling.
      window.location.reload();
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        setError(err.message.slice(0, 80));
      }
      setLoading(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="signed-out-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <div className="glass-strong relative w-full max-w-sm rounded-[8px] p-6 text-center shadow-[0_28px_70px_-18px_rgba(0,0,0,0.92)]">
        <ShieldOff size={28} className="mx-auto mb-4 text-amber-400" aria-hidden="true" />
        <h2 id="signed-out-title" className="text-base font-semibold text-void-100">
          This device has been signed out.
        </h2>
        <p className="mt-2 text-sm text-dim-200">
          The passkey for this session was revoked. Sign in again to continue.
        </p>
        <button
          type="button"
          onClick={onReauth}
          disabled={loading}
          className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md
                     bg-accent px-4 py-2.5 text-sm font-medium text-void-950 transition-colors
                     hover:bg-accent/90 disabled:opacity-60"
        >
          <LogIn size={16} />
          {loading ? 'Authenticating...' : 'Sign in again'}
        </button>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
