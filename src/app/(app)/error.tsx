'use client';

import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * Error boundary for every shelled page (dashboard, terminal, chat, practice,
 * operations, fleet, status, settings).
 *
 * Added 2026-09-20 (SAM_ui_Audit_2026-09-20 finding 7). Before this, a render
 * throw anywhere under (app) took the whole PWA to Next's generic "Application
 * error: a client-side exception has occurred" — no shell, no nav, no way back
 * except killing the app. The 1,606-line chat page (25 useState, 22 useEffect,
 * 27 useRef) is the most likely origin, and it is also the page you least want
 * to lose on a phone mid-turn.
 *
 * This boundary keeps the shell mounted, so the sidebar and tab bar still work
 * and only the failed page is replaced — you can navigate away instead of
 * force-quitting.
 *
 * Type uses dim-*, surfaces use void-*. `text-void-600` is #16162c and is
 * invisible on a near-black page; see globals.css.
 */

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server has no idea a client component threw. One line in the browser
    // console is the only breadcrumb a future debugging session gets.
    console.error('[sam-ui] page render failed:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-void-500 bg-void-900/80 p-6">
        <p className="text-xs tracking-[0.2em] text-dim-500">SAM</p>
        <h1 className="mt-2 text-lg text-dim-100">This page failed to render.</h1>
        <p className="mt-3 text-sm leading-relaxed text-dim-400">
          The shell is still running, so the nav below still works. Try again
          first — if it fails the same way twice, the served build and this
          tab&apos;s cached HTML have probably drifted apart, and a redeploy
          (<code className="text-dim-300">./deploy.sh</code>) is the fix.
        </p>

        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-dim-500">
            digest {error.digest}
          </p>
        ) : null}

        {error.message ? (
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-void-600 bg-void-950 p-3 font-mono text-xs leading-relaxed text-dim-400">
            {error.message}
          </pre>
        ) : null}

        <button
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-void-400 bg-void-600 px-4 py-2 text-sm text-dim-200 transition-colors hover:bg-void-500"
        >
          <RotateCcw size={14} aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
