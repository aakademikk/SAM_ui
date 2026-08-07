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
  ServiceState,
  Severity,
  SystemHealthPayload,
  TaskPriority,
  VaultCluster,
  VaultMemoryPayload,
  VaultQuery,
} from '@/types/dashboard';
import { clamp, makeRng } from '@/lib/utils';

const SERIES_LENGTH = 60;
const SERIES_STEP_MS = 4_000;

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

const SERVICE_BLUEPRINTS: { id: string; name: string; kind: string }[] = [
  { id: 'svc_n8n', name: 'n8n-orchestrator', kind: 'n8n' },
  { id: 'svc_docker', name: 'docker-daemon', kind: 'docker' },
  { id: 'svc_pg', name: 'postgres-primary', kind: 'database' },
  { id: 'svc_redis', name: 'redis-cache', kind: 'cache' },
  { id: 'svc_indexer', name: 'vault-indexer', kind: 'worker' },
  { id: 'svc_embed', name: 'chroma-embed', kind: 'vector' },
  { id: 'svc_edge', name: 'nginx-edge', kind: 'proxy' },
  { id: 'svc_backup', name: 'backup-agent', kind: 'worker' },
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

const VAULT_CLUSTER_NAMES = [
  'Client Contracts',
  'System Architecture',
  'Meeting Notes',
  'Financial Records',
  'Agent Playbooks',
  'Research & Teardowns',
  'Incident Reports',
];

const VAULT_QUERY_TEXTS = [
  'atwood core rate limit policy',
  'halberd contract termination clause',
  'q3 burn vs forecast',
  'postgres failover runbook',
  'why did we drop the redis queue',
  'client portal auth decision record',
  'n8n retry semantics',
  'embedding model migration notes',
  'invoice dispute — meridian',
  'incident 2024-11 postmortem',
];

const SEED_TASKS: { title: string; priority: TaskPriority; tag: string; origin: DailyTask['origin'] }[] =
  [
    { title: 'Sign off Ledger Reconciler QA gate', priority: 'p0', tag: 'ship', origin: 'operator' },
    { title: 'Review Halberd portal scope creep', priority: 'p1', tag: 'client', origin: 'sam' },
    { title: 'Rotate expired vault-indexer credentials', priority: 'p0', tag: 'security', origin: 'sam' },
    { title: 'Approve Q3 infra spend increase', priority: 'p1', tag: 'finance', origin: 'operator' },
    { title: 'Write postmortem for webhook outage', priority: 'p2', tag: 'ops', origin: 'agent' },
    { title: 'Cut v3.4.0 release notes', priority: 'p2', tag: 'ship', origin: 'operator' },
    { title: 'Prune 41 orphaned docker volumes', priority: 'p3', tag: 'ops', origin: 'agent' },
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
  readonly bootedAt = Date.now();
  private lastAdvance = Date.now();
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

  completedToday = 3;
  streakDays = 11;

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

    this.services = SERVICE_BLUEPRINTS.map((bp, i) => {
      const state: ServiceState = i === 5 ? 'degraded' : i === 7 ? 'maintenance' : 'operational';
      return {
        ...bp,
        state,
        latencyMs: Math.round(4 + this.rng() * 90),
        uptimePct: 99 + this.rng(),
        incidents24h: state === 'operational' ? 0 : 1 + Math.floor(this.rng() * 3),
      };
    });

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

    this.tasks = SEED_TASKS.map((t, i) => ({
      id: `task_seed_${i}`,
      title: t.title,
      done: i === 5,
      priority: t.priority,
      tag: t.tag,
      dueAt:
        i < 3
          ? new Date(now - (i === 0 ? 7_200_000 : -14_400_000)).toISOString()
          : new Date(now + 86_400_000 * (i - 1)).toISOString(),
      createdAt: new Date(now - 86_400_000 * (i + 1)).toISOString(),
      origin: t.origin,
    }));

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

    this.vaultQueries = VAULT_QUERY_TEXTS.slice(0, 6).map((text, i) => ({
      id: `vq_seed_${i}`,
      text,
      hits: 3 + Math.floor(this.rng() * 24),
      latencyMs: Math.round(28 + this.rng() * 180),
      at: new Date(now - i * 47_000 - Math.floor(this.rng() * 20_000)).toISOString(),
      agent: AGENT_BLUEPRINTS[Math.floor(this.rng() * AGENT_BLUEPRINTS.length)].codename,
    }));

    // Backfill the ring buffers so the first render already has history.
    const totalBalance = this.accounts.reduce((s, a) => s + a.balance, 0);
    for (let i = SERIES_LENGTH; i > 0; i--) {
      const t = now - i * SERIES_STEP_MS;
      const wave = Math.sin(i / 7) * 8 + Math.sin(i / 3.1) * 4;
      this.cpuSeries.push({ t, v: clamp(34 + wave + this.rng() * 6, 2, 99) });
      this.memSeries.push({ t, v: clamp(56 + Math.sin(i / 11) * 6 + this.rng() * 3, 5, 99) });
      this.netSeries.push({ t, v: clamp(80 + Math.sin(i / 5) * 34 + this.rng() * 18, 0, 400) });
      this.indexThroughput.push({ t, v: Math.max(0, 42 + Math.sin(i / 4) * 22 + this.rng() * 14) });
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

    /* --- Host metrics ---------------------------------------------------- */
    const executing = this.agents.filter((a) => a.status === 'executing').length;
    const loadPressure = executing / Math.max(1, this.agents.length);

    this.cpuPct = clamp(
      this.cpuPct + (loadPressure * 70 - this.cpuPct) * 0.08 + (r() - 0.5) * 7,
      3,
      99,
    );
    this.memPct = clamp(this.memPct + (r() - 0.48) * 2.2, 12, 96);
    this.diskPct = clamp(this.diskPct + (r() - 0.495) * 0.08, 20, 99);
    this.netMbps = clamp(this.netMbps + (r() - 0.5) * 26, 2, 480);

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

    /* --- Services -------------------------------------------------------- */
    for (const service of this.services) {
      service.latencyMs = Math.max(1, Math.round(service.latencyMs + (r() - 0.5) * 14));
      if (service.state === 'operational' && r() < 0.004) {
        service.state = 'degraded';
        service.incidents24h++;
      } else if (service.state === 'degraded' && r() < 0.05) {
        service.state = 'operational';
      }
    }

    /* --- Vault ----------------------------------------------------------- */
    const ingested = Math.min(this.pendingIndex, Math.round(dt * (0.6 + r() * 1.4)));
    this.pendingIndex -= ingested;
    this.indexedNotes += ingested;
    this.embeddings += ingested * 26;
    if (r() < 0.14) {
      const added = 1 + Math.floor(r() * 5);
      this.totalNotes += added;
      this.pendingIndex += added;
      this.vaultSizeMb += added * 0.12;
      this.lastVaultSync = now;
    }
    this.cacheHitRate = clamp(this.cacheHitRate + (r() - 0.5) * 0.01, 0.55, 0.99);
    this.push(this.indexThroughput, { t: now, v: Math.max(0, ingested * 20 + r() * 12) });

    if (r() < 0.1) {
      this.recordVaultQuery(VAULT_QUERY_TEXTS[Math.floor(r() * VAULT_QUERY_TEXTS.length)]);
    }

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
    const clusters: VaultCluster[] = VAULT_CLUSTER_NAMES.map((name, i) => {
      const notes = Math.round((this.totalNotes / VAULT_CLUSTER_NAMES.length) * (0.5 + ((i * 37) % 90) / 60));
      return {
        name,
        notes,
        weight: 0,
        driftPct: Math.round(((i * 13) % 22) - 8 + this.rng() * 4),
      };
    });
    const totalClusterNotes = clusters.reduce((s, c) => s + c.notes, 0) || 1;
    for (const cluster of clusters) cluster.weight = cluster.notes / totalClusterNotes;

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
      loadAvg: [
        Number((this.cpuPct / 22).toFixed(2)),
        Number((this.cpuPct / 26).toFixed(2)),
        Number((this.cpuPct / 31).toFixed(2)),
      ],
      uptimeSec: Math.floor((Date.now() - this.bootedAt) / 1000) + 1_284_400,
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

    return {
      tasks: [...this.tasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.priority.localeCompare(b.priority);
      }),
      completedToday: this.completedToday,
      streakDays: this.streakDays,
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
    return this.getTasks();
  }

  updateTask(id: string, patch: Partial<DailyTask>) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      const wasDone = task.done;
      Object.assign(task, patch);
      if (!wasDone && task.done) this.completedToday++;
      if (wasDone && !task.done) this.completedToday = Math.max(0, this.completedToday - 1);
    }
    return this.getTasks();
  }

  deleteTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
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
