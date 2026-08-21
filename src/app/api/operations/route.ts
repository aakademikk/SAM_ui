/**
 * GET /api/operations — the named-operation registry, read live from the vault.
 *
 * Session required (read operation). Parsed from
 * `00_SAM_Control/Named Operations.md` on every call (8s cache) so editing the
 * note in Obsidian is all it takes to change what a launch runs — the
 * dashboard never holds its own copy of a pipeline.
 */

import { readOperations } from '@/lib/server/operations';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const { operations, available } = readOperations();
  return envelope({ operations, available }, 'sam.operations.registry', startedAt, estate.tick);
}
