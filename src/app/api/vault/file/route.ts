import fs from 'node:fs';
import { Readable } from 'node:stream';
import { requireSession } from '@/lib/server/auth/guard';
import { refuse, resolveVaultFile } from '@/lib/server/vaultFiles';
import { headersFor, notFound, parseRange } from '@/lib/server/vaultServe';

export const dynamic = 'force-dynamic';

/** Types served with byte ranges (phone seeking, lazy PDF pages). */
const RANGED = new Set(['mp4', 'webm', 'pdf']);

/**
 * GET /api/vault/file?path=<p>[&from=<item path>] — the bytes of one vault
 * file. Session-gated before any path work; every refusal is the same 404 and
 * one audit line. Streams from disk, never buffers. Read-only: no other
 * method is exported, so Next answers them with 405.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const url = new URL(request.url);
  const asked = url.searchParams.get('path');
  const from = url.searchParams.get('from') ?? undefined;

  const r = await resolveVaultFile(asked, { from });
  if (!r.ok) {
    await refuse(asked ?? '', r.reason);
    return notFound();
  }

  const headers = headersFor(r.ext, r.size);
  if (RANGED.has(r.ext.toLowerCase())) {
    headers['Accept-Ranges'] = 'bytes';
    const range = parseRange(request.headers.get('range'), r.size);
    if (range === 416) {
      headers['Content-Range'] = `bytes */${r.size}`;
      headers['Content-Length'] = '0';
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      const { start, end } = range;
      headers['Content-Range'] = `bytes ${start}-${end}/${r.size}`;
      headers['Content-Length'] = String(end - start + 1);
      const part = Readable.toWeb(
        fs.createReadStream(r.abs, { start, end }),
      ) as unknown as ReadableStream<Uint8Array>;
      return new Response(part, { status: 206, headers });
    }
  }

  const stream = fs.createReadStream(r.abs);
  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}
