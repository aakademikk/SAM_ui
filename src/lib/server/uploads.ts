/**
 * Uploads — where a picked file lands, and what may be handed to the agent.
 *
 * The design in one line: the CLI never receives the bytes. A file is written
 * to disk here and its *path* goes into the prompt, because Claude Code already
 * reads files by path. That is why this needed no change to how chat spawns,
 * and why it could not regress the busiest path in the app.
 *
 * This module exists as one place rather than two because both ends have to
 * agree. The route that writes the file and the route that accepts its path
 * must share one definition of "an upload", or the second becomes a way to
 * point the agent at any file on the box.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Deliberately outside the repo. Anything inside it is a candidate for the
 * hourly commit and its secret guard, and a user's uploaded photo should never
 * be in a git history at all, let alone scanned by a key-shaped-value regex.
 */
export function uploadsRoot(): string {
  return process.env.SAM_UPLOADS_DIR ?? path.join(os.homedir(), 'sam-uploads');
}

/** Per file. Also a memory guard: `formData()` buffers the whole body. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Per request, for the same reason — five 100MB files is 500MB resident. */
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

export const MAX_FILES = 5;

/** How many paths one chat turn may carry. */
export const MAX_ATTACHMENTS = 5;

/**
 * Media and documents. Keyed on the type the browser reports, with the
 * extension as a second chance because a browser will send an empty type for
 * anything it does not recognise — and an iPhone sends HEIC and QuickTime,
 * which are the two most likely files to arrive from Colin's phone.
 */
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/rtf',
  'text/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif',
  '.mp4', '.mov', '.webm', '.mkv',
  '.pdf', '.txt', '.md', '.csv', '.json', '.rtf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);

/**
 * The client's filename is a *label*, never a path. Stripping to a basename is
 * what stops `../../.ssh/authorized_keys` being a filename, and the control
 * characters would otherwise let a name rewrite the terminal it is printed in.
 */
export function safeLabel(name: string, fallback = 'file'): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  // A name that is nothing but dots (`..`, `...`) reads like a path to a model
  // and tells a person nothing, so it counts as empty rather than as a label.
  if (!cleaned || /^\.+$/.test(cleaned)) return fallback;
  return cleaned.slice(0, 120);
}

/**
 * The extension to use when the client's filename has none we recognise.
 * A phone camera roll sends JPEG bytes named `image` surprisingly often, and an
 * extensionless file is one the agent's Read tool has to guess at.
 */
const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
};

/** A generated name: sortable, collision-free, and carrying only a known extension. */
export function generatedName(label: string, mime: string): string {
  const ext = path.extname(label).toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(ext)
    ? ext
    : (MIME_EXTENSION[mime.toLowerCase()] ?? '.bin');
  return `${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
}

/** True if the browser's type, or failing that the extension, is one we accept. */
export function typeAllowed(mime: string, label: string): boolean {
  if (mime && ALLOWED_TYPES.has(mime.toLowerCase())) return true;
  return ALLOWED_EXTENSIONS.has(path.extname(label).toLowerCase());
}

/**
 * The one check that matters. Returns the resolved absolute path, or null if it
 * is not inside the uploads root.
 *
 * Without this the `attachments` field on the chat route is an arbitrary-file
 * read primitive: post `/home/col/.ssh/id_rsa` and the agent reads it out.
 */
export function resolveUploadPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  // A relative path would resolve against the route's cwd, which is not a place
  // the client should get to choose.
  if (!path.isAbsolute(candidate)) return null;

  const root = path.resolve(uploadsRoot());
  const resolved = path.resolve(candidate);
  const rel = path.relative(root, resolved);

  // '' is the root itself (a directory, not an upload); a leading '..' is
  // anything above it; an absolute result means a different root entirely.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;

  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }

  return resolved;
}

/**
 * One entry on the chat route's `attachments` field: a safe path plus the name
 * to show for it.
 *
 * Two shapes are accepted deliberately. The client sends `{ path, name }` so a
 * turn keeps the name Colin actually picked — `Q3 report.pdf` tells the model
 * something a timestamped filename does not. A bare string is still accepted
 * because a browser holding a cached chunk from the previous build posts one,
 * and a stale-chunk client should get a working turn rather than a 400. (This
 * app has been bitten by stale chunks before; see the deploy.sh header.)
 *
 * The label is client-supplied and ends up in a prompt, so it goes through
 * safeLabel: basename only, control characters gone, length capped.
 */
export function resolveAttachment(
  candidate: unknown,
): { path: string; name: string } | null {
  if (typeof candidate === 'string') {
    const resolved = resolveUploadPath(candidate);
    return resolved ? { path: resolved, name: path.basename(resolved) } : null;
  }

  if (typeof candidate === 'object' && candidate !== null) {
    const entry = candidate as Record<string, unknown>;
    const resolved = resolveUploadPath(entry.path);
    if (!resolved) return null;
    // '' as the fallback, not safeLabel's usual 'file': here an unusable name
    // must fall through to the generated basename, which at least carries the
    // real extension, rather than becoming the literal label "file".
    const label = typeof entry.name === 'string' ? safeLabel(entry.name, '') : '';
    return { path: resolved, name: label || path.basename(resolved) };
  }

  return null;
}

/**
 * What the agent actually sees. The paths go in as a plain list rather than
 * being phrased as an instruction, because the surrounding message is Colin's
 * and the model should read the file as context for it, not as a command.
 */
export function attachmentBlock(files: { path: string; name: string }[]): string {
  if (files.length === 0) return '';
  const lines = files.map((f) => `- ${f.path}  (${f.name})`);
  return `\n\n[Attached files, saved on this machine:]\n${lines.join('\n')}`;
}

/** How long an upload stays on disk. */
export const RETENTION_DAYS = 7;

/** Only day folders are swept. A stray file in the root is not ours to delete. */
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Delete uploads older than the window and drop the day folders they empty.
 *
 * Called opportunistically after a save rather than from a systemd timer. A
 * timer that quietly stops firing is this estate's most-repeated failure — a
 * broken job that looks exactly like a quiet one — and a sweep that runs only
 * when something is uploaded cannot rot without anyone noticing.
 *
 * Never throws: retention failing must never fail the upload that triggered it.
 */
export async function sweepUploads(retentionDays = RETENTION_DAYS): Promise<number> {
  let removed = 0;
  try {
    const root = uploadsRoot();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    let entries: string[];
    try {
      entries = await fsp.readdir(root);
    } catch {
      return 0; // Nothing has ever been uploaded.
    }

    for (const entry of entries) {
      if (!DAY_FOLDER.test(entry)) continue;
      const dir = path.join(root, entry);

      let names: string[];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }

      let live = 0;
      for (const name of names) {
        try {
          const stat = await fsp.stat(path.join(dir, name));
          if (stat.mtimeMs < cutoff) {
            await fsp.unlink(path.join(dir, name));
            removed += 1;
          } else {
            live += 1;
          }
        } catch {
          // Already gone. That was the objective.
        }
      }

      // Only when the folder is genuinely empty: rmdir refuses otherwise, which
      // is the check, so a file we failed to stat is never collateral.
      if (live === 0) {
        try {
          await fsp.rmdir(dir);
        } catch {
          /* not empty, or already removed */
        }
      }
    }
  } catch {
    // Swallowed deliberately — see above.
  }
  return removed;
}
