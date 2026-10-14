import fs from 'node:fs';
import path from 'node:path';

import { envelope } from '@/lib/server/respond';

export const dynamic = 'force-dynamic';

/**
 * GET /api/build — the ID of the build this server is running.
 *
 * Read once: deploy.sh always restarts the server after a build, so the ID
 * cannot change under a running process. BuildWatch compares it with the ID it
 * saw at page load and reloads on a change (src/lib/buildCheck.ts). Public on
 * purpose, like /api/health: a build ID is not a secret, and a page whose
 * session expired is exactly one that may need the reload.
 */
const BUILD_ID = readBuildId();

function readBuildId(): string | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function GET() {
  return envelope({ buildId: BUILD_ID }, 'build', Date.now(), 0);
}
