/**
 * SAM — where the agent runs.
 *
 * Moved out of src/app/api/chat/agent/route.ts (T4) so the transcript reader
 * can compute the same cwd slug the live route uses, without importing a
 * route module (which would pull `next/server` into code that must stay
 * testable with plain `node --test`).
 */

import os from 'node:os';
import path from 'node:path';

/** Where the agent runs. Its CLAUDE.md is what makes SAM sound like SAM. */
export function agentCwd(): string {
  return process.env.SAM_AGENT_CWD ?? path.join(os.homedir(), 'claude');
}
