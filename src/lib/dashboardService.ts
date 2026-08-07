/**
 * SAM — Dashboard API client.
 *
 * Single choke point for every network call the dashboard makes. Responsible
 * for: timeouts, bounded retry with backoff, abort propagation, and runtime
 * validation. Nothing downstream of this file trusts the wire format — the
 * `parse*` functions coerce every field so a malformed payload degrades into
 * a sane default instead of a white screen.
 */

import type {
  AgentFleetPayload,
  AgentStatus,
  ApiEnvelope,
  ApiMeta,
  ChatMessage,
  CommandResult,
  DailyTask,
  DailyTasksPayload,
  DashboardBootstrap,
  FinanceAccount,
  FinancePayload,
  FleetAgent,
  Insight,
  InsightDomain,
  Project,
  ProjectHealth,
  ProjectPhase,
  ServiceNode,
  ServiceState,
  Severity,
  SystemHealthPayload,
  TaskPriority,
  TerminalStreamKind,
  VaultCluster,
  VaultMemoryPayload,
  VaultQuery,
  WidgetLayoutItem,
} from '@/types/dashboard';
import type { SamContext, SarcasmLevel } from '@/lib/personalityEngine';
import {
  asArray,
  asBool,
  asEnum,
  asNumber,
  asRecord,
  asSeries,
  asString,
  clamp,
  sleep,
} from '@/lib/utils';

/* ========================================================================== */
/* Transport                                                                  */
/* ========================================================================== */

export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, endpoint: string, retryable: boolean) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.retryable = retryable;
  }
}

const BASE = '/api';
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Links an external abort signal to an internal timeout signal. `AbortSignal.any`
 * is not universally available in the browsers we target, so this is manual.
 */
function withTimeout(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);

  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const {
    method = 'GET',
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = MAX_ATTEMPTS,
    query,
  } = options;

  const url = buildUrl(path, query);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { signal: composed, dispose } = withTimeout(timeoutMs, signal);
    try {
      const response = await fetch(url, {
        method,
        signal: composed,
        cache: 'no-store',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        const detail = await response.text().catch(() => '');
        throw new ApiError(
          detail.slice(0, 240) || `${method} ${path} failed with ${response.status}`,
          response.status,
          path,
          retryable,
        );
      }

      const json: unknown = await response.json();
      const record = asRecord(json);
      return {
        data: record.data as T,
        meta: parseMeta(record.meta),
      };
    } catch (error) {
      lastError = error;

      // A caller-initiated abort is intentional; never retry or swallow it.
      if (signal?.aborted) throw error;

      const isLastAttempt = attempt === attempts;
      const retryable =
        error instanceof ApiError
          ? error.retryable
          : error instanceof DOMException
            ? error.name === 'TimeoutError'
            : true;

      if (isLastAttempt || !retryable) break;
      await sleep(220 * 2 ** (attempt - 1) + Math.random() * 120);
    } finally {
      dispose();
    }
  }

  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(
    lastError instanceof Error ? lastError.message : 'Network failure',
    0,
    path,
    true,
  );
}

function parseMeta(raw: unknown): ApiMeta {
  const r = asRecord(raw);
  return {
    generatedAt: asString(r.generatedAt, new Date(0).toISOString()),
    latencyMs: asNumber(r.latencyMs),
    source: asString(r.source, 'unknown'),
    tick: asNumber(r.tick),
  };
}

/* ========================================================================== */
/* Parsers                                                                    */
/* ========================================================================== */

const SEVERITIES = ['critical', 'warning', 'info', 'success'] as const satisfies readonly Severity[];
const DOMAINS = [
  'system',
  'business',
  'security',
  'agents',
  'finance',
  'vault',
] as const satisfies readonly InsightDomain[];
const AGENT_STATUSES = [
  'executing',
  'idle',
  'blocked',
  'spawning',
  'offline',
  'throttled',
] as const satisfies readonly AgentStatus[];
const PHASES = [
  'discovery',
  'build',
  'qa',
  'staging',
  'production',
  'blocked',
] as const satisfies readonly ProjectPhase[];
const HEALTHS = ['on-track', 'at-risk', 'critical', 'shipped'] as const satisfies readonly ProjectHealth[];
const SERVICE_STATES = [
  'operational',
  'degraded',
  'down',
  'maintenance',
] as const satisfies readonly ServiceState[];
const PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const satisfies readonly TaskPriority[];
const STREAMS = [
  'stdin',
  'stdout',
  'stderr',
  'system',
  'sam',
] as const satisfies readonly TerminalStreamKind[];

export function parseInsight(raw: unknown): Insight {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'insight_unknown'),
    severity: asEnum(r.severity, SEVERITIES, 'info'),
    domain: asEnum(r.domain, DOMAINS, 'system'),
    headline: asString(r.headline, 'Untitled observation'),
    body: asString(r.body),
    source: asString(r.source, 'unattributed'),
    evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
    confidence: clamp(asNumber(r.confidence, 0.5), 0, 1),
    createdAt: asString(r.createdAt, new Date(0).toISOString()),
    acknowledged: asBool(r.acknowledged),
    suggestedAction: typeof r.suggestedAction === 'string' ? r.suggestedAction : undefined,
  };
}

export function parseAgent(raw: unknown): FleetAgent {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'agent_unknown'),
    codename: asString(r.codename, 'UNNAMED'),
    role: asString(r.role, 'worker'),
    swarm: asString(r.swarm, 'unassigned'),
    status: asEnum(r.status, AGENT_STATUSES, 'offline'),
    currentTask: asString(r.currentTask, 'idle'),
    progress: clamp(asNumber(r.progress), 0, 1),
    cpuPct: clamp(asNumber(r.cpuPct), 0, 100),
    memMb: asNumber(r.memMb),
    memCapMb: Math.max(1, asNumber(r.memCapMb, 1024)),
    tokensPerMin: asNumber(r.tokensPerMin),
    queueDepth: asNumber(r.queueDepth),
    uptimeSec: asNumber(r.uptimeSec),
    tasksCompleted: asNumber(r.tasksCompleted),
    errorCount: asNumber(r.errorCount),
    lastHeartbeat: asString(r.lastHeartbeat, new Date(0).toISOString()),
  };
}

export function parseFleet(raw: unknown): AgentFleetPayload {
  const r = asRecord(raw);
  return {
    agents: asArray(r.agents, parseAgent),
    swarms: asArray(r.swarms, (s) => {
      const sr = asRecord(s);
      return {
        name: asString(sr.name, 'swarm'),
        active: asNumber(sr.active),
        total: asNumber(sr.total),
      };
    }),
    totalTokensPerMin: asNumber(r.totalTokensPerMin),
    aggregateCpuPct: clamp(asNumber(r.aggregateCpuPct), 0, 100),
    supervisorVerdict: asString(r.supervisorVerdict),
  };
}

export function parseVaultCluster(raw: unknown): VaultCluster {
  const r = asRecord(raw);
  return {
    name: asString(r.name, 'uncategorised'),
    notes: asNumber(r.notes),
    weight: clamp(asNumber(r.weight), 0, 1),
    driftPct: asNumber(r.driftPct),
  };
}

export function parseVaultQuery(raw: unknown): VaultQuery {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'q_unknown'),
    text: asString(r.text),
    hits: asNumber(r.hits),
    latencyMs: asNumber(r.latencyMs),
    at: asString(r.at, new Date(0).toISOString()),
    agent: asString(r.agent, 'sam'),
  };
}

export function parseVault(raw: unknown): VaultMemoryPayload {
  const r = asRecord(raw);
  return {
    totalNotes: asNumber(r.totalNotes),
    indexedNotes: asNumber(r.indexedNotes),
    embeddings: asNumber(r.embeddings),
    pendingIndex: asNumber(r.pendingIndex),
    vaultSizeMb: asNumber(r.vaultSizeMb),
    lastSync: asString(r.lastSync, new Date(0).toISOString()),
    ingestPerMin: asNumber(r.ingestPerMin),
    retrievalP95Ms: asNumber(r.retrievalP95Ms),
    cacheHitRate: clamp(asNumber(r.cacheHitRate), 0, 1),
    clusters: asArray(r.clusters, parseVaultCluster),
    recentQueries: asArray(r.recentQueries, parseVaultQuery),
    indexThroughput: asSeries(r.indexThroughput),
  };
}

export function parseProject(raw: unknown): Project {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'proj_unknown'),
    name: asString(r.name, 'Untitled'),
    client: asString(r.client, 'Internal'),
    phase: asEnum(r.phase, PHASES, 'build'),
    health: asEnum(r.health, HEALTHS, 'on-track'),
    progress: clamp(asNumber(r.progress), 0, 1),
    deployTarget: asString(r.deployTarget, 'n/a'),
    openIssues: asNumber(r.openIssues),
    blockers: asNumber(r.blockers),
    lastDeploy: asString(r.lastDeploy, new Date(0).toISOString()),
    etaDays: asNumber(r.etaDays),
    budgetUsedPct: clamp(asNumber(r.budgetUsedPct), 0, 200),
    owner: asString(r.owner, 'unassigned'),
  };
}

export function parseService(raw: unknown): ServiceNode {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'svc_unknown'),
    name: asString(r.name, 'service'),
    state: asEnum(r.state, SERVICE_STATES, 'operational'),
    latencyMs: asNumber(r.latencyMs),
    uptimePct: clamp(asNumber(r.uptimePct, 100), 0, 100),
    kind: asString(r.kind, 'service'),
    incidents24h: asNumber(r.incidents24h),
  };
}

export function parseSystem(raw: unknown): SystemHealthPayload {
  const r = asRecord(raw);
  const load = Array.isArray(r.loadAvg) ? r.loadAvg : [];
  return {
    overallScore: clamp(asNumber(r.overallScore, 100), 0, 100),
    cpuPct: clamp(asNumber(r.cpuPct), 0, 100),
    memPct: clamp(asNumber(r.memPct), 0, 100),
    diskPct: clamp(asNumber(r.diskPct), 0, 100),
    netMbps: asNumber(r.netMbps),
    loadAvg: [asNumber(load[0]), asNumber(load[1]), asNumber(load[2])],
    uptimeSec: asNumber(r.uptimeSec),
    services: asArray(r.services, parseService),
    cpuSeries: asSeries(r.cpuSeries),
    memSeries: asSeries(r.memSeries),
    netSeries: asSeries(r.netSeries),
    automationRuns24h: asNumber(r.automationRuns24h),
    automationFailures24h: asNumber(r.automationFailures24h),
  };
}

export function parseAccount(raw: unknown): FinanceAccount {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'acct_unknown'),
    label: asString(r.label, 'Account'),
    institution: asString(r.institution, '—'),
    balance: asNumber(r.balance),
    currency: asString(r.currency, 'USD'),
    deltaPct: asNumber(r.deltaPct),
    kind: asEnum(r.kind, ['operating', 'reserve', 'tax', 'credit', 'escrow'] as const, 'operating'),
  };
}

export function parseFinance(raw: unknown): FinancePayload {
  const r = asRecord(raw);
  return {
    totalBalance: asNumber(r.totalBalance),
    currency: asString(r.currency, 'USD'),
    deltaPct: asNumber(r.deltaPct),
    deltaAbs: asNumber(r.deltaAbs),
    mrr: asNumber(r.mrr),
    monthlyBurn: asNumber(r.monthlyBurn),
    runwayDays: asNumber(r.runwayDays),
    outstandingInvoices: asNumber(r.outstandingInvoices),
    outstandingValue: asNumber(r.outstandingValue),
    accounts: asArray(r.accounts, parseAccount),
    balanceSeries: asSeries(r.balanceSeries),
    inflowSeries: asSeries(r.inflowSeries),
    outflowSeries: asSeries(r.outflowSeries),
  };
}

export function parseTask(raw: unknown): DailyTask {
  const r = asRecord(raw);
  return {
    id: asString(r.id, 'task_unknown'),
    title: asString(r.title, 'Untitled task'),
    done: asBool(r.done),
    priority: asEnum(r.priority, PRIORITIES, 'p2'),
    tag: asString(r.tag, 'general'),
    dueAt: typeof r.dueAt === 'string' ? r.dueAt : null,
    createdAt: asString(r.createdAt, new Date(0).toISOString()),
    origin: asEnum(r.origin, ['operator', 'sam', 'agent'] as const, 'operator'),
  };
}

export function parseTasks(raw: unknown): DailyTasksPayload {
  const r = asRecord(raw);
  return {
    tasks: asArray(r.tasks, parseTask),
    completedToday: asNumber(r.completedToday),
    streakDays: asNumber(r.streakDays),
    overdue: asNumber(r.overdue),
  };
}

export function parseCommandResult(raw: unknown): CommandResult {
  const r = asRecord(raw);
  return {
    ok: asBool(r.ok),
    exitCode: asNumber(r.exitCode, 1),
    durationMs: asNumber(r.durationMs),
    lines: asArray(r.lines, (l) => {
      const lr = asRecord(l);
      return {
        kind: asEnum(lr.kind, STREAMS, 'stdout'),
        text: asString(lr.text),
      };
    }),
    remark: typeof r.remark === 'string' ? r.remark : undefined,
  };
}

/* ========================================================================== */
/* Endpoints                                                                  */
/* ========================================================================== */

export interface FetchOpts {
  signal?: AbortSignal;
}

export interface ChatOptions extends FetchOpts {
  /** Live estate snapshot so SAM answers with real numbers, not vibes. */
  context?: SamContext;
  sarcasm?: SarcasmLevel;
}

export const dashboardService = {
  async getInsights(opts: FetchOpts = {}): Promise<Insight[]> {
    const res = await request<unknown>('/dashboard/insights', { signal: opts.signal });
    return asArray(res.data, parseInsight);
  },

  async acknowledgeInsight(id: string, opts: FetchOpts = {}): Promise<Insight[]> {
    const res = await request<unknown>('/dashboard/insights', {
      method: 'PATCH',
      body: { id, acknowledged: true },
      signal: opts.signal,
      attempts: 1,
    });
    return asArray(res.data, parseInsight);
  },

  async getFleet(opts: FetchOpts = {}): Promise<AgentFleetPayload> {
    const res = await request<unknown>('/dashboard/agents', { signal: opts.signal });
    return parseFleet(res.data);
  },

  async commandAgent(
    id: string,
    action: 'pause' | 'resume' | 'kill' | 'boost',
    opts: FetchOpts = {},
  ): Promise<AgentFleetPayload> {
    const res = await request<unknown>('/dashboard/agents', {
      method: 'POST',
      body: { id, action },
      signal: opts.signal,
      attempts: 1,
    });
    return parseFleet(res.data);
  },

  async getVault(opts: FetchOpts = {}): Promise<VaultMemoryPayload> {
    const res = await request<unknown>('/dashboard/vault', { signal: opts.signal });
    return parseVault(res.data);
  },

  async queryVault(query: string, opts: FetchOpts = {}): Promise<VaultMemoryPayload> {
    const res = await request<unknown>('/dashboard/vault', {
      method: 'POST',
      body: { query },
      signal: opts.signal,
      attempts: 1,
    });
    return parseVault(res.data);
  },

  async getProjects(opts: FetchOpts = {}): Promise<Project[]> {
    const res = await request<unknown>('/dashboard/projects', { signal: opts.signal });
    return asArray(res.data, parseProject);
  },

  async getSystemHealth(opts: FetchOpts = {}): Promise<SystemHealthPayload> {
    const res = await request<unknown>('/dashboard/system', { signal: opts.signal });
    return parseSystem(res.data);
  },

  async getFinance(range: '7d' | '30d' | '90d' = '30d', opts: FetchOpts = {}): Promise<FinancePayload> {
    const res = await request<unknown>('/dashboard/finance', { query: { range }, signal: opts.signal });
    return parseFinance(res.data);
  },

  async getTasks(opts: FetchOpts = {}): Promise<DailyTasksPayload> {
    const res = await request<unknown>('/dashboard/tasks', { signal: opts.signal });
    return parseTasks(res.data);
  },

  async createTask(
    input: { title: string; priority?: TaskPriority; tag?: string; dueAt?: string | null },
    opts: FetchOpts = {},
  ): Promise<DailyTasksPayload> {
    const res = await request<unknown>('/dashboard/tasks', {
      method: 'POST',
      body: input,
      signal: opts.signal,
      attempts: 1,
    });
    return parseTasks(res.data);
  },

  async updateTask(
    id: string,
    patch: Partial<Pick<DailyTask, 'done' | 'title' | 'priority' | 'tag' | 'dueAt'>>,
    opts: FetchOpts = {},
  ): Promise<DailyTasksPayload> {
    const res = await request<unknown>('/dashboard/tasks', {
      method: 'PATCH',
      body: { id, ...patch },
      signal: opts.signal,
      attempts: 1,
    });
    return parseTasks(res.data);
  },

  async deleteTask(id: string, opts: FetchOpts = {}): Promise<DailyTasksPayload> {
    const res = await request<unknown>('/dashboard/tasks', {
      method: 'DELETE',
      body: { id },
      signal: opts.signal,
      attempts: 1,
    });
    return parseTasks(res.data);
  },

  async execCommand(command: string, opts: FetchOpts = {}): Promise<CommandResult> {
    const res = await request<unknown>('/terminal', {
      method: 'POST',
      body: { command },
      signal: opts.signal,
      attempts: 1,
      timeoutMs: 30_000,
    });
    return parseCommandResult(res.data);
  },

  async chat(
    messages: Pick<ChatMessage, 'role' | 'content'>[],
    opts: ChatOptions = {},
  ): Promise<{ content: string; severity: Severity }> {
    const res = await request<unknown>('/chat', {
      method: 'POST',
      body: { messages, context: opts.context, sarcasm: opts.sarcasm },
      signal: opts.signal,
      attempts: 1,
      timeoutMs: 45_000,
    });
    const r = asRecord(res.data);
    return {
      content: asString(r.content),
      severity: asEnum(r.severity, SEVERITIES, 'info'),
    };
  },

  /**
   * Streaming chat. Yields text deltas as they arrive so the panel can render
   * SAM mid-sentence. Falls back to `chat()` if the response is not chunked.
   */
  async *streamChat(
    messages: Pick<ChatMessage, 'role' | 'content'>[],
    opts: ChatOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const { signal, dispose } = withTimeout(60_000, opts.signal);
    try {
      const response = await fetch(`${BASE}/chat`, {
        method: 'POST',
        signal,
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'text/plain' },
        body: JSON.stringify({
          messages,
          stream: true,
          context: opts.context,
          sarcasm: opts.sarcasm,
        }),
      });

      if (!response.ok) {
        throw new ApiError(
          `Chat failed with ${response.status}`,
          response.status,
          '/chat',
          response.status >= 500,
        );
      }

      if (!response.body) {
        const fallback = await dashboardService.chat(messages, opts);
        yield fallback.content;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) yield chunk;
        }
        const tail = decoder.decode();
        if (tail) yield tail;
      } finally {
        reader.releaseLock();
      }
    } finally {
      dispose();
    }
  },

  /**
   * Persists widget layout. Called from the debounced sync in
   * `userPreferencesStore` — never invoke this directly from a drag handler.
   */
  async patchLayout(layout: WidgetLayoutItem[], opts: FetchOpts = {}): Promise<{ savedAt: string }> {
    const res = await request<unknown>('/dashboard/layout', {
      method: 'PATCH',
      body: { layout },
      signal: opts.signal,
      attempts: 2,
      timeoutMs: 8_000,
    });
    const r = asRecord(res.data);
    return { savedAt: asString(r.savedAt, new Date().toISOString()) };
  },

  /** Parallel cold-start fetch. Individual failures reject the whole batch. */
  async bootstrap(opts: FetchOpts = {}): Promise<DashboardBootstrap> {
    const [insights, fleet, vault, projects, system, finance, tasks] = await Promise.all([
      dashboardService.getInsights(opts),
      dashboardService.getFleet(opts),
      dashboardService.getVault(opts),
      dashboardService.getProjects(opts),
      dashboardService.getSystemHealth(opts),
      dashboardService.getFinance('30d', opts),
      dashboardService.getTasks(opts),
    ]);
    return { insights, fleet, vault, projects, system, finance, tasks };
  },
};

export type DashboardService = typeof dashboardService;
