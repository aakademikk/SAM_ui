/**
 * Graceful-shutdown registry.
 *
 * `next start` does install its own SIGTERM handler, but in production it can
 * never finish. It awaits `server.close()`, which stops accepting new
 * connections and waits for the open ones to end — and it calls
 * `server.closeAllConnections()`, the thing that would force them shut, **only
 * when `isDev`** (`next/dist/server/lib/start-server.js`). An SSE stream never
 * ends on its own, so shutdown hung until systemd lost patience and SIGKILLed
 * the process 90 seconds later, recording the unit as failed. Measured: three
 * of the four restarts before this existed.
 *
 * Closing the streams is what lets Next's own cleanup complete and exit on its
 * own. The timer is the backstop for anything else still holding a connection
 * open — a prompt exit beats systemd's SIGKILL every time.
 */

type Closer = () => void;

const closers = new Set<Closer>();
let shuttingDown = false;

/** How long Next's own cleanup gets to finish before the process is forced out. */
const BACKSTOP_MS = 3_000;

function runShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  // Ending the streams is what unblocks `server.close()`.
  for (const close of closers) {
    try {
      close();
    } catch {
      // One failing stream must not stop the others from closing.
    }
  }
  closers.clear();

  setTimeout(() => process.exit(0), BACKSTOP_MS).unref();
}

// Wired on first import (the job stream route is the only importer). A server
// that never held a stream open keeps Next's own behaviour untouched: with
// nothing left to wait for, its cleanup finishes by itself.
process.on('SIGTERM', runShutdown);
process.on('SIGINT', runShutdown);

/**
 * Register a cleanup to run at shutdown. Returns the unregister — call it when
 * the stream ends, or the registry would hold a dead closer for every stream
 * the server has ever served.
 */
export function onShutdown(close: Closer): () => void {
  if (shuttingDown) {
    // A stream opened while we are already shutting down would otherwise never
    // close, and would keep `server.close()` waiting for it.
    close();
    return () => {};
  }

  closers.add(close);
  return () => closers.delete(close);
}
