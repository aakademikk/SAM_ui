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
 * A reconnecting client that asked for output the bounded buffer no longer
 * holds gets event: "truncated" with the missing sequence range, before the
 * replay, so it can mark the gap rather than render a hole as whole output.
 *
 * Server-side phase pings are emitted as event: "phase" with
 *   data: { "phase": "spawn"|"boot"|"context"|"model"|"done", "ms": <since start> }
 * naming the silent pre-output gaps (process boot, session/context load, first
 * model output) and heartbeating once a second for as long as the job is
 * running, so a client can show liveness instead of an indefinite spinner.
 * Phase events carry no id and are re-derived on reconnect rather than
 * replayed — but one is always emitted once the replay has settled, so a
 * reconnecting client can never keep a stale label.
 *
 * Query params:
 *   ?resume=1  — skip meta, only send new output (for reconnect)
 */

import { getJobManager, type OutputFrame } from '@/lib/server/jobs/manager';
import { requireSession } from '@/lib/server/auth/guard';
import { onShutdown } from '@/lib/server/shutdown';
import { failure } from '@/lib/server/respond';
import { serialTick } from '@/lib/server/serialTick';
import type { JobStatus } from '@/types/jobs';

export const dynamic = 'force-dynamic';

/**
 * True once a job can never produce more output. 'running' and 'queued' are
 * the only non-terminal statuses JobManager or sam-job ever write, so
 * checking those two (inverted) covers every terminal status by construction
 * — including sam-job's 'failed' and 'stopped', which this route used to
 * miss because it only matched 'exited' | 'killed' by name.
 */
function isFinishedStatus(status: JobStatus): boolean {
  return status !== 'running' && status !== 'queued';
}

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
      // Every terminal path funnels through here: stop polling, leave the
      // shutdown registry, and close the response. Without the unregister, each
      // stream the server has ever served would leave a dead closer behind; and
      // without the close, an open stream holds Next's `server.close()` open and
      // turns a restart into a 90-second SIGKILL (see lib/server/shutdown.ts).
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let finished = false;
      let offShutdown: () => void = () => {};
      const finish = () => {
        if (finished) return;
        finished = true;
        if (pollInterval) clearInterval(pollInterval);
        offShutdown();
        try {
          controller.close();
        } catch {
          // Already closed — the client disconnected first. Nothing to do.
        }
      };
      offShutdown = onShutdown(finish);

      /**
       * Enqueueing onto a closed controller throws ERR_INVALID_STATE, and in
       * Next's production server an unhandled one of those is a process-level
       * `uncaughtException` — logged on 2026-08-28, 2026-09-08 and 2026-09-10
       * from this exact route before the abort path was fixed. `finish()` is
       * guarded but every `enqueue` call site was not, and several of them sit
       * outside any try (the post-replay phase emit, for one).
       *
       * Marking the stream finished on the first failure is the important half:
       * a closed controller never reopens, so continuing to poll it would just
       * throw once per tick forever. This turns a crash into a clean stop.
       */
      const enqueue = (data: string) => {
        if (finished) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          finish();
        }
      };

      /* Registered BEFORE the replay and the poll interval, not after.
         `addEventListener('abort')` on an already-aborted signal never fires,
         so a client that disconnected during the awaited disk replay below used
         to leave the poll interval running to job end against a dead
         controller. Checking `aborted` as well covers the case where the signal
         fired before this line was reached. */
      if (request.signal.aborted) {
        finish();
        return;
      }
      request.signal.addEventListener('abort', finish, { once: true });

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
      }

      // 2. Replay any buffered output from the requested sequence
      try {
        const frames = await manager.getOutput(id, fromSeq);

        // The output file is a bounded window — whole frames are dropped off
        // the front once it reaches its cap — so a resume can land in a gap.
        // Saying so matters more than the trim itself: a client that is told
        // nothing renders an incomplete transcript as though it were whole.
        // Sequence numbers rise by one per frame, so a first frame past
        // `fromSeq + 1` is proof that exactly that happened.
        if (fromSeq > 0 && frames.length > 0 && frames[0].seq > fromSeq + 1) {
          enqueue(`event: truncated\n`);
          enqueue(
            `data: ${JSON.stringify({ from: fromSeq + 1, to: frames[0].seq - 1 })}\n\n`,
          );
        }

        for (const frame of frames) {
          const text = frame.data.toString('utf-8');
          enqueue(formatFrame(frame));
          scanFrame(text);
          lastSeq = Math.max(lastSeq, frame.seq);
        }
      } catch {
        // output file not readable yet — fine, proceed to live
      }

      // 2b. State the phase the replay settled on, on every connect. A
      // reconnect used to get no phase event at all, so the client kept
      // whatever label it last saw — the frozen "Booting SAM" sitting over a
      // turn that was working fine. Emitting after the replay means the label
      // always describes the real current phase, never the one it was born in.
      if (live.phase !== 'done') emitPhase();

      // 3. If job is already done (or orphaned), send closed and stop.
      // Any status other than 'running' or 'queued' is finished — covers
      // JobManager's 'exited' | 'killed' and sam-job's 'failed' | 'stopped'
      // alike, rather than naming each terminal status and missing the next
      // one a worker script introduces.
      if (isFinishedStatus(job.status) || orphaned) {
        if (live.phase !== 'done') {
          live.phase = 'done';
          emitPhase();
        }
        enqueue(`event: closed\n`);
        enqueue(`data: ${JSON.stringify({ status: orphaned ? 'killed' : job.status, exitCode: job.exitCode })}\n\n`);
        finish();
        return;
      }

      // 4. Poll for new output on running jobs. serialTick: a slow tick must
      // not overlap the next, or both send the same frames (doubled replies).
      pollInterval = setInterval(serialTick(async () => {
        // The callback is async, so one can already be in flight when finish()
        // clears the interval. Without this, that straggler still does two disk
        // reads for a stream nobody is listening to.
        if (finished) return;
        try {
          const current = await manager.get(id);
          if (!current) {
            enqueue(`event: closed\n`);
            enqueue(`data: ${JSON.stringify({ status: 'lost' })}\n\n`);
            finish();
            return;
          }

          // Orphan re-check: the record claims running but the process is gone
          // (external kill). Close instead of polling a corpse forever.
          if (current.status === 'running' && !manager.isLive(id)) {
            enqueue(`event: closed\n`);
            enqueue(`data: ${JSON.stringify({ status: 'killed', exitCode: null })}\n\n`);
            finish();
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
              enqueue(`event: closed\n`);
              enqueue(`data: ${JSON.stringify({ status: 'lost', exitCode: null })}\n\n`);
              finish();
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

          // Heartbeat for as long as the job is running, so the client can
          // tell "still working" from "connection died". This used to fire
          // only in spawn/context, which left the longest gap of all — a model
          // turn producing no output yet — with no liveness signal at all,
          // and the client's status line frozen on a stale label.
          if (live.phase !== 'done' && Date.now() - live.lastPing >= 1000) {
            live.lastPing = Date.now();
            emitPhase();
          }

          // Job finished
          if (isFinishedStatus(current.status)) {
            if (live.phase !== 'done') {
              live.phase = 'done';
              emitPhase();
            }
            enqueue(`event: closed\n`);
            enqueue(`data: ${JSON.stringify({ status: current.status, exitCode: current.exitCode })}\n\n`);
            finish();
          }
        } catch {
          // Manager error — keep polling
        }
      }), 100);
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
