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
  ApiEnvelope,
  ApiMeta,
  DailyTask,
  DailyTasksPayload,
  DashboardBootstrap,
  Project,
  ProjectHealth,
  ProjectPhase,
  ServiceNode,
  ServiceState,
  SystemHealthPayload,
  TaskPriority,
  WidgetLayoutItem,
} from '@/types/dashboard';
import { asArray, asBool, asEnum, asNumber, asRecord, asSeries, asString, clamp, sleep } from '@/lib/utils';

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

/* ========================================================================== */
/* Endpoints                                                                  */
/* ========================================================================== */

export interface FetchOpts {
  signal?: AbortSignal;
}

export const dashboardService = {
  async getProjects(opts: FetchOpts = {}): Promise<Project[]> {
    const res = await request<unknown>('/dashboard/projects', { signal: opts.signal });
    return asArray(res.data, parseProject);
  },

  async getSystemHealth(opts: FetchOpts = {}): Promise<SystemHealthPayload> {
    const res = await request<unknown>('/dashboard/system', { signal: opts.signal });
    return parseSystem(res.data);
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
    const [projects, system, tasks] = await Promise.all([
      dashboardService.getProjects(opts),
      dashboardService.getSystemHealth(opts),
      dashboardService.getTasks(opts),
    ]);
    return { projects, system, tasks };
  },
};

export type DashboardService = typeof dashboardService;
