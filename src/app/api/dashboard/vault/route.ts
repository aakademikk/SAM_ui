import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(estate.getVault(), 'sam.memory.vault', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const query = typeof body.query === 'string' ? body.query.trim() : '';

  if (!query) return failure('A query string is required.', 400);
  if (query.length > 400) return failure('Query exceeds the 400 character limit.', 413);

  const estate = getEstate();
  estate.recordVaultQuery(query, 'OPERATOR');
  return envelope(estate.getVault(), 'sam.memory.vault', startedAt, estate.tick);
}
