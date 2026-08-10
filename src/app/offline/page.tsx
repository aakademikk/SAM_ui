/**
 * Offline fallback page.
 *
 * SAM does not pretend to work offline — the agent lives on the desktop.
 * This page shows a clear signal that the connection is down and offers a retry.
 * No JavaScript required — the SW serves this as a static HTML page.
 */

import Link from 'next/link';

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-void-950 text-void-100 flex items-center justify-center p-8">
      <div className="text-center space-y-5 max-w-sm">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-900/30 border border-red-700/30">
          <span className="text-2xl">⚡</span>
        </div>

        <h1 className="text-xl font-bold text-void-100">SAM is unreachable</h1>

        <p className="text-void-400 text-sm leading-relaxed">
          Your phone cannot reach the desktop. SAM runs on the machine in your
          office — it does not work offline. The agent, your data, and every
          command all live on that machine.
        </p>

        <p className="text-void-500 text-xs">
          Check your connection to the tailnet, then retry.
        </p>

        <Link
          href="/"
          className="inline-block px-5 py-2.5 bg-accent/20 border border-accent/40 rounded-lg
                     text-accent text-sm font-medium hover:bg-accent/30 transition-colors"
        >
          Retry
        </Link>
      </div>
    </main>
  );
}
