import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(estate.getInsights(), 'sam.analysis.insights', startedAt, estate.tick);
}

export async function PATCH(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const id = typeof body.id === 'string' ? body.id : null;

  if (!id) return failure('An insight id is required.', 400);

  const estate = getEstate();
  return envelope(estate.acknowledgeInsight(id), 'sam.analysis.insights', startedAt, estate.tick);
}
