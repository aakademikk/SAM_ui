import type { SarcasmLevel } from '@/lib/personalityEngine';
import { executeCommand } from '@/lib/server/commands';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

const MAX_COMMAND_LENGTH = 512;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);
  const command = typeof body.command === 'string' ? body.command : '';

  if (!command.trim()) return failure('No command supplied.', 400);
  if (command.length > MAX_COMMAND_LENGTH) {
    return failure(`Command exceeds ${MAX_COMMAND_LENGTH} characters.`, 413);
  }

  const sarcasm = ([0, 1, 2, 3] as const).includes(body.sarcasm as SarcasmLevel)
    ? (body.sarcasm as SarcasmLevel)
    : 2;

  // Resolved against the estate model — see the security note in commands.ts.
  const result = executeCommand(command, sarcasm);
  const estate = getEstate();

  return envelope(result, 'sam.shell', startedAt, estate.tick);
}
