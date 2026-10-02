# SAM_ui: visual upgrade (the fleet view)

Status: LOCKED 2026-10-02
Grilled: 2026-09-30, recorded in vault note `02 - Atwood Systems/00_SAM_Control/SAM_ui Visual Upgrade.md` (table "Grill, 2026-09-30").
Design source: the approved mockup, hybrid E with the polished clock ring, `/home/col/Atwood_demos/sam-ui-concepts/e-hybrid/` (README section "E: Hybrid").

## 1. Goal

The SAM_ui Dashboard, the app's home page, becomes the fleet floor: the real fleet at work (SAM at the top, the five Generals beneath, their workers spawning as jobs run, every stage lighting up as it happens), with a chat widget so Colin can talk to SAM without leaving it.
It is the centre of the app and Colin's everyday window on the fleet, and with demo mode on, a showpiece he can screen-share to a prospect without exposing anything private.

## 2. Must do

The view
1. The Dashboard (`/`, the home page, behind the existing sign-in) is replaced by the fleet view (Colin, 2026-10-01: "more dashboard, the central part of the app"). It looks and behaves like mockup E: the C floor with stations, pads and towers; D's layout with SAM at the top and the five Generals in a row; A's filament links and travelling lights; the emerald palette.
2. SAM is drawn as the Zeus bust. The five Generals are drawn as their busts: Cerberus, Hermes, Hephaestus, Calliope, Prometheus (gold flame).
3. Around the floor sit the mockup's modules: KPI tiles, Active jobs, Job detail, Fleet status, Stage events, Spend by hour, and a chat widget.
3a. The chat widget is a real SAM chat, not a link: Colin can type or speak to SAM and read the replies without leaving the Dashboard (Colin, 2026-10-01). Today's Dashboard already carries one (`ChatVoiceWidget`).
3b. Three of today's Dashboard widgets carry over as modules beside the floor (in the drawer on a small laptop, below the job in flight on the phone): System Health, Daily Tasks and Money In. Each shows the same data it shows today (Colin, 2026-10-01).
3c. Today's top bar stays on the new Dashboard: health score chip, sync badge, UTC clock and the settings gear (Colin, 2026-10-01).
3d. The Dashboard is always emerald. The gear's theme switch (Plasma, Ember and the rest) changes the other pages only; on the Dashboard the floor, modules and background stay emerald whichever theme is picked (Colin, 2026-10-01: "emerald").
3e. The widget opens on the most recently active chat, with a small picker to switch to another chat from the multi-chat list. "Hey Sam" and the hands-free loop on the Dashboard send to the widget's chat, in line with multi-chat Must 8 (the wake word sends to the chat on screen) (Colin, 2026-10-01).
4. Clicking a General (on the floor, its card, or its row in Fleet status or Active jobs) zooms in and opens its detail. Esc or Back returns.
5. On a small laptop (about 1200 to 1600 wide, or under about 800 tall) the modules fold into the tabbed drawer, as in the mockup, so the floor keeps most of the screen.
6. Reduced motion is honoured: no travelling lights, flares or bobbing; the floor shows the current state still.

The phone (Colin, 2026-10-01: full phone layout)
6a. On a phone the fleet view uses mockup E's phone layout (`e-hybrid/phone.html`): the floor hero with Zeus at the top and the five busts on the General row, then the job in flight with its stage timeline, Fleet, Active jobs and Spend, and a solid Ask SAM bar fixed at the bottom.
6b. Tapping a General opens the bottom sheet with its large bust and detail; swiping it down or tapping outside closes it.
6c. One link serves both: a phone (narrower than 820 px, or a touch screen under 560 px tall) gets the phone layout, a laptop or desktop gets the desktop layout, with no flash of the wrong one.
6d. Everything under Live data and Demo mode below applies on the phone the same as on desktop.

Live data (the honest view)
7. Every job in the job store that is queued or running appears under the General that owns it, as one worker figure on that General's pads. One figure per running job: two jobs under one General show as two figures. Sub-agents inside a job are not drawn (the job store can't see them) (Colin, 2026-10-01).
8. A job's stages light up in order as they actually happen, from real stage events, not a timeline guess.
9. When a job is dispatched, the dispatch pulse runs from SAM to the owning General and Zeus's lightning flares. It flares at no other time.
10. A General with no running job is idle: its bust at about 40% brightness, no workers, no traffic on its link. Working Generals are at full brightness.
11. When a job finishes, its proof returns to SAM in teal and, if it succeeded, a slab drops onto that General's tower. A failed job shows in status red.
12. Each tower holds one slab per job verified today.
13. Changes in the job store show on screen within 5 seconds, without a page reload.
14. Job detail shows the job's name, General, model tier, stages done out of stages planned, elapsed time and cost. No percentage bars.
15. Spend by hour and the KPI tiles use the same costing as the existing fleet spend scan, so the two can never disagree.

Stage events (change to the live dispatch tools)
Stage-event design agreed by Colin 2026-10-01 (Open question 2):
16. Every brief carries two lines: `General: <name>` (one of the five Generals, or `sam` for SAM's own work) and `Stages: <a>, <b>, ...` in planned order.
16a. `sam-dispatch` refuses a brief missing either line, or naming an unknown General, the same way it refuses a missing `Task type:` today. It copies the General and the planned stages into the job's `meta.json`.
16b. `sam-job` appends `dispatched`, `started` and `ended` (with exit code) to a new `events.jsonl` in the job's folder by itself.
16c. A new helper, `sam-stage start <stage>` / `sam-stage done <stage>`, lets the worker append stage events to the same file as it goes. It refuses a stage that isn't in the job's planned list.
16d. Each event line carries a timestamp, so the view can show when each stage started and ended.
16e. `sam-job` records where each job came from: `chat` (launched from a chat), `schedule` (launched by a systemd timer or cron) or `manual`. The view reads this field; it never patches the wording in.
17. A job with no General or no stage events (older jobs, or anything not launched through `sam-dispatch`) still appears, under SAM, with its start, running and end states only, and is never shown with invented stages.

Demo mode
18. A demo mode switch replays the mockup's three demo jobs on a loop, with no live data.
19. In demo mode, System Health, Daily Tasks and Money In show demo data or are hidden, the clock ring and Schedule panel show the mockup's made-up schedule (several real timer names carry client names), and no real client name, personal note, chat text, file path or cost from the live system appears anywhere on screen.
20. Demo mode is clearly marked on screen, so Colin can't mistake it for the live fleet.

Everything else
21. The other existing pages (Chat, Fleet, Status, Operations, Notifications and the rest) keep working as they do today.
22. The old Dashboard stays reachable at `/classic`, unchanged, until Colin signs off the new one; it is then deleted in a follow-up change (Colin, 2026-10-01). It is not in the nav.

Scheduled jobs: the clock ring (Colin passed the mockup 2026-10-02, then the polished version; design source `shots/e-ring2-*.png` and the README part "Scheduled jobs ring")
23. A 24-hour clock ring around Zeus's tier, as in the polished mockup (2026-10-02, `shots/e-ring2-*.png`), with a faint "now" hand. Jobs that run every few hours, daily, on weekdays or weekly get one tick each on the outer dial at their next run time; jobs that run hourly or more often sit as beads on a separate inner track, so busy hours never merge into one patch. Weekly and weekday-only jobs are drawn as diamonds, and any tick whose next run is more than 24 h away is dimmed. The dial carries 00, 06, 12 and 18, and the fleet key has a ring entry. Nothing of the ring sits under the SAM label.
24. When a scheduled job runs, its tick glows and a light runs round the ring; the tick stays lit while the job runs and settles when it ends.
25. A timer whose last run failed shows a red tick until its next successful run. Cron keeps no run record, so a cron entry shows its next run only, with last run "not recorded", never a guessed result.
26. Clicking (or tapping) the ring opens the Schedule panel: each job's name, its schedule in plain words, last run, last result and next run, sorted by next run. It opens where the General detail opens (the drawer's Schedule tab on a small laptop, the bottom sheet on the phone). Esc or Back closes it.
27. A scheduled job that launches a fleet job shows on the ring as the trigger only; the fleet job appears on the floor like any other, marked as coming from the schedule (Must 16e).
28. Ring changes show within 5 seconds, like the floor (Must 13).

## 3. Won't do

- No restyle of the other pages. Only the Dashboard changes; Chat, Fleet, Status and the rest keep their current look.
- No public URL or public demo page. It stays behind SAM_ui's sign-in.
- No WebGL or 3D. The 2D canvas approach of the mockup stays.
- No new bust artwork. The six approved cards in `assets/busts/` are used as they are.
- No B (Orchestration Board) elements.
- No purple or violet anywhere on the Dashboard. (Other pages keep whatever theme Colin picks.)
- No control of jobs from the view (no cancel, retry or dispatch buttons). It shows the fleet; it does not drive it.
- No change to how `sam-dispatch` picks a model or seat, or to its routing guard.
- The Active Projects widget is dropped from the Dashboard (Colin, 2026-10-01).
- No redesign of the approved phone layout. The phone's canvas labels stay as in the mockup.

## 4. Constraints and locked decisions

- Hybrid E: C base, D layout with SAM at the top, A's pulsing links, B out, SAM's emerald (#3dff5a, #9dff70, #10b981, #065f46, teal #2dd4bf as the only secondary). LOCKED by Colin 2026-09-30. Source: `[[SAM_ui Visual Upgrade]]`.
- Busts: Zeus replaces SAM's diamond; his lightning flares on each dispatch; Generals rise off their platforms, about 40% when idle and full when working; small on cards, large in the zoom panel; flat images drawn with a light/screen blend. Colin, 2026-09-30 23:30. Prometheus keeps the gold flame (Colin, 23:20), the one deliberate non-green accent. Source: `[[job-sam-ui-hybrid-20260930]]`.
- Real stage events, not a faked timeline (grill Q1). Changing `sam-dispatch`/`sam-job` is a change to live tools: it needs Colin's double-confirm and ships with a test that fails before and passes after. Source: `[[SAM_ui Visual Upgrade]]`, CLAUDE.md rules.
- Honest live view for Colin, demo mode for clients (grill Q2). Shown on Colin's laptop or screen-share (grill Q3).
- The SAM_ui repo is public. No client names, personal content or secrets in source, fixtures or demo data.
- Colin's laptop and phone looks of E PASSED on 2026-10-01; the 1920 layout is the recorded baseline (`shots/e-fit-1920-before.json`).
- The existing `sam-dispatch` tests (`~/.sam/tests/test-dispatch-routing.sh`) and the 20:25 delegation check (`~/.sam/delegation-check.sh`) keep passing; the dispatch log format is not broken.
- Once `sam-dispatch` refuses briefs without `General:` and `Stages:`, any brief or waiter script that dispatches must already carry them, or queued and overnight jobs will fail to launch. The change ships with every live caller updated in the same pass (2026-10-01: the multi-chat briefs in `~/.sam/briefs/` call it from inside their jobs).
- Budget: the main-seat $100 cloud credit (expires 5 Nov 2026) for the build. Source: `[[SAM_ui Visual Upgrade]]`.
- Every `./deploy.sh` or sam-ui restart kills Colin's in-flight chat turn: warn him before each deploy.

## 5. Done means

1. (Must 1, 2, 3) Screenshots of the live view at 1920x1080, 1536x730, 1366x680 and 1280x650 compared side by side with the mockup E shots: same layout, palette and busts. Colin confirms on his laptop.
2. (Must 1, 5) The mockup's fit checks pass on the live view at the same four sizes: no card overlaps, no label overlaps, nothing cut off, no sideways overflow, floor at least 45% of the screen at laptop sizes, no text under 11 px.
3. (Must 2) The bust checks pass: all six images load and draw, Zeus is at the SAM node, no diamond, an idle General is dimmer than a working one.
4. (Must 4) A browser test clicks a General, sees its detail, presses Esc and is back at the full floor.
5. (Must 6) With reduced motion forced, no travelling lights or flares are drawn and 0 console errors.
6. (Must 7, 8, 10, 13) A test job dispatched through `sam-dispatch` with three stages appears under its named General within 5 s; each stage lights in order within 5 s of its event; the other four Generals stay idle.
7. (Must 9) During that test, Zeus flares once, at the dispatch, and not otherwise.
8. (Must 11, 12) The test job ending with exit 0 adds one slab to its General's tower and shows the teal return; a second test job ending non-zero shows red and adds no slab.
9. (Must 14, 15) Job detail for the test job shows General, tier, stages done/planned, elapsed and cost; the cost matches `/api/fleet/spend` and `/api/fleet/jobs` for the same job.
10. (Must 16 to 16d) New tests for `sam-dispatch`, `sam-job` and `sam-stage`, run against test seams (never the live job store): a brief without `General:` or `Stages:` is refused; an unknown General is refused; a good brief writes both into `meta.json`; a job's `events.jsonl` holds dispatched, started, each stage start and done in order, and ended with its exit code; `sam-stage` refuses an unplanned stage. They fail on the current tools and pass after the change. The existing `sam-dispatch` tests still pass.
11. (Must 17) An old job from the store with no General or stage events shows under SAM with start, running and end only, and no stage pads lit.
12. (Must 18, 20) Demo mode plays the three demo jobs on a loop with a visible "Demo" marker.
13. (Must 19) An automated check scans the demo-mode page text and the demo data for every client name in the vault's `02 - Atwood Systems/10_Clients/` folder and for any path under the home folder: 0 hits. The same check run against the live view finds at least one, proving it can fail.
14. (Must 1 to 20) 0 console errors and no failed network requests on the live view and demo mode; no purple or violet pixels in ten rendered states (the mockup's pixel check).
15. (Must 1) Frame rate at 1440x900 and 1280x650 within 5 fps of the mockup E page measured in the same run.
16. (Must 21) Typecheck, lint, the full test suite and `next build` pass; every existing page still loads after deploy; `/api/health` is ok.
17. (Must 1, 3, 9, 10) Colin watches a real dispatch on the live view on his laptop and confirms it reads right.
18. (Must 6a, 6c) The fit checks pass at 412x915 and 390x844: no overlaps, no sideways overflow, Ask SAM bar solid with nothing showing through. Opening the view at 412x915 lands on the phone layout; at 1920 on the desktop layout.
19. (Must 6b) A browser test at 412x915 taps a General, sees its sheet with the large bust, and closes it.
20. (Must 6d) Checks 6, 7 and 13 also pass at 412x915.
21. (Must 6a to 6d) Colin opens the view in the SAM app on the A16, watches a real dispatch and confirms it runs smoothly and reads right. This passes before the new Dashboard goes live, because it is now the home page.
22. (Must 3b) System Health, Daily Tasks and Money In on the new Dashboard show the same values as their APIs return, checked against the old widgets on the same data.
23. (Must 19, 3b) The demo-mode scan in check 13 also covers those three modules: no live tasks, amounts or health details on screen.
24. (Must 3d) With the theme set to Plasma, then Ember, the Dashboard passes the purple/violet pixel check (check 14) and shows the same emerald as with the default theme; another page (for example Status) does change theme.
25. (Must 22) After deploy, `/classic` loads the old Dashboard with its four widgets and no console errors, and no nav item links to it.
26. (Must 3a, 3e) On the Dashboard, the widget shows the most recent chat's history; a message sent from it appears in that chat on the Chat page; picking another chat switches the widget; a "Hey Sam" with the Dashboard on screen lands in the widget's chat (checked on the A16).
27. (Must 23, 24, 25, 28) Against a test fixture of timers and cron entries: the tick count equals timers plus cron entries; a test timer fired by hand lights its tick within 5 s; a test timer whose service exits non-zero turns red and back to green after a good run; a cron entry shows "not recorded".
28. (Must 26) A real click on the ring at 1920x1080 and 1280x650, and a tap at 412x915, opens the Schedule panel listing every job in next-run order; Esc and Back close it.
29. (Must 27, 16e) A test timer that runs `sam-dispatch` fires its tick, and the job appears on the floor under its General with origin `schedule`; the ring draws no worker for it.
30. (Must 19) The demo-mode scan in check 13 covers the ring and Schedule panel: 0 real timer or cron names.
31. (Must 23) The ring keeps the polished mockup's results: ring width and mark spacing (at least 8 px apart at 1920, 6 px at laptop and phone sizes), numerals at least 11 px at laptop sizes and 1920 without overlaps, weekly ticks in the diamond shape, ticks over 24 h away dimmer, no ring pixel inside the SAM label box; no recorded 1920 box moves more than 2 px apart from the SAM label and fleet key; fps at 1440x900 and 1280x650 within 5 of the floor without the ring.

32. (Must 3c) On the new Dashboard at 1920x1080, 1280x650 and 412x915, the top bar shows the health score chip, sync badge, UTC clock and settings gear, and the gear opens. (Added 2026-10-02 after the lock: Must 3c had no check; no decision changed.)

## 6. Open questions

1. ANSWERED 2026-10-01 (Colin): phone gets E's full phone layout. Now Must 6a to 6d.
2. ANSWERED 2026-10-01 (Colin: "that's good"): `General:` and `Stages:` lines in the brief, enforced by `sam-dispatch`; `events.jsonl` per job written by `sam-job` and the new `sam-stage` helper. Now Must 16 to 16d. The design is agreed; the actual edit to the live tools still needs Colin's double-confirm when its ticket is built.
3. ANSWERED 2026-10-01 (Colin): it becomes the Dashboard, the central part of the app, with a chat widget. Now Must 1 and 3a. This overrides the vault note's earlier plan of a new page beside the current UI.
3b. ANSWERED 2026-10-01 (Colin): keep System Health, Daily Tasks and Money In (Must 3b); drop Active Projects. (SAM's earlier "stat cards" was a mislabel: `StatCardGrid` is only the grid that holds the four widgets, not a separate feature.)
3b-ii. ANSWERED 2026-10-01 (Colin): keep the top bar (Must 3c).
3b-iii. ANSWERED 2026-10-01 (Colin: "emerald"): the Dashboard stays emerald whatever the theme; the theme switch only changes the other pages (Must 3d).
3c. ANSWERED 2026-10-01 (Colin: "y"): old Dashboard kept at `/classic` until sign-off, then deleted (Must 22).
4. ANSWERED 2026-10-01 (Colin): a real chat widget (Must 3a), on the most recent chat with a picker, "Hey Sam" goes to it (Must 3e).
5. ANSWERED 2026-10-01 (Colin): one worker figure per running job (Must 7).
6. ANSWERED 2026-10-02 (Colin looked at the ring mockup on his devices: "its good"). Now Must 16e and 23 to 28, checks 27 to 31. SAM's proof check of the mockup job: own re-run of `node src/audit.js e` PASS (ring checks failed 12 times on the pre-ring build), A to D checksums unchanged, shots viewed. Known limits carried from the mockup README: the ring is small and frequent jobs merge near the hand; it has no numerals; weekly jobs are not set apart on the dial.
