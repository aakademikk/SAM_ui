/**
 * SAM — Context builder.
 *
 * Reads CLAUDE.md and the Obsidian vault at request time so SAM has
 * real knowledge of who he is and what's going on. Results are cached
 * briefly to avoid disk thrash on rapid-fire messages.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/* ========================================================================== */
/* Paths                                                                       */
/* ========================================================================== */

const CLAUDE_MD = path.join(os.homedir(), 'claude', 'CLAUDE.md');
const VAULT_ROOT = '/home/col/ai-memory-vault';
const VAULT_INDEX = path.join(VAULT_ROOT, 'VAULT-INDEX.md');
const ACTIVE_PRIORITIES = path.join(VAULT_ROOT, 'Active Priorities.md');
const DAILY_NOTES_DIR = path.join(VAULT_ROOT, '01 - Daily Notes');

/* ========================================================================== */
/* Cache                                                                       */
/* ========================================================================== */

interface CachedContext {
  systemPrompt: string;
  fetchedAt: number;
}

let cache: CachedContext | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/* ========================================================================== */
/* Builders                                                                   */
/* ========================================================================== */

async function readFileIfExists(filePath: string, maxLen = 8000): Promise<string | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return raw.slice(0, maxLen);
  } catch {
    return null;
  }
}

async function findLatestDailyNote(): Promise<string | null> {
  try {
    const entries = await fsp.readdir(DAILY_NOTES_DIR, { withFileTypes: true });
    // Monthly folders: "08 - August 2026", etc.
    const monthDirs = entries
      .filter((e) => e.isDirectory())
      .sort()
      .reverse(); // newest first

    for (const dir of monthDirs) {
      const monthPath = path.join(DAILY_NOTES_DIR, dir.name);
      const files = await fsp.readdir(monthPath);
      const notes = files.filter((f) => f.endsWith('.md')).sort().reverse();
      if (notes.length > 0) {
        const content = await readFileIfExists(path.join(monthPath, notes[0]), 4000);
        return `Latest daily note (${notes[0]}):\n${content ?? '(empty)'}`;
      }
    }
  } catch {
    // vault may not exist yet
  }
  return null;
}

async function buildSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.systemPrompt;
  }

  const [claudeMd, vaultIndex, activePriorities, latestDaily] = await Promise.all([
    readFileIfExists(CLAUDE_MD),
    readFileIfExists(VAULT_INDEX, 6000),
    readFileIfExists(ACTIVE_PRIORITIES, 3000),
    findLatestDailyNote(),
  ]);

  let prompt = '';

  // 1. Identity — CLAUDE.md IS who SAM is
  if (claudeMd) {
    prompt += `=== YOUR IDENTITY (from CLAUDE.md) ===\n${claudeMd}\n\n`;
  } else {
    prompt += `You are SAM (Super Awesome Machine), Col's executive AI manager at Atwood Systems.
You're direct, sarcastic, and speak UK English. No Americanisms.
You run on the SAM dashboard at super-awesome-machine.tail2eadff.ts.net.\n\n`;
  }

  // 2. Vault overview
  if (vaultIndex) {
    prompt += `=== VAULT OVERVIEW ===\n${vaultIndex}\n\n`;
  }

  // 3. Active priorities
  if (activePriorities) {
    prompt += `=== ACTIVE PRIORITIES ===\n${activePriorities}\n\n`;
  }

  // 4. Latest daily note
  if (latestDaily) {
    prompt += `=== LATEST ACTIVITY ===\n${latestDaily}\n\n`;
  }

  // 5. Operating instructions
  prompt += `=== OPERATING RULES ===
- You are SAM, not a generic assistant. Be direct, blunt, and witty.
- Use UK English — colour not color, organise not organize, maths not math.
- You have access to the vault above — reference it when relevant.
- You can run commands via the Terminal tab (Col does that, not you).
- Col is your boss. Challenge his assumptions. Don't sugarcoat.
- Keep answers concise. He's on a phone, not reading a novel.
- Current date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;

  cache = { systemPrompt: prompt, fetchedAt: now };
  return prompt;
}

/* ========================================================================== */
/* Public API                                                                  */
/* ========================================================================== */

/** Get the full system prompt with live vault context. */
export async function getSystemPrompt(): Promise<string> {
  return buildSystemPrompt();
}
