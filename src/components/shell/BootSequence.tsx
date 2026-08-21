/**
 * SAM — Boot sequence.
 *
 * The cold-start intro: the visualiser assembles itself from an empty canvas
 * while a readout reports what actually came up. The numbers are pulled from
 * the live endpoints, not scripted — a boot screen that lies about the state
 * of the system is just a splash screen with extra steps.
 *
 * Two usages:
 *   <BootSequence once />              — AppShell, plays on cold start only
 *   <BootSequence onDone={…} />        — /intro, plays every time
 *
 * The timeline never waits on the network. Lines reveal on schedule and their
 * values fill in as responses land; anything still outstanding when its line
 * appears shows as scanning, and anything that failed shows UNAVAILABLE.
 */

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { VaultGraphVisualiser } from '@/components/visualiser/VaultGraphVisualiser';
import { VisualiserWidget } from '@/components/visualiser/VisualiserWidget';
import type {
  DailyTasksPayload,
  Project,
  SystemHealthPayload,
} from '@/types/dashboard';
import type { VaultGraph } from '@/types/vaultGraph';

/* ========================================================================== */
/* Timing                                                                     */
/* ========================================================================== */

// Long enough to actually watch the mesh assemble and read the readout. It is
// skippable on any tap or key, so erring slow costs nothing.
const BOOT_MS = 6000;
// Reduced motion means *less movement*, not "blink and miss it". The readout is
// information, so it still needs time to be read — this only trims the dwell.
const REDUCED_BOOT_MS = 2600;
const FADE_MS = 420;
/** Beat spent on the finished visualiser before the overlay leaves. */
const HOLD_MS = 900;
const SESSION_KEY = 'sam:booted';

/** Node count the visualiser builds its mesh from — kept in step with the widget. */
const MESH_NODES = 500;

/* ========================================================================== */
/* Readout definition                                                         */
/* ========================================================================== */

type LineStatus = 'scanning' | 'ok' | 'warn';

interface LineSpec {
  key: string;
  label: string;
  /** Boot progress at which this line reveals. */
  at: number;
  /** Shown until live data lands. Null means "resolves from telemetry". */
  fixed?: string;
}

/**
 * The second line describes whatever field is actually rendering. In vault mode
 * that is the real graph, so the count resolves from the API rather than being
 * the fixed mesh figure — same rule as every other line here.
 */
function buildLines(vaultMode: boolean): LineSpec[] {
  return [
    { key: 'core', label: 'CORE SYSTEMS', at: 0.06, fixed: 'INITIALISING' },
    vaultMode
      ? { key: 'mesh', label: 'VAULT GRAPH', at: 0.22 }
      : { key: 'mesh', label: 'NEURAL MESH', at: 0.22, fixed: `${MESH_NODES} NODES` },
    { key: 'telemetry', label: 'TELEMETRY', at: 0.40 },
    { key: 'projects', label: 'PROJECTS', at: 0.56 },
    { key: 'tasks', label: 'TASK QUEUE', at: 0.70 },
    { key: 'uplink', label: 'UPLINK', at: 0.82 },
  ];
}

interface Reading {
  value: string;
  status: LineStatus;
}

/* ========================================================================== */
/* Telemetry                                                                  */
/* ========================================================================== */

interface HealthShape {
  gitSHA: string | null;
  nodeVersion: string;
}

/** Fetch and unwrap an API envelope. Returns null on any failure or timeout. */
async function readEndpoint<T>(url: string, timeoutMs = 2500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'data' in body) {
      return (body as { data: T }).data;
    }
    return body as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const UNAVAILABLE: Reading = { value: 'UNAVAILABLE', status: 'warn' };

/**
 * useLayoutEffect warns when a component is server-rendered, and Next renders
 * this one to HTML even though it is a client component. Same behaviour,
 * without the console noise.
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Pulls the real numbers behind the readout. Each endpoint resolves
 * independently so one slow route never holds up the rest.
 */
function useBootTelemetry(vaultMode: boolean): Record<string, Reading> {
  const [readings, setReadings] = useState<Record<string, Reading>>({});

  useEffect(() => {
    let live = true;
    const put = (key: string, reading: Reading) => {
      if (live) setReadings((prev) => ({ ...prev, [key]: reading }));
    };

    void readEndpoint<SystemHealthPayload>('/api/dashboard/system').then((data) => {
      if (!data) return put('telemetry', UNAVAILABLE);
      const down = data.services.filter((s) => s.state === 'down').length;
      put('telemetry', {
        value: `CPU ${Math.round(data.cpuPct)}% · MEM ${Math.round(data.memPct)}%`,
        status: down > 0 ? 'warn' : 'ok',
      });
    });

    void readEndpoint<Project[]>('/api/dashboard/projects').then((data) => {
      if (!data) return put('projects', UNAVAILABLE);
      const blocked = data.filter((p) => p.phase === 'blocked').length;
      put('projects', {
        value: blocked
          ? `${data.length} LOADED · ${blocked} BLOCKED`
          : `${data.length} LOADED`,
        status: blocked > 0 ? 'warn' : 'ok',
      });
    });

    void readEndpoint<DailyTasksPayload>('/api/dashboard/tasks').then((data) => {
      if (!data) return put('tasks', UNAVAILABLE);
      const open = data.tasks.filter((t) => !t.done).length;
      put('tasks', {
        value: data.overdue
          ? `${open} OPEN · ${data.overdue} OVERDUE`
          : `${open} OPEN`,
        status: data.overdue > 0 ? 'warn' : 'ok',
      });
    });

    if (vaultMode) {
      void readEndpoint<VaultGraph>('/api/vault/graph').then((data) => {
        if (!data) return put('mesh', UNAVAILABLE);
        const { notes, edges } = data.counts;
        put('mesh', {
          value: `${notes} NOTES · ${edges} LINKS`,
          // Ghost links are a standing property of the vault, not a fault.
          // Amber on every single boot would just train the eye to ignore it.
          status: 'ok',
        });
      });
    }

    void readEndpoint<HealthShape>('/api/health').then((data) => {
      if (!data) return put('uplink', UNAVAILABLE);
      put('uplink', {
        value: data.gitSHA ? `BUILD ${data.gitSHA}` : `NODE ${data.nodeVersion}`,
        status: 'ok',
      });
    });

    return () => {
      live = false;
    };
  }, [vaultMode]);

  return readings;
}

/* ========================================================================== */
/* Component                                                                  */
/* ========================================================================== */

export interface BootSequenceProps {
  /** Called once the sequence has finished fading out. */
  onDone?: () => void;
  /** Play only on the first load of a browser session. */
  once?: boolean;
  /**
   * Which field assembles behind the readout.
   *   'classic' — the abstract generated mesh (default; unchanged behaviour)
   *   'vault'   — SAM's real memory: the vault wikilink graph
   */
  visualiser?: 'classic' | 'vault';
}

export function BootSequence({ onDone, once = false, visualiser = 'classic' }: BootSequenceProps) {
  // `null` means "not yet decided" — nothing renders on the server, and the
  // decision is made before first paint so the dashboard never flashes.
  const [active, setActive] = useState<boolean | null>(null);
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const vaultMode = visualiser === 'vault';
  const readings = useBootTelemetry(vaultMode);
  const lines = buildLines(vaultMode);

  const doneRef = useRef(false);
  const durationRef = useRef(BOOT_MS);

  // Held in a ref so an inline `onDone` from the caller cannot re-create
  // `finish`, which would tear down and restart the timeline every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  /* ---- Should this play at all? ------------------------------------------ */
  useIsomorphicLayoutEffect(() => {
    // The flag records that *a* boot has played this session, whichever mount
    // played it — /intro hands off to `/`, and AppShell must not replay there.
    // So every instance writes it; only `once` instances read it.
    try {
      if (once && window.sessionStorage.getItem(SESSION_KEY) === '1') {
        setActive(false);
        // `onDone` means "the boot phase is over", not "the animation played".
        // Callers gate real work on it, so it has to fire on the skip path too.
        doneRef.current = true;
        onDoneRef.current?.();
        return;
      }
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Private mode or storage disabled — play it. That's the safe default.
    }

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    durationRef.current = reduced ? REDUCED_BOOT_MS : BOOT_MS;

    setActive(true);
  }, [once]);

  /* ---- Finish ------------------------------------------------------------ */
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      setActive(false);
      onDoneRef.current?.();
    }, FADE_MS);
  }, []);

  /* ---- Drive the timeline ------------------------------------------------ */
  useEffect(() => {
    if (active !== true) return;

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationRef.current);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Hold on the fully-formed visualiser for a beat before leaving.
        window.setTimeout(finish, HOLD_MS);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [active, finish]);

  /* ---- Skip on any input ------------------------------------------------- */
  useEffect(() => {
    if (active !== true) return;
    const skip = () => finish();
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [active, finish]);

  if (active !== true) return null;

  const pct = Math.round(progress * 100);
  const wordmarkIn = progress > 0.12;
  const online = progress >= 0.94;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] overflow-hidden bg-[#010812]"
      style={{
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'scale(1.04)' : 'scale(1)',
        filter: leaving ? 'blur(6px)' : 'none',
        transition: `opacity ${FADE_MS}ms ease-out, transform ${FADE_MS}ms ease-out, filter ${FADE_MS}ms ease-out`,
      }}
    >
      {/* The visualiser assembling itself, full bleed */}
      {visualiser === 'vault' ? (
        <VaultGraphVisualiser state="idle" boot={progress} />
      ) : (
        <VisualiserWidget state="idle" hud={false} boot={progress} />
      )}

      {/* Single scan-line sweep across the build */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 h-px"
        style={{
          top: `${Math.min(100, progress * 130)}%`,
          opacity: progress > 0.06 && progress < 0.82 ? 0.5 : 0,
          background:
            'linear-gradient(90deg, transparent, rgba(61,255,90,0.9) 50%, transparent)',
          transition: 'opacity 200ms linear',
        }}
      />

      {/* ---- Wordmark ------------------------------------------------------ */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
        {/* Scrim. The core is at its brightest exactly where the wordmark sits,
            and without this the type is swallowed by the glow behind it. */}
        <div
          className="absolute left-1/2 top-1/2 h-[280px] w-[420px] -translate-x-1/2 -translate-y-1/2"
          style={{
            background: vaultMode
              ? // The vault nucleus is the brightest thing on screen and sits
                // directly behind the type. Scrim only enough to hold contrast —
                // the glow bleeding around the letters is the effect.
                'radial-gradient(ellipse at center, rgba(1,6,14,0.58) 0%, rgba(1,6,14,0.30) 48%, transparent 74%)'
              : 'radial-gradient(ellipse at center, rgba(1,6,14,0.82) 0%, rgba(1,6,14,0.55) 45%, transparent 72%)',
          }}
        />

        <div className="relative flex items-center gap-[0.18em]">
          {['S', 'A', 'M'].map((ch, i) => {
            // Letters resolve one at a time, blurred until they lock.
            const lock = Math.max(0, Math.min(1, (progress - 0.12 - i * 0.08) / 0.18));
            return (
              <span
                key={ch}
                className="font-mono text-[clamp(38px,11vw,72px)] font-bold leading-none"
                style={{
                  color: online ? '#ffffff' : `rgba(170,255,190,${0.35 + lock * 0.5})`,
                  filter: `blur(${(1 - lock) * 10}px)`,
                  opacity: lock,
                  textShadow: online
                    ? '0 0 24px rgba(61,255,90,0.75), 0 0 70px rgba(61,255,90,0.35)'
                    : `0 0 ${lock * 18}px rgba(61,255,90,${lock * 0.5})`,
                  transition: 'color 500ms ease-out, text-shadow 500ms ease-out',
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>

        {/* Hairline that draws outward under the wordmark */}
        <div
          className="relative mt-4 h-px bg-flux-400/60"
          style={{
            width: `${Math.min(1, Math.max(0, (progress - 0.2) / 0.5)) * 190}px`,
            boxShadow: '0 0 10px rgba(61,255,90,0.5)',
          }}
        />

        <p
          className="relative mt-4 font-mono text-[10px] tracking-[0.42em]"
          style={{
            color: online ? '#b0ffbe' : 'rgba(140,255,160,0.8)',
            opacity: wordmarkIn ? 1 : 0,
            textShadow: '0 0 12px rgba(1,6,14,0.95), 0 0 4px rgba(1,6,14,1)',
            transition: 'opacity 600ms ease-out, color 500ms ease-out',
          }}
        >
          {online ? 'ONLINE' : 'INITIALISING'}
        </p>
      </div>

      {/* ---- Readout ------------------------------------------------------- */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))] sm:px-10">
        <div className="mx-auto w-full max-w-[520px]">
          <ul className="space-y-[7px]">
            {lines.map((line) => {
              const shown = progress >= line.at;
              // CORE reports its own completion; everything else waits on data.
              const fixed =
                line.key === 'core' && online ? 'ONLINE' : line.fixed;
              const resolved =
                readings[line.key] ??
                (fixed ? { value: fixed, status: 'ok' as LineStatus } : null);
              const status: LineStatus = resolved?.status ?? 'scanning';

              return (
                <li
                  key={line.key}
                  className="flex items-baseline gap-2 font-mono text-[10px] tracking-[0.16em]"
                  style={{
                    opacity: shown ? 1 : 0,
                    transform: shown ? 'translateY(0)' : 'translateY(5px)',
                    transition: 'opacity 320ms ease-out, transform 320ms ease-out',
                  }}
                >
                  <span
                    className="inline-block h-[5px] w-[5px] shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        status === 'ok'
                          ? '#3dff5a'
                          : status === 'warn'
                            ? '#fbbf24'
                            : 'rgba(148,163,184,0.5)',
                      boxShadow:
                        status === 'ok' ? '0 0 8px rgba(61,255,90,0.9)' : 'none',
                    }}
                  />
                  <span className="shrink-0 text-dim-500">{line.label}</span>
                  <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dotted border-void-400" />
                  <span
                    className="shrink-0 tabular-nums"
                    style={{
                      color:
                        status === 'ok'
                          ? '#b0ffbe'
                          : status === 'warn'
                            ? '#fbbf24'
                            : 'rgba(139,148,180,0.8)',
                    }}
                  >
                    {resolved ? resolved.value : 'SCANNING'}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Progress rail */}
          <div className="mt-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-void-500">
              <div
                className="h-px bg-flux-400"
                style={{
                  width: `${pct}%`,
                  boxShadow: '0 0 8px rgba(61,255,90,0.8)',
                }}
              />
            </div>
            <span className="font-mono text-[10px] tabular-nums tracking-[0.2em] text-flux-300/80">
              {String(pct).padStart(3, '0')}%
            </span>
          </div>

          <p className="mt-4 text-center font-mono text-[8px] tracking-[0.34em] text-void-300">
            ATWOOD SYSTEMS · CORE DASHBOARD
          </p>
        </div>
      </div>
    </div>
  );
}
