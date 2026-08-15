/**
 * SAM — Claude Code session usage.
 *
 * Scans Claude Code transcripts (normal sessions *and* subagent runs) so the
 * Fleet tab shows the whole estate in one place instead of splitting it across
 * the tab, the ledger and the Anthropic console.
 *
 * Costing is deliberately provider-split:
 *
 *   - DeepSeek: recomputed via DEEPSEEK_RATES — that is real out-of-pocket
 *     spend and is priced from token counts (the CLI's own figure is
 *     Opus-priced and overstates by up to ~100x; see lib/costing.ts).
 *   - Anthropic: not priced at all. Sessions run on the flat Pro plan, so
 *     API-rate pricing (Opus $5/$25 etc.) invents hundreds of dollars of
 *     spend that nobody paid — measured ~$300/7d of pure fiction. Anthropic
 *     turns are counted in tokens instead, the honest metric for subscription
 *     usage. (A future API-billed mode would price these turns.)
 *
 * The scan is incremental so a page load does not re-parse ~400MB of history:
 * a cache at ~/.sam/claude-costs.json keys each transcript on (mtimeMs, size)
 * and only changed files are re-parsed. Files whose last write predates the
 * 7-day window are skipped without parsing at all. The window is calendar-day
 * granularity (a whole day counts if it overlaps the window), which is within
 * ~24h of the fleet job store's exact 168h — close enough for a spend view.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Dirent } from 'node:fs';

import { DEEPSEEK_RATES } from '@/lib/server/chat/tiers';
import { deepseekWindow } from '@/lib/costing';

import type { ClaudeSpend } from '@/types/fleet';

const TRANSCRIPTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const CACHE_PATH = path.join(os.homedir(), '.sam', 'claude-costs.json');
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 3; // bump on any pricing/scan change so stale buckets are re-scanned
/** Bounds a single request's scan work — a cold cache warms over a few loads. */
const MAX_SCAN_BYTES = 256 * 1024 * 1024;
const MAX_DEPTH = 8;

interface AssistantEvent {
  type?: string;
  timestamp?: string;
  message?: {
    /** Stable id for the turn — the dedup key (see scanFile). */
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

/** Per-calendar-day cost + tokens of one transcript, keyed `YYYY-MM-DD` (UTC). */
type DayCosts = Record<string, { cost: number; tokens: number }>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  days: DayCosts;
}

interface CacheShape {
  version: number;
  updatedAt: number;
  files: Record<string, CacheEntry>;
}

/**
 * Price one assistant turn in USD from its token counts — DeepSeek only.
 * Anthropic turns run on the flat Pro plan and are counted in tokens instead
 * of being priced at API rates that nobody pays.
 */
function priceEvent(
  model: string,
  usage: NonNullable<AssistantEvent['message']>['usage'],
  tsMs: number,
): number {
  const rates = DEEPSEEK_RATES[model];
  if (!rates) return 0;

  const input = usage?.input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;

  const table = rates[deepseekWindow(new Date(tsMs))];
  // Cache writes bill at the full (miss) input rate and the transcript's
  // input_tokens already includes them — same basis as the fleet spend route.
  return (input * table.inputMiss + cacheRead * table.cacheHit + output * table.output) / 1_000_000;
}

/** Total tokens a turn moved through the model — the honest volume metric. */
function eventTokens(
  usage: NonNullable<AssistantEvent['message']>['usage'],
): number {
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0) +
    (usage?.output_tokens ?? 0)
  );
}

function eventTimeMs(ev: AssistantEvent, fallbackMs: number): number {
  if (typeof ev.timestamp === 'string') {
    const t = Date.parse(ev.timestamp);
    if (!Number.isNaN(t)) return t;
  }
  return fallbackMs;
}

/** Parse a transcript into per-day cost buckets. */
async function scanFile(file: string, mtimeMs: number): Promise<DayCosts> {
  const text = await fsp.readFile(file, 'utf-8');
  const days: DayCosts = {};
  // Transcripts log one assistant event per stream chunk, all carrying the same
  // turn's usage object (measured 2.7× duplication on a live session). Each
  // turn's usage must be counted once, keyed on the stable `message.id`. Events
  // without an id (rare) fall back to their usage signature so exact duplicates
  // still collapse.
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev: AssistantEvent;
    try {
      ev = JSON.parse(line) as AssistantEvent;
    } catch {
      continue;
    }
    if (ev.type !== 'assistant' || !ev.message?.usage || !ev.message.model) continue;
    const { id, model, usage } = ev.message;
    const key =
      id ??
      `${model}|${usage.input_tokens ?? 0}|${usage.cache_creation_input_tokens ?? 0}|${usage.cache_read_input_tokens ?? 0}|${usage.output_tokens ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tsMs = eventTimeMs(ev, mtimeMs);
    const cost = priceEvent(model, usage, tsMs);
    const tokens = eventTokens(usage);
    if (cost <= 0 && tokens <= 0) continue;
    const day = new Date(tsMs).toISOString().slice(0, 10);
    const bucket = days[day] ?? { cost: 0, tokens: 0 };
    bucket.cost += cost;
    bucket.tokens += tokens;
    days[day] = bucket;
  }
  return days;
}

interface TranscriptFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/** Every transcript under ~/.claude/projects, including subagents/ dirs. */
async function listTranscripts(): Promise<TranscriptFile[]> {
  const out: TranscriptFile[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const st = await fsp.stat(full);
          out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // File vanished mid-walk — skip it.
        }
      }
    }
  };
  await walk(TRANSCRIPTS_ROOT, 0);
  return out;
}

async function loadCache(): Promise<CacheShape> {
  try {
    const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf-8')) as CacheShape;
    if (parsed.version === CACHE_VERSION) return parsed;
  } catch {
    // First run or a corrupt cache — start empty.
  }
  return { version: CACHE_VERSION, updatedAt: 0, files: {} };
}

async function saveCache(cache: CacheShape): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fsp.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  } catch {
    // Non-fatal: the caller still returns this request's result.
  }
}

/** Best-effort cwd basename from the project slug (`-home-col-claude` → `claude`). */
function projectLabel(file: string): string {
  const rel = path.relative(TRANSCRIPTS_ROOT, file);
  const slug = rel.split(path.sep)[0];
  const base = slug.replace(/-/g, '/').split('/').filter(Boolean).pop();
  return base || slug;
}

/**
 * Cost of Claude Code session usage over the last 7 days.
 *
 * Reads the transcript store, re-parsing only files that changed since the last
 * scan, then sums the in-window day buckets. Cheap to call on every Fleet tab
 * load once the cache is warm.
 */
export async function claudeCosts(): Promise<ClaudeSpend> {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const minDay = new Date(cutoff).toISOString().slice(0, 10);

  const cache = await loadCache();
  const files = await listTranscripts();
  // Newest first, so a budget-capped pass still covers the most recent work.
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const next: Record<string, CacheEntry> = {};
  let scannedFiles = 0;
  let scanBytes = 0;

  for (const f of files) {
    const cached = cache.files[f.path];
    if (f.mtimeMs < cutoff) continue; // all activity older than the window
    if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.size) {
      next[f.path] = cached; // unchanged since last scan
      continue;
    }
    if (scanBytes >= MAX_SCAN_BYTES) {
      if (cached) next[f.path] = cached; // budget spent — keep the prior value
      continue;
    }
    scanBytes += f.size;
    scannedFiles += 1;
    try {
      next[f.path] = { mtimeMs: f.mtimeMs, size: f.size, days: await scanFile(f.path, f.mtimeMs) };
    } catch {
      // Unreadable transcript — leave it out rather than fail the scan.
    }
  }

  await saveCache({ version: CACHE_VERSION, updatedAt: now, files: next });

  const projects: Record<string, { sessions: number; costUsd: number; tokens: number }> = {};
  let sessions = 0;
  let costUsd = 0;
  let tokens = 0;

  for (const [file, entry] of Object.entries(next)) {
    let fileCost = 0;
    let fileTokens = 0;
    for (const [day, bucket] of Object.entries(entry.days)) {
      if (day >= minDay) {
        fileCost += bucket.cost;
        fileTokens += bucket.tokens;
      }
    }
    if (fileCost <= 0 && fileTokens <= 0) continue;
    costUsd += fileCost;
    tokens += fileTokens;
    sessions += 1;
    const label = projectLabel(file);
    const p = projects[label] ?? { sessions: 0, costUsd: 0, tokens: 0 };
    p.sessions += 1;
    p.costUsd += fileCost;
    p.tokens += fileTokens;
    projects[label] = p;
  }

  return { sessions, costUsd, tokens, projects, scannedFiles };
}
