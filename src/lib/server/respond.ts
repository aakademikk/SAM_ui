import { NextResponse } from 'next/server';

import type { ApiEnvelope } from '@/types/dashboard';

/** Wraps a payload in the envelope every client parser expects. */
export function envelope<T>(data: T, source: string, startedAt: number, tick: number) {
  const body: ApiEnvelope<T> = {
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      latencyMs: Math.max(0, Date.now() - startedAt),
      source,
      tick,
    },
  };

  return NextResponse.json(body, {
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

export function failure(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}

/** Parses a JSON body without throwing on malformed input. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
