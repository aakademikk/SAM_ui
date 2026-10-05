import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { getUsage } from '@/lib/server/usage/usageRuns';

export const dynamic = 'force-dynamic';

/** Reads open, like the other dashboard routes. Only reports what runs already
 *  wrote to the quota log: it never starts a Claude run or touches the network. */
export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(getUsage(), 'sam.usage.limits', startedAt, estate.tick);
}
