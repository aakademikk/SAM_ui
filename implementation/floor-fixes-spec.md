# SAM_ui: floor follow-up fixes (tiles, accent, phone jobs, worker figures)

Status: LOCKED 2026-10-04 (Colin: "all approved apart from 3. I want a hide option too"). Every OPEN resolved: 1 by SAM, 2 to 9 by Colin (Must-dos 22 to 29, checks 27 to 33).

Grilled: 2026-10-04, SAM with Colin, after Colin's go-live read of the fleet dashboard. Colin's four decisions are carried below as locked (section 4). Base: branch `build/floor-fixes` at the live commit `55ac55e`.

## 1. Goal

The live fleet dashboard stops offering things that do nothing. System Health, Daily Tasks and Money In can really be moved, resized and taken full screen, on the desktop column, the laptop drawer and the phone. The accent Colin picks in Settings colours every page, not just `/classic`. On the phone, tapping a job shows that job. Clicking a worker figure on the floor opens its job, for SAM's own jobs as well as the Generals'.

## 2. Must do

**Tiles: System Health, Daily Tasks, Money In (Colin decision 1)**

1. On the new dashboard the three tiles can be reordered among themselves by dragging the grip (mouse or touch) or from the keyboard (focus the grip, Space, arrow keys, Space). They stay in their own group: they cannot be dropped among Active jobs, Chat or any other module.
2. Each tile can be resized to Small (today's footprint) or Tall (twice the height, same width). Wide and Large are not offered, because the side column is one column wide. Each size shows that widget's existing content for it, with no clipping or overlap.
3. Each tile has a "Full screen" action in its menu. Full screen fills the whole viewport, above the top bar, the phone tab bar and the Ask SAM bar. It has an "Exit full screen" button, and Esc exits. Focus returns to where it was. The page behind does not scroll. The tile keeps its live data and its own controls (adding a task, logging income).
4. The tile menu on the new dashboard offers only what works here: Small, Tall, Move up, Move down, Full screen, Hide, and Refresh now (Move up is absent on the first tile, Move down on the last). The four-size list is not shown on these three tiles. `/classic`'s menu is unchanged. (Amended after OPENs 4 and 9, Colin 2026-10-04.)
5. The new dashboard keeps its own order and sizes for these tiles, separate from `/classic`'s layout. Changing one never changes the other. A fresh profile starts in today's order (System Health, Daily Tasks, Money In), all Small, whatever `/classic` is set to. The choice survives a reload.
6. All of this holds in all three placements: the desktop side column, the laptop drawer's Job tab, and the phone stack under the job panel. Growing a tile never pushes Active jobs, Chat or the Ask SAM bar off screen, and never causes sideways overflow. The tile group scrolls inside itself when it is too tall.
7. On touch screens the grip and the options button are always visible (today they appear on hover only). On every screen the grip, the options button and the Exit full screen button are at least 44×44px, and no tile text is under 12px.
8. Demo mode still hides the three tiles. Turning demo on while a tile is full screen closes it.

**Accent (Colin decision 2)**

9. The accent chosen in Settings (or the gear's theme picker) applies on every page, including Chat, Status, Fleet, Operations, Terminal, Roleplay, Notifications, Settings, the home page's own chrome (Sidebar, tab bar) and `/classic`. A change shows at once, with no reload.
10. The fleet floor stays emerald whatever the accent: the floor canvas, the fleet modules, the fleet top bar and the particle field keep their emerald (visual-upgrade Must 3d). Nothing on the fleet surface turns the chosen colour.
11. The saved accent is applied before the first paint on every page, so a reload never shows Toxic first and then switches. A device with nothing saved shows Toxic, as today.
12. `/classic` behaves as it does today: its theme controls still work.

**Phone jobs (Colin decision 3)**

13. On the phone, tapping a row in Active jobs shows that job in the job panel (Job detail and its stage timeline). It does not open that General's sheet. The row shows as selected.
14. After the tap the job panel is on screen. If it was scrolled out of view, the page moves it into view (instantly under reduced motion).
15. Tapping a General's statue on the floor, or its row in Fleet status, still opens the General's sheet.
16. The picked job stays picked across polls while it is live. When it ends, the panel falls back to the first live job, as today.

**Worker figures (Colin decision 4)**

17. Clicking (PC) or tapping (phone) a worker figure of a live job selects that job, exactly as an Active jobs row does: Job detail shows it and its Active jobs row is marked selected. This covers SAM's own jobs and every General's. The pointer shows a hand over a figure on desktop.
18. A figure's hit area is at least 44×44px centred on its pad, including the phone's small figures. A figure wins over the General's column behind it. Elsewhere in that column a click still opens the General, and empty floor behaves as today.
19. After a figure is picked, Job detail is visible in every layout. A General's panel or the Schedule panel that was open over it is closed. In the laptop drawer the Job tab is shown. On the phone the job panel is brought into view (Must 14).
20. Keyboard users use the Active jobs list, which is already a Tab/Enter list of buttons with a selected state. That is the equivalent, and the canvas gets no new tab stops. On the phone it works as in Must 13.
21. Demo mode figures are selectable the same way.

**Decisions on the open questions (Colin, 2026-10-04: "all approved apart from 3. I want a hide option too")**

22. Hide (OPEN 4): Hide removes a tile from the new dashboard's tile group on this device. While at least one tile is hidden, a "Hidden tiles (n)" control sits at the end of the group; it lists each hidden tile with a Restore button, and Restore puts the tile back in its previous place and size. Hiding all three leaves only that control. Hidden state is per device and never touches `/classic` (Must 5). Hide and Restore controls are at least 44×44px.
23. Desktop Active jobs rows (OPEN 5): on every layout, clicking an Active jobs row shows that job in Job detail and does not open the General's panel; a General opens from its statue or its Fleet status row (as Must 13 and 15 on the phone).
24. Background intensity and grid overlay (OPEN 6): both settings apply on every page, as the accent does (Must 9 and 11), with the fleet surface keeping its own fixed look where visual-upgrade defines one.
25. Failed figures (OPEN 7): clicking or tapping a red figure of a recently failed job shows that job in Job detail (its failed state and last action), the same as a live figure (Must 17 to 19).
26. Theme contrast (OPEN 8): any of the six themes that fails text contrast (4.5:1 body, 3:1 large) or non-text contrast on any page is recoloured until it passes; no theme is removed from the picker.
27. Move up / Move down (OPEN 9): the tile menu's Move up and Move down move the tile one place and keep focus on the moved tile's menu button, as a one-tap alternative to dragging (Must 1).
28. Tile layout per device (OPEN 2): the tile order, sizes and hidden state are stored on each device only (local storage), with no server or `/api/dashboard/layout` change.
29. Accent on the page chrome (OPEN 3): the Sidebar, tab bar and other chrome on `/` follow the chosen accent; only the fleet surface (floor, fleet modules, fleet top bar, particle field) stays emerald. Visual-upgrade's "no purple on the Dashboard" is read as the fleet surface.

**Job status (Colin, 2026-10-04 "yes" to adding it to this build)**

30. A headless job is never filed as "killed" while its unit is still running. `JobManager.watchUnit` (`src/lib/server/jobs/manager.ts`) keeps watching when `unitState` returns `unknown` (a `systemctl` error or timeout); it finalises only when the unit reads `inactive` or `failed` (then the exit sentinel decides `exited` or `killed`), and the same rule applies in `reconcileOrphans`. Found 2026-10-04: after the 16:34 restart a running build was filed killed at 16:39 while its unit ran on.

## 3. Won't do

- No wide or large tiles, and no moving a tile out of its group or into the floor, Chat or other modules.
- Active Projects stays dropped.
- No change to `/classic`: its layout, menu, sizes or grid. No change to `StatCardGrid` or `WIDGET_REGISTRY` behaviour there.
- No change to the floor's colours, scene, or Generals' hit test beyond adding figures.
- No tab stops or focusable elements on the canvas for figures (Must 20).
- No new nav, boot screen, tab bar, Chat or Settings redesign.
- No deploy. Colin says go.

## 4. Constraints and locked decisions

- Tiles movable, resizable within the side column, full screen; menu offers only what works; `/classic` layout not silently changed; holds on desktop column, laptop drawer, phone stack. LOCKED, Colin 2026-10-04 (decision 1).
- Accent app-wide; fleet floor always emerald; no flash if avoidable. LOCKED, Colin 2026-10-04 (decision 2). Consistent with `implementation/visual-upgrade-spec.md` Must 3d, whose wording is "the floor, modules and background stay emerald"; the particle field already uses literal emerald (`VaultGraphVisualiser.tsx` state colours), and `.fleet-dashboard` in `src/app/globals.css` already pins the accent variables on the shell roots.
- Phone Active jobs row shows the job, General statue opens the General. LOCKED, Colin 2026-10-04 (decision 3).
- Figure click or tap selects its job, SAM's own included; keyboard equivalent stated. LOCKED, Colin 2026-10-04 (decision 4).
- Visual-upgrade Must 3b: the three tiles keep showing the same data as today (check 22 there), and demo mode shows none of it (Must 19). Both hold.
- Where the bugs live (found in the code, for the ticket writer): the tiles are pinned to Small outside the drag grid in `SidebarWidgets.tsx` while their menus write to the shared `dashboardLayout`; the accent is applied only by `DashboardShell.tsx` (mounted only on `/classic`) while `layout.tsx` hard-codes `data-ambient="toxic"`; the phone's Active jobs row calls both `onSelectJob` and `onSelectGeneral`; `FloorCanvas.tsx` hit-tests Generals only (`hitGeneral`).
- Known hazard from the T15 build, to honour: two live instances of a tile with the same `layoutId` (`WidgetFrame`) fight and one never finishes its entrance. Exactly one instance of each tile may be mounted at a time, including while full screen.
- Full-screen hazards: `.fd` clips overflow and some ancestors (`.fd-focus`, `.fd-p`) animate transforms or opacity, so a full-screen tile must still cover the whole viewport and sit above the app's tab bar (z-50).
- Esc already closes a General's panel (`FleetDashboardShell`) and a phone sheet. Esc in tile full screen exits full screen only.
- UX standard applies to everything new: 44px targets, no text under 12px, contrast, axe serious/critical zero (`UX_Design_Standards.md` §6; ux-fixes Must 20 to 23).
- Proof method: every UI check runs in a real browser against a local production build in the worktree on 127.0.0.1, ports 4900 to 4999, logged out where the page renders logged out, with the throwaway-passkey method of `~/delivery/ux-audits/sam-ui-20261003/audit-loggedin.mjs` where data is needed. Each check must fail on `55ac55e` and pass after. Logged-in local runs use the harness in OPEN 1 (resolved).
- The local build runs with the harness's isolated `HOME`, so it has its own auth store and never reads or writes the live `~/.sam/auth`. Throwaway devices are still revoked after each run.
- Figure checks need figure centres a browser test can read. The ticket provides a DOM-readable source for them (the clock ring's transparent button is the precedent). It must not add tab stops (Must 20).
- Build in the worktree only, never `~/SAM_ui`. Deploy only on Colin's go (a restart kills his in-flight chat turn).

## 5. Done means

All browser checks: local production build on 127.0.0.1:49xx, logged in via the throwaway passkey unless it says logged out, demo mode on for data-dependent tiles and jobs (deterministic), each failing on `55ac55e` and passing after.

1. (Must 1) At 1920×1080 and 1366×680, dragging Daily Tasks' grip above System Health with the mouse changes the DOM order of the three tiles; after a reload the new order holds. On `55ac55e` the order never changes.
2. (Must 1) Keyboard: focus Money In's grip, Space, ArrowUp, Space moves it up one place, at 1920×1080. A drop outside the group is refused.
3. (Must 1, 6) Touch at 412×915 and at 1280×650 (drawer): a touch-drag of a grip reorders the tiles, and the page still scrolls when dragging elsewhere.
4. (Must 2, 4) At 1920×1080, 1280×650 and 412×915, a tile's open menu lists exactly Small, Tall, Full screen and Refresh now. It has no Wide, Large or Hide.
5. (Must 2, 6) Choosing Tall makes the tile about twice the Small height (within 2px of two Smalls plus the gap), same width. Choosing Small restores it. Checked at the same three viewports for all three tiles, with no text clipped or overlapped.
6. (Must 3, 7) Full screen at 1920×1080 and 412×915: the tile box equals the viewport (±1px), `elementFromPoint` at the top bar and at the tab bar's position returns the tile, and `document.body` does not scroll. The Exit button and Esc each exit, and focus returns to the menu button. The tile's own control (add a task) still works in full screen.
7. (Must 5) Independence, both directions. (a) Resize and reorder on the new dashboard: the `dashboardLayout` stored in `sam.preferences.v1` is unchanged, no layout PATCH to `/api/dashboard/layout` is sent for it, and `/classic` shows its widgets in the sizes it had. (b) Change a size on `/classic`: the new dashboard's tiles do not change. On `55ac55e` (a) changes `/classic`'s saved sizes.
8. (Must 5) A fresh browser profile with `/classic` set to Large for all four shows the new dashboard's tiles in today's order, all Small (176px).
9. (Must 6) With all three tiles Tall at 1920×1080, 1366×680, 1280×650 and 412×915: no horizontal overflow (`scrollWidth ≤ clientWidth`), Active jobs and the Chat input stay reachable on screen (scrolled into view if needed), the Ask SAM bar is not covered, and the tile group scrolls inside itself.
10. (Must 7, whole) At 390×844 and 1920×1080 on `/`, with a tile's menu open and with a tile full screen: grip, options and exit buttons measure ≥44×44px, no text node is under 12px, and axe-core reports 0 serious/critical. On a touch context the grip and options button are visible without hover.
11. (Must 8) Demo on: the three tiles are absent. Demo off: they return in their saved order and size. Demo switched on while a tile is full screen closes it.
12. (Must 9) Logged out where the page renders, otherwise logged in: with `ambientTheme: 'ember'` saved in `sam.preferences.v1`, on Status, Chat, Settings, Fleet, Operations, Terminal, Notifications and `/classic`, `html[data-ambient]` is `ember` and `--sam-accent` computes to `#fb923c`. Repeat for plasma, ghost and emerald on Status. On `55ac55e` every page except `/classic` stays Toxic.
13. (Must 9) In Settings, clicking Ember changes `--sam-accent` with no reload, and the value is unchanged after navigating to Status.
14. (Must 10) With Ember saved, at 1920×1080 and 412×915 on `/`: the `.fd`/`.fp` root's `--sam-accent` computes to `#3dff5a`, and the floor, module and top-bar area has no ember or purple-hued pixels (the purple/violet pixel check of visual-upgrade check 14, extended to ember). With Plasma the same check passes, as in visual-upgrade check 24. The Sidebar and tab bar are outside this check (see OPEN 3).
15. (Must 11) With Ember saved, a reload on `/`, Status and Chat, observed from the first document frame, records the values of `html[data-ambient]` as `ember` only, never `toxic`, and 0 console errors or hydration warnings. With nothing saved the record is `toxic` only. On `55ac55e` the record starts with `toxic`.
16. (Must 12) `/classic`'s gear theme picker still changes the accent, and its widgets still render with no console errors.
17. (Must 13, 14) At 412×915 in demo mode, tapping a General's job row that is not the first live job: the job panel shows that job (its id and General), `[data-sheet=general]` is not open, the row is `aria-pressed`, and the job panel's box is inside the viewport after the tap. On `55ac55e` the General's sheet opens and the panel does not change.
18. (Must 15) At 412×915 a tap on a General's station away from any figure, and a tap on its Fleet status row, each open its sheet.
19. (Must 16) The picked job is still shown after two polls (at least 7s). When it ends, the panel shows the first live job.
20. (Must 17, 18) At 1920×1080 in demo mode, clicking a Generals' figure and then a SAM figure each shows that job in Job detail and marks its Active jobs row. A click up to 22px from a figure's centre selects it. A click on the same General's statue away from the figures opens the General. The pointer is a hand over a figure.
21. (Must 17, 18) The same at 412×915 with taps, using the tapped figure's job in the job panel.
22. (Must 19) At 1920×1080 with a General's panel open (and the Schedule panel open in a second run), clicking a figure closes it and Job detail is visible. At 1280×650 the drawer switches to its Job tab. At 412×915 the job panel is in the viewport.
23. (Must 20) At 412×915 with the keyboard only: Tab to an Active jobs row, Enter shows that job in the job panel and does not open a General's sheet. The canvas adds no tab stop (tab order is unchanged by the build).
24. (Must 21) Checks 20 and 21 run in demo mode with demo data only. A real dispatched job is covered by check 26.
25. (Whole) Unit tests for the new pure logic (the separate tile layout and its defaults and reconcile, the sheet and panel reducers' job selection, figure hit-testing and precedence) fail on `55ac55e` and pass after. Typecheck, lint, the full suite and `next build` pass. `/api/health` is ok. axe-core serious/critical is 0 on all 8 pages at 390×844, logged in and out, for Toxic (the standard) and for each of the six themes on Status and Settings.
26. (Whole) Colin confirms on his phone and laptop after deploy: tiles move, resize and go full screen; the accent follows; a phone row tap shows the job; clicking a worker figure on a real dispatched job shows it.
27. (Must 22) At 1920×1080 and 412×915: Hide on Daily Tasks removes it, "Hidden tiles (1)" appears and lists it; Restore puts it back in its old place and size; after a reload hidden state holds; `/classic` still shows Daily Tasks. Hiding all three leaves only the control. On `55ac55e` Hide changes `/classic` instead.
28. (Must 23) At 1920×1080 in demo mode, clicking a General's job row in Active jobs shows that job in Job detail and no General's panel opens. On `55ac55e` the General's panel opens.
29. (Must 24) With intensity set low and the grid overlay off in Settings, on Status, Chat and Settings the corresponding CSS variables (`--sam-bg-intensity`, `--sam-grid-alpha`) compute to the saved values, before first paint and after a change with no reload. On `55ac55e` they stay at the defaults off `/classic`.
30. (Must 25) In demo mode with a failed job on the floor, clicking its red figure shows that job, marked failed, in Job detail.
31. (Must 26) axe-core text contrast and the non-text contrast probe report zero failures on all 8 pages at 390×844 for every one of the six themes.
32. (Must 27) Move up on Money In moves it above Daily Tasks and keeps focus on its menu button; Move up is absent on the first tile and Move down on the last.
33. (Must 28) After reordering and resizing, `localStorage` holds the tile layout and no request is sent to `/api/dashboard/layout`.
34. (Must 30) Unit tests with a fake unit probe: a sequence `active, unknown, unknown, active, inactive` leaves the record `running` until the `inactive` reading and then finalises it from the sentinel; `unknown` alone never finalises; `reconcileOrphans` with `unknown` at boot keeps watching. Each fails on `55ac55e` and passes after.

## 6. Open questions

1. RESOLVED (SAM, 2026-10-04): use the ux-fixes build's local harness, now kept at `<harness>/` (`start.sh`, `stop.sh`, `proxy.mjs`, `lib.mjs`; set `SAMUI_WORKTREE` to the worktree to serve). The test browser maps the tailnet hostname to a local TLS proxy (`--host-resolver-rules`), so `RP_ID` needs no change, and the local server runs with an isolated `HOME` and its own auth store, so the live passkeys in `~/.sam/auth` are never touched. Proven on 2026-10-04 by the ux-fixes T24 to T26 checks.
2. RESOLVED (Colin, 2026-10-04): per device, local storage only. See Must 28.
3. RESOLVED (Colin, 2026-10-04): the page chrome follows the accent; only the fleet surface stays emerald. See Must 29.
4. RESOLVED (Colin, 2026-10-04): yes, a Hide option with a restore control. See Must 22.
5. RESOLVED (Colin, 2026-10-04): desktop rows just show the job. See Must 23.
6. RESOLVED (Colin, 2026-10-04): fix both in this change. See Must 24.
7. RESOLVED (Colin, 2026-10-04): yes, a failed figure shows its job. See Must 25.
8. RESOLVED (Colin, 2026-10-04): recolour the failing theme, never remove it. See Must 26.
9. RESOLVED (Colin, 2026-10-04): yes, Move up and Move down in the menu. See Must 27.
