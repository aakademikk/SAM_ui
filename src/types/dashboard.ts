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

export type WidgetKind =
  | 'ai-insights'
  | 'agent-fleet'
  | 'vault-memory'
  | 'command-terminal'
  | 'active-projects'
  | 'system-health'
  | 'finance-balance'
  | 'daily-tasks';

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

export type AmbientTheme = 'void' | 'plasma' | 'toxic' | 'ember' | 'ghost';

export const AMBIENT_THEMES: { id: AmbientTheme; label: string; swatch: [string, string] }[] = [
  { id: 'void', label: 'Void', swatch: ['#a855f7', '#22d3ee'] },
  { id: 'plasma', label: 'Plasma', swatch: ['#c026d3', '#f472b6'] },
  { id: 'toxic', label: 'Toxic', swatch: ['#22d3ee', '#4ade80'] },
  { id: 'ember', label: 'Ember', swatch: ['#fb923c', '#f43f5e'] },
  { id: 'ghost', label: 'Ghost', swatch: ['#94a3b8', '#67e8f9'] },
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

/* ========================================================================== */
/* AI Insights                                                                */
/* ========================================================================== */

export type InsightDomain = 'system' | 'business' | 'security' | 'agents' | 'finance' | 'vault';

export interface Insight {
  id: string;
  severity: Severity;
  domain: InsightDomain;
  /** Terse headline. Rendered verbatim. */
  headline: string;
  /** Raw analytical body. `personalityEngine` applies SAM's tone on render. */
  body: string;
  /** Where SAM got this from — an agent codename, a service, a vault note. */
  source: string;
  /** Optional supporting number, e.g. "+38%" or "412ms p99". */
  evidence?: string;
  confidence: number;
  createdAt: string;
  acknowledged: boolean;
  /** Actionable follow-up SAM is willing to execute on request. */
  suggestedAction?: string;
}

/* ========================================================================== */
/* Agent Fleet                                                                */
/* ========================================================================== */

export type AgentStatus = 'executing' | 'idle' | 'blocked' | 'spawning' | 'offline' | 'throttled';

export interface FleetAgent {
  id: string;
  codename: string;
  role: string;
  swarm: string;
  status: AgentStatus;
  currentTask: string;
  /** 0–1 completion of `currentTask`. */
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

/* ========================================================================== */
/* Vault Memory                                                               */
/* ========================================================================== */

export interface VaultCluster {
  name: string;
  notes: number;
  /** 0–1 share of total embedding volume. */
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

/* ========================================================================== */
/* Command Terminal                                                           */
/* ========================================================================== */

export type TerminalStreamKind = 'stdin' | 'stdout' | 'stderr' | 'system' | 'sam';

export interface TerminalLine {
  id: string;
  kind: TerminalStreamKind;
  text: string;
  at: number;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  lines: { kind: TerminalStreamKind; text: string }[];
  /** SAM's unsolicited editorial on what you just ran. */
  remark?: string;
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
/* Finance                                                                    */
/* ========================================================================== */

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

/* ========================================================================== */
/* Chat                                                                       */
/* ========================================================================== */

export type ChatRole = 'user' | 'sam' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: number;
  /** True while tokens are still streaming into `content`. */
  streaming?: boolean;
  /** Structured side effects SAM performed for this turn. */
  actions?: { label: string; status: 'ok' | 'failed' | 'pending' }[];
  severity?: Severity;
}

/** SAM's outward affect — drives the mechanical eye. */
export type SamMood = 'idle' | 'thinking' | 'speaking' | 'alert' | 'annoyed' | 'pleased';

/* ========================================================================== */
/* Bootstrap                                                                  */
/* ========================================================================== */

export interface DashboardBootstrap {
  insights: Insight[];
  fleet: AgentFleetPayload;
  vault: VaultMemoryPayload;
  projects: Project[];
  system: SystemHealthPayload;
  finance: FinancePayload;
  tasks: DailyTasksPayload;
}
