/**
 * SAM — real vault telemetry.
 *
 * Reads the actual Obsidian vault on disk. There is no embedding pipeline or
 * query log wired up yet, so those fields honestly report zero rather than
 * fabricating numbers — see VaultMemoryWidget in the README's "wiring real
 * infrastructure" section for what would light them up.
 */

import fs from 'node:fs';
import path from 'node:path';

const VAULT_PATH = '/home/col/ai-memory-vault';
const IGNORED_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);
const CACHE_MS = 8_000;

export interface VaultScan {
  totalNotes: number;
  vaultSizeMb: number;
  lastModified: number;
  clusters: { name: string; notes: number }[];
}

let cached: { at: number; scan: VaultScan } | null = null;

function walk(dir: string, acc: { notes: number; bytes: number; lastMod: number }) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.name.endsWith('.md')) {
      try {
        const stat = fs.statSync(full);
        acc.notes++;
        acc.bytes += stat.size;
        acc.lastMod = Math.max(acc.lastMod, stat.mtimeMs);
      } catch {
        // File vanished between readdir and stat — skip it.
      }
    }
  }
}

function scanNow(): VaultScan {
  let topLevel: fs.Dirent[];
  try {
    topLevel = fs.readdirSync(VAULT_PATH, { withFileTypes: true });
  } catch {
    return { totalNotes: 0, vaultSizeMb: 0, lastModified: Date.now(), clusters: [] };
  }

  const clusters: { name: string; notes: number }[] = [];
  let totalNotes = 0;
  let totalBytes = 0;
  let lastModified = 0;

  for (const entry of topLevel) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(VAULT_PATH, entry.name);
    if (entry.isDirectory()) {
      const acc = { notes: 0, bytes: 0, lastMod: 0 };
      walk(full, acc);
      if (acc.notes > 0) clusters.push({ name: entry.name, notes: acc.notes });
      totalNotes += acc.notes;
      totalBytes += acc.bytes;
      lastModified = Math.max(lastModified, acc.lastMod);
    } else if (entry.name.endsWith('.md')) {
      try {
        const stat = fs.statSync(full);
        totalNotes++;
        totalBytes += stat.size;
        lastModified = Math.max(lastModified, stat.mtimeMs);
      } catch {
        // ignore
      }
    }
  }

  return {
    totalNotes,
    vaultSizeMb: totalBytes / (1024 * 1024),
    lastModified: lastModified || Date.now(),
    clusters: clusters.sort((a, b) => b.notes - a.notes),
  };
}

/** Cached for CACHE_MS so a burst of concurrent widget polls doesn't re-walk the tree. */
export function scanVault(): VaultScan {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.scan;
  const scan = scanNow();
  cached = { at: Date.now(), scan };
  return scan;
}
