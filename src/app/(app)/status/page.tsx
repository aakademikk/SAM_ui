/**
 * /status — the Atwood Ops box-health glance, folded into the SAM_ui shell.
 *
 * Renders the same read-only state ops-status.service already collects
 * (outreach pool, canary, nightly backup, lead-finder freshness, TRW batches,
 * systemd services + timers) natively in the SAM_ui theme. Data comes through
 * the /api/status proxy so the collector stays the single source of truth.
 *
 * Colour is never the only signal — every status row pairs a dot with a word,
 * exactly as the standalone page does.
 */

'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  RelativeTime,
  StatusDot,
  Stat,
  TONE_COLOR,
  type ToneName,
} from '@/components/ui/Indicators';

/* ---------------------------------------------------------------------------
 * Ops payload types — mirror ops-status/server.js collectAll() output.
 * ------------------------------------------------------------------------- */

interface StateItem {
  state: string;
  label: string;
  ageMin: number | null;
  raw?: string | null;
}

interface LaneRow {
  lane: string;
  fresh: number;
  progressing: number;
  done: number;
}

interface WhatsappRow {
  sector: string;
  available: number;
  messaged: number;
  closed: number;
}

/**
 * The WhatsApp lane, read from its own ledger by the ops-status collector. It
 * rides under `outreach` because it is the same programme on a different
 * transport, but every field is optional: an older collector simply omits it
 * and the block disappears rather than breaking the page.
 */
interface OutreachWhatsapp {
  ok: boolean;
  error: string | null;
  pool?: { available: number; messaged: number; replied: number; closed: number };
  perSector?: WhatsappRow[];
  /** Chases whose date has passed. A date, not a queue — see the footnote. */
  overdue?: number;
  dueToday?: number;
  dueNext?: { date: string; count: number }[];
  sentToday?: number;
  chasedToday?: number;
  /**
   * The field pages themselves, discovered from the served directory by the
   * collector — so a page that is built or retired shows up here without a code
   * change. `actionable` is what is still owed on it: unmessaged leads on a cold
   * page, unchased ones on a chase page.
   */
  pages?: WhatsappPage[];
}

interface WhatsappPage {
  file: string;
  url: string;
  label: string;
  kind: string;
  leads: number;
  actionable: number;
  state: string;
}

interface OutreachOk {
  ok: true;
  cap: number | null;
  whatsapp?: OutreachWhatsapp;
  pool: {
    active: number;
    fresh: number;
    replied: number;
    bounced: number;
    followupsDue: number;
    remainingSends: number;
    estSendDays: number;
  };
  perLane: LaneRow[];
  dueToday: number;
  dueNext: { date: string; count: number }[];
  sentToday: number;
}

interface OutreachErr {
  ok: false;
  error: string;
}

interface Finder {
  key: string;
  label: string;
  state: string;
  lastRun: string | null;
  ageLabel: string;
}

interface Batch {
  key: string;
  name: string;
  state: string;
  label: string;
  doneCount?: number;
  lastActivity: string | null;
}

interface OpsSystem {
  hostname: string | null;
  uptimeSec: number | null;
  load: string[] | null;
  services: { name: string; state: string }[];
  timers: { name: string; next: string | null }[];
}

interface OpsPayload {
  generatedAt: string;
  summary: { state: string; label: string };
  outreach: OutreachOk | OutreachErr | null;
  canary: StateItem | null;
  backup: StateItem | null;
  finders: Finder[] | null;
  batches: Batch[] | null;
  system: OpsSystem | null;
}

/* ---------------------------------------------------------------------------
 * State → tone + symbol mapping. Symbols pair with colour so a row never
 * depends on colour alone (locked rule from the standalone ops page).
 * ------------------------------------------------------------------------- */

const STATE_TONE: Record<string, ToneName> = {
  good: 'success',
  active: 'success',
  warn: 'warning',
  inactive: 'warning',
  'not-found': 'warning',
  serious: 'warning',
  crit: 'critical',
  failed: 'critical',
  error: 'critical',
  mute: 'muted',
  unknown: 'muted',
};

function toneFor(state?: string | null): ToneName {
  return (state && STATE_TONE[state]) || 'muted';
}

function fmtAgo(min: number | null | undefined): string {
  if (min == null) return 'never';
  if (min < 2) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ${Math.round((min % 1440) / 60)}h ago`;
}

function fmtUptime(sec: number | null | undefined): string {
  if (sec == null) return '';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = `${d}d ${h}h ${m}m`;
  return s.replace(/^0d /, '');
}

/** systemctl next-fire string "Mon 2026-09-07 09:25:00 BST" → "Mon · 09:25" */
function fmtNext(raw: string | null): string {
  if (!raw) return '';
  const m = String(raw).match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  if (!m) return raw;
  const d = new Date(`${m[1]}T${m[2]}`);
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${wd} · ${m[2]}`;
}

function shortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

/* ---------------------------------------------------------------------------
 * Small presenters
 * ------------------------------------------------------------------------- */

function Readout({
  state,
  word,
  className,
}: {
  state?: string | null;
  word: ReactNode;
  className?: string;
}) {
  const tone = toneFor(state);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <StatusDot tone={tone} size={6} pulse={tone === 'critical'} />
      <span
        className="truncate text-[12px] font-medium"
        style={{ color: TONE_COLOR[tone] }}
      >
        {word}
      </span>
    </span>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1.5 font-mono text-[12px] font-semibold tracking-[0.16em] text-dim-500 uppercase">
      {children}
    </h2>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-void-700 bg-void-900/60 p-4', className)}>
      {children}
    </div>
  );
}

function Row({
  k,
  children,
  tag,
}: {
  k: ReactNode;
  children: ReactNode;
  tag?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-void-800 py-[5px] last:border-b-0">
      <span className="min-w-0 shrink-0 text-[12px] text-slate-400">{k}</span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-right">
        {children}
        {tag && <span className="tabular shrink-0 text-[12px] text-dim-500">{tag}</span>}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

export default function StatusPage() {
  const [payload, setPayload] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status fetch failed (${res.status})`);
      const json = (await res.json()) as { data: OpsPayload };
      setPayload(json.data);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read box status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const outreach = payload?.outreach && payload.outreach.ok ? payload.outreach : null;
  const outreachErr = payload?.outreach && !payload.outreach.ok ? payload.outreach : null;
  const pool = outreach?.pool;
  const wa = outreach?.whatsapp && outreach.whatsapp.ok ? outreach.whatsapp : null;

  // The lane's footer sums the rows it sits under rather than reading `pool`:
  // per-sector folds the one reply into "live" (61) while `pool` reports it split
  // (60 messaged + 1 replied), so summing the rows is what keeps the total
  // reconciling with the table above it.
  const waTotals = (wa?.perSector ?? []).reduce(
    (a, l) => ({
      available: a.available + l.available,
      messaged: a.messaged + l.messaged,
      closed: a.closed + l.closed,
    }),
    { available: 0, messaged: 0, closed: 0 },
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-void-100">
            <Activity size={17} className="text-accent" />
            Status
          </h1>
          <p className="mt-1 text-[12px] leading-relaxed text-dim-300">
            Is the box OK — outreach, watch, lead pipelines, services. Read-only glance,
            refreshed every minute.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent/12
                       px-2.5 py-1 text-[12px] font-medium text-accent transition-colors
                       hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {updatedAt && (
            <span className="text-[12px] text-dim-500">
              <RelativeTime value={updatedAt} prefix="Updated " />
            </span>
          )}
        </div>
      </header>

      {error && (
        <p className="rounded-md border border-red-700/30 bg-red-900/12 px-3 py-2 text-[12px] text-red-300">
          {error} — is ops-status.service running?
        </p>
      )}

      {loading && !payload ? (
        <p className="text-[12px] text-dim-400">Reading box state…</p>
      ) : payload ? (
        <>
          {/* ---- summary banner ---- */}
          <Card className="flex items-center gap-3">
            <StatusDot
              tone={toneFor(payload.summary.state)}
              pulse={payload.summary.state === 'crit'}
              size={12}
            />
            <div className="min-w-0">
              <p
                className="text-[15px] leading-tight font-bold"
                style={{ color: TONE_COLOR[toneFor(payload.summary.state)] }}
              >
                {payload.summary.state === 'good'
                  ? 'All good'
                  : (payload.summary.label || payload.summary.state).toUpperCase()}
              </p>
              {payload.summary.state !== 'good' && payload.summary.label && (
                <p className="mt-0.5 truncate text-[12px] text-slate-400">
                  {payload.summary.label}
                </p>
              )}
            </div>
          </Card>

          {/* ---- stat tiles ---- */}
          {outreach && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card>
                <Stat
                  label="active in pool"
                  value={pool?.active ?? '–'}
                  tone="accent"
                  hint={
                    wa
                      ? `WhatsApp ${(wa.pool?.messaged ?? 0) + (wa.pool?.replied ?? 0)} live`
                      : undefined
                  }
                />
              </Card>
              <Card>
                <Stat
                  label="due today"
                  value={outreach.dueToday ?? '–'}
                  hint={wa ? `WhatsApp ${wa.dueToday ?? 0} due · ${wa.overdue ?? 0} overdue` : undefined}
                />
              </Card>
              <Card>
                <Stat
                  label="sent today"
                  value={outreach.sentToday ?? '–'}
                  hint={
                    wa
                      ? `WhatsApp ${wa.sentToday ?? 0} sent · ${wa.chasedToday ?? 0} chased`
                      : undefined
                  }
                />
              </Card>
              <Card>
                <Stat
                  label="runway"
                  value={pool?.estSendDays != null ? `~${pool.estSendDays}d` : '–'}
                />
              </Card>
            </div>
          )}

          {/* ---- outreach ---- */}
          <section>
            <SectionTitle>Outreach</SectionTitle>
            {outreachErr ? (
              <Card>
                <p className="text-[12px] text-red-300">
                  Outreach db error — {outreachErr.error}
                </p>
              </Card>
            ) : outreach ? (
              <Card className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 font-mono text-[12px] tracking-[0.14em] text-dim-500 uppercase">
                      Leads in pool
                    </p>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 border-b border-void-700 pb-1 font-mono text-[12px] tracking-[0.12em] text-dim-500 uppercase">
                      <span>sector</span>
                      <span className="w-10 text-right">fresh</span>
                      <span className="w-12 text-right">mid</span>
                      <span className="w-12 text-right">active</span>
                    </div>
                    {(outreach.perLane ?? []).map((l) => (
                      <div
                        key={l.lane}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-3 border-b border-void-800 py-1 text-[12px]"
                      >
                        <span className="truncate text-slate-200 capitalize">{l.lane}</span>
                        <span className="tabular w-10 text-right font-semibold text-slate-100">
                          {l.fresh}
                        </span>
                        <span className="tabular w-12 text-right text-slate-400">
                          {l.progressing}
                        </span>
                        <span className="tabular w-12 text-right text-slate-400">
                          {l.fresh + l.progressing}
                        </span>
                      </div>
                    ))}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-3 pt-1 text-[12px] font-bold">
                      <span className="text-slate-200">total</span>
                      <span className="tabular w-10 text-right text-slate-100">
                        {pool?.fresh ?? 0}
                      </span>
                      <span className="tabular w-12 text-right text-slate-300">
                        {pool?.followupsDue ?? 0}
                      </span>
                      <span className="tabular w-12 text-right text-slate-100">
                        {pool?.active ?? 0}
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] text-dim-500">
                      {pool?.remainingSends ?? 0} sends left in cadence · ~
                      {pool?.estSendDays ?? '–'} days at cap 43
                    </p>
                  </div>

                  <div>
                    <p className="mb-1 font-mono text-[12px] tracking-[0.14em] text-dim-500 uppercase">
                      Sends
                    </p>
                    <Row k="due today">
                      <span className="tabular text-[12px] text-slate-100">
                        {outreach.dueToday}
                      </span>
                    </Row>
                    <Row k="sent today">
                      <span className="tabular text-[12px] text-slate-100">
                        {outreach.sentToday}
                      </span>
                    </Row>
                    <Row k="replied / bounced">
                      <span className="tabular text-[12px] text-slate-100">
                        {pool?.replied ?? 0} / {pool?.bounced ?? 0}
                      </span>
                    </Row>
                    <Row k="runway">
                      <span className="tabular text-[12px] text-slate-100">
                        ~{pool?.estSendDays ?? '–'} days
                      </span>
                    </Row>
                    {outreach.dueNext && outreach.dueNext.length > 0 && (
                      <Row k="next due">
                        <span className="flex flex-wrap justify-end gap-1">
                          {outreach.dueNext.map((d) => (
                            <span
                              key={d.date}
                              className="rounded-[3px] border border-void-600 px-1.5 py-0.5 font-mono text-[12px] text-slate-300"
                            >
                              {shortDate(d.date)} · {d.count}
                            </span>
                          ))}
                        </span>
                      </Row>
                    )}
                    {outreach.cap != null && (
                      <p className="mt-1 text-[12px] text-dim-500">
                        cap {outreach.cap}
                        {outreach.cap === 60 ? ' (reverts 43 @ 13:00)' : ''}
                      </p>
                    )}
                  </div>
                </div>

                {wa && (
                  <div className="space-y-3 border-t border-void-700 pt-4">
                    <p className="font-mono text-[12px] tracking-[0.14em] text-dim-500 uppercase">
                      WhatsApp lane
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 font-mono text-[12px] tracking-[0.14em] text-dim-500 uppercase">
                          pool by trade
                        </p>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 border-b border-void-700 pb-1 font-mono text-[12px] tracking-[0.12em] text-dim-500 uppercase">
                          <span>sector</span>
                          <span className="w-10 text-right">new</span>
                          <span className="w-12 text-right">live</span>
                          <span className="w-12 text-right">done</span>
                        </div>
                        {(wa.perSector ?? []).map((l) => (
                          <div
                            key={l.sector}
                            className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-3 border-b border-void-800 py-1 text-[12px]"
                          >
                            <span className="truncate text-slate-200 capitalize">{l.sector}</span>
                            <span className="tabular w-10 text-right font-semibold text-slate-100">
                              {l.available}
                            </span>
                            <span className="tabular w-12 text-right text-slate-400">
                              {l.messaged}
                            </span>
                            <span className="tabular w-12 text-right text-dim-500">
                              {l.closed}
                            </span>
                          </div>
                        ))}
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-3 border-t border-void-600 pt-1 font-mono text-[12px] tracking-[0.12em] text-dim-500 uppercase">
                          <span className="truncate">
                            total · {waTotals.available + waTotals.messaged + waTotals.closed}
                          </span>
                          <span className="tabular w-10 text-right">{waTotals.available}</span>
                          <span className="tabular w-12 text-right">{waTotals.messaged}</span>
                          <span className="tabular w-12 text-right">{waTotals.closed}</span>
                        </div>
                      </div>

                      <div>
                        <Row k="chases overdue">
                          <span
                            className={`tabular text-[12px] ${
                              (wa.overdue ?? 0) > 0 ? 'font-semibold text-amber-300' : 'text-slate-100'
                            }`}
                          >
                            {wa.overdue ?? 0}
                          </span>
                        </Row>
                        <Row k="due today">
                          <span className="tabular text-[12px] text-slate-100">
                            {wa.dueToday ?? 0}
                          </span>
                        </Row>
                        <Row k="sent / chased today">
                          <span className="tabular text-[12px] text-slate-100">
                            {wa.sentToday ?? 0} / {wa.chasedToday ?? 0}
                          </span>
                        </Row>
                        <Row k="in flight">
                          <span className="tabular text-[12px] text-slate-100">
                            {wa.pool?.messaged ?? 0} live · {wa.pool?.replied ?? 0} replied
                          </span>
                        </Row>
                        {wa.dueNext && wa.dueNext.length > 0 && (
                          <Row k="next due">
                            <span className="flex flex-wrap justify-end gap-1">
                              {wa.dueNext.map((d) => (
                                <span
                                  key={d.date}
                                  className="rounded-[3px] border border-void-600 px-1.5 py-0.5 font-mono text-[12px] text-slate-300"
                                >
                                  {shortDate(d.date)} · {d.count}
                                </span>
                              ))}
                            </span>
                          </Row>
                        )}
                        <p className="mt-2 text-[12px] text-dim-500">
                          {wa.pool?.available ?? 0} in the pool, unmessaged — a chase date is
                          not a queue; read the row before sending
                        </p>
                      </div>
                    </div>

                    {wa.pages && wa.pages.length > 0 && (
                      <div>
                        <p className="mb-1 font-mono text-[12px] tracking-[0.14em] text-dim-500 uppercase">
                          pages
                        </p>
                        {wa.pages.map((p) => (
                          <a
                            key={p.file}
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-baseline justify-between gap-3 border-b border-void-800 py-1 text-[12px] transition-colors ${
                              p.actionable > 0
                                ? 'text-slate-200 hover:text-slate-50'
                                : 'text-dim-500 hover:text-slate-400'
                            }`}
                          >
                            <span className="truncate">
                              {p.label} <span className="text-dim-500">↗</span>
                            </span>
                            <span
                              className={`shrink-0 font-mono text-[12px] tracking-[0.1em] uppercase ${
                                p.actionable > 0 ? 'text-slate-100' : 'text-dim-500'
                              }`}
                            >
                              {p.state}
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {outreach.whatsapp && !outreach.whatsapp.ok && (
                  <p className="border-t border-void-700 pt-3 text-[12px] text-red-300">
                    WhatsApp db error — {outreach.whatsapp.error}
                  </p>
                )}
              </Card>
            ) : (
              <Card>
                <p className="text-[12px] text-dim-500 italic">No outreach data.</p>
              </Card>
            )}
          </section>

          {/* ---- watch ---- */}
          <section>
            <SectionTitle>Watch</SectionTitle>
            <Card>
              <Row k="Max-tier canary" tag={fmtAgo(payload.canary?.ageMin)}>
                <Readout state={payload.canary?.state} word={payload.canary?.label ?? 'no status'} />
              </Row>
              <Row k="Nightly backup" tag={fmtAgo(payload.backup?.ageMin)}>
                <Readout state={payload.backup?.state} word={payload.backup?.label ?? 'no log'} />
              </Row>
              {(payload.batches ?? []).map((b) => (
                <Row
                  key={b.key}
                  k={b.name}
                  tag={
                    b.lastActivity
                      ? fmtAgo(Math.round((Date.now() - new Date(b.lastActivity).getTime()) / 60000))
                      : ''
                  }
                >
                  <Readout state={b.state} word={b.label} />
                </Row>
              ))}
              {(!payload.batches || payload.batches.length === 0) && (
                <Row k="Batches">
                  <span className="text-[12px] text-dim-500 italic">none</span>
                </Row>
              )}
            </Card>
          </section>

          {/* ---- lead pipelines ---- */}
          <section>
            <SectionTitle>Lead pipelines</SectionTitle>
            <Card>
              {payload.finders && payload.finders.length > 0 ? (
                payload.finders.map((f) => (
                  <Row
                    key={f.key}
                    k={f.label}
                    tag={
                      f.ageLabel === 'never'
                        ? 'not run yet'
                        : f.lastRun
                          ? fmtAgo(Math.round((Date.now() - new Date(f.lastRun).getTime()) / 60000))
                          : ''
                    }
                  >
                    <Readout state={f.state} word={f.ageLabel} />
                  </Row>
                ))
              ) : (
                <p className="text-[12px] text-dim-500 italic">None tracked.</p>
              )}
            </Card>
          </section>

          {/* ---- services ---- */}
          <section>
            <SectionTitle>Services</SectionTitle>
            <Card>
              {payload.system?.services ? (
                <>
                  <Row k="daemons">
                    <span className="tabular text-[12px] text-slate-200">
                      {payload.system.services.filter((u) => u.state === 'active').length}/
                      {payload.system.services.length} up
                    </span>
                  </Row>
                  {payload.system.services.map((u) => (
                    <Row key={u.name} k={u.name}>
                      <Readout state={u.state} word={u.state === 'active' ? 'up' : u.state} />
                    </Row>
                  ))}
                  {(payload.system.timers ?? []).filter((t) => t.next).length > 0 && (
                    <>
                      <div className="mt-2 border-t border-void-700" />
                      {(payload.system.timers ?? [])
                        .filter((t) => t.next)
                        .map((t) => (
                          <Row key={t.name} k={`${t.name.replace('.timer', '')} → next`}>
                            <span className="tabular text-[12px] text-slate-300">
                              {fmtNext(t.next)}
                            </span>
                          </Row>
                        ))}
                    </>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-dim-500 italic">System state unavailable.</p>
              )}
            </Card>
          </section>

          {/* ---- footer ---- */}
          <p className="px-1 text-[12px] text-dim-500">
            {payload.system?.hostname || 'box'} · up {fmtUptime(payload.system?.uptimeSec)}
            {payload.system?.load ? ` · load ${payload.system.load.join(' ')}` : ''} · generated{' '}
            {new Date(payload.generatedAt).toLocaleTimeString('en-GB')}
          </p>
        </>
      ) : null}
    </div>
  );
}
