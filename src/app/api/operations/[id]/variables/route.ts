/**
 * POST /api/operations/[id]/variables — set an operation's variable block.
 *
 * Session required (not step-up): this edits a vault note — the same privilege
 * as loading the ops page — not a live process. The client sends the FULL array
 * it wants to keep, so add and delete are the same replace call.
 *
 * Values are written to the vault note in plaintext and handed to the dispatched
 * agent verbatim in its brief, so they are configuration, not secrets. Keep
 * credentials out of them.
 */

import { findOperation, setOperationVariables } from '@/lib/server/operations';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const { id } = await params;

  if (!findOperation(id)) {
    return failure(`Unknown operation '${id}'.`, 404);
  }

  const body = await readJson(request);
  const raw = Array.isArray(body.variables) ? body.variables : [];
  const variables = raw
    .map((v) => ({
      key: typeof v?.key === 'string' ? v.key.trim() : '',
      value: typeof v?.value === 'string' ? v.value.trim() : '',
    }))
    .filter((v) => v.key.length > 0);

  // Last write wins for duplicate keys.
  const deduped = [...new Map(variables.map((v) => [v.key, v])).values()];

  if (!setOperationVariables(id, deduped)) {
    return failure('Could not write variables to the vault note.', 500);
  }

  return envelope(
    { ok: true, id, variables: deduped },
    'sam.operations.variables',
    startedAt,
    estate.tick,
  );
}
