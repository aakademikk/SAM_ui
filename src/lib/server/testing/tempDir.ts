/**
 * Test helper: temp directories that remove themselves.
 *
 * `npm test` runs with a private TMPDIR and fails if anything is left in it
 * (scripts/run-tests.cjs), so a test that makes a temp dir must clean it up.
 * Every dir made here — at module level or inside a test or fixture helper —
 * is removed when the importing test file has finished its last test. (Each
 * test file runs in its own process, so the registry below is per file.)
 */

import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const made = new Set<string>();
let settleMs = 0;

const removeAll = () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
};

// Registered on first import, which is at the importing file's top level —
// the one place `after` attaches to the whole file.
after(async () => {
  // Fire-and-forget work a finished test started (a turn's title and ping
  // hooks) writes into its dir a moment later; removing the dir under it would
  // just have it re-created. Let such a file say how long to wait first.
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
  removeAll();
  if (settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    removeAll();
  }
  made.clear();
});

/** Call before the file's tests end, for a file whose tests leave background work running. */
export function settleBeforeRemoving(ms: number): void {
  settleMs = Math.max(settleMs, ms);
}

export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}
