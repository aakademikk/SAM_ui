import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(estate.getSystem(), 'sam.telemetry.host', startedAt, estate.tick);
}
