/**
 * SAM — where the server's live files are.
 *
 * Every path resolves per call from `os.homedir()` (never a module-level
 * const), so a harness or test that sets `HOME` gets its own tree. Production
 * runs with HOME=/home/col, so live behaviour is unchanged. Each module's own
 * env override still wins; `SAM_VAULT_DIR` is the vault's, as in `handoff.ts`.
 */

import os from 'node:os';
import path from 'node:path';

/** `~/.sam`, the state directory. */
export function samStateDir(): string {
  return path.join(os.homedir(), '.sam');
}

/** The knowledge vault: `SAM_VAULT_DIR`, else `~/ai-memory-vault`. */
export function vaultDir(): string {
  return process.env.SAM_VAULT_DIR ?? path.join(os.homedir(), 'ai-memory-vault');
}

export function atwoodDir(): string {
  return path.join(vaultDir(), '02 - Atwood Systems');
}

export function activePrioritiesPath(): string {
  return path.join(vaultDir(), 'Active Priorities.md');
}
