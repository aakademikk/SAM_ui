/**
 * SAM — Fleet types.
 *
 * The Fleet tab is the single interface for dispatching the Tier 2 General
 * personas (hermes, calliope, hephaestus, cerberus, prometheus) as stateless `claude`
 * CLI jobs. Personas are read live from `~/.claude/agents/*.md` — the vault
 * Generals notes are the source of truth, these files are the executable
 * layer over them.
 */

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
  /** Sum of the CLI-reported `total_cost_usd` across those jobs. */
  costUsd: number;
}

export interface FleetSpend {
  personas: Record<string, FleetSpendEntry>;
  totalCostUsd: number;
  /** How many fleet jobs were scanned this call. */
  scannedJobs: number;
}
