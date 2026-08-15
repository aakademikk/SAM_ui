/**
 * SAM — Claude Code session costing.
 *
 * Prices Claude Code sessions (normal sessions *and* subagent runs) locally from
 * transcript token counts, so the Fleet tab's cost section shows the whole
 * estate in one place instead of splitting it across the tab, the ledger and
 * the Anthropic console.
 *
 * Transcripts carry no cost figure — only `message.usage` per assistant turn —
 * so every turn is priced from its token counts:
 *
 *   - DeepSeek:  recomputed via DEEPSEEK_RATES. The CLI overstates DeepSeek by
 *                ~12x against its Anthropic table, so it is never trusted here,
 *                matching the fleet spend route.
 *   - Anthropic: ANTHROPIC_RATES below, with prompt-cache economics
 *                (reads 0.1× input, writes 1.25× input) and Sonnet 5's intro
 *                price while it runs (to 2026-08-31).
 *   - Unknown models are skipped, not guessed.
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
const CACHE_VERSION = 2; // bump on any pricing/scan change so stale buckets are re-scanned
/** Bounds a single request's scan work — a cold cache warms over a few loads. */
const MAX_SCAN_BYTES = 256 * 1024 * 1024;
const MAX_DEPTH = 8;

/** Prompt-cache economics: reads ≈ 0.1× input, writes ≈ 1.25× input (5m TTL). */
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

/** Anthropic first-party API rates, USD per 1M tokens (claude-api reference, cached 2026-06-24). */
const ANTHROPIC_RATES: Record<string, { input: number; output: number }> = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 }, // intro 2/10 to 2026-08-31 — see sonnet5Rates
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** 2026-09-01 00:00 UTC — Sonnet 5's intro price ends 2026-08-31. */
const SONNET5_INTRO_END = Date.UTC(2026, 8, 1);

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

/** Per-calendar-day cost of one transcript, keyed `YYYY-MM-DD` (UTC). */
type DayCosts = Record<string, number>;

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

type Rates =
  | { kind: 'anthropic'; input: number; output: number }
  | { kind: 'deepseek'; inputMiss: number; cacheHit: number; output: number };

/** Transcript ids may carry a dated suffix (`claude-sonnet-4-6-20250514`). */
function normalizeModel(model: string): string {
  return model.replace(/-\d{8}$/, '');
}

function sonnet5Rates(tsMs: number): { input: number; output: number } {
  return tsMs < SONNET5_INTRO_END
    ? { input: 2, output: 10 }
    : { input: 3, output: 15 };
}

function ratesFor(model: string, tsMs: number): Rates | null {
  const m = normalizeModel(model);
  if (m === 'claude-sonnet-5') return { kind: 'anthropic', ...sonnet5Rates(tsMs) };
  const anthropic = ANTHROPIC_RATES[m];
  if (anthropic) return { kind: 'anthropic', ...anthropic };
  const deepseek = DEEPSEEK_RATES[m];
  if (deepseek) return { kind: 'deepseek', ...deepseek[deepseekWindow(new Date(tsMs))] };
  return null;
}

/** Price one assistant turn in USD from its token counts and the model's rates. */
function priceEvent(
  model: string,
  usage: NonNullable<AssistantEvent['message']>['usage'],
  tsMs: number,
): number {
  const rates = ratesFor(model, tsMs);
  if (!rates) return 0;

  const input = usage?.input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;

  if (rates.kind === 'deepseek') {
    // Cache writes bill at the full (miss) input rate and the transcript's
    // input_tokens already includes them — same basis as the fleet spend route.
    return (input * rates.inputMiss + cacheRead * rates.cacheHit + output * rates.output) / 1_000_000;
  }
  return (
    (input * rates.input +
      cacheRead * rates.input * CACHE_READ_MULT +
      cacheWrite * rates.input * CACHE_WRITE_MULT +
      output * rates.output) /
    1_000_000
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
    if (cost <= 0) continue;
    const day = new Date(tsMs).toISOString().slice(0, 10);
    days[day] = (days[day] ?? 0) + cost;
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

  const projects: Record<string, { sessions: number; costUsd: number }> = {};
  let sessions = 0;
  let costUsd = 0;

  for (const [file, entry] of Object.entries(next)) {
    let fileCost = 0;
    for (const [day, cost] of Object.entries(entry.days)) {
      if (day >= minDay) fileCost += cost;
    }
    if (fileCost <= 0) continue;
    costUsd += fileCost;
    sessions += 1;
    const label = projectLabel(file);
    const p = projects[label] ?? { sessions: 0, costUsd: 0 };
    p.sessions += 1;
    p.costUsd += fileCost;
    projects[label] = p;
  }

  return { sessions, costUsd, projects, scannedFiles };
}
