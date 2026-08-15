/**
 * SAM — Fleet API client.
 *
 * Registry (roster), dispatch (run a persona), and spend (cost-to-date).
 * Output streaming reuses the existing job SSE stream — a dispatched run is a
 * job like any other, so reconnection and resume come for free.
 */

import type { FleetPersona, FleetDispatchResult, FleetSpend, FleetPersonaJob } from '@/types/fleet';
import { ApiError } from '@/lib/dashboardService';

const BASE = '/api/fleet';

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
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      stepUpRequired?: boolean;
    };
    const error = new ApiError(
      body.error ?? `${options.method ?? 'GET'} ${path} failed`,
      response.status,
      path,
      response.status >= 500 || response.status === 429,
    ) as ApiError & { stepUpRequired?: boolean };
    if (response.status === 401 && body.stepUpRequired) error.stepUpRequired = true;
    throw error;
  }

  const json: unknown = await response.json();
  const record = json as Record<string, unknown>;
  return record.data as T;
}

export const fleetService = {
  /** The roster of personas `--agent` can accept. */
  async registry(signal?: AbortSignal): Promise<FleetPersona[]> {
    return request<FleetPersona[]>('/registry', { signal });
  },

  /** Dispatch a persona as a stateless job. Returns the job to stream. */
  async dispatch(
    params: { persona: string; model: string; brief: string },
    signal?: AbortSignal,
  ): Promise<FleetDispatchResult> {
    return request<FleetDispatchResult>('/dispatch', {
      method: 'POST',
      body: params,
      signal,
    });
  },

  /** Cost-to-date per persona across the retained job store. */
  async spend(signal?: AbortSignal): Promise<FleetSpend> {
    return request<FleetSpend>('/spend', { signal });
  },

  /** A persona's last 10 fleet jobs, costed, newest first. */
  async jobsByPersona(
    persona: string,
    signal?: AbortSignal,
  ): Promise<{ persona: string; jobs: FleetPersonaJob[] }> {
    return request<{ persona: string; jobs: FleetPersonaJob[] }>(
      `/jobs?persona=${encodeURIComponent(persona)}`,
      { signal },
    );
  },
};
