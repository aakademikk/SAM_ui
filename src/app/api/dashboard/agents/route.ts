import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

const ACTIONS = ['pause', 'resume', 'kill', 'boost'] as const;
type Action = (typeof ACTIONS)[number];

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(estate.getFleet(), 'sam.supervisor.fleet', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);

  const id = typeof body.id === 'string' ? body.id : null;
  const action = ACTIONS.includes(body.action as Action) ? (body.action as Action) : null;

  if (!id || !action) {
    return failure('Both an agent id and a valid action (pause|resume|kill|boost) are required.', 400);
  }

  const estate = getEstate();
  return envelope(estate.commandAgent(id, action), 'sam.supervisor.fleet', startedAt, estate.tick);
}
