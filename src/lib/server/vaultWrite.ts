/**
 * SAM — safe read-edit-write for hand-edited vault notes.
 *
 * Active Priorities and Named Operations have several writers (these routes,
 * Obsidian, Claude sessions, closer_vault.py). A bare read + writeFileSync
 * loses whatever another writer saved in between. This helper writes a temp
 * file in the same folder, fsyncs it, re-checks the target's mtime and size
 * and only then renames over it. If the file changed since the read, the edit
 * is redone once on the fresh text. The window between the final check and the
 * rename is unavoidable without a lock (closer_vault.py has the same one).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface EditVaultFileOpts {
  /** Test hook: runs after the edit is computed and before the temp file is written. */
  beforeWrite?: (attempt: number) => void;
}

const warn = (msg: string) => console.warn(`[vault-write] ${msg}`);

function sameStat(a: fs.Stats, b: fs.Stats): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * Applies `edit` to the file's text. `edit` returns the new text, or null to
 * leave the file alone. Returns true only if a new version was written.
 * Never throws; failures are logged.
 */
export function editVaultFile(
  file: string,
  edit: (text: string) => string | null,
  opts: EditVaultFileOpts = {},
): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    let tmp: string | null = null;
    try {
      const before = fs.statSync(file);
      const text = fs.readFileSync(file, 'utf-8');
      const next = edit(text);
      if (next === null) return false;

      opts.beforeWrite?.(attempt);

      tmp = path.join(
        path.dirname(file),
        `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
      );
      const fd = fs.openSync(tmp, 'w', before.mode & 0o777);
      try {
        fs.writeSync(fd, next, null, 'utf-8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.chmodSync(tmp, before.mode & 0o777);
      } catch {
        /* best effort */
      }

      if (!sameStat(before, fs.statSync(file))) {
        fs.rmSync(tmp, { force: true });
        tmp = null;
        if (attempt === 0) {
          warn(`${path.basename(file)} changed during edit; retrying on fresh text`);
          continue;
        }
        warn(`${path.basename(file)} changed again during retry; edit dropped`);
        return false;
      }

      fs.renameSync(tmp, file);
      tmp = null;
      return true;
    } catch (err) {
      warn(`${path.basename(file)} edit failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
    }
  }
  return false;
}
