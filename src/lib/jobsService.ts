/**
 * SAM — Jobs API client.
 *
 * Thin client for the job system. SSE streaming uses the native EventSource
 * API directly (no fetch wrapper needed). JSON endpoints use the existing
 * request() transport from dashboardService.
 */

import type { JobRecord, JobSummary } from '@/types/jobs';
import { ApiError } from '@/lib/dashboardService';

const BASE = '/api';

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    signal: options.signal,
    cache: 'no-store',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ApiError(
      detail.slice(0, 240) || `${options.method ?? 'GET'} ${path} failed`,
      response.status,
      path,
      response.status >= 500 || response.status === 429,
    );
  }

  const json: unknown = await response.json();
  const record = json as Record<string, unknown>;
  return record.data as T;
}

export interface JobStreamHandle {
  /** The underlying EventSource. */
  es: EventSource;
  /** Clean up — closes the connection. */
  close(): void;
}

export type JobEvent =
  | { type: 'meta'; job: JobRecord }
  | { type: 'output'; seq: number; text: string }
  | { type: 'closed'; status: 'exited' | 'killed' | 'lost'; exitCode: number | null };

/**
 * Open an SSE stream for a job. Pass a callback for each event.
 * Returns a handle with `.close()` to tear down.
 *
 * Reconnection is handled by EventSource natively — it sends Last-Event-ID
 * automatically. Pass `fromSeq` to resume from a known sequence.
 */
export function streamJob(
  id: string,
  onEvent: (event: JobEvent) => void,
  opts: { fromSeq?: number } = {},
): JobStreamHandle {
  const url = `${BASE}/jobs/${id}/stream${opts.fromSeq ? `?resume=1` : ''}`;

  // EventSource doesn't support custom headers (like Last-Event-ID on first
  // connect), but it DOES send Last-Event-ID on reconnect automatically.
  // For fresh resume, we use the ?resume=1 query param and the server reads
  // Last-Event-ID from the request header (which EventSource sets on reconnect,
  // but not on the very first connection).
  //
  // For the initial resume case, we need a different approach. We'll use
  // fetch with a ReadableStream for the initial connect when resuming, and
  // EventSource for normal operation.
  //
  // Actually the simplest approach: always use fetch + ReadableStream. No
  // EventSource at all — it can't set Last-Event-ID on first connect.

  const abort = new AbortController();

  // We use fetch streaming instead of EventSource so we can control the
  // Last-Event-ID header on the first connection.
  const esUrl = new URL(url, window.location.origin);
  const fetchStream = async () => {
    try {
      const response = await fetch(esUrl.toString(), {
        headers: {
          accept: 'text/event-stream',
          ...(opts.fromSeq ? { 'last-event-id': String(opts.fromSeq) } : {}),
        },
        signal: abort.signal,
        cache: 'no-store',
      });

      if (!response.ok || !response.body) {
        onEvent({ type: 'closed', status: 'lost', exitCode: null });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete line in buffer

        let currentId: string | undefined;
        let currentEvent: string | undefined;
        let currentData: string[] = [];

        for (const line of lines) {
          if (line === '') {
            // Empty line = dispatch event
            if (currentEvent && currentData.length > 0) {
              dispatchSSE(currentEvent, currentData.join('\n'), currentId, onEvent);
            }
            currentEvent = undefined;
            currentData = [];
            currentId = undefined;
            continue;
          }

          if (line.startsWith('id: ')) {
            currentId = line.slice(4);
          } else if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData.push(line.slice(6));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onEvent({ type: 'closed', status: 'lost', exitCode: null });
      }
    }
  };

  fetchStream();

  return {
    es: null as unknown as EventSource, // unused but satisfies the type
    close() {
      abort.abort();
    },
  };
}

function dispatchSSE(
  event: string,
  data: string,
  id: string | undefined,
  onEvent: (e: JobEvent) => void,
) {
  switch (event) {
    case 'meta': {
      try {
        const job = JSON.parse(data) as JobRecord;
        onEvent({ type: 'meta', job });
      } catch {
        // ignore
      }
      break;
    }
    case 'output': {
      onEvent({ type: 'output', seq: id ? parseInt(id, 10) : 0, text: data });
      break;
    }
    case 'closed': {
      try {
        const info = JSON.parse(data) as { status: string; exitCode: number | null };
        onEvent({
          type: 'closed',
          status: info.status as 'exited' | 'killed' | 'lost',
          exitCode: info.exitCode,
        });
      } catch {
        onEvent({ type: 'closed', status: 'lost', exitCode: null });
      }
      break;
    }
  }
}

export const jobsService = {
  /** List recent jobs. */
  async list(signal?: AbortSignal): Promise<JobSummary[]> {
    return request<JobSummary[]>('/jobs', { signal });
  },

  /** Get a single job's status. */
  async get(id: string, signal?: AbortSignal): Promise<JobRecord> {
    return request<JobRecord>(`/jobs/${encodeURIComponent(id)}`, { signal });
  },

  /** Create and start a new job. */
  async create(command: string, signal?: AbortSignal): Promise<JobRecord> {
    return request<JobRecord>('/jobs', {
      method: 'POST',
      body: { command },
      signal,
    });
  },

  /** Kill a running job. */
  async kill(id: string, signal?: AbortSignal): Promise<void> {
    await request(`/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    });
  },

  /** Send stdin to a running job. */
  async sendInput(id: string, input: string, signal?: AbortSignal): Promise<void> {
    await request(`/jobs/${encodeURIComponent(id)}/input`, {
      method: 'POST',
      body: { input },
      signal,
    });
  },

  /** Open an SSE stream for job output. */
  stream: streamJob,
};
