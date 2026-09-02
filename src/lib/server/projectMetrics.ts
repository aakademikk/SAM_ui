/**
 * SAM — real project telemetry.
 *
 * Reads the actual Atwood Systems folder in the vault and derives Project[]
 * from the notes on disk. The registry below is curation (which real notes
 * belong to which real project) — every stat (phase, health, progress,
 * open issues, blockers) is read from the note state, never fabricated.
 *
 * Fields with no real source stay honestly zero/empty rather than faking a
 * number: budgetUsedPct and etaDays report 0, meaning "not tracked".
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Project, ProjectHealth, ProjectPhase } from '@/types/dashboard';

const ATWOOD_DIR = '/home/col/ai-memory-vault/02 - Atwood Systems';
const CLIENTS_DIR = path.join(ATWOOD_DIR, '10_Clients');
const PRIORITIES_PATH = '/home/col/ai-memory-vault/Active Priorities.md';
const CACHE_MS = 8_000;

interface ProjectMeta {
  id: string;
  name: string;
  client: string;
  deployTarget: string;
  owner: string;
  files: string[];
  /** Active Priorities item prefixes that count as this project's work. */
  apPrefixes: string[];
}

const PROJECT_META: ProjectMeta[] = [
  {
    id: 'proj_pat',
    name: 'Parkfords P.A.T',
    client: 'Parkfords',
    deployTarget: 'parkfordsai.co.uk',
    owner: 'hephaestus',
    files: [
      'Parkfords Site Visit App - User Feedback.md',
      'Parkfords Site Visit App - Progress Report 2026-08-19.md',
      'Parkfords Sign-off Runbook 2026-08-17.md',
      'Parkfords System Handover 2026-08-20.md',
    ],
    apPrefixes: ['Parkfords Site Visit App', 'Parkfords Dashboard app'],
  },
  {
    id: 'proj_timesheet',
    name: 'Parkfords Timesheet & Invoice',
    client: 'Parkfords',
    deployTarget: 'n8n + docmerge',
    owner: 'hephaestus',
    files: ['Parkfords Timesheet & Invoice Automation.md'],
    apPrefixes: ['Parkfords Timesheet & Invoice Automation', 'Inspection emails + completed-form export'],
  },
  {
    id: 'proj_wo',
    name: 'Parkfords Works Order Automation',
    client: 'Parkfords',
    deployTarget: 'n8n + docmerge',
    owner: 'hephaestus',
    files: ['Parkfords Works Order Automation.md'],
    apPrefixes: ['Parkfords Works Order Automation'],
  },
  {
    id: 'proj_leadgen',
    name: 'Parkfords Lead Generation',
    client: 'Parkfords',
    deployTarget: 'parkfordsai.co.uk/app/lead-gen',
    owner: 'hermes',
    files: ['Parkfords - Lead Generation Strategy.md'],
    apPrefixes: ['RTM Lead Finder', 'Parkfords lead-gen'],
  },
  {
    id: 'proj_rtm',
    name: 'RTM Lead Finder',
    client: 'Atwood Systems',
    deployTarget: '/home/col/rtm-lead-finder',
    owner: 'hermes',
    files: ['RTM Lead Finder.md'],
    apPrefixes: ['RTM Lead Finder'],
  },
  {
    id: 'proj_receptionist',
    name: 'AI Receptionist Platform',
    client: 'Atwood Systems',
    deployTarget: 'github.com/aakademikk/AI-Receptionist-platform',
    owner: 'hephaestus',
    files: ['AI Receptionist Platform.md'],
    apPrefixes: ['AI Receptionist platform', 'SAM Phone Assistant'],
  },
  {
    id: 'proj_dataenergy',
    name: 'Data Energy Portal',
    client: 'Parkfords',
    deployTarget: 'portal (data energy)',
    owner: 'hephaestus',
    files: ['Data Energy Portal.md'],
    apPrefixes: ['Data Energy sync'],
  },
  {
    id: 'proj_kaw',
    name: 'KAW Brickwork',
    client: 'KAW Brickwork (lead)',
    deployTarget: '/home/col/Atwood_demos/kaw-brickwork',
    owner: 'hephaestus',
    files: ['10_Clients/KAW Brickwork - lead.md', '10_Clients/KAW Brickwork - lead/kaw-audit-2026-08-21.md'],
    apPrefixes: ['KAW Brickwork'],
  },
  {
    id: 'proj_4edge',
    name: '4edge.co.uk',
    client: '4edge (lead)',
    deployTarget: '/home/col/Atwood_demos',
    owner: 'hephaestus',
    files: ['10_Clients/4edge.co.uk - lead.md', '10_Clients/4edge Limited - outreach.md'],
    apPrefixes: ['4edge.co.uk'],
  },
  {
    id: 'proj_horizon',
    name: 'Horizon Blinds (Brad)',
    client: 'Horizon Blinds (lead)',
    deployTarget: '—',
    owner: 'hermes',
    files: ['10_Clients/Horizon Blinds - Brad.md'],
    apPrefixes: ['Brad / Horizon Blinds'],
  },
];

/* ------------------------------------------------------------------------ */
/* Reading helpers                                                           */
/* ------------------------------------------------------------------------ */

function readFileIfExists(file: string): string | null {
  const full = path.join(ATWOOD_DIR, file);
  try {
    return fs.readFileSync(full, 'utf-8');
  } catch {
    return null;
  }
}

/** (done, total) checkbox counts in a note body. */
function checkboxCounts(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]/);
    if (!m) continue;
    total++;
    if (m[1].toLowerCase() === 'x') done++;
  }
  return { done, total };
}

/** Status frontmatter value, or null when the note has none / doesn't exist. */
function noteStatus(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/^status:\s*(\S+)/m);
  return m ? m[1].toLowerCase() : null;
}

/** (done, total) for Active Priorities items whose bold prefix matches. */
function prioritiesProgress(prefixes: string[]): { done: number; total: number } {
  let text: string;
  try {
    text = fs.readFileSync(PRIORITIES_PATH, 'utf-8');
  } catch {
    return { done: 0, total: 0 };
  }

  const keys = prefixes.map((p) => p.toLowerCase());
  let done = 0;
  let total = 0;

  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s+\*\*([^*]+)/);
    if (!m) continue;
    const title = m[2].trim().toLowerCase();
    if (!keys.some((k) => title.startsWith(k))) continue;
    total++;
    if (m[1].toLowerCase() === 'x') done++;
  }

  return { done, total };
}

/** Count of "blocked" mentions in a set of note texts. */
function blockedMentions(texts: (string | null)[]): number {
  return texts.reduce(
    (sum, t) => sum + (t ? (t.match(/\bblocked\b/gi)?.length ?? 0) : 0),
    0,
  );
}

/* ------------------------------------------------------------------------ */
/* Project derivation                                                        */
/* ------------------------------------------------------------------------ */

function buildProject(meta: ProjectMeta): Project {
  const texts = meta.files.map(readFileIfExists);
  const anyText = texts.find((t): t is string => t !== null) ?? '';

  const noteChecks = texts.reduce(
    (acc, t) => {
      const c = checkboxCounts(t ?? '');
      return { done: acc.done + c.done, total: acc.total + c.total };
    },
    { done: 0, total: 0 },
  );
  const apChecks = prioritiesProgress(meta.apPrefixes);

  const done = noteChecks.done + apChecks.done;
  const total = noteChecks.total + apChecks.total;
  const progress = total > 0 ? Math.min(1, done / total) : 0;

  // Status union across the project's notes: any note that's complete makes
  // the project shipped; otherwise an active note keeps it on-track.
  const statuses = texts.map(noteStatus).filter((s): s is string => s !== null);
  const allDone = total > 0 && done >= total;
  const blockers = blockedMentions(texts);

  let phase: ProjectPhase;
  let health: ProjectHealth;

  if (statuses.includes('completed') || allDone) {
    phase = 'production';
    health = 'shipped';
  } else if (statuses.includes('draft')) {
    phase = 'discovery';
    health = blockers > 0 ? 'at-risk' : 'on-track';
  } else if (blockers > 0) {
    phase = 'blocked';
    health = blockers >= 2 ? 'critical' : 'at-risk';
  } else {
    // Active / unknown status — an honest build/qa default, not a claim.
    phase = total > 0 && progress > 0.5 ? 'qa' : 'build';
    health = 'on-track';
  }

  // Latest real modification across the project's notes.
  let lastDeploy = 0;
  for (const file of meta.files) {
    try {
      const st = fs.statSync(path.join(ATWOOD_DIR, file));
      lastDeploy = Math.max(lastDeploy, st.mtimeMs);
    } catch {
      // note missing — skip
    }
  }

  return {
    id: meta.id,
    name: meta.name,
    client: meta.client,
    phase,
    health,
    progress,
    deployTarget: meta.deployTarget,
    openIssues: Math.max(0, total - done),
    blockers,
    lastDeploy: new Date(lastDeploy || Date.now()).toISOString(),
    etaDays: 0, // not tracked
    budgetUsedPct: 0, // not tracked
    owner: meta.owner,
  };
}

/* ------------------------------------------------------------------------ */

let cached: { at: number; projects: Project[] } | null = null;

/** Real projects derived from the vault. Cached like vaultMetrics. */
export function readProjects(): Project[] {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.projects;
  const projects = PROJECT_META.map(buildProject);
  cached = { at: Date.now(), projects };
  return projects;
}
