/**
 * Resolve the Claude Code CLI binary to an absolute path.
 *
 * The dashboard runs as a systemd user service whose PATH is systemd's
 * default — `~/.local/bin` (where the CLI installs) is not on it. Passing the
 * bare `claude` string to a systemd-scope spawn then dies at exec with
 * "Failed to find executable claude", which the job store records as a failed
 * run and the health score counts against the failure rate. So resolve once
 * here: honour the SAM_CLAUDE_BIN override, then PATH, then the user-local
 * install locations a service can't see.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve `claude` against PATH the way a shell would. */
function findOnPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, 'claude');
    if (isExecutable(full)) return full;
  }
  return null;
}

/** Absolute candidate install locations, checked after PATH. */
function findInHome(): string | null {
  const home = os.homedir();
  for (const candidate of [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
  ]) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function claudeBin(): string {
  const override = process.env.SAM_CLAUDE_BIN;
  if (override) return override;

  const onPath = findOnPath();
  if (onPath) return onPath;

  const inHome = findInHome();
  if (inHome) return inHome;

  // Last resort — let the spawn fail loudly rather than guess.
  return 'claude';
}
