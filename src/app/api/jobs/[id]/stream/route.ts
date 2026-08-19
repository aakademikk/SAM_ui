/**
 * GET /api/jobs/[id]/stream  → SSE stream of job output
 *
 * Supports reconnection via Last-Event-ID. Each event has:
 *   id: <sequence number>
 *   event: output
 *   data: <text chunk>
 *
 * A final event with event: "closed" is sent when the job exits.
 * The first event is always event: "meta" with the job record.
 *
 * Server-side phase pings are emitted as event: "phase" with
 *   data: { "phase": "spawn"|"boot"|"context"|"model"|"done", "ms": <since start> }
 * naming the silent pre-output gaps (process boot, session/context load, first
 * model output) and heartbeating once a second while one is open, so a client
 * can show liveness instead of an indefinite spinner. Phase events carry no id
 * and are re-derived on reconnect rather than replayed.
 *
 * Query params:
 *   ?resume=1  — skip meta, only send new output (for reconnect)
 */

import { getJobManager, type OutputFrame } from '@/lib/server/jobs/manager';
import { requireSession } from '@/lib/server/auth/guard';
import { failure } from '@/lib/server/respond';

export const dynamic = 'force-dynamic';

/**
 * A client that isn't consuming the stream (phone locked, tab backgrounded)
 * makes `enqueue` buffer without bound. Replays work from disk, so after this
 * long without a drain we close with 'lost' — the client reconnects and picks
 * up from its last sequence number, nothing is lost.
 */
const BACKPRESSURE_CLOSE_MS = 30_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Job output includes chat transcripts — reading it must not be open to any
  // tailnet client (Job 07 adjacent finding, fixed with Policy B).
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const { id } = await params;
  const manager = getJobManager();

  const job = await manager.get(id);
  if (!job) {
    return failure('Job not found.', 404);
  }

  // A record claiming 'running' with no live process behind it is an orphan
  // left by a service restart. Polling it would loop forever on a frozen
  // sequence number, so treat it as killed: the client finalises the turn
  // instead of hanging until the stuck watchdog fires.
  const orphaned = job.status === 'running' && !manager.isLive(id);

  const url = new URL(request.url);
  const resumeParam = url.searchParams.get('resume');
  const lastEventId = parseInt(request.headers.get('last-event-id') ?? '0', 10) || 0;

  const fromSeq = resumeParam === '1' ? lastEventId : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) => {
        controller.enqueue(encoder.encode(data));
      };

      let lastSeq = fromSeq;
      // Last time the stream's internal queue drained (desiredSize >= 0). A
      // long deficit means the client has stopped consuming — close the stream
      // rather than buffer without bound; the client reconnects and replays.
      let lastDrain = Date.now();

      /* ── Server-side phase pings ────────────────────────────────────────
         The client can derive content phases (thinking/working/streaming)
         from the stream itself, but the silent stretches before any model
         output are indistinguishable from a dead connection. These pings
         name the phase truthfully — process boot vs session/context load vs
         first model output — with ms since process start, and heartbeat
         once a second while one of those gaps is open so the client can
         show liveness rather than an indefinite spinner.
         Only stream-json jobs get the init/assistant scan; other jobs still
         get spawn/boot/done, which costs them nothing. */

      type PhaseId = 'spawn' | 'boot' | 'context' | 'model' | 'done';

      const startMs = job.startedAt ? Date.parse(job.startedAt) : Date.now();
      // Mutable phase state in a const holder — a bare `let phase` would get
      // narrowed to its initial 'spawn' inside these closures by TS, which is
      // exactly wrong for a variable that only changes at runtime.
      const live = {
        phase: 'spawn' as PhaseId,
        sawOutput: false,
        sawInit: false,
        sawAssistant: false,
        lastPing: Date.now(),
      };

      const phaseMs = () => Math.max(0, Date.now() - startMs);

      const emitPhase = () => {
        enqueue(`event: phase\n`);
        enqueue(`data: ${JSON.stringify({ phase: live.phase, ms: phaseMs() })}\n\n`);
      };

      /** Marker scan, not a JSON parser: stream-json lines are one object per
          line, so a line-prefix match is exact. Detects the CLI's init (CLI
          ready, session file loading) and the first assistant event (the
          model is producing). */
      const scanFrame = (text: string) => {
        if (live.phase === 'done') return;

        if (!live.sawOutput) {
          live.sawOutput = true;
          // Not stream-json (a terminal job) — the first byte is the last
          // signal we can name. Emit boot and stop scanning.
          if (!text.trimStart().startsWith('{')) {
            live.phase = 'boot';
            emitPhase();
            return;
          }
        }

        for (const line of text.split('\n')) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith('{')) continue;
          if (!live.sawInit) {
            if (
              trimmed.startsWith('{"type":"system"') &&
              trimmed.includes('"subtype":"init"')
            ) {
              live.sawInit = true;
              live.phase = 'context';
              emitPhase();
            }
          } else if (!live.sawAssistant && trimmed.startsWith('{"type":"assistant"')) {
            live.sawAssistant = true;
            live.phase = 'model';
            emitPhase();
          }
        }
      };

      // 1. Send job metadata first (only on fresh connect)
      if (fromSeq === 0) {
        enqueue(`id: 0\n`);
        enqueue(`event: meta\n`);
        enqueue(`data: ${JSON.stringify(job)}\n\n`);
        // Spawn ping only when nothing has been written yet — a reconnect to
        // an already-running job must not claim it is booting again.
        if (job.lastSeq === 0) emitPhase();
      }

      // 2. Replay any buffered output from the requested sequence
      try {
        const frames = await manager.getOutput(id, fromSeq);
        for (const frame of frames) {
          const text = frame.data.toString('utf-8');
          enqueue(formatFrame(frame));
          scanFrame(text);
          lastSeq = Math.max(lastSeq, frame.seq);
        }
      } catch {
        // output file not readable yet — fine, proceed to live
      }

      // 3. If job is already done (or orphaned), send closed and stop
      if (job.status === 'exited' || job.status === 'killed' || orphaned) {
        if (live.phase !== 'done') {
          live.phase = 'done';
          emitPhase();
        }
        enqueue(`event: closed\n`);
        enqueue(`data: ${JSON.stringify({ status: orphaned ? 'killed' : job.status, exitCode: job.exitCode })}\n\n`);
        controller.close();
        return;
      }

      // 4. Poll for new output on running jobs.
      const pollInterval = setInterval(async () => {
        try {
          const current = await manager.get(id);
          if (!current) {
            clearInterval(pollInterval);
            enqueue(`event: closed\n`);
            enqueue(`data: ${JSON.stringify({ status: 'lost' })}\n\n`);
            controller.close();
            return;
          }

          // Orphan re-check: the record claims running but the process is gone
          // (external kill). Close instead of polling a corpse forever.
          if (current.status === 'running' && !manager.isLive(id)) {
            clearInterval(pollInterval);
            enqueue(`event: closed\n`);
            enqueue(`data: ${JSON.stringify({ status: 'killed', exitCode: null })}\n\n`);
            controller.close();
            return;
          }

          // Backpressure: a client that stopped reading (phone locked, tab
          // backgrounded) makes enqueue buffer without bound. Replays work
          // from disk, so after BACKPRESSURE_CLOSE_MS without a drain close
          // with 'lost' — the client reconnects and picks up where it left off.
          const desiredSize = controller.desiredSize;
          if (desiredSize !== null) {
            if (desiredSize >= 0) {
              lastDrain = Date.now();
            } else if (Date.now() - lastDrain > BACKPRESSURE_CLOSE_MS) {
              clearInterval(pollInterval);
              enqueue(`event: closed\n`);
              enqueue(`data: ${JSON.stringify({ status: 'lost', exitCode: null })}\n\n`);
              controller.close();
              return;
            }
          }

          // Check for new output
          if (current.lastSeq > lastSeq) {
            const newFrames = await manager.getOutput(id, lastSeq);
            for (const frame of newFrames) {
              const text = frame.data.toString('utf-8');
              enqueue(formatFrame(frame));
              scanFrame(text);
              lastSeq = Math.max(lastSeq, frame.seq);
            }
          }

          // Heartbeat while stuck in a pre-output gap, so the client can tell
          // "still working" from "connection died".
          if (
            (live.phase === 'spawn' || live.phase === 'context') &&
            Date.now() - live.lastPing >= 1000
          ) {
            live.lastPing = Date.now();
            emitPhase();
          }

          // Job finished
          if (current.status === 'exited' || current.status === 'killed') {
            clearInterval(pollInterval);
            if (live.phase !== 'done') {
              live.phase = 'done';
              emitPhase();
            }
            enqueue(`event: closed\n`);
            enqueue(`data: ${JSON.stringify({ status: current.status, exitCode: current.exitCode })}\n\n`);
            controller.close();
          }
        } catch {
          // Manager error — keep polling
        }
      }, 100);

      // Cleanup on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
      connection: 'keep-alive',
    },
  });
}

function formatFrame(frame: OutputFrame): string {
  // SSE requires one `data:` field per line. Emitting raw newlines inside a
  // single `data:` silently drops every line after the first, which matters
  // enormously for newline-delimited payloads (e.g. agent stream-json).
  // Splitting here round-trips exactly: the client rejoins the fields with \n.
  const text = frame.data.toString('utf-8');
  let out = `id: ${frame.seq}\n`;
  out += `event: output\n`;
  for (const line of text.split('\n')) {
    out += `data: ${line}\n`;
  }
  out += `\n`;
  return out;
}
