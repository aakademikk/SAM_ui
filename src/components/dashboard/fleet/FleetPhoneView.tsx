'use client';

/**
 * SAM — the fleet view on a phone (T13, Must 6a, 6b, 6d).
 *
 * A port of mockup E's phone page (`e-phone.html` with its shared
 * `phone.css`): today's top bar (Must 3c, in place of the mockup's own
 * header), the floor hero (full screen, 100dvh; Zeus at the top, the five busts on the
 * General row, names and states as the mockup's small canvas text), its
 * caption chip, the KPI tiles, then the job in flight with its lifecycle
 * and stage timeline, T15's carried-over widgets (`SidebarWidgets`: System
 * Health, Daily Tasks, Money In) directly below it, then Fleet, Stage
 * events, Active jobs and Spend stacked, and a solid Ask SAM bar fixed at
 * the bottom.
 *
 * Tapping a General (in the hero, its Fleet row or an Active jobs row) zooms
 * the hero onto it and opens its bottom sheet with the large bust
 * (`GeneralDetailSheet`); swiping the sheet down, tapping outside it, Back
 * or Esc closes it. The Ask SAM bar opens the same sheet shell with the chat
 * (`chatSlot`; T14's widget, a placeholder until then).
 *
 * T18, Must 26: a transparent tap target over the ring (`.fp-ring-hit`, sized
 * from `FloorCanvas`'s `onRing`) opens the same bottom sheet shell with the
 * Schedule panel, fed by the ring's own shared poll (`onSchedule`). It shares
 * `phoneView.ts`'s single `PhoneSheet` state with a General's sheet and the
 * Ask SAM chat, so opening any one of the three always closes whichever of
 * the others was open; the hero's hint is the mockup's own phone wording,
 * "Tap a General or the ring".
 *
 * Live data and demo mode work exactly as on the desktop (Must 6d): the same
 * `FloorCanvas` poll feeds every module, and `demo` goes to every data source.
 * Colours are the mockup's emerald literals, and the root carries
 * `fleet-dashboard` so the top bar's theme variables stay emerald (Must 3d).
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { TopBar } from '@/components/dashboard/TopBar';
import FloorCanvas from '@/components/floor/FloorCanvas';
import type { Box } from '@/components/floor/ringRender';
import { useDashboardStore } from '@/store/dashboardStore';
import type { FloorState, FloorWorker, GeneralId, ScheduledJob } from '@/types/floor';

import ActiveJobsModule, { activeJobEntries } from './ActiveJobsModule';
import DemoModeToggle from './DemoModeToggle';
import FleetStatusModule from './FleetStatusModule';
import GeneralDetailSheet, { BottomSheet } from './GeneralDetailSheet';
import JobDetailModule from './JobDetailModule';
import KpiTiles from './KpiTiles';
import SchedulePanel from './SchedulePanel';
import SidebarWidgets from './SidebarWidgets';
import SpendByHourModule from './SpendByHourModule';
import StageEventsModule from './StageEventsModule';
import { LIFECYCLE, heroCaption, lifecycleSteps, phoneSheetReducer, stageTimeline } from './phoneView';

export interface FleetPhoneViewProps {
  /** Demo mode (T20): passed to every data source. */
  demo?: boolean;
  /** The chat widget (T14), shown in the sheet the Ask SAM bar opens; a placeholder until then. */
  chatSlot?: ReactNode;
  /** Non-zero when a "Hey Sam" just arrived (T14, from FleetView): opens the Ask SAM sheet so the chat is on screen. */
  chatWake?: number;
  /**
   * Mounted directly below the job in flight (T15: System Health, Daily
   * Tasks, Money In). Defaults to `SidebarWidgets` itself, same as `chatSlot`
   * defaults to a placeholder — a caller only needs to pass this to override
   * it (e.g. for a test double).
   */
  belowJobSlot?: ReactNode;
}

/* ---------- e-phone.html + phone.css, scoped to .fp ---------- */

const LINE = 'rgba(157,255,112,.075)';
const LINE_STRONG = 'rgba(157,255,112,.16)';
const PANEL_BG = 'linear-gradient(180deg,rgba(9,28,20,.9),rgba(5,17,12,.92))';
const PANEL_BORDER = 'rgba(61,255,90,.12)';

const CSS = `
.fp{position:relative;box-sizing:border-box;min-height:100vh;min-height:100dvh;background:#030a07;color:#e8f7ee;overflow-x:clip;
  padding-bottom:calc(84px + env(safe-area-inset-bottom));font-size:12.5px;line-height:1.35}
.fp *,.fp *::before,.fp *::after{box-sizing:border-box}
.fp-top{position:sticky;top:0;z-index:10}
.fp-top>header{margin:0;position:relative;top:auto;border-radius:0;border-bottom:1px solid ${LINE};gap:5px;padding-left:12px;padding-right:10px;
  background:rgba(3,12,8,.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
/* Must 3c, check 32: the top bar keeps its health chip, sync badge and UTC clock on the phone too (TopBar hides them under sm/md/lg) */
.fp-top>header [class~="md:flex"]{display:flex;flex:0 0 auto}
.fp-top>header [class~="lg:inline-flex"]{display:inline-flex;letter-spacing:0;gap:4px}
.fp-top>header [class~="sm:inline"]{display:inline;letter-spacing:0}
.fp-top>header>div:last-child{gap:6px}
.fp-top>header .label{letter-spacing:.03em}
.fp-top>header h1{letter-spacing:.1em}
.fp-hero{position:relative;height:100dvh;overflow:hidden;border-bottom:1px solid ${LINE};background:#020805}
.fp-cap{position:absolute;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:12px;color:#98b6a6;pointer-events:none}
.fp-cap .c{display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;background:rgba(5,19,13,.85);border:1px solid ${LINE};
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:78%}
.fp-cap .c i{width:6px;height:6px;border-radius:50%;background:#3dff5a;flex:none;box-shadow:0 0 6px #3dff5a}
.fp-cap .c span{overflow:hidden;text-overflow:ellipsis}
.fp-cap .hint{font-size:12px;color:#5f7d6e;white-space:nowrap}
.fp-tiles{display:flex;align-items:center;gap:8px;padding:12px 12px 0}
.fp-tiles>section{gap:8px;flex:1 1 auto;min-width:0}
.fp-tiles>section>div{border-radius:10px;padding:9px 11px}
/* e-phone.html .tile: a 9.5 px label over a 17 px figure, no sub-line */
.fp-tiles>section>div>span:first-child{font-size:12px;letter-spacing:.08em}
.fp-tiles>section>div b{font-size:17px}
.fp-tiles>section>div small{display:none}
.fp-stack{display:flex;flex-direction:column;gap:12px;padding:12px}
.fp-stack section{border-radius:14px}
.fp-job{border-radius:14px;padding:14px 15px;background:${PANEL_BG};border:1px solid ${PANEL_BORDER}}
.fp-job>section{background:none!important;border:0!important;border-radius:0!important;padding:0!important}
.fp-life{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(5,1fr);position:relative}
.fp-life li{position:relative;text-align:center;font-size:12px;color:#5f7d6e;padding-top:16px}
.fp-life li i{position:absolute;top:3px;left:50%;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;border:1.5px solid ${LINE_STRONG};background:#030a07;z-index:1;transition:all .3s}
.fp-life li::before{content:"";position:absolute;top:7px;left:-50%;right:50%;height:1.5px;background:${LINE_STRONG}}
.fp-life li:first-child::before{display:none}
.fp-life li.done{color:#98b6a6}
.fp-life li.done i{background:#9dff70;border-color:#9dff70}
.fp-life li.done::before,.fp-life li.now::before,.fp-life li.bad::before{background:#9dff70}
.fp-life li.now{color:#e8f7ee;font-weight:600}
.fp-life li.now i{border-color:#3dff5a;background:#3dff5a;box-shadow:0 0 0 4px rgba(61,255,90,.085),0 0 12px #3dff5a}
.fp-life li.bad{color:#ff7a70;font-weight:600}
.fp-life li.bad i{border-color:#ff7a70;background:#ff7a70}
.fp-sec{display:flex;justify-content:space-between;margin:14px 0 8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#5f7d6e;font-weight:600}
.fp-sec span+span{letter-spacing:.02em;text-transform:none;font-weight:500}
.fp-stages{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.fp-stages li{display:flex;align-items:center;gap:10px;padding:5px 8px;border-radius:7px;color:#5f7d6e;font-size:12px;transition:background .3s,color .3s}
.fp-stages li i{width:8px;height:8px;border-radius:2px;border:1.5px solid ${LINE_STRONG};flex:none;transition:all .3s}
.fp-stages li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-stages li.done{color:#98b6a6}
.fp-stages li.done i{background:#9dff70;border-color:#9dff70}
.fp-stages li.now{color:#e8f7ee;background:rgba(61,255,90,.085)}
.fp-stages li.now i{background:#3dff5a;border-color:#3dff5a;box-shadow:0 0 10px #3dff5a}
.fp-note{margin:10px 0 0;font-size:12px;color:#5f7d6e}
/* the Ask SAM bar is solid, so the panels never show through it; the page ends with room to scroll the last panel clear */
.fp-ask{position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom) + var(--fp-ask-offset,0px));z-index:10;display:flex;align-items:center;gap:10px;
  padding:12px 14px;border-radius:14px;background:#06140e;border:1px solid ${LINE_STRONG};color:#98b6a6;font:inherit;font-size:14px;text-align:left;cursor:pointer;
  box-shadow:0 0 0 14px #030a07,0 -10px 24px 8px #030a07}
/* the app's fixed bottom tab bar (z-50, 3.5rem, md:hidden) sits over the bottom 56px of the viewport below 768px; lift the bar clear of it so the whole button is tappable (T29) */
@media (max-width:767px){.fp-ask{--fp-ask-offset:3.5rem}}
.fp-ask i{width:22px;height:22px;border-radius:7px;background:rgba(61,255,90,.085);border:1px solid rgba(61,255,90,.34);flex:none}
.fp-ask b{margin-left:auto;font-size:12px;font-weight:600;color:#3dff5a}
.fp-ask:focus-visible{outline:1px solid rgba(61,255,90,.34);outline-offset:2px}
.fp-chat-slot header{display:flex;align-items:center;justify-content:space-between;margin:14px 0 0}
/* T18: a transparent, keyboard-reachable hit target over the clock ring (the mockup's .ring-hit) */
.fp-ring-hit{position:absolute;left:0;top:0;padding:0;margin:0;border:0;border-radius:50%;background:none;-webkit-tap-highlight-color:transparent}
.fp-ring-hit:focus-visible{outline:1px solid rgba(61,255,90,.34);outline-offset:-1px}
/* the Schedule panel inside the bottom sheet: the sheet is the panel, so the desktop panel's own chrome goes (same rule as GeneralDetailSheet's .fs-general) */
.fs-sheet .fp-sched>section{background:none!important;border:0!important;border-radius:0!important;padding:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
@media (prefers-reduced-motion: reduce){.fp *{transition:none!important;animation:none!important}}
`;

export default function FleetPhoneView({ demo: demoProp = false, chatSlot, chatWake = 0, belowJobSlot }: FleetPhoneViewProps) {
  // The demo switch (Must 20) overrides the prop once tapped — same pattern as the desktop shell.
  const [demoOverride, setDemoOverride] = useState<boolean | null>(null);
  const demo = demoOverride ?? demoProp;
  const onToggleDemo = useCallback(() => setDemoOverride((v) => !(v ?? demoProp)), [demoProp]);
  const [floor, setFloor] = useState<FloorState | null>(null);
  const [sheet, dispatch] = useReducer(phoneSheetReducer, null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const openGeneral = sheet?.kind === 'general' ? sheet.id : null;
  const scheduleOpen = sheet?.kind === 'schedule';

  /* T18: the clock ring's shared poll (`FloorCanvas`'s `onSchedule`) and its tap target's box (`onRing`) */
  const [schedule, setSchedule] = useState<ScheduledJob[] | null>(null);
  const [ringBox, setRingBox] = useState<Box | null>(null);

  /* the top bar's health chip reads the dashboard store, so keep it fed, as the desktop shell does */
  const bootstrap = useDashboardStore((s) => s.bootstrap);
  const startPolling = useDashboardStore((s) => s.startPolling);
  const stopPolling = useDashboardStore((s) => s.stopPolling);
  useEffect(() => {
    void bootstrap();
    startPolling();
    return () => stopPolling();
  }, [bootstrap, startPolling, stopPolling]);

  /* a "Hey Sam" brings the chat on screen: the widget mounts in the sheet and picks up the wake */
  useEffect(() => {
    if (chatWake) dispatch({ type: 'openChat' });
  }, [chatWake]);

  /* Esc closes the sheet */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) dispatch({ type: 'close' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* hero taps: FloorCanvas reports a General during its own click handler; a tap on empty floor does nothing */
  const hitThisTap = useRef(false);
  const onFloorGeneral = useCallback((id: GeneralId) => {
    hitThisTap.current = true;
    dispatch({ type: 'heroTap', hit: id });
  }, []);
  const onHeroClick = useCallback(() => {
    if (!hitThisTap.current) dispatch({ type: 'heroTap', hit: null });
    hitThisTap.current = false;
  }, []);
  const onSelectGeneral = useCallback((id: GeneralId) => dispatch({ type: 'openGeneral', id }), []);
  const onClose = useCallback(() => dispatch({ type: 'close' }), []);
  const onAsk = useCallback(() => dispatch({ type: 'openChat' }), []);
  const onOpenSchedule = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    dispatch({ type: 'openSchedule' });
  }, []);

  // the job in flight: the picked job while it is live, else the first live job (the same rule as the desktop)
  const entries = activeJobEntries(floor);
  const flight = (selectedJobId ? entries.find((e) => e.worker.jobId === selectedJobId) : undefined) ?? entries[0] ?? null;
  const jobId = flight?.worker.jobId ?? null;

  return (
    <div className="fp fleet-dashboard" data-layout="phone">
      <style>{CSS}</style>

      <div className="fp-top">
        <TopBar />
      </div>

      <section className="fp-hero" aria-label="Fleet floor" onClick={onHeroClick}>
        <FloorCanvas
          demo={demo}
          focus={openGeneral}
          variant="phone"
          showCards={false}
          showSamLabel={false}
          showKey={false}
          onSelectGeneral={onFloorGeneral}
          onState={setFloor}
          onSchedule={setSchedule}
          onRing={setRingBox}
        />
        {/* T18: a transparent, keyboard-reachable tap target over the ring (Must 26) */}
        {ringBox && (
          <button
            type="button"
            className="fp-ring-hit"
            aria-label="Schedule: scheduled jobs on the clock ring"
            aria-haspopup="dialog"
            aria-expanded={scheduleOpen}
            style={{ transform: `translate(${ringBox[0]}px,${ringBox[1]}px)`, width: ringBox[2], height: ringBox[3] }}
            onClick={onOpenSchedule}
          />
        )}
        <div className="fp-cap">
          <span className="c"><i aria-hidden /><span data-bind="caption">{heroCaption(floor, flight?.worker ?? null)}</span></span>
          <span className="hint">Tap a General or the ring</span>
        </div>
      </section>

      <div className="fp-tiles">
        <KpiTiles state={floor} demo={demo} />
        <DemoModeToggle demo={demo} onToggle={onToggleDemo} />
      </div>

      <div className="fp-stack">
        <div className="fp-job" data-panel="detail">
          <JobDetailModule state={floor} selectedJobId={jobId} demo={demo} />
          {flight ? <StageTimeline worker={flight.worker} /> : null}
        </div>
        <div data-slot="below-job">{belowJobSlot ?? <SidebarWidgets demo={demo} />}</div>
        <div data-panel="fleet">
          <FleetStatusModule state={floor} selectedGeneral={openGeneral} onSelectGeneral={onSelectGeneral} />
        </div>
        <div data-panel="events">
          <StageEventsModule state={floor} maxEntries={4} />
        </div>
        <div data-panel="jobs">
          <ActiveJobsModule
            state={floor}
            selectedJobId={jobId}
            onSelectJob={setSelectedJobId}
            onSelectGeneral={onSelectGeneral}
          />
        </div>
        <div data-panel="spend">
          <SpendByHourModule demo={demo} />
        </div>
      </div>

      <button type="button" className="fp-ask" aria-label="Ask SAM" onClick={onAsk}>
        <i aria-hidden />Ask SAM…<b>Chat</b>
      </button>

      <GeneralDetailSheet general={openGeneral} state={floor} onClose={onClose} demo={demo} />
      <BottomSheet open={sheet?.kind === 'chat'} onClose={onClose} label="Ask SAM" dataSheet="chat">
        <div data-slot="chat">{chatSlot ?? <ChatSlotPlaceholder onClose={onClose} />}</div>
      </BottomSheet>
      {/* T18: the ring's tap opens the same list as the desktop/drawer panel, in the bottom sheet (Must 26) */}
      <BottomSheet open={scheduleOpen} onClose={onClose} label="Schedule" dataSheet="schedule">
        <div className="fp-sched">
          <SchedulePanel jobs={schedule} onClose={onClose} />
        </div>
      </BottomSheet>
    </div>
  );
}

/** The mockup's lifecycle row and build pipeline, from the job's real status and stage events only (Must 8, 17). */
function StageTimeline({ worker }: { worker: FloorWorker }) {
  const steps = lifecycleSteps(worker.status);
  const tl = stageTimeline(worker);
  return (
    <div data-bind="timeline">
      <ol className="fp-life" aria-label="Lifecycle">
        {LIFECYCLE.map((label, i) => (
          <li key={label} className={steps[i]}>
            <i aria-hidden />
            <span>{steps[i] === 'bad' ? 'Failed' : label}</span>
          </li>
        ))}
      </ol>
      <div className="fp-sec">
        <span>Stages</span>
        <span>{tl.summary}</span>
      </div>
      {tl.stages ? (
        <ol className="fp-stages">
          {tl.stages.map((s, i) => (
            <li key={`${s.name}:${i}`} className={s.state === 'todo' ? '' : s.state}>
              <i aria-hidden />
              <span>{s.name}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fp-note">Start, running and end only: this job has no stage events.</p>
      )}
    </div>
  );
}

/** The chat sheet until T14's DashboardChatWidget fills it: a header only, no chat logic. */
function ChatSlotPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <section aria-label="Chat with SAM" className="fp-chat-slot">
      <header>
        <span className="text-[12px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Chat with SAM
        </span>
        <button
          type="button"
          data-back
          onClick={onClose}
          className="cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{ background: 'rgba(157,255,112,.06)', borderColor: LINE_STRONG, color: '#e8f7ee' }}
        >
          Back
        </button>
      </header>
      <p className="mt-2 text-[12px]" style={{ color: '#5f7d6e' }}>
        Chat is on the Chat page for now.
      </p>
    </section>
  );
}
