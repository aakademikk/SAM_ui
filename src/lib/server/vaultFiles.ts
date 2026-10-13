/**
 * SAM — the one gate every vault read passes (work area).
 *
 * Stricter than `resolveUploadPath`: it compares REAL paths (symlinks
 * followed) of the vault root and the file. Paths resolve per call through
 * `livePaths.ts`. A refusal gives a reason code; the caller audits once per
 * request with `refuse`, never per candidate.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { vaultDir } from '@/lib/server/livePaths';
import { logVaultRefusal } from '@/lib/server/auth/auditLog';
import { ALLOWED_TYPES } from '@/lib/workItems';

export type VaultResolve =
  | { ok: true; abs: string; rel: string; ext: string; size: number }
  | { ok: false; reason: string };

const NUL = '\u0000';
const allowed = new Set<string>(ALLOWED_TYPES);

function inside(root: string, target: string): boolean {
  const r = path.relative(root, target);
  return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
}

function hasDotDot(form: string): boolean {
  return form.split(/[\\/]/).some((part) => part === '..');
}

function checkLexical(requested: unknown): { ok: true; rel: string } | { ok: false; reason: string } {
  if (typeof requested !== 'string' || requested.length === 0 || requested.includes(NUL)) {
    return { ok: false, reason: 'nul' };
  }
  if (requested.includes('\\')) return { ok: false, reason: 'backslash' };

  let form = requested;
  for (let i = 0; i <= 3; i++) {
    if (form.includes(NUL)) return { ok: false, reason: i === 0 ? 'nul' : 'encoded' };
    if (hasDotDot(form)) return { ok: false, reason: i === 0 ? 'dotdot' : 'encoded' };
    if (i === 3) break;
    let next: string;
    try {
      next = decodeURIComponent(form);
    } catch {
      break;
    }
    if (next === form) break;
    form = next;
  }

  let rel = requested;
  if (path.isAbsolute(requested)) {
    const root = path.resolve(vaultDir());
    const abs = path.resolve(requested);
    if (!inside(root, abs) || abs === root) return { ok: false, reason: 'absolute-outside' };
    rel = path.relative(root, abs);
  }

  const parts = rel.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) return { ok: false, reason: 'missing' };
  if (parts.some((p) => p.startsWith('.'))) return { ok: false, reason: 'dot-part' };
  const ext = path.extname(parts[parts.length - 1]).slice(1).toLowerCase();
  if (!allowed.has(ext)) return { ok: false, reason: 'type' };
  return { ok: true, rel: parts.join('/') };
}

async function resolveOne(requested: unknown): Promise<VaultResolve> {
  const lex = checkLexical(requested);
  if (!lex.ok) return lex;
  const ext = path.extname(lex.rel).slice(1).toLowerCase();

  let realRoot: string;
  let real: string;
  try {
    realRoot = await fsp.realpath(vaultDir());
    real = await fsp.realpath(path.join(realRoot, lex.rel));
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!inside(realRoot, real) || real === realRoot) return { ok: false, reason: 'symlink-outside' };
  let st;
  try {
    st = await fsp.stat(real);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not-file' };
  return { ok: true, abs: real, rel: lex.rel, ext, size: st.size };
}

export async function resolveVaultFile(
  requested: unknown,
  opts?: { from?: string },
): Promise<VaultResolve> {
  if (opts?.from !== undefined && typeof requested === 'string') {
    const from = await resolveOne(opts.from);
    // `..` in any form stays refused, even where it would collapse back inside the vault.
    if (!checkLexical(requested).ok) return resolveOne(requested);
    if (from.ok && !path.isAbsolute(requested)) {
      const sibling = path.posix.join(path.posix.dirname(from.rel), requested);
      const first = await resolveOne(sibling);
      if (first.ok) return first;
    }
  }
  return resolveOne(requested);
}

/** Audit a refusal once per request and hand back the reason. */
export async function refuse(requested: unknown, reason: string): Promise<void> {
  await logVaultRefusal(typeof requested === 'string' ? requested : String(requested), reason);
}
