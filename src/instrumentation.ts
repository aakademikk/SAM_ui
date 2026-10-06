/**
 * Next calls `register()` once, when the server process starts.
 *
 * Two jobs here. First, warm the local Kokoro TTS engine so the chat voice's fallback
 * is instant. `voice-line` is the primary and it *stalls* rather than fails —
 * the chat route logged 10 fallbacks in 7 days, every one a TimeoutError — and
 * every cold fallback costs ~4s of model load on top of changing voice
 * mid-answer. Warming at boot pays that once, off the critical path.
 *
 * (Second, the usage-alert sweep, below.) Deliberately fire-and-forget, after a short delay: it must never block boot
 * or the first request, and a failure here must never take the server down.
 * TTS is a nice-to-have; the dashboard is not.
 *
 * Guarded to the node runtime, and the import is dynamic, so the edge bundle
 * never pulls in the native sherpa-onnx addon.
 */

const WARM_DELAY_MS = 5_000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Usage alerts, once a minute: a reading written by a fleet job or the hourly
  // timer pings within a minute, dashboard open or not. Not during `next build`
  // (which loads this file), and a failure here never blocks boot.
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const { startUsageSweep } = await import('@/lib/server/usage/usageSweep');
      startUsageSweep();
    } catch (err) {
      console.warn(
        `[usage-sweep] not started: ${err instanceof Error ? err.message : 'unknown'} — alerts still fire when a chat turn ends`,
      );
    }
  }

  setTimeout(() => {
    void (async () => {
      try {
        const { warmTts } = await import('@/lib/server/voice/tts');
        console.log(`[tts-warm] Kokoro warmed in ${warmTts()}ms`);
      } catch (err) {
        console.warn(
          `[tts-warm] warm failed: ${err instanceof Error ? err.message : 'unknown'} — the first fallback will pay the load instead`,
        );
      }
    })();
  }, WARM_DELAY_MS);
}
