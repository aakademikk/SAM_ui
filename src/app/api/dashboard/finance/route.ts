import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

const RANGE_POINTS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function GET(request: Request) {
  const startedAt = Date.now();
  const estate = getEstate();
  const range = new URL(request.url).searchParams.get('range') ?? '30d';
  const points = RANGE_POINTS[range] ?? 30;

  const finance = estate.getFinance();
  // The simulator retains 30 days; wider ranges return what exists rather than
  // fabricating history that was never recorded.
  const trim = <T,>(series: T[]) => series.slice(-points);

  return envelope(
    {
      ...finance,
      balanceSeries: trim(finance.balanceSeries),
      inflowSeries: trim(finance.inflowSeries),
      outflowSeries: trim(finance.outflowSeries),
    },
    'sam.finance.ledger',
    startedAt,
    estate.tick,
  );
}
