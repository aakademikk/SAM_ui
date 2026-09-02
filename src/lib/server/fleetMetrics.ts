/**
 * SAM — real fleet agent telemetry.
 *
 * Replaces the fabricated AGENT_BLUEPRINTS roster. Real agents are the
 * personas in `~/.claude/agents/*.md`; their live state comes from the
 * retained job store (`~/.sam/jobs/`), the same store the Fleet tab reads.
 *
 * Fields with no real per-agent source (cpu, mem, tokens) report 0 honestly
 * rather than a made-up number. Status is derived: any job still running for
 * a persona makes it executing; otherwise it is idle. There is no real
 * "blocked" signal yet, so nothing reports blocked.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { FleetAgent, AgentStatus } from '@/types/dashboard';

const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const CACHE_MS = 8_000;

interface PersonaMeta {
  name: string;
  description: string;
  model: string;
}

/** Domain the persona actually works in, from its description. */
function personaDomain(description: string, name: string): string {
  const d = description.toLowerCase();
  if (d.includes('marketing')) return 'marketing';
  if (d.includes('growth') || d.includes('lead generation') || d.includes('outreach')) return 'growth';
  if (d.includes('security')) return 'security';
  if (d.includes('delivery') || d.includes('prototype') || d.includes('production build')) return 'delivery';
  if (d.includes('r&d') || d.includes('research')) return 'rd';
  return 'general';
}

/** Tier grouping: the five Generals are tier-2, everything else is core. */
function personaTier(name: string): string {
  const generals = new Set(['calliope', 'cerberus', 'hephaestus', 'hermes', 'prometheus']);
  return generals.has(name) ? 'tier-2' : 'core';
}

interface JobMeta {
  command?: string;
  status?: string;
  exitCode?: number | null;
  createdAt?: string;
  endedAt?: string | null;
}

function readPersonas(): PersonaMeta[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(AGENTS_DIR);
  } catch {
    return [];
  }

  const personas: PersonaMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(AGENTS_DIR, entry), 'utf-8');
    } catch {
      continue;
    }
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    if (!name) continue;
    personas.push({
      name,
      description: fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '',
      model: fm[1].match(/^model:\s*(.+)$/m)?.[1]?.trim() ?? 'sonnet',
    });
  }
  personas.sort((a, b) => a.name.localeCompare(b.name));
  return personas;
}

/** Per-persona stats from the job store. */
function readJobStats(): Map<string, { running: boolean; completed: number; errors: number; lastAt: number; lastTask: string }> {
  const out = new Map<string, { running: boolean; completed: number; errors: number; lastAt: number; lastTask: string }>();

  let dirs: string[];
  try {
    dirs = fs.readdirSync(JOBS_ROOT);
  } catch {
    return out;
  }

  for (const dir of dirs) {
    if (!dir.startsWith('job_')) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(JOBS_ROOT, dir, 'meta.json'), 'utf-8');
    } catch {
      continue;
    }

    let meta: JobMeta;
    try {
      meta = JSON.parse(raw) as JobMeta;
    } catch {
      continue;
    }
    if (!meta.command) continue;

    const match = meta.command.match(/^fleet:([a-z0-9_-]+)/);
    if (!match) continue;
    const persona = match[1];
    const entry = out.get(persona) ?? { running: false, completed: 0, errors: 0, lastAt: 0, lastTask: '' };

    const createdAt = meta.createdAt ? Date.parse(meta.createdAt) : 0;
    const endedAt = meta.endedAt ? Date.parse(meta.endedAt) : 0;
    entry.lastAt = Math.max(entry.lastAt, isNaN(endedAt) ? createdAt : endedAt);

    if (meta.status === 'running') entry.running = true;
    if (meta.status === 'exited' && meta.exitCode === 0) entry.completed++;
    // Same semantics as jobRunMetrics: terminations (killed / SIGTERM) are not
    // errors — a user stop, the watchdog, or a restart.
    if (meta.status === 'failed' || meta.status === 'error' || (typeof meta.exitCode === 'number' && meta.exitCode !== 0 && meta.exitCode !== 143)) entry.errors++;
    // Most recent command label is the persona's current/next task context.
    if (!entry.lastTask || createdAt >= entry.lastAt - 1000) entry.lastTask = meta.command.replace(/^fleet:[a-z0-9_-]+\s*/, '').slice(0, 80);

    out.set(persona, entry);
  }

  return out;
}

function buildAgents(): FleetAgent[] {
  const personas = readPersonas();
  const stats = readJobStats();
  const now = Date.now();

  return personas.map((p) => {
    const s = stats.get(p.name);
    const status: AgentStatus = s?.running ? 'executing' : 'idle';
    const lastTask = s?.lastTask?.trim() || 'idle — awaiting dispatch';

    return {
      id: `agent_${p.name.toLowerCase()}`,
      codename: p.name,
      role: personaDomain(p.description, p.name),
      swarm: personaTier(p.name),
      status,
      currentTask: status === 'executing' ? lastTask : lastTask,
      progress: status === 'executing' ? 0.5 : 0,
      cpuPct: 0, // no per-agent source
      memMb: 0,
      memCapMb: 2048,
      tokensPerMin: 0,
      queueDepth: 0,
      uptimeSec: 0,
      tasksCompleted: s?.completed ?? 0,
      errorCount: s?.errors ?? 0,
      lastHeartbeat: new Date(s?.lastAt || now).toISOString(),
    };
  });
}

let cached: { at: number; agents: FleetAgent[] } | null = null;

/** Real fleet agents (personas + job store). Cached like vaultMetrics. */
export function readFleetAgents(): FleetAgent[] {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.agents;
  const agents = buildAgents();
  cached = { at: Date.now(), agents };
  return agents;
}
