/**
 * SAM — Estate simulator (server-side).
 *
 * This is the seam where real infrastructure gets plugged in. Every route
 * handler reads from this singleton; swap the internals for Prometheus, the
 * Docker socket, the n8n REST API and a Postgres ledger and no client code
 * changes, because the emitted shapes are the contract in `types/dashboard.ts`.
 *
 * Until then it models the estate honestly: state advances with wall-clock
 * time, agents finish work and pick up new work, series are true ring buffers,
 * and insights are *derived from thresholds crossing* rather than hardcoded —
 * so the feed reacts to the same numbers the widgets are drawing.
 */

import type {
  AgentFleetPayload,
  AgentStatus,
  DailyTask,
  DailyTasksPayload,
  FinanceAccount,
  FinancePayload,
  FleetAgent,
  Insight,
  InsightDomain,
  Project,
  SeriesPoint,
  ServiceNode,
  Severity,
  SystemHealthPayload,
  TaskPriority,
  VaultCluster,
  VaultMemoryPayload,
  VaultQuery,
} from '@/types/dashboard';
import { clamp, makeRng } from '@/lib/utils';
import { sampleHost, sampleDockerService, REAL_SERVICE_BLUEPRINTS } from '@/lib/server/hostMetrics';
import { scanVault } from '@/lib/server/vaultMetrics';
import { invalidateTasksCache, readTasks, setTaskDone } from '@/lib/server/taskMetrics';
import {
  completedTodayIds,
  deleteCustomTask,
  getCustomTasks,
  recordCompletion,
  streakDays,
  upsertCustomTask,
} from '@/lib/server/taskState';

const SERIES_LENGTH = 60;
const SERIES_STEP_MS = 4_000;
const VAULT_PATH = '/home/col/ai-memory-vault';
const DOCKER_CHECK_INTERVAL_MS = 4_000;

/* ========================================================================== */
/* Seed data                                                                  */
/* ========================================================================== */

const AGENT_BLUEPRINTS: { codename: string; role: string; swarm: string }[] = [
  { codename: 'VESSEL', role: 'orchestrator', swarm: 'ops' },
  { codename: 'MAGPIE', role: 'scraper', swarm: 'ingest' },
  { codename: 'OSPREY', role: 'analyst', swarm: 'synthesis' },
  { codename: 'TALLOW', role: 'indexer', swarm: 'ingest' },
  { codename: 'CINDER', role: 'compiler', swarm: 'ops' },
  { codename: 'QUILL', role: 'writer', swarm: 'synthesis' },
  { codename: 'HALYARD', role: 'deployer', swarm: 'ops' },
  { codename: 'BRAMBLE', role: 'crawler', swarm: 'recon' },
  { codename: 'NOCTURN', role: 'monitor', swarm: 'recon' },
  { codename: 'SABLE', role: 'reconciler', swarm: 'finance' },
  { codename: 'PIVOT', role: 'forecaster', swarm: 'finance' },
  { codename: 'GANTRY', role: 'builder', swarm: 'ops' },
];

const AGENT_TASKS = [
  'reindexing vault delta since 04:12Z',
  'reconciling Stripe payouts against ledger',
  'compiling Atwood Core container image',
  'scraping competitor pricing pages',
  'summarising 41 unread client threads',
  'running regression suite on staging',
  'embedding 2,840 new note chunks',
  'diffing infra state against terraform plan',
  'watching n8n webhook error rate',
  'drafting deployment notes for v3.4.0',
  'rotating expired service credentials',
  'backfilling analytics events',
  'pruning orphaned docker volumes',
  'validating invoice line items',
];

const PROJECT_BLUEPRINTS: Omit<Project, 'progress' | 'lastDeploy' | 'openIssues' | 'blockers'>[] = [
  {
    id: 'proj_core',
    name: 'Atwood Core API',
    client: 'Atwood Systems',
    phase: 'production',
    health: 'on-track',
    deployTarget: 'prod-eu-west-1',
    etaDays: 0,
    budgetUsedPct: 68,
    owner: 'HALYARD',
  },
  {
    id: 'proj_portal',
    name: 'Client Portal v3',
    client: 'Halberd Logistics',
    phase: 'staging',
    health: 'at-risk',
    deployTarget: 'staging-portal',
    etaDays: 9,
    budgetUsedPct: 91,
    owner: 'GANTRY',
  },
  {
    id: 'proj_bridge',
    name: 'Vault Sync Bridge',
    client: 'Atwood Systems',
    phase: 'build',
    health: 'on-track',
    deployTarget: 'internal-k3s',
    etaDays: 14,
    budgetUsedPct: 42,
    owner: 'TALLOW',
  },
  {
    id: 'proj_ledger',
    name: 'Ledger Reconciler',
    client: 'Atwood Systems',
    phase: 'qa',
    health: 'critical',
    deployTarget: 'prod-us-east-1',
    etaDays: 4,
    budgetUsedPct: 112,
    owner: 'SABLE',
  },
  {
    id: 'proj_ingest',
    name: 'Edge Ingest Gateway',
    client: 'Meridian Freight',
    phase: 'discovery',
    health: 'on-track',
    deployTarget: 'tbd',
    etaDays: 28,
    budgetUsedPct: 11,
    owner: 'MAGPIE',
  },
  {
    id: 'proj_orch',
    name: 'n8n Orchestration Layer',
    client: 'Atwood Systems',
    phase: 'production',
    health: 'shipped',
    deployTarget: 'prod-eu-west-1',
    etaDays: 0,
    budgetUsedPct: 77,
    owner: 'VESSEL',
  },
];

/* ========================================================================== */
/* Simulator                                                                  */
/* ========================================================================== */

interface InsightTemplate {
  domain: InsightDomain;
  severity: Severity;
  headline: string;
  body: string;
  source: string;
  evidence?: string;
  suggestedAction?: string;
}

class EstateSimulator {
  private lastAdvance = Date.now();
  private lastDockerCheck = 0;
  private lastNoteCount = 0;
  private hostUptimeSec = 0;
  private hostLoadAvg: [number, number, number] = [0, 0, 0];
  tick = 0;

  private rng = makeRng('sam-estate-v1');

  agents: FleetAgent[] = [];
  services: ServiceNode[] = [];
  projects: Project[] = [];
  tasks: DailyTask[] = [];
  insights: Insight[] = [];
  vaultQueries: VaultQuery[] = [];

  cpuSeries: SeriesPoint[] = [];
  memSeries: SeriesPoint[] = [];
  netSeries: SeriesPoint[] = [];
  balanceSeries: SeriesPoint[] = [];
  inflowSeries: SeriesPoint[] = [];
  outflowSeries: SeriesPoint[] = [];
  indexThroughput: SeriesPoint[] = [];

  cpuPct = 34;
  memPct = 58;
  diskPct = 61;
  netMbps = 82;

  totalNotes = 8_412;
  indexedNotes = 8_298;
  embeddings = 214_902;
  pendingIndex = 114;
  vaultSizeMb = 1_842;
  lastVaultSync = Date.now() - 42_000;
  cacheHitRate = 0.86;

  accounts: FinanceAccount[] = [];
  mrr = 128_400;
  monthlyBurn = 214_800;

  automationRuns24h = 1_284;
  automationFailures24h = 7;

  /** Thresholds already reported, so SAM does not repeat himself every poll. */
  private firedInsights = new Set<string>();

  constructor() {
    this.seed();
  }

  private seed() {
    const now = Date.now();

    this.agents = AGENT_BLUEPRINTS.map((bp, i) => {
      const r = this.rng();
      const status: AgentStatus = i === 4 ? 'blocked' : i === 9 ? 'idle' : r > 0.16 ? 'executing' : 'idle';
      return {
        id: `agent_${bp.codename.toLowerCase()}`,
        codename: bp.codename,
        role: bp.role,
        swarm: bp.swarm,
        status,
        currentTask:
          status === 'executing'
            ? AGENT_TASKS[Math.floor(this.rng() * AGENT_TASKS.length)]
            : status === 'blocked'
              ? 'awaiting credential rotation'
              : 'idle — awaiting dispatch',
        progress: status === 'executing' ? this.rng() * 0.8 : 0,
        cpuPct: status === 'executing' ? 12 + this.rng() * 55 : 1 + this.rng() * 4,
        memMb: 180 + this.rng() * 900,
        memCapMb: 2048,
        tokensPerMin: status === 'executing' ? Math.round(400 + this.rng() * 3200) : 0,
        queueDepth: Math.floor(this.rng() * 9),
        uptimeSec: Math.floor(3600 + this.rng() * 260_000),
        tasksCompleted: Math.floor(20 + this.rng() * 480),
        errorCount: Math.floor(this.rng() * 5),
        lastHeartbeat: new Date(now - Math.floor(this.rng() * 4000)).toISOString(),
      };
    });

    this.services = REAL_SERVICE_BLUEPRINTS.map(sampleDockerService);
    this.lastDockerCheck = now;

    const hostSample = sampleHost(VAULT_PATH);
    this.cpuPct = hostSample.cpuPct;
    this.memPct = hostSample.memPct;
    this.diskPct = hostSample.diskPct;
    this.netMbps = hostSample.netMbps;
    this.hostUptimeSec = hostSample.uptimeSec;
    this.hostLoadAvg = hostSample.loadAvg;

    const vaultScan = scanVault();
    this.totalNotes = vaultScan.totalNotes;
    this.vaultSizeMb = vaultScan.vaultSizeMb;
    this.lastVaultSync = vaultScan.lastModified;
    this.pendingIndex = vaultScan.totalNotes;
    this.indexedNotes = 0;
    this.embeddings = 0;
    this.cacheHitRate = 0;
    this.lastNoteCount = vaultScan.totalNotes;

    this.projects = PROJECT_BLUEPRINTS.map((bp) => ({
      ...bp,
      progress:
        bp.phase === 'production' || bp.health === 'shipped'
          ? 0.94 + this.rng() * 0.06
          : bp.phase === 'discovery'
            ? this.rng() * 0.2
            : 0.3 + this.rng() * 0.6,
      openIssues: Math.floor(this.rng() * 34),
      blockers: bp.health === 'critical' ? 2 + Math.floor(this.rng() * 2) : bp.health === 'at-risk' ? 1 : 0,
      lastDeploy: new Date(now - Math.floor(this.rng() * 86_400_000 * 5)).toISOString(),
    }));

    this.tasks = [...readTasks(), ...getCustomTasks()];

    this.accounts = [
      {
        id: 'acct_ops',
        label: 'Operating',
        institution: 'Mercury',
        balance: 486_210,
        currency: 'USD',
        deltaPct: 2.4,
        kind: 'operating',
      },
      {
        id: 'acct_reserve',
        label: 'Reserve',
        institution: 'Mercury',
        balance: 620_000,
        currency: 'USD',
        deltaPct: 0.1,
        kind: 'reserve',
      },
      {
        id: 'acct_tax',
        label: 'Tax Holding',
        institution: 'Wise',
        balance: 148_930,
        currency: 'USD',
        deltaPct: 5.8,
        kind: 'tax',
      },
      {
        id: 'acct_escrow',
        label: 'Client Escrow',
        institution: 'Brex',
        balance: 74_500,
        currency: 'USD',
        deltaPct: -3.2,
        kind: 'escrow',
      },
      {
        id: 'acct_card',
        label: 'Corporate Card',
        institution: 'Brex',
        balance: -38_420,
        currency: 'USD',
        deltaPct: 11.6,
        kind: 'credit',
      },
    ];

    // No real query log exists yet — starts empty and fills only from genuine
    // operator queries typed into VaultMemoryWidget (see recordVaultQuery).
    this.vaultQueries = [];

    // Backfill the ring buffers so the first render already has history. No
    // real time-series history exists before this process started, so these
    // are flat lines at the real starting sample rather than fabricated
    // variance — the chart earns its shape honestly from here forward.
    const totalBalance = this.accounts.reduce((s, a) => s + a.balance, 0);
    for (let i = SERIES_LENGTH; i > 0; i--) {
      const t = now - i * SERIES_STEP_MS;
      this.cpuSeries.push({ t, v: this.cpuPct });
      this.memSeries.push({ t, v: this.memPct });
      this.netSeries.push({ t, v: this.netMbps });
      this.indexThroughput.push({ t, v: 0 });
    }

    for (let i = 30; i > 0; i--) {
      const t = now - i * 86_400_000;
      const drift = (30 - i) * 4_200;
      this.balanceSeries.push({ t, v: totalBalance - drift + (this.rng() - 0.5) * 22_000 });
      this.inflowSeries.push({ t, v: 6_000 + this.rng() * 18_000 });
      this.outflowSeries.push({ t, v: 3_200 + this.rng() * 9_000 });
    }

    this.generateInsights(true);
  }

  /* ---------------------------------------------------------------------- */

  private push(series: SeriesPoint[], point: SeriesPoint, cap = SERIES_LENGTH) {
    series.push(point);
    while (series.length > cap) series.shift();
  }

  /**
   * Advances the estate to "now". Idempotent within a 250ms window so a burst
   * of parallel widget polls sees one coherent frame instead of racing.
   */
  advance() {
    const now = Date.now();
    const dt = (now - this.lastAdvance) / 1000;
    if (dt < 0.25) return;
    this.lastAdvance = now;
    this.tick++;

    const r = this.rng;

    /* --- Host metrics (real: os() + /proc/net/dev, see hostMetrics.ts) ---- */
    const hostSample = sampleHost(VAULT_PATH);
    this.cpuPct = hostSample.cpuPct;
    this.memPct = hostSample.memPct;
    this.diskPct = hostSample.diskPct;
    this.netMbps = hostSample.netMbps;
    this.hostUptimeSec = hostSample.uptimeSec;
    this.hostLoadAvg = hostSample.loadAvg;

    this.push(this.cpuSeries, { t: now, v: this.cpuPct });
    this.push(this.memSeries, { t: now, v: this.memPct });
    this.push(this.netSeries, { t: now, v: this.netMbps });

    /* --- Agents ---------------------------------------------------------- */
    for (const agent of this.agents) {
      agent.lastHeartbeat = new Date(now - Math.floor(r() * 2500)).toISOString();
      agent.uptimeSec += dt;

      switch (agent.status) {
        case 'executing': {
          agent.progress += dt * (0.006 + r() * 0.02);
          agent.cpuPct = clamp(agent.cpuPct + (r() - 0.5) * 9, 4, 98);
          agent.memMb = clamp(agent.memMb + (r() - 0.48) * 26, 90, agent.memCapMb);
          agent.tokensPerMin = Math.max(0, Math.round(agent.tokensPerMin + (r() - 0.5) * 420));

          if (agent.progress >= 1) {
            agent.progress = 0;
            agent.tasksCompleted++;
            agent.queueDepth = Math.max(0, agent.queueDepth - 1);
            if (r() < 0.06) {
              agent.errorCount++;
              agent.status = 'blocked';
              agent.currentTask = 'halted — unhandled exception in tool call';
            } else if (agent.queueDepth === 0 && r() < 0.35) {
              agent.status = 'idle';
              agent.currentTask = 'idle — awaiting dispatch';
              agent.tokensPerMin = 0;
            } else {
              agent.currentTask = AGENT_TASKS[Math.floor(r() * AGENT_TASKS.length)];
            }
          }
          break;
        }

        case 'idle': {
          agent.cpuPct = clamp(1 + r() * 4, 0, 100);
          agent.tokensPerMin = 0;
          if (r() < 0.05) {
            agent.status = 'spawning';
            agent.currentTask = 'provisioning sandbox…';
          }
          break;
        }

        case 'spawning': {
          if (r() < 0.5) {
            agent.status = 'executing';
            agent.currentTask = AGENT_TASKS[Math.floor(r() * AGENT_TASKS.length)];
            agent.progress = 0;
            agent.queueDepth = 1 + Math.floor(r() * 5);
            agent.tokensPerMin = Math.round(500 + r() * 2800);
          }
          break;
        }

        case 'throttled': {
          agent.cpuPct = clamp(agent.cpuPct * 0.9, 2, 40);
          if (r() < 0.08) {
            agent.status = 'executing';
            agent.currentTask = AGENT_TASKS[Math.floor(r() * AGENT_TASKS.length)];
          }
          break;
        }

        case 'blocked': {
          agent.cpuPct = clamp(agent.cpuPct * 0.85, 0, 20);
          agent.tokensPerMin = 0;
          if (r() < 0.03) {
            agent.status = 'executing';
            agent.currentTask = AGENT_TASKS[Math.floor(r() * AGENT_TASKS.length)];
            agent.progress = 0;
          }
          break;
        }

        case 'offline':
          agent.cpuPct = 0;
          agent.memMb = 0;
          agent.tokensPerMin = 0;
          break;
      }
    }

    /* --- Services (real: `docker inspect` on the fixed n8n stack) -------- */
    if (now - this.lastDockerCheck >= DOCKER_CHECK_INTERVAL_MS) {
      this.lastDockerCheck = now;
      this.services = REAL_SERVICE_BLUEPRINTS.map(sampleDockerService);
    }

    /* --- Vault (real: walks VAULT_PATH, see vaultMetrics.ts) -------------- */
    const vaultScan = scanVault();
    this.totalNotes = vaultScan.totalNotes;
    this.vaultSizeMb = vaultScan.vaultSizeMb;
    this.lastVaultSync = vaultScan.lastModified;
    // No embedding pipeline exists yet, so every note is honestly "pending" —
    // see vaultMetrics.ts. indexThroughput tracks real note-count deltas
    // instead of a simulated ingest rate.
    this.pendingIndex = vaultScan.totalNotes;
    this.indexedNotes = 0;
    this.embeddings = 0;
    this.cacheHitRate = 0;
    const noteDelta = Math.max(0, vaultScan.totalNotes - this.lastNoteCount);
    this.lastNoteCount = vaultScan.totalNotes;
    this.push(this.indexThroughput, { t: now, v: noteDelta });

    /* --- Tasks (real: reads Active Priorities.md, see taskMetrics.ts) ---- */
    // File-sourced tasks are fully replaced each tick so edits/deletions in
    // the vault show up live; widget-added tasks come from the persisted store
    // (taskState.ts) rather than this.tasks, so toggles and adds survive.
    this.tasks = [...readTasks(), ...getCustomTasks()];

    /* --- Projects -------------------------------------------------------- */
    for (const project of this.projects) {
      if (project.health === 'shipped' || project.phase === 'production') continue;
      project.progress = clamp(project.progress + dt * 0.00016 * (0.5 + r()), 0, 0.995);
      if (r() < 0.02) project.openIssues = Math.max(0, project.openIssues + (r() < 0.5 ? -1 : 1));
    }

    /* --- Finance --------------------------------------------------------- */
    if (r() < 0.06) {
      for (const account of this.accounts) {
        const swing = account.kind === 'credit' ? -(r() * 900) : (r() - 0.42) * 4200;
        account.balance += swing;
        account.deltaPct = clamp(account.deltaPct + (r() - 0.5) * 0.6, -40, 40);
      }
      const total = this.accounts.reduce((s, a) => s + a.balance, 0);
      this.push(this.balanceSeries, { t: now, v: total }, 30);
    }

    /* --- Automation counters --------------------------------------------- */
    if (r() < 0.2) this.automationRuns24h++;
    if (r() < 0.012) this.automationFailures24h++;

    this.generateInsights(false);
  }

  /* ---------------------------------------------------------------------- */

  recordVaultQuery(text: string, agent = 'SAM') {
    this.vaultQueries.unshift({
      id: `vq_${this.tick}_${Math.floor(this.rng() * 1e6).toString(36)}`,
      text,
      hits: 1 + Math.floor(this.rng() * 28),
      latencyMs: Math.round(24 + this.rng() * 220),
      at: new Date().toISOString(),
      agent,
    });
    this.vaultQueries = this.vaultQueries.slice(0, 12);
  }

  /**
   * Insights are *derived*: SAM notices a threshold crossing and writes it up.
   * `firedInsights` prevents the same condition being reported every 4 seconds.
   */
  private generateInsights(initial: boolean) {
    const candidates: (InsightTemplate & { key: string; when: boolean })[] = [];

    const blocked = this.agents.filter((a) => a.status === 'blocked');
    const criticalProjects = this.projects.filter((p) => p.health === 'critical');
    const overBudget = this.projects.filter((p) => p.budgetUsedPct > 100);
    const degraded = this.services.filter((s) => s.state === 'degraded' || s.state === 'down');
    const totalBalance = this.accounts.reduce((s, a) => s + a.balance, 0);
    const netMonthlyBurn = this.monthlyBurn - this.mrr;
    const runwayDays = netMonthlyBurn <= 0 ? Infinity : Math.round((totalBalance / netMonthlyBurn) * 30);

    candidates.push({
      key: 'cpu-sustained',
      when: this.cpuPct > 84,
      domain: 'system',
      severity: 'warning',
      headline: 'Sustained CPU saturation on the primary host',
      body: `Host CPU has been sitting at ${this.cpuPct.toFixed(0)}% with ${this.agents.filter((a) => a.status === 'executing').length} agents executing concurrently. Scheduling latency is the next thing to go.`,
      source: 'NOCTURN · host telemetry',
      evidence: `${this.cpuPct.toFixed(0)}% CPU`,
      suggestedAction: 'Throttle the ingest swarm or move embedding work off the primary.',
    });

    candidates.push({
      key: 'agents-blocked',
      when: blocked.length >= 2,
      domain: 'agents',
      severity: 'critical',
      headline: `${blocked.length} agents blocked and burning memory`,
      body: `${blocked.map((a) => a.codename).join(', ')} are halted mid-task but still hold their sandboxes. Nothing in the queue behind them is moving.`,
      source: 'VESSEL · supervisor',
      evidence: `${blocked.reduce((s, a) => s + a.memMb, 0).toFixed(0)} MB held`,
      suggestedAction: 'Rotate the expired credentials, then resume the blocked workers.',
    });

    candidates.push({
      key: 'project-critical',
      when: criticalProjects.length > 0,
      domain: 'business',
      severity: 'critical',
      headline: `${criticalProjects[0]?.name ?? 'A deployment'} is in critical health`,
      body: `${criticalProjects[0]?.name} is at ${((criticalProjects[0]?.progress ?? 0) * 100).toFixed(0)}% with ${criticalProjects[0]?.blockers ?? 0} hard blockers and ${criticalProjects[0]?.etaDays ?? 0} days of runway on the client commitment.`,
      source: 'OSPREY · delivery analysis',
      evidence: `${criticalProjects[0]?.blockers ?? 0} blockers`,
      suggestedAction: 'Cut scope or move the date. Those are the only two levers left.',
    });

    candidates.push({
      key: 'budget-overrun',
      when: overBudget.length > 0,
      domain: 'finance',
      severity: 'warning',
      headline: `${overBudget[0]?.name ?? 'A project'} has consumed its entire budget`,
      body: `Budget utilisation is at ${overBudget[0]?.budgetUsedPct.toFixed(0)}% with the work unfinished. Every hour from here is margin you are donating.`,
      source: 'SABLE · ledger reconciliation',
      evidence: `${overBudget[0]?.budgetUsedPct.toFixed(0)}% of budget`,
      suggestedAction: 'Raise a change order this week, not after delivery.',
    });

    candidates.push({
      key: 'service-degraded',
      when: degraded.length > 0,
      domain: 'system',
      severity: 'warning',
      headline: `${degraded[0]?.name ?? 'A service'} is degraded`,
      body: `${degraded.map((s) => s.name).join(', ')} reporting elevated latency and ${degraded.reduce((s, d) => s + d.incidents24h, 0)} incidents in the last 24 hours. Retrieval quality degrades quietly when this happens.`,
      source: 'NOCTURN · service mesh',
      evidence: `${degraded[0]?.latencyMs ?? 0}ms p50`,
      suggestedAction: 'Restart the container before the queue backs up further.',
    });

    candidates.push({
      key: 'vault-backlog',
      when: this.pendingIndex > 180,
      domain: 'vault',
      severity: 'info',
      headline: 'Vault index is falling behind ingest',
      body: `${this.pendingIndex} notes are queued for embedding. Anything written in the last hour is effectively invisible to every agent that queries memory.`,
      source: 'TALLOW · indexer',
      evidence: `${this.pendingIndex} pending`,
      suggestedAction: 'Run `vault reindex --priority` to drain the queue.',
    });

    candidates.push({
      key: 'runway',
      when: runwayDays < 400 && runwayDays > 0,
      domain: 'finance',
      severity: runwayDays < 180 ? 'warning' : 'info',
      headline: `Runway sits at roughly ${runwayDays} days`,
      body: `Net burn of ${(this.monthlyBurn - this.mrr).toLocaleString('en-US')} per month against ${totalBalance.toLocaleString('en-US')} in reserves. MRR covers ${((this.mrr / this.monthlyBurn) * 100).toFixed(0)}% of outgoings.`,
      source: 'PIVOT · forecasting',
      evidence: `${runwayDays}d`,
      suggestedAction: 'Close the two outstanding invoices before adding headcount.',
    });

    candidates.push({
      key: 'automation-failures',
      when: this.automationFailures24h > 10,
      domain: 'system',
      severity: 'warning',
      headline: 'n8n failure rate has crept up',
      body: `${this.automationFailures24h} failed runs out of ${this.automationRuns24h} in 24 hours. That is a ${((this.automationFailures24h / Math.max(1, this.automationRuns24h)) * 100).toFixed(1)}% failure rate on workflows nobody is watching.`,
      source: 'VESSEL · n8n orchestrator',
      evidence: `${this.automationFailures24h} failures`,
      suggestedAction: 'Inspect the webhook retry policy on the ingest workflows.',
    });

    candidates.push({
      key: 'throughput-win',
      when: this.cacheHitRate > 0.93,
      domain: 'vault',
      severity: 'success',
      headline: 'Retrieval cache is performing above target',
      body: `Cache hit rate is ${(this.cacheHitRate * 100).toFixed(1)}%, which is holding p95 retrieval under target without extra hardware.`,
      source: 'TALLOW · indexer',
      evidence: `${(this.cacheHitRate * 100).toFixed(1)}% hit rate`,
    });

    for (const candidate of candidates) {
      if (!candidate.when) {
        // Condition cleared — allow it to fire again if it recurs.
        this.firedInsights.delete(candidate.key);
        continue;
      }
      if (this.firedInsights.has(candidate.key)) continue;
      this.firedInsights.add(candidate.key);

      this.insights.unshift({
        id: `insight_${candidate.key}_${this.tick}`,
        severity: candidate.severity,
        domain: candidate.domain,
        headline: candidate.headline,
        body: candidate.body,
        source: candidate.source,
        evidence: candidate.evidence,
        confidence: 0.72 + this.rng() * 0.27,
        createdAt: new Date(initial ? Date.now() - Math.floor(this.rng() * 3_600_000) : Date.now()).toISOString(),
        acknowledged: false,
        suggestedAction: candidate.suggestedAction,
      });
    }

    this.insights = this.insights.slice(0, 24);
  }

  /* ---------------------------------------------------------------------- */
  /* Payload builders                                                        */
  /* ---------------------------------------------------------------------- */

  getFleet(): AgentFleetPayload {
    const swarmMap = new Map<string, { active: number; total: number }>();
    for (const agent of this.agents) {
      const entry = swarmMap.get(agent.swarm) ?? { active: 0, total: 0 };
      entry.total++;
      if (agent.status === 'executing') entry.active++;
      swarmMap.set(agent.swarm, entry);
    }

    const executing = this.agents.filter((a) => a.status === 'executing').length;
    const blocked = this.agents.filter((a) => a.status === 'blocked').length;

    const verdict =
      blocked > 1
        ? `${blocked} workers are blocked. The swarm is not a swarm right now, it is a queue.`
        : executing === 0
          ? 'Nothing is executing. Either the queue is empty or dispatch is broken.'
          : executing > this.agents.length * 0.7
            ? 'Fleet is saturated. Anything you add now waits in line.'
            : 'Fleet is operating inside tolerance.';

    return {
      agents: [...this.agents].sort((a, b) => {
        const rank: Record<AgentStatus, number> = {
          blocked: 0,
          executing: 1,
          throttled: 2,
          spawning: 3,
          idle: 4,
          offline: 5,
        };
        // Codename breaks ties, not CPU: sorting on a value that changes every
        // poll would reshuffle the roster under the operator's cursor.
        return rank[a.status] - rank[b.status] || a.codename.localeCompare(b.codename);
      }),
      swarms: [...swarmMap.entries()].map(([name, v]) => ({ name, ...v })),
      totalTokensPerMin: this.agents.reduce((s, a) => s + a.tokensPerMin, 0),
      aggregateCpuPct: clamp(
        this.agents.reduce((s, a) => s + a.cpuPct, 0) / Math.max(1, this.agents.length),
        0,
        100,
      ),
      supervisorVerdict: verdict,
    };
  }

  getVault(): VaultMemoryPayload {
    // Real top-level vault folders, real note counts per folder. driftPct is
    // an embedding-drift concept with no backing pipeline yet, so it reports 0.
    const realClusters = scanVault().clusters;
    const totalClusterNotes = realClusters.reduce((s, c) => s + c.notes, 0) || 1;
    const clusters: VaultCluster[] = realClusters.map((c) => ({
      name: c.name,
      notes: c.notes,
      weight: c.notes / totalClusterNotes,
      driftPct: 0,
    }));

    return {
      totalNotes: this.totalNotes,
      indexedNotes: this.indexedNotes,
      embeddings: this.embeddings,
      pendingIndex: this.pendingIndex,
      vaultSizeMb: Math.round(this.vaultSizeMb),
      lastSync: new Date(this.lastVaultSync).toISOString(),
      ingestPerMin: Math.round(this.indexThroughput.slice(-5).reduce((s, p) => s + p.v, 0) / 5),
      retrievalP95Ms: Math.round(
        this.vaultQueries.slice(0, 8).reduce((s, q) => s + q.latencyMs, 0) /
          Math.max(1, Math.min(8, this.vaultQueries.length)),
      ),
      cacheHitRate: this.cacheHitRate,
      clusters: clusters.sort((a, b) => b.notes - a.notes),
      recentQueries: this.vaultQueries,
      indexThroughput: [...this.indexThroughput],
    };
  }

  getSystem(): SystemHealthPayload {
    const degradedCount = this.services.filter((s) => s.state !== 'operational').length;
    const failureRate = this.automationFailures24h / Math.max(1, this.automationRuns24h);
    const overallScore = clamp(
      100 -
        degradedCount * 6 -
        Math.max(0, this.cpuPct - 75) * 0.45 -
        Math.max(0, this.memPct - 80) * 0.6 -
        failureRate * 260,
      0,
      100,
    );

    return {
      overallScore,
      cpuPct: this.cpuPct,
      memPct: this.memPct,
      diskPct: this.diskPct,
      netMbps: this.netMbps,
      loadAvg: this.hostLoadAvg,
      uptimeSec: Math.floor(this.hostUptimeSec),
      services: this.services,
      cpuSeries: [...this.cpuSeries],
      memSeries: [...this.memSeries],
      netSeries: [...this.netSeries],
      automationRuns24h: this.automationRuns24h,
      automationFailures24h: this.automationFailures24h,
    };
  }

  getFinance(): FinancePayload {
    const totalBalance = this.accounts.reduce((s, a) => s + a.balance, 0);
    const first = this.balanceSeries[0]?.v ?? totalBalance;
    const deltaAbs = totalBalance - first;
    const netBurn = this.monthlyBurn - this.mrr;
    // Revenue covering burn means runway is not a meaningful number. Report a
    // sentinel the client renders as ∞ rather than dividing by ~zero.
    const runwayDays = netBurn <= 0 ? Number.MAX_SAFE_INTEGER : Math.round((totalBalance / netBurn) * 30);

    return {
      totalBalance,
      currency: 'USD',
      deltaPct: first === 0 ? 0 : (deltaAbs / Math.abs(first)) * 100,
      deltaAbs,
      mrr: this.mrr,
      monthlyBurn: this.monthlyBurn,
      runwayDays,
      outstandingInvoices: 4,
      outstandingValue: 212_800,
      accounts: this.accounts,
      balanceSeries: [...this.balanceSeries],
      inflowSeries: [...this.inflowSeries],
      outflowSeries: [...this.outflowSeries],
    };
  }

  getTasks(): DailyTasksPayload {
    const now = Date.now();
    const overdue = this.tasks.filter(
      (t) => !t.done && t.dueAt !== null && Date.parse(t.dueAt) < now,
    ).length;
    const doneToday = completedTodayIds();

    return {
      tasks: [...this.tasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.priority.localeCompare(b.priority);
      }),
      completedToday: this.tasks.filter((t) => t.done && doneToday.has(t.id)).length,
      streakDays: streakDays(),
      overdue,
    };
  }

  getProjects(): Project[] {
    return [...this.projects].sort((a, b) => {
      const rank: Record<Project['health'], number> = {
        critical: 0,
        'at-risk': 1,
        'on-track': 2,
        shipped: 3,
      };
      return rank[a.health] - rank[b.health] || b.progress - a.progress;
    });
  }

  getInsights(): Insight[] {
    return this.insights;
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations                                                               */
  /* ---------------------------------------------------------------------- */

  acknowledgeInsight(id: string) {
    const insight = this.insights.find((i) => i.id === id);
    if (insight) insight.acknowledged = true;
    return this.insights;
  }

  commandAgent(id: string, action: 'pause' | 'resume' | 'kill' | 'boost') {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) return this.getFleet();

    switch (action) {
      case 'pause':
        agent.status = 'throttled';
        agent.currentTask = 'throttled by supervisor';
        break;
      case 'resume':
        agent.status = 'executing';
        agent.currentTask = AGENT_TASKS[Math.floor(this.rng() * AGENT_TASKS.length)];
        agent.progress = 0;
        agent.tokensPerMin = Math.round(600 + this.rng() * 2600);
        break;
      case 'kill':
        agent.status = 'offline';
        agent.currentTask = 'terminated by supervisor';
        agent.progress = 0;
        agent.cpuPct = 0;
        agent.memMb = 0;
        agent.tokensPerMin = 0;
        agent.queueDepth = 0;
        break;
      case 'boost':
        agent.status = 'executing';
        agent.cpuPct = clamp(agent.cpuPct * 1.6, 10, 98);
        agent.tokensPerMin = Math.round(agent.tokensPerMin * 1.5 + 800);
        break;
    }

    return this.getFleet();
  }

  addTask(input: { title: string; priority?: TaskPriority; tag?: string; dueAt?: string | null }) {
    const task: DailyTask = {
      id: `task_${Date.now().toString(36)}_${Math.floor(this.rng() * 1e6).toString(36)}`,
      title: input.title.slice(0, 200),
      done: false,
      priority: input.priority ?? 'p2',
      tag: input.tag ?? 'general',
      dueAt: input.dueAt ?? null,
      createdAt: new Date().toISOString(),
      origin: 'operator',
    };
    this.tasks.unshift(task);
    upsertCustomTask(task);
    return this.getTasks();
  }

  updateTask(id: string, patch: Partial<DailyTask>) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      const wasDone = task.done;
      const newDone = typeof patch.done === 'boolean' ? patch.done : wasDone;
      Object.assign(task, patch);
      const doneChanged = newDone !== wasDone;

      // Vault-sourced tasks write the mark back into Active Priorities.md;
      // widget-added tasks persist through the task store.
      if (doneChanged) {
        if (task.id.startsWith('task_priorities_')) {
          setTaskDone(task, newDone);
          invalidateTasksCache();
        } else {
          upsertCustomTask(task);
        }
        if (newDone) recordCompletion(task);
      }
    }
    return this.getTasks();
  }

  /** Returns null when the task is vault-owned — the route maps that to a 409. */
  deleteTask(id: string): DailyTasksPayload | null {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return this.getTasks();
    if (task.id.startsWith('task_priorities_')) return null;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    deleteCustomTask(id);
    return this.getTasks();
  }

  restartService(nameFragment: string): ServiceNode | null {
    const service = this.services.find((s) => s.name.includes(nameFragment) || s.kind === nameFragment);
    if (!service) return null;
    service.state = 'operational';
    service.latencyMs = Math.round(4 + this.rng() * 20);
    service.incidents24h = 0;
    return service;
  }
}

/* ========================================================================== */
/* Singleton                                                                  */
/* ========================================================================== */

/**
 * Cached on globalThis so Next's dev-mode module reloading does not reset the
 * estate on every save (and so all route handlers observe the same instance).
 */
const globalForSam = globalThis as unknown as { __samEstate?: EstateSimulator };

export function getEstate(): EstateSimulator {
  if (!globalForSam.__samEstate) {
    globalForSam.__samEstate = new EstateSimulator();
  }
  const estate = globalForSam.__samEstate;
  estate.advance();
  return estate;
}

export type { EstateSimulator };
