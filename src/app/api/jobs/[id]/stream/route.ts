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
 * Query params:
 *   ?resume=1  — skip meta, only send new output (for reconnect)
 */

import { getJobManager, type OutputFrame } from '@/lib/server/jobs/manager';
import { failure } from '@/lib/server/respond';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const manager = getJobManager();

  const job = await manager.get(id);
  if (!job) {
    return failure('Job not found.', 404);
  }

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

      // 1. Send job metadata first (only on fresh connect)
      if (fromSeq === 0) {
        enqueue(`id: 0\n`);
        enqueue(`event: meta\n`);
        enqueue(`data: ${JSON.stringify(job)}\n\n`);
      }

      // 2. Replay any buffered output from the requested sequence
      try {
        const frames = await manager.getOutput(id, fromSeq);
        for (const frame of frames) {
          enqueue(formatFrame(frame));
          lastSeq = Math.max(lastSeq, frame.seq);
        }
      } catch {
        // output file not readable yet — fine, proceed to live
      }

      // 3. If job is already done, send closed and stop
      if (job.status === 'exited' || job.status === 'killed') {
        enqueue(`event: closed\n`);
        enqueue(`data: ${JSON.stringify({ status: job.status, exitCode: job.exitCode })}\n\n`);
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

          // Check for new output
          if (current.lastSeq > lastSeq) {
            const newFrames = await manager.getOutput(id, lastSeq);
            for (const frame of newFrames) {
              enqueue(formatFrame(frame));
              lastSeq = Math.max(lastSeq, frame.seq);
            }
          }

          // Job finished
          if (current.status === 'exited' || current.status === 'killed') {
            clearInterval(pollInterval);
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
  let out = `id: ${frame.seq}\n`;
  out += `event: output\n`;
  out += `data: ${frame.data.toString('utf-8')}\n\n`;
  return out;
}
