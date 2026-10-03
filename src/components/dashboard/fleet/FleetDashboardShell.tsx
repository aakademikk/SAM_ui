'use client';

/**
 * SAM — the fleet dashboard shell (T11, Must 1, 3, 3c, 4, 5).
 *
 * Assembles the fleet view: today's top bar (Must 3c, `TopBar` unchanged),
 * the KPI tiles, the floor (`FloorCanvas`, T7/T8) and the six modules around
 * it (T9/T10, plus the chat slot T14 fills), in the design source's D-style
 * layout (`e-hybrid.html`): Active jobs and Chat on the left, the floor with
 * Stage events and Spend beneath it in the centre, Job detail and Fleet
 * status on the right.
 *
 * T15's three carried-over widgets (`SidebarWidgets`: System Health, Daily
 * Tasks, Money In) sit beside the floor in the left column, in the gap
 * between Active jobs and Chat (the empty space T11's 1920 shot left there
 * — the floor and every other module's size and position are unchanged).
 *
 * On a small laptop (Must 5) the six modules fold into one tabbed drawer on
 * the right (Job, Fleet, Jobs, Events, Spend, Chat; Job open by default), so
 * the floor keeps most of the screen; on a taller laptop the Job tab shows
 * Job detail and Fleet status together. The breakpoints are the mockup's own
 * media queries (see `dashboardLayout.ts`), applied in CSS so the first paint
 * is already the right layout. There is no seventh "Widgets" tab — the
 * mockup's own README notes a seventh label does not fit the 336px drawer at
 * 11px (it says this of a Schedule tab, T18; the same constraint applies
 * here) — so `SidebarWidgets` folds into the Job tab's scroll in the drawer
 * instead.
 *
 * `SidebarWidgets` is the one exception to "every module is always mounted,
 * CSS alone repositions it": its widgets carry `framer-motion` `layoutId`s
 * (from `WidgetFrame`, shared with `/classic`), and two live instances of
 * the same `layoutId` mounted at once (one merely `display:none`d by CSS)
 * fight over that shared layout tracking and never finish their entrance
 * animation — found by screenshot while building this ticket: the panel was
 * in the DOM but permanently `opacity:0`. So it is mounted in exactly one of
 * the two spots at a time, gated on `drawerMode` in JS rather than CSS.
 *
 * Clicking a General anywhere (its station or card on the floor, its Fleet
 * status row, an Active jobs row) zooms the floor onto it and opens its
 * detail (`GeneralDetailPanel`): over the right-hand column on the desktop
 * layout, in place of the drawer on a laptop. Esc, Back or a click on empty
 * floor closes it (Must 4).
 *
 * T18, Must 26: a transparent, keyboard-reachable button (`.fd-ring-hit`)
 * sits over the clock ring's extent (`FloorCanvas`'s `onRing`) and opens
 * `SchedulePanel` in that same spot, fed by the ring's own shared poll
 * (`onSchedule`). It shares `dashboardLayout.ts`'s single `OpenPanel` state
 * with a General's detail, so opening one always closes the other first —
 * the same swap as the mockup's `E.setFocus` override in `e-scene.js`'s
 * `EScene.schedule`.
 *
 * Colours are the mockup's emerald literals, never the theme variables
 * (Must 3d; T12 audits this).
 *
 * Not mounted at `/` yet: T22 swaps the route.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { TopBar } from '@/components/dashboard/TopBar';
import FloorCanvas from '@/components/floor/FloorCanvas';
import type { Box } from '@/components/floor/ringRender';
import { useDashboardStore } from '@/store/dashboardStore';
import type { FloorState, GeneralId, ScheduledJob } from '@/types/floor';

import ActiveJobsModule, { activeJobEntries } from './ActiveJobsModule';
import FleetStatusModule from './FleetStatusModule';
import GeneralDetailPanel from './GeneralDetailPanel';
import JobDetailModule from './JobDetailModule';
import KpiTiles from './KpiTiles';
import SchedulePanel from './SchedulePanel';
import SidebarWidgets from './SidebarWidgets';
import SpendByHourModule from './SpendByHourModule';
import StageEventsModule from './StageEventsModule';
import {
  COMPACT_QUERY, DRAWER_QUERY, DRAWER_TABS, DRAWER_TALL_QUERY, INITIAL_PANEL_STATE, panelReducer, useDashboardLayout,
} from './dashboardLayout';
import type { DrawerTab } from './dashboardLayout';

export interface FleetDashboardShellProps {
  /** Demo mode (T20): passed to every data source. */
  demo?: boolean;
  /** The chat widget (T14) for the Chat slot; a placeholder panel until then. */
  chatSlot?: ReactNode;
  /** Non-zero when a "Hey Sam" just arrived (T14, from FleetView): the small-laptop drawer switches to its Chat tab. */
  chatWake?: number;
}

/* ---------- layout CSS: e-hybrid.html's grid and media queries, scoped to .fd ---------- */

const PANEL_BG = 'linear-gradient(180deg,rgba(9,28,20,.82),rgba(5,17,12,.86))';
const PANEL_BORDER = 'rgba(61,255,90,.12)';

const CSS = `
.fd{position:relative;z-index:1;box-sizing:border-box;width:100%;height:100vh;height:100dvh;display:grid;
  grid-template-rows:auto 64px minmax(0,1fr);gap:14px;padding:14px 20px 20px;overflow:clip;color:#e8f7ee;
  background:radial-gradient(ellipse 80% 80% at 50% 35%,rgba(6,26,18,.86),rgba(2,7,5,.94))}
.fd *,.fd *::before,.fd *::after{box-sizing:border-box}
.fd-top{min-width:0}
.fd-top>header{margin:0;position:relative;top:auto}
.fd-tiles{min-height:0;min-width:0}
.fd-tiles>section{height:100%}
.fd-main{display:grid;grid-template-columns:340px minmax(0,1fr) 360px;gap:14px;min-height:0;min-width:0}
.fd-tabs{display:none}
.fd-col{display:flex;flex-direction:column;gap:14px;min-height:0;min-width:0;position:relative}
.fd-center{display:grid;grid-template-rows:minmax(0,1fr) 222px;gap:14px;min-height:0;min-width:0}
.fd-bottom{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;min-height:0}
.fd-p{display:flex;flex-direction:column;min-height:0;min-width:0;flex:0 1 auto}
.fd-p>section{flex:1 1 auto;min-height:0}
.fd-bottom>.fd-p{height:100%}
.fd-p[data-panel=chat]{margin-top:auto;flex:0 0 auto}
.fd-hero{position:relative;min-height:0;min-width:0;border-radius:12px;overflow:hidden;border:1px solid ${PANEL_BORDER};background:#020805}
.fd-col-r>.fd-p:not(.fd-focus){transition:opacity .4s}
.fd-focus{position:absolute;left:0;right:0;top:0;max-height:100%;overflow:auto;scrollbar-width:thin;z-index:8;opacity:0;
  transform:translateX(24px);pointer-events:none;transition:opacity .5s,transform .6s cubic-bezier(.2,.8,.2,1)}
.fd-main[data-open] .fd-focus{opacity:1;transform:none;pointer-events:auto}
.fd-main[data-open] .fd-col-r>.fd-p:not(.fd-focus){opacity:0;pointer-events:none}
.fd-chat-slot{border-radius:12px;border:1px solid ${PANEL_BORDER};background:${PANEL_BG};padding:12px 14px;min-height:150px;display:flex;flex-direction:column}
/* T18: a transparent, keyboard-reachable hit target over the clock ring (the mockup's .ring-hit) */
.fd-ring-hit{position:absolute;left:0;top:0;padding:0;margin:0;border:0;border-radius:50%;background:none;cursor:pointer}
.fd-ring-hit:focus-visible{outline:1px solid rgba(61,255,90,.34);outline-offset:-1px}
/* T15: SidebarWidgets folded into the drawer's Job tab (no seventh tab, per the mockup's own note on the 336px drawer); only mounted at all in the drawer (see the component's JS gate), so this is just its spacing, not a visibility toggle. */
.fd-drawer-sidebar{margin-top:10px}
@media ${COMPACT_QUERY}{
  .fd{grid-template-rows:auto 54px minmax(0,1fr);gap:10px;padding:10px 14px 14px}
  .fd-main{grid-template-columns:292px minmax(0,1fr) 318px;gap:10px}
  .fd-col,.fd-center{gap:10px}
  .fd-bottom{gap:10px;grid-template-columns:minmax(0,1fr) 280px}
  .fd-center{grid-template-rows:minmax(0,1fr) 176px}
  .fd-tiles>section{gap:10px}
  .fd-tiles>section>div{padding-top:6px;padding-bottom:6px;padding-left:12px;padding-right:12px}
  .fd-tiles>section>div b{font-size:17px}
  .fd-fx-name{font-size:22px}
}
@media ${DRAWER_QUERY}{
  .fd{grid-template-rows:auto 46px minmax(0,1fr);gap:8px;padding:8px 12px 12px}
  .fd-tiles>section{gap:8px}
  .fd-tiles>section>div{padding:4px 12px}
  .fd-tiles>section>div b{font-size:16px}
  .fd-main{grid-template-columns:minmax(0,1fr) 336px;grid-template-rows:auto minmax(0,1fr);gap:8px}
  .fd-col,.fd-center,.fd-bottom{display:contents}
  .fd-hero{grid-column:1;grid-row:1/3}
  .fd-tabs{display:flex;grid-column:2;grid-row:1;gap:2px;padding:3px;border-radius:10px;background:rgba(5,17,12,.86);border:1px solid ${PANEL_BORDER}}
  .fd-tabs button{flex:1;min-width:0;font-size:12px;font-weight:600;color:#98b6a6;background:none;border:0;border-radius:7px;padding:6px 0;cursor:pointer}
  .fd-tabs button:hover{color:#e8f7ee;background:rgba(157,255,112,.045)}
  .fd-tabs button[aria-selected=true]{color:#3dff5a;background:rgba(61,255,90,.085);box-shadow:inset 0 0 0 1px rgba(61,255,90,.34)}
  .fd-p{grid-column:2;grid-row:2;display:none;min-height:0;overflow:auto;margin:0;scrollbar-width:thin;opacity:1;transition:none}
  .fd-p[data-panel=chat]{margin:0}
  .fd-main:not([data-open])[data-tab=detail] .fd-p[data-panel=detail],
  .fd-main:not([data-open])[data-tab=fleet] .fd-p[data-panel=fleet],
  .fd-main:not([data-open])[data-tab=jobs] .fd-p[data-panel=jobs],
  .fd-main:not([data-open])[data-tab=events] .fd-p[data-panel=events],
  .fd-main:not([data-open])[data-tab=spend] .fd-p[data-panel=spend],
  .fd-main:not([data-open])[data-tab=chat] .fd-p[data-panel=chat]{display:flex}
  .fd-p[data-panel=detail]>section,.fd-p[data-panel=spend]>section{flex:0 0 auto}
  .fd-focus{position:relative;transform:none;max-height:none;display:none}
  .fd-main[data-open] .fd-focus{display:block}
}
@media ${DRAWER_TALL_QUERY}{
  .fd-main{grid-template-rows:auto auto minmax(0,1fr)}
  .fd-hero{grid-row:1/4}
  .fd-p{grid-row:2/4}
  /* The Job tab's own row is content-sized (auto) so Fleet keeps its row below; capped here so T15's folded-in widgets scroll inside the Job tab instead of growing the row past Fleet. */
  .fd-main:not([data-open])[data-tab=detail] .fd-p[data-panel=detail]{grid-row:2;max-height:320px;overflow:auto}
  .fd-main:not([data-open])[data-tab=detail] .fd-p[data-panel=fleet]{display:flex;grid-row:3}
  .fd-tabs [data-tab=fleet]{display:none}
}
@media (prefers-reduced-motion: reduce){.fd *{transition:none!important;animation:none!important}}
`;

export default function FleetDashboardShell({ demo = false, chatSlot, chatWake = 0 }: FleetDashboardShellProps) {
  const layout = useDashboardLayout();
  const [floor, setFloor] = useState<FloorState | null>(null);
  const [panel, dispatch] = useReducer(panelReducer, INITIAL_PANEL_STATE);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const openGeneral = panel.open?.kind === 'general' ? panel.open.id : null;
  const scheduleOpen = panel.open?.kind === 'schedule';

  /* T18: the clock ring's shared poll (`FloorCanvas`'s `onSchedule`) and its click target's box (`onRing`) */
  const [schedule, setSchedule] = useState<ScheduledJob[] | null>(null);
  const [ringBox, setRingBox] = useState<Box | null>(null);
  const onOpenSchedule = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    dispatch({ type: 'openSchedule' });
  }, []);

  /* the top bar's health chip reads the dashboard store, so keep it fed, as DashboardShell does */
  const bootstrap = useDashboardStore((s) => s.bootstrap);
  const startPolling = useDashboardStore((s) => s.startPolling);
  const stopPolling = useDashboardStore((s) => s.stopPolling);
  useEffect(() => {
    void bootstrap();
    startPolling();
    return () => stopPolling();
  }, [bootstrap, startPolling, stopPolling]);

  /* a "Hey Sam" brings the chat on screen; in the full layout it is always showing */
  const drawerMode = layout?.mode === 'drawer';
  useEffect(() => {
    if (chatWake && drawerMode) dispatch({ type: 'tab', tab: 'chat' });
  }, [chatWake, drawerMode]);

  /* Esc returns to the full floor (Must 4) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) dispatch({ type: 'close' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /*
   * Floor clicks. FloorCanvas calls onSelectGeneral during the canvas's own
   * click handler when a General is hit; the event then bubbles to the hero
   * wrapper, which closes the detail if nothing was hit (empty floor).
   */
  const hitThisClick = useRef(false);
  const onFloorGeneral = useCallback((id: GeneralId) => {
    hitThisClick.current = true;
    dispatch({ type: 'floorClick', hit: id });
  }, []);
  const onHeroClick = useCallback(() => {
    if (!hitThisClick.current) dispatch({ type: 'floorClick', hit: null });
    hitThisClick.current = false;
  }, []);
  const onSelectGeneral = useCallback((id: GeneralId) => dispatch({ type: 'openGeneral', id }), []);
  const onClose = useCallback(() => dispatch({ type: 'close' }), []);

  // Job detail follows the picked job while it is live, else the first live job
  const entries = activeJobEntries(floor);
  const jobId = selectedJobId && entries.some((e) => e.worker.jobId === selectedJobId)
    ? selectedJobId
    : entries[0]?.worker.jobId ?? null;

  const tab: DrawerTab = panel.tab;

  return (
    <div className="fd fleet-dashboard" data-layout={layout?.mode ?? undefined}>
      <style>{CSS}</style>

      <div className="fd-top">
        <TopBar />
      </div>

      <div className="fd-tiles">
        <KpiTiles state={floor} demo={demo} />
      </div>

      <div className="fd-main" data-tab={tab} data-open={panel.open ? panel.open.kind : undefined}>
        <nav className="fd-tabs" role="tablist" aria-label="Panels">
          {DRAWER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              aria-selected={tab === t.id}
              onClick={() => dispatch({ type: 'tab', tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="fd-col fd-col-l">
          <div className="fd-p" data-panel="jobs">
            <ActiveJobsModule
              state={floor}
              selectedJobId={jobId}
              onSelectJob={setSelectedJobId}
              onSelectGeneral={onSelectGeneral}
            />
          </div>
          {!drawerMode && (
            <div className="fd-p" data-panel="sidebar">
              <SidebarWidgets demo={demo} />
            </div>
          )}
          <div className="fd-p" data-panel="chat" data-slot="chat">
            {chatSlot ?? <ChatSlotPlaceholder />}
          </div>
        </div>

        <div className="fd-center">
          <div className="fd-hero" onClick={onHeroClick}>
            <FloorCanvas
              demo={demo}
              focus={openGeneral}
              variant={layout?.floorVariant ?? 'auto'}
              onSelectGeneral={onFloorGeneral}
              onState={setFloor}
              onSchedule={setSchedule}
              onRing={setRingBox}
            />
            {/* T18: a transparent, keyboard-reachable hit target over the ring (Must 26) */}
            {ringBox && (
              <button
                type="button"
                className="fd-ring-hit"
                aria-label="Schedule: scheduled jobs on the clock ring"
                aria-haspopup="dialog"
                aria-expanded={scheduleOpen}
                style={{ transform: `translate(${ringBox[0]}px,${ringBox[1]}px)`, width: ringBox[2], height: ringBox[3] }}
                onClick={onOpenSchedule}
              />
            )}
          </div>
          <div className="fd-bottom">
            <div className="fd-p" data-panel="events">
              <StageEventsModule state={floor} />
            </div>
            <div className="fd-p" data-panel="spend">
              <SpendByHourModule demo={demo} />
            </div>
          </div>
        </div>

        <div className="fd-col fd-col-r">
          <div className="fd-p" data-panel="detail">
            <JobDetailModule state={floor} selectedJobId={jobId} demo={demo} />
            {/* T15: no seventh drawer tab (mockup's own note) — folded into the Job tab's scroll here; beside the floor in fd-col-l instead outside the drawer (one mount at a time, see the module doc comment). */}
            {drawerMode && (
              <div className="fd-drawer-sidebar">
                <SidebarWidgets demo={demo} />
              </div>
            )}
          </div>
          <div className="fd-p" data-panel="fleet">
            <FleetStatusModule state={floor} selectedGeneral={openGeneral} onSelectGeneral={onSelectGeneral} />
          </div>
          <div className="fd-p fd-focus" data-panel="focus" aria-hidden={panel.open ? undefined : true}>
            {scheduleOpen ? (
              <SchedulePanel jobs={schedule} onClose={onClose} />
            ) : openGeneral ? (
              <GeneralDetailPanel general={openGeneral} state={floor} onClose={onClose} demo={demo} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Chat slot until T14's DashboardChatWidget fills it: a header only, no chat logic. */
function ChatSlotPlaceholder() {
  return (
    <section aria-label="Chat with SAM" className="fd-chat-slot">
      <header className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Chat with SAM
        </span>
      </header>
      <p className="mt-2 text-[11px]" style={{ color: '#5f7d6e' }}>
        Chat is on the Chat page for now.
      </p>
    </section>
  );
}
