import { envelope, failure, readJson } from '@/lib/server/respond';
import { requireSession } from '@/lib/server/auth/guard';
import { getEstate } from '@/lib/server/telemetry';
import {
  addEntry,
  deleteEntry,
  getSummary,
  isValidDate,
} from '@/lib/server/moneyState';

export const dynamic = 'force-dynamic';

const MAX_LABEL = 120;
const MAX_SOURCE = 60;

/** Local calendar day as YYYY-MM-DD — matches the widget's default date. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Auth boundary: reads stay open (matches the long-standing dashboard
 * posture), but logging or removing money writes to the persisted store —
 * those require a logged-in session, same as the tasks widget.
 */
async function requireWrite(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  return null;
}

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(getSummary(), 'sam.money.in', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const denied = await requireWrite(request);
  if (denied) return denied;

  const startedAt = Date.now();
  const body = await readJson(request);

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const amount = body.amount;
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  const date = typeof body.date === 'string' ? body.date : todayLocal();
  const recurring = typeof body.recurring === 'boolean' ? body.recurring : false;

  if (!label) return failure('A label is required.', 400);
  if (label.length > MAX_LABEL) return failure('Label exceeds 120 characters.', 413);
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return failure('Amount must be a whole positive number of pounds.', 400);
  }
  if (source.length > MAX_SOURCE) return failure('Source exceeds 60 characters.', 413);
  if (!isValidDate(date)) return failure('Date must be YYYY-MM-DD.', 400);

  addEntry({ label, amount, date, source, recurring });

  const estate = getEstate();
  return envelope(getSummary(), 'sam.money.in', startedAt, estate.tick);
}

export async function DELETE(request: Request) {
  const denied = await requireWrite(request);
  if (denied) return denied;

  const startedAt = Date.now();
  const body = await readJson(request);
  const id = typeof body.id === 'string' ? body.id : null;

  if (!id) return failure('An entry id is required.', 400);
  if (!deleteEntry(id)) return failure('No money entry with that id.', 404);

  const estate = getEstate();
  return envelope(getSummary(), 'sam.money.in', startedAt, estate.tick);
}
