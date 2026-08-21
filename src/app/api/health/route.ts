import { execSync } from 'node:child_process';
import os from 'node:os';

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

const GIT_SHA = readGitSha();
const PROCESS_STARTED_AT = new Date(
  Date.now() - process.uptime() * 1000,
).toISOString();

function readGitSha(): string | null {
  try {
    // Run from the project root so git can find .git even when the cwd is elsewhere.
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 2000,
    });
    return sha.trim() || null;
  } catch {
    return null;
  }
}

export interface HealthPayload {
  uptime: {
    system: number; // seconds since boot
    process: number; // seconds since this server started
  };
  startedAt: string; // ISO-8601
  gitSHA: string | null;
  nodeVersion: string;
}

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();

  const payload: HealthPayload = {
    uptime: {
      system: os.uptime(),
      process: process.uptime(),
    },
    startedAt: PROCESS_STARTED_AT,
    gitSHA: GIT_SHA,
    nodeVersion: process.version,
  };

  return envelope(payload, 'sam.health', startedAt, estate.tick);
}
