/**
 * SAM — Named Operations API client.
 *
 * Registry reads the vault-defined pipelines; dispatch launches one as a fleet
 * job. Output streaming reuses the job SSE stream — an operation run is a job
 * like any other, so reconnection and resume come for free.
 */

import type { Operation, OperationDispatchResult, OperationsPayload } from '@/types/operations';
import { ApiError } from '@/lib/dashboardService';

const BASE = '/api/operations';

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
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
  return (json as Record<string, unknown>).data as T;
}

export const operationsService = {
  /** The operations defined in the vault registry. */
  async registry(signal?: AbortSignal): Promise<OperationsPayload> {
    return request<OperationsPayload>('', { signal });
  },

  /** Launch an operation. Returns the job to stream. */
  async dispatch(
    params: { operationId: Operation['id']; model?: string },
    signal?: AbortSignal,
  ): Promise<OperationDispatchResult> {
    return request<OperationDispatchResult>('/dispatch', {
      method: 'POST',
      body: params,
      signal,
    });
  },
};
