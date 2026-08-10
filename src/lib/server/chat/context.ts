/**
 * SAM — Context builder with real-time vault search.
 *
 * On each chat message, greps the vault for relevant notes and injects
 * them into the system prompt. No static snapshot — SAM sees live vault
 * content matched to the current conversation.
 */

import { execSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/* ========================================================================== */
/* Paths                                                                       */
/* ========================================================================== */

const VAULT_ROOT = '/home/col/ai-memory-vault';
const CLAUDE_MD = path.join(os.homedir(), 'claude', 'CLAUDE.md');
const ACTIVE_PRIORITIES = path.join(VAULT_ROOT, 'Active Priorities.md');

/* ========================================================================== */
/* Stop words — filtered from search queries                                   */
/* ========================================================================== */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'where', 'when', 'why', 'how', 'all', 'any', 'both', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but',
  'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'from', 'with', 'in',
  'of', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'now', 'also',
  'really', 'actually', 'something', 'anything', 'nothing', 'ok', 'yeah',
]);

/* ========================================================================== */
/* Cache                                                                       */
/* ========================================================================== */

interface CachedEntry {
  query: string;
  result: string;
  at: number;
}

let searchCache: CachedEntry | null = null;
const CACHE_TTL_MS = 10_000; // 10s — rapid follow-ups use cached results

/* ========================================================================== */
/* Helpers                                                                     */
/* ========================================================================== */

async function readIfExists(filePath: string, maxLen = 6000): Promise<string | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return raw.slice(0, maxLen);
  } catch {
    return null;
  }
}

/** Extract meaningful search terms from a message. */
function extractTerms(message: string): string[] {
  const words = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate, take up to 10 terms
  return [...new Set(words)].slice(0, 10);
}

/** Search vault for files containing any of the given terms. */
function grepVault(terms: string[]): string[] {
  if (terms.length === 0) return [];

  try {
    // Build a grep pattern: term1\|term2\|term3
    const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\|');

    const result = execSync(
      `grep -rli --include='*.md' --exclude-dir='.obsidian' --exclude-dir='.git' '${pattern}' '${VAULT_ROOT}'`,
      { encoding: 'utf-8', timeout: 3000, maxBuffer: 1024 * 1024 },
    ).trim();

    return result ? result.split('\n').slice(0, 10) : [];
  } catch {
    // grep returns exit 1 if no matches — that's fine.
    return [];
  }
}

/** Score and rank matches by how many search terms they contain. */
function scoreMatches(files: string[], terms: string[]): string[] {
  if (files.length <= 5) return files;

  // Quick-and-dirty: prefer files whose names contain search terms.
  const scored = files.map((f) => {
    const name = path.basename(f).toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (name.includes(term)) score += 2;
    }
    return { file: f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((s) => s.file);
}

/* ========================================================================== */
/* Builder                                                                     */
/* ========================================================================== */

export async function buildContext(userMessage: string): Promise<string> {
  // 1. Identity (always included)
  const claudeMd = await readIfExists(CLAUDE_MD);

  // 2. Active priorities (always included)
  const priorities = await readIfExists(ACTIVE_PRIORITIES, 2000);

  // 3. Vault search — find relevant notes for this message
  let vaultContext = '';
  const terms = extractTerms(userMessage);

  // Check cache first
  const cacheKey = terms.join(',');
  if (searchCache && searchCache.query === cacheKey && Date.now() - searchCache.at < CACHE_TTL_MS) {
    vaultContext = searchCache.result;
  } else if (terms.length > 0) {
    const matches = scoreMatches(grepVault(terms), terms);

    if (matches.length > 0) {
      const notes: string[] = [];
      for (const filePath of matches.slice(0, 3)) {
        const content = await readIfExists(filePath);
        if (content) {
          const relPath = path.relative(VAULT_ROOT, filePath);
          notes.push(`### ${relPath}\n${content.slice(0, 2000)}`);
        }
      }
      if (notes.length > 0) {
        vaultContext = `=== VAULT SEARCH RESULTS (matched: ${terms.join(', ')}) ===\n${notes.join('\n\n')}\n`;
      }
    }

    searchCache = { query: cacheKey, result: vaultContext, at: Date.now() };
  }

  // 4. Assemble the system prompt
  let prompt = '';

  // Identity
  if (claudeMd) {
    prompt += `=== YOUR IDENTITY (CLAUDE.md) ===\n${claudeMd}\n\n`;
  } else {
    prompt += `You are SAM (Super Awesome Machine), Col's executive AI manager at Atwood Systems. Direct, sarcastic, UK English. No Americanisms.\n\n`;
  }

  // Active priorities
  if (priorities) {
    prompt += `=== ACTIVE PRIORITIES ===\n${priorities}\n\n`;
  }

  // Vault search results (or overview if no search hits)
  if (vaultContext) {
    prompt += vaultContext + '\n';
  } else {
    // Fallback: read vault index for overview
    const vaultIndex = await readIfExists(path.join(VAULT_ROOT, 'VAULT-INDEX.md'), 3000);
    if (vaultIndex) {
      prompt += `=== VAULT OVERVIEW ===\n${vaultIndex}\n\n`;
    }
  }

  // Operating rules
  prompt += `=== OPERATING RULES ===
- You are SAM. Be direct, blunt, and witty. UK English.
- You have REAL-TIME access to the vault above — the search results are
  from THIS conversation, not a stale snapshot. Reference them confidently.
- If you need more detail from a note, tell Col which note to open.
- Col runs commands in the Terminal tab. If something needs doing, tell him
  the exact command. You CANNOT execute anything yourself.
- NEVER say "I'll look into that" or "let me check." You either know it
  (from the vault above), or you tell Col what to do.
- Keep answers concise. He's on a phone.
- Current date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;

  return prompt;
}
