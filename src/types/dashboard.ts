/**
 * SAM — Core Dashboard domain model.
 *
 * Every widget in the dashboard consumes one of the payloads declared here.
 * The API route handlers emit exactly these shapes; `dashboardService.ts`
 * re-validates them at the boundary before they reach the store.
 */

/* ========================================================================== */
/* Layout primitives                                                          */
/* ========================================================================== */

/** Grid footprint of a widget. The grid is 4 columns wide on desktop. */
export type WidgetSize = 'sm' | 'md-wide' | 'md-tall' | 'lg';

export type WidgetKind = 'active-projects' | 'system-health' | 'daily-tasks' | 'money-in';

export interface WidgetLayoutItem {
  id: WidgetKind;
  size: WidgetSize;
  visible: boolean;
}

export interface WidgetSpan {
  cols: 1 | 2;
  rows: 1 | 2;
}

export const WIDGET_SPANS: Record<WidgetSize, WidgetSpan> = {
  sm: { cols: 1, rows: 1 },
  'md-wide': { cols: 2, rows: 1 },
  'md-tall': { cols: 1, rows: 2 },
  lg: { cols: 2, rows: 2 },
};

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = {
  sm: 'Small · 1×1',
  'md-wide': 'Wide · 2×1',
  'md-tall': 'Tall · 1×2',
  lg: 'Large · 2×2',
};

export type AmbientTheme = 'void' | 'plasma' | 'toxic' | 'ember' | 'ghost' | 'emerald';

export const AMBIENT_THEMES: { id: AmbientTheme; label: string; swatch: [string, string] }[] = [
  { id: 'void', label: 'Void', swatch: ['#a855f7', '#22d3ee'] },
  { id: 'plasma', label: 'Plasma', swatch: ['#c026d3', '#f472b6'] },
  { id: 'toxic', label: 'Toxic', swatch: ['#22d3ee', '#4ade80'] },
  { id: 'ember', label: 'Ember', swatch: ['#fb923c', '#f43f5e'] },
  { id: 'ghost', label: 'Ghost', swatch: ['#94a3b8', '#67e8f9'] },
  { id: 'emerald', label: 'Emerald', swatch: ['#3dff5a', '#9dff70'] },
];

/* ========================================================================== */
/* Shared vocabulary                                                          */
/* ========================================================================== */

export type Severity = 'critical' | 'warning' | 'info' | 'success';
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type TrendDirection = 'up' | 'down' | 'flat';

export interface SeriesPoint {
  /** Epoch milliseconds. */
  t: number;
  v: number;
}

export interface ApiMeta {
  generatedAt: string;
  latencyMs: number;
  source: string;
  /** Server-side sequence number; lets the client detect dropped polls. */
  tick: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

/**
 * `Insight`/`SamMood` stay defined here (rather than being deleted with the
 * widgets that used to render them) because `lib/personalityEngine.ts` still
 * imports both — `frameInsight`/`moodFor` are dead code post-prune but not
 * worth unpicking from the tone engine for this pass.
 */
export type InsightDomain = 'system' | 'business' | 'security' | 'agents' | 'finance' | 'vault';

export interface Insight {
  id: string;
  severity: Severity;
  domain: InsightDomain;
  headline: string;
  body: string;
  source: string;
  evidence?: string;
  confidence: number;
  createdAt: string;
  acknowledged: boolean;
  suggestedAction?: string;
}

/**
 * Agent Fleet / Vault Memory / Finance — the widgets that rendered these were
 * removed (fully mocked, never real). `lib/server/telemetry.ts`'s estate
 * simulator still generates this data internally for its own tick logic, but
 * nothing routes it to the client anymore (the API routes were deleted) — so
 * these types are backend-internal only now, not part of the wire contract.
 */
export type AgentStatus = 'executing' | 'idle' | 'blocked' | 'spawning' | 'offline' | 'throttled';

export interface FleetAgent {
  id: string;
  codename: string;
  role: string;
  swarm: string;
  status: AgentStatus;
  currentTask: string;
  progress: number;
  cpuPct: number;
  memMb: number;
  memCapMb: number;
  tokensPerMin: number;
  queueDepth: number;
  uptimeSec: number;
  tasksCompleted: number;
  errorCount: number;
  lastHeartbeat: string;
}

export interface AgentFleetPayload {
  agents: FleetAgent[];
  swarms: { name: string; active: number; total: number }[];
  totalTokensPerMin: number;
  aggregateCpuPct: number;
  supervisorVerdict: string;
}

export interface VaultCluster {
  name: string;
  notes: number;
  weight: number;
  driftPct: number;
}

export interface VaultQuery {
  id: string;
  text: string;
  hits: number;
  latencyMs: number;
  at: string;
  agent: string;
}

export interface VaultMemoryPayload {
  totalNotes: number;
  indexedNotes: number;
  embeddings: number;
  pendingIndex: number;
  vaultSizeMb: number;
  lastSync: string;
  ingestPerMin: number;
  retrievalP95Ms: number;
  cacheHitRate: number;
  clusters: VaultCluster[];
  recentQueries: VaultQuery[];
  indexThroughput: SeriesPoint[];
}

export interface FinanceAccount {
  id: string;
  label: string;
  institution: string;
  balance: number;
  currency: string;
  deltaPct: number;
  kind: 'operating' | 'reserve' | 'tax' | 'credit' | 'escrow';
}

export interface FinancePayload {
  totalBalance: number;
  currency: string;
  deltaPct: number;
  deltaAbs: number;
  mrr: number;
  monthlyBurn: number;
  runwayDays: number;
  outstandingInvoices: number;
  outstandingValue: number;
  accounts: FinanceAccount[];
  balanceSeries: SeriesPoint[];
  inflowSeries: SeriesPoint[];
  outflowSeries: SeriesPoint[];
}

/* ========================================================================== */
/* Money In                                                                    */
/* ========================================================================== */

/**
 * A single manually-logged income entry. The Money In widget is backed by
 * this real store (`lib/server/moneyState.ts` → `~/.sam/money-state.json`),
 * never fabricated — amounts are what actually landed.
 */
export interface MoneyEntry {
  id: string;
  label: string;
  /** Whole pounds; the widget's quick-add form has no pence input (v1). */
  amount: number;
  /** Local calendar day the money arrived, as YYYY-MM-DD. */
  date: string;
  /** Optional attribution, e.g. "Atwood — 4edge deposit", "day job". */
  source: string;
  /**
   * True for monthly recurring income (retainer, salary standing order).
   * Counts toward every month's total from `date`'s month onward — `date`
   * is the first payment month, not a one-off landing day.
   */
  recurring: boolean;
  createdAt: string;
}

export interface MoneyInPayload {
  currency: string;
  /** All-time money in, newest first. */
  entries: MoneyEntry[];
  totalThisMonth: number;
  countThisMonth: number;
  /** Previous calendar month, for the month-over-month read. */
  totalLastMonth: number;
  /** -1 if there is no previous month to compare against. */
  monthDeltaPct: number;
}

/* ========================================================================== */
/* Active Projects                                                            */
/* ========================================================================== */

export type ProjectPhase = 'discovery' | 'build' | 'qa' | 'staging' | 'production' | 'blocked';
export type ProjectHealth = 'on-track' | 'at-risk' | 'critical' | 'shipped';

export interface Project {
  id: string;
  name: string;
  client: string;
  phase: ProjectPhase;
  health: ProjectHealth;
  progress: number;
  deployTarget: string;
  openIssues: number;
  blockers: number;
  lastDeploy: string;
  etaDays: number;
  budgetUsedPct: number;
  owner: string;
}

/* ========================================================================== */
/* System Health                                                              */
/* ========================================================================== */

export type ServiceState = 'operational' | 'degraded' | 'down' | 'maintenance';

export interface ServiceNode {
  id: string;
  name: string;
  state: ServiceState;
  latencyMs: number;
  uptimePct: number;
  /** e.g. "n8n", "docker", "postgres". */
  kind: string;
  incidents24h: number;
}

export interface SystemHealthPayload {
  overallScore: number;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  netMbps: number;
  loadAvg: [number, number, number];
  uptimeSec: number;
  services: ServiceNode[];
  cpuSeries: SeriesPoint[];
  memSeries: SeriesPoint[];
  netSeries: SeriesPoint[];
  automationRuns24h: number;
  automationFailures24h: number;
}

/* ========================================================================== */
/* Daily Tasks                                                                */
/* ========================================================================== */

export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface DailyTask {
  id: string;
  title: string;
  done: boolean;
  priority: TaskPriority;
  tag: string;
  dueAt: string | null;
  createdAt: string;
  /** Set when SAM queued the task himself rather than the operator. */
  origin: 'operator' | 'sam' | 'agent';
}

export interface DailyTasksPayload {
  tasks: DailyTask[];
  completedToday: number;
  streakDays: number;
  overdue: number;
}

/** SAM's outward affect — kept for `personalityEngine.ts`'s `moodFor`. */
export type SamMood = 'idle' | 'thinking' | 'speaking' | 'alert' | 'annoyed' | 'pleased';

/* ========================================================================== */
/* Bootstrap                                                                  */
/* ========================================================================== */

export interface DashboardBootstrap {
  projects: Project[];
  system: SystemHealthPayload;
  tasks: DailyTasksPayload;
}
