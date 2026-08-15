/**
 * SAM — Fleet types.
 *
 * The Fleet tab is the single interface for dispatching the Tier 2 General
 * personas (hermes, calliope, hephaestus, cerberus, prometheus) as stateless `claude`
 * CLI jobs. Personas are read live from `~/.claude/agents/*.md` — the vault
 * Generals notes are the source of truth, these files are the executable
 * layer over them.
 */

import type { JobStatus } from '@/types/jobs';

export interface FleetPersona {
  /** Matches the persona file's `name` frontmatter. */
  name: string;
  description: string;
  /** Default model alias from the file (e.g. `sonnet`). */
  model: string;
  /** Scoped tool list from the file (e.g. Read, Glob, Grep, Bash). */
  tools: string[];
}

export interface FleetDispatchResult {
  jobId: string;
  persona: string;
  model: string;
}

export interface FleetSpendEntry {
  /** Number of fleet jobs run for this persona (7-day retention). */
  jobs: number;
  /**
   * Cost across those jobs. Anthropic runs use the CLI's `total_cost_usd`;
   * DeepSeek runs are recomputed from raw tokens, because the CLI prices every
   * model against an Anthropic table and overstates DeepSeek by ~12x.
   */
  costUsd: number;
}

export interface ClaudeProjectCost {
  /** Transcript files with any in-window cost, per project. */
  sessions: number;
  costUsd: number;
  /** Total tokens processed (input + cache reads/writes + output). */
  tokens: number;
}

export interface ClaudeSpend {
  /** Transcript files (sessions + subagent runs) with in-window activity. */
  sessions: number;
  /** Real spend only — DeepSeek turns. Anthropic usage is flat Pro. */
  costUsd: number;
  /** Total tokens processed (input + cache reads/writes + output). */
  tokens: number;
  /** Per-project breakdown, keyed by the project's cwd basename. */
  projects: Record<string, ClaudeProjectCost>;
  /** Transcript files actually re-parsed this call (cache misses). */
  scannedFiles: number;
}

export interface FleetSpend {
  personas: Record<string, FleetSpendEntry>;
  totalCostUsd: number;
  /** How many fleet jobs were scanned this call. */
  scannedJobs: number;
  /**
   * Claude Code session usage merged into totalCostUsd (same 7-day window).
   * Absent only if the transcript scan failed — the tab still shows fleet-only.
   */
  claude?: ClaudeSpend;
  /**
   * DeepSeek jobs whose served model differed from the one dispatched. The
   * endpoint answers 200 with a substitute for an unknown id, so a non-zero
   * count here means spend figures and results are attributed to the wrong
   * model — not a cosmetic warning.
   */
  modelMismatches?: number;
}

/** One fleet job in a persona's run history. Cost is derived from the job's
 * `result` event — DeepSeek recomputed from raw tokens, Anthropic trusted from
 * the CLI figure — so the run list and the spend scan can never disagree. */
export interface FleetPersonaJob {
  id: string;
  /** Display-only dispatch label, `fleet:<persona> (<model>) — <brief>`. */
  command: string;
  status: JobStatus;
  exitCode: number | null;
  createdAt: string;
  endedAt: string | null;
  /** Dispatched model from the label — the cost-basis selector. */
  model: string;
  costUsd: number | null;
  costBasis: 'computed' | 'reported';
  usage?: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
  };
  servedModel?: string;
  durationMs?: number;
  sessionId?: string;
  /** DeepSeek run whose served model differed from the one dispatched. */
  modelMismatch?: boolean;
}
