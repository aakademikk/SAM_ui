'use client';

/**
 * Last-resort error boundary — catches a throw in the root layout itself,
 * which is the one place `error.tsx` cannot reach. Next renders this INSTEAD OF
 * the root layout, so it has to ship its own <html> and <body> and cannot use
 * any of the app's providers, fonts or shell.
 *
 * Why this file exists (SAM_ui_Audit_2026-09-20 finding 7): the app had no
 * error boundaries at all. Any render throw in a client component white-screened
 * into Next's generic "Application error: a client-side exception has occurred"
 * — the exact string the PWA caching rules already identify as this app's most
 * misleading failure, because it reads as a code bug when it is usually a stale
 * chunk. An unstyled but honest page that says which layer failed, and offers a
 * reload, is worth more than a blank screen.
 *
 * Styling is inline on purpose: if the root layout threw, globals.css may not
 * have been applied.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#08080f',
          color: '#c8c8d8',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.75rem',
              letterSpacing: '0.2em',
              color: '#6b6b8a',
            }}
          >
            SAM
          </p>
          <h1 style={{ margin: '0.5rem 0 1rem', fontSize: '1.25rem' }}>
            The shell failed to render.
          </h1>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            This is the root layout, not a page — so a reload is the right first
            move. If it persists after a reload, the served build and the cached
            HTML have probably drifted apart; redeploy with{' '}
            <code>./deploy.sh</code>.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: '0 0 1.5rem',
                fontSize: '0.75rem',
                color: '#6b6b8a',
              }}
            >
              digest {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              background: '#16162c',
              border: '1px solid #2a2a4a',
              borderRadius: '0.5rem',
              color: '#c8c8d8',
              cursor: 'pointer',
              font: 'inherit',
              padding: '0.6rem 1.1rem',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
