# Completed-jobs lists: build report

## Browser checks, desktop and laptop (T14)

Run 2026-10-24 against build/completed-jobs at 875b585 (served build reports gitSHA 875b585), fresh `npx next build` (clean, 6 lint warnings, the baseline ones). Local proof harness on 127.0.0.1:4950 (TLS proxy 4951), throwaway passkey enrolled and revoked each run. Two data sources: demo (the Demo toggle) and a T13 fixture store (`make-fixture-store.cjs --chat 50 --jobs 40`, 34 finished, 30 counted). Scripts and raw JSON: /tmp/t14-proof/ (t14.mjs, t14b.mjs, detail-probe.mjs; demo.jsonl, demo-b-run1.jsonl, demo-b.jsonl, fixture.jsonl, fixture-b.jsonl). Screenshots: /home/col/SAM_ui-completed-jobs/implementation/shots/ (t14-demo-* and t14-fixture-*, not committed).

Results:

- Check 12: PASS. Column 1920x1080 and 1680x1050 (also 1601x801), drawer 1440x900 (and 1500x900): "Finished jobs" sits directly under Fleet status (previous sibling is Fleet status, inside .fd-col-r in the column; in the Job tab under Fleet status in the drawer), 10 rows, newest first (demo: the 10 ids match the fixture order bakery-quote-form, morning-briefing, headers-check, hermes-openers, app-ad-set, model-benchmark, plumber-lighthouse, store-tidy, inbox-triage, dependency-audit, and the API's endedAt is strictly descending; fixture: rows equal the API order, endedAt descending). Every row (12 renders x 10 rows) shows name, General (or SAM), finish time (HH:MM, with DD MMM on older days) and outcome or verdict, "not checked" exactly when there is no verdict. Clicking the third row lands on its URL: demo /jobs/demo-fin-headers-check (the page shows "No jobs yet.", expected for a demo id), fixture /jobs/job_copperline-hero-3d_20261024-091434 (the job page: "Back, bash ~/.sam/jobs/job_copperline-hero-3d_20261024-091434/cmd.sh, exited (0), (no output)"). Same result at every size.
- Check 13: PASS at the column sizes. Job detail / Fleet status, list shown against list hidden: 1920x1080 166.5/232.5 against 166.5/232.5; 1680x1050 166.5/232.5 against 166.5/232.5; 1601x801 166.4/232.4 against 166.5/232.5 (0.1 px). Identical in demo and fixture. Rows fully in view in the list: 7, 7, 3 (1601x801 holds exactly the three-row floor; list 218.3 px). The 10-row list scrolls inside itself (panel scrollHeight 606 against clientHeight 461 / 467 / 218; the mouse wheel moved its scrollTop 144 / 138 / 387 px, the last row then fully visible) with no page scroll (document scrollHeight equals viewport height, scrollY 0) and no overlap (gaps Job detail to Fleet status to list 14/14 px at 1920x1080, 10/10 px at the others; list bottom 1060 / 1036 / 787 equals the column bottom, inside the viewport). Job detail is not clipped in the column (scrollHeight equals clientHeight, list shown and hidden). No size found where Job detail or Fleet status shrink. Drawer 1440x900 (information): Job detail 176.5 px demo, 320 px fixture, Fleet status 232.5 px, the same with the list hidden; the list starts below them and is reached by scrolling the tab (rows in view before scrolling 4 demo, 1 fixture; after 9 and 6, last row reachable).
- Check 14: PASS. 1366x768 and 1280x720 (drawer, Fleet tab): the list sits directly under Fleet status (Fleet status 182 to 414.5, list from 422.5), tabs Job, Fleet, Jobs, Events, Spend, Chat (six, unchanged; the shell diff against bf0efc6 touches no tab), list reachable by scrolling the tab (wrapper scrollTop 272 / 320 px, last row fully visible and on top, no page scroll). 1500x900 and 1440x900 (taller drawer, Job tab): Job detail, Fleet status, then the list; tabs the same six with Fleet hidden as before; tab scrolls 324 px (demo) to the last row, no page scroll.
- Check 15: PASS at 1920x1080 and 1440x900 (all seven sizes measured the same). Rows 54.3 px tall (li 54.3 to 55.3 px), General-panel rows 50.4 px; text sizes in the list 12, 12.5 and 13 px, none below 12. Contrast: axe-core 4.13.0 via @axe-core/playwright (the harness's AxeBuilder, /home/col/delivery/ux-gate/probe/node_modules), rule color-contrast, scoped to [data-finished-jobs]. Plain run: 0 violations but 0 passes, all 46 nodes incomplete (bgGradient: the panel background is a gradient, so axe judged nothing). With each gradient on the list's ancestors replaced by its lightest stop, then its darkest stop, and the list scrolled to its end: 0 violations, 46 of 46 nodes passed (demo), 50 of 50 (fixture), lowest ratio 6.21:1 (lightest stops) and 6.81:1 (darkest). An independent gradient-aware DOM probe gave 0 of 46 below 4.5:1, lowest 5.32:1 (a FAIL pill under the mouse's hover tint).
- Check 16: PASS at 1920x1080 and 1440x900, demo and fixture. A click on each General's statue on the floor opens its panel (all five reached). "Last 5 finished" shows 5 rows for every General in demo, and 5/5/5/3/3 in the fixture (cerberus and prometheus hold 3 counted finished jobs there), same row format as the fleet list (name, General, time, outcome or verdict, "not checked"), rows reaching back to 20 Oct. Running and Verified present with the unchanged value logic; Workers now present whenever the General has workers (Calliope, Cerberus, Prometheus in demo, all five in the fixture); Spend today and Earlier today absent everywhere. Screenshots t14-*-general-<id>.png.
- Check 18 (desktop): PASS. `node scripts/run-tests.cjs .test-build/components/floor/floorGolden.test.js` after `npx tsc -p tsconfig.test.json`: 7 of 7 pass (desktop 1150x666, 1600x760, laptop 1166x596, 996x546, 910x516, 800x500, determinism). `git diff bf0efc6 --stat -- src/components/floor` prints nothing; `git diff bf0efc6 -- src/components/floor/floorGolden.test.ts` is empty.

Adaptations (foreman decisions):

- The spec names 1440x900 as a column (three-column desktop) size; it is a drawer size (LAPTOP_QUERY is 820 to 1600 wide, taller drawer). The column exists only above 1600 px wide and 800 px tall, so checks 12, 13 and 15's column measurements ran at 1920x1080, 1680x1050 and 1601x801, and 1440x900 was run as the drawer equivalent (Job tab: Job detail, Fleet status, then the list, reached by scrolling the tab).
- bf0efc6 read for e20d7ca throughout. `git diff 789589e -- src/components/floor/floorGolden.test.ts` (the ticket's base) is not empty: 130 added lines, all from production commit bd96059 (usage-limits tile and phone pyramid), which bf0efc6 already contains; the build adds nothing.
- "Before" heights measured on this build with `[data-panel=finished]{display:none!important}` injected, as the ticket says, not on a second server. In the column the build changes no rule for Job detail or Fleet status (only a display:contents wrapper), so these stand for production there.
- Demo switched on with the toggle (openHome demo:true), not ?demo=1. The fixture run used the same harness with HARNESS_HOME pointed at /tmp/t14-proof/fxhome (start.sh's own variable), its .sam/auth linked to the harness's auth store so the existing enrolment works, and XDG_RUNTIME_DIR / DBUS_SESSION_BUS_ADDRESS dropped as run-fixture-server.cjs does. No harness or repo file changed.
- Phone sizes (412x915, 390x844) and P1 to P9 are not part of this ticket.

Surprises and notes (none is a failure of this build):

- Drawers, T9 decision: Fleet status now takes its natural height, 232.5 px, with the list shown or hidden. In production it filled its grid cell, which is now the wrapper: 521.5 px demo / 378 px fixture at 1440x900 and 1500x900, 574 px at 1366x768, 526 px at 1280x720. Job detail is unchanged by the list in every drawer.
- Job detail with the fixture store is 320 px at 1440x900 (max-height 320 px; it holds the sidebar tiles, System Health first, and scrolls inside), against 176.5 px in demo; the same with the list hidden. In the column it is 166.5 px in both. The fixture holds no job tickets, so the taller job ticket panel case was not exercised here.
- At 1440x900 with the fixture store only one list row is in view before the tab is scrolled, and once scrolled the rows clip directly under Job detail's System Health tile (the wrapper's top edge, 8 px below Job detail; no overlap). A readability note for Colin's review, not a measured fault.
- The General panel's stat row is now two columns (grid-cols-2) instead of three, so Running and Verified are wider; labels and values unchanged.
- Pre-existing, not from this build: in demo, Calliope's panel can read "Idle. No workers running." while Running shows 1 and Workers now lists a queued job (queued workers count in Running). summariseGeneral's worker logic and FleetStatusModule are unchanged from production.
- Plain axe could not judge the list (bgGradient on every node); the pass above rests on the gradient-flattened axe runs and the DOM probe, both stated.

## Browser checks, phone (T15)

Run 2026-10-24 (about 13:00 to 13:20 UTC) against build/completed-jobs at 47f3fbe (served build reports gitSHA 47f3fbe; src identical to 875b585, the T14 build, which only added the report). The build from T14 was current (no src file newer than .next/BUILD_ID iwBUdawx0QikEMGkiAoeK), so it was served without a rebuild. Local proof harness on 127.0.0.1:4950 (TLS proxy 4951), touch contexts from floor-fixes-proofs/common.mjs (touchContext, isMobile, hasTouch, service workers blocked as t22-pyramid.mjs does), throwaway passkey enrolled and revoked every run. Two data sources: demo (the Demo toggle, openHome demo:true) and the T14 fixture store (a copy of /tmp/t14-proof/fxhome at /tmp/t15-proof/fxhome, served with HARNESS_HOME pointed at it, .sam/auth linked to the harness auth store, XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS dropped, as T14 did). Every check below ran on both sources. Taps are real touchscreen taps at the element's centre, after checking the centre point is the element (not the Ask SAM bar or a top bar). Scripts and raw JSON: /tmp/t15-proof/ (t15.mjs, sheetscroll.mjs, navcover.mjs, cerberus-strip.mjs; demo.jsonl, fixture.jsonl, navcover-demo.out, navcover-fixture.out, unit.log; pyramid/ holds the pyramid rig copy and its output). Screenshots: /home/col/SAM_ui-completed-jobs/implementation/shots/t15-* (not committed).

Results:

- Check 22: PASS for the list at 412x915 and 390x844, demo and fixture. "Finished jobs" sits directly under Fleet status (its previous sibling is [data-panel=fleet]; phone stack order detail, below-job, fleet, finished, events, jobs, spend; 12 px gap; Fleet status 219.4 px, list 560.1 px, both scroll with the page, no horizontal scroll: scrollWidth equals width). 10 rows, the same 10 ids in the same order at both sizes and equal to /api/fleet/finished-jobs, endedAt newest first. Every row (4 renders x 10) has name, General ("SAM" for SAM's jobs), UTC time HH:MM matching its own endedAt (with DD MMM on other days, none on today), the outcome or the closer verdict word for word, the job's own outcome in small text when it disagrees ("FAIL: tests Job: Passed", "PASS (5/5 checks) Job: Failed"), and "not checked" exactly when there is no verdict. Tapping the third row lands on its page at both sizes: demo /jobs/demo-fin-headers-check (page shows "No jobs yet.", expected for a demo id), fixture /jobs/job_copperline-hero-3d_20261024-091434 (the job page: "Back, bash ~/.sam/jobs/job_copperline-hero-3d_20261024-091434/cmd.sh, exited (0), (no output)"). The check's last clause (phone pyramid P1 to P9 unchanged) is the check 18 run below. Shots t15-{demo,fixture}-{412x915,390x844}-{fleet-and-finished,finished,full,row-tap}.png.
- Check 15 (phone): PASS at 412x915 (390x844 measured the same). Rows 50.4 px tall (li 50.4 px; min and max 50.4) in the list and in every General sheet; text sizes in the list 12, 12.5 and 13 px, none below 12. Contrast: axe-core 4.13.0 (@axe-core/playwright, the harness AxeBuilder), rule color-contrast, scoped to [data-finished-jobs], list scrolled to the top of the screen and again with its end in view. Plain run: 0 violations, 0 passes, all nodes incomplete (bgGradient: 46 demo, 50 fixture), the same as T14, so plain axe judged nothing. T14 gradient workaround: each gradient on the list's ancestors replaced by its lightest stop, then its darkest: 0 violations, 46 of 46 nodes passed (demo), 50 of 50 (fixture), lowest ratio 6.33:1 (lightest stops) and 6.76:1 (darkest). The T14 gradient-aware DOM probe: 0 of 46 / 0 of 50 below 4.5:1, lowest 6.29:1 (the FAIL and Failed pills, 12.5 px).
- Check 16 (phone): FAIL at 412x915 (and 390x844), demo and fixture: a defect, the bottom navigation bar covers the last finished row of every General's sheet. A tap on each General's bust (touch, on the canvas, all five reached) opens the sheet. The parts that hold: "Last 5 finished" shows 5 rows for every General in demo and 5/5/5/3/3 in the fixture (cerberus and prometheus hold 3 counted finished jobs there), same format as the fleet list and equal to /api/fleet/finished-jobs?general=<id> (ids, order, outcome or verdict, "not checked", time against the row's own endedAt), rows reaching back to 20 Oct. Running and Verified present (demo, for example, Calliope "RUNNING 1 VERIFIED 0", Cerberus "RUNNING 0 VERIFIED 4"; fixture Hephaestus "RUNNING 4 VERIFIED 2"); Workers now present whenever the General has workers (Calliope and Prometheus in demo, all five in the fixture); Spend today and Earlier today absent in all ten sheets. The sheet is capped at 78% of the screen (max-height 713.7 px = 0.78 x 915, overflow auto): sheets with more content sit at 713.7 px (frac 0.7800) and scroll inside themselves under a real touch drag, to the end with the last row inside the sheet box (demo Calliope and Prometheus scrollTop 49 of 762/713; fixture Hermes 106, Hephaestus 134, Calliope 106, Cerberus 31, Prometheus 3) while the page stays at scrollY 0; shorter sheets (698.8 px) need no scroll. The defect: the phone's fixed bottom nav (NAV.md:hidden fixed bottom-0, z-index 50) lies over the sheet (z-index 20, bottom padding 26 px), top edge at y 859 at 412x915 and y 788 at 390x844. With the sheet scrolled as far as it goes, the last row spans y 838.5 to 889.5 (412x915) and 766.9 to 817.9 (390x844), so about 30 of its 50.4 px are under the bar: elementFromPoint on its second line (General, outcome, "not checked") returns the nav's icon, in 20 of 20 sheets measured (5 Generals x 2 sizes x 2 sources). Only the name line (about 20 px) can be seen or tapped, and no scroll position reveals the outcome. Every other row is clear. Shots t15-{demo,fixture}-412x915-sheet-<id>.png, -sheet-<id>-scrolled.png, and the defect t15-{demo,fixture}-{412x915,390x844}-sheet-{cerberus,hephaestus}-end-navbar.png.
- Check 17: PASS at 412x915, demo and fixture. In Hephaestus's sheet (5 rows) a touch tap on the second row (centre point on the row, checked) opens its page: demo /jobs/demo-fin-plumber-lighthouse, fixture /jobs/job_copperline-hero-3d_20261024-091434 (the job page as above). Shots t15-{demo,fixture}-412x915-sheet-before-row-tap.png and -sheet-row-tap.png. The covered fifth row (check 16) was not tap-tested.
- Check 18 (phone): FAIL as written: one browser check of the pyramid proof (pyramid check 12, P5) fails on its pixel test, in two runs out of two; every other P check passes. Unit (automated) half: `npx tsc -p tsconfig.test.json` then `node scripts/run-tests.cjs` over the eight src/components/floor tests: 84 of 84 pass, 0 fail: phonePyramid 11/11 (P1, P2, P3, P4, P5, P6 twice, P7, P8, P9 named tests all ok), ringRender 20/20, floorGolden 7/7, floorRender 13/13, floorRender.tickets 5/5, figureHit 8/8, busts 11/11, floorPacing 9/9. src/components/floor is unchanged against bf0efc6 (`git diff bf0efc6 --stat -- src` lists no floor file). Browser half: the pyramid tickets' T23 proof, /home/col/delivery/ux-audits/usage-pyramid-proofs/t22-pyramid.mjs with common.mjs and run-proof.sh, copied to /tmp/t15-proof/pyramid/ and run as `NOBUILD=1 bash run-proof.sh after t22-pyramid.mjs`. Changes, worktree paths only: REPO_TSC to this worktree's tsc, the `after` SAMUI_WORKTREE to /home/col/SAM_ui-completed-jobs, and the proofs dir P to the /tmp copy so results do not overwrite the October results; common.mjs byte-identical. Results (run 1 and run 2 identical): CHECK 8 (P1) PASS, two rows, Cerberus and Prometheus at bust y 346.4 over Hermes, Hephaestus, Calliope at 602.2; CHECK 9 (P2) PASS, busts 58 px each (need 57.5), samK 1.15; CHECK 12 (P5) FAIL; CHECK TAPS PASS, 10 of 10 label and platform taps open the tapped General; CHECK 15 (P8) PASS, figures for cerberus (back row) and two hephaestus (front row) between the top bar (66) and the Ask SAM bar (797), no clashes; CHECK 16 (P9) PASS, 390x371 two rows, least edge gap 28.3 px, no overlaps, samK 0.6, no horizontal scroll; CHECK REVOKE PASS. The check 12 failure: every General is framed whole (platform, bust and label inside the canvas by 101.5 px for all five, zoom x1.90, the sheet names the tapped General), but for Cerberus the canvas's top 3 px strip holds 13 emerald-class pixels from x 79 to 347, and the script can only put the 320 to 347 part down to SAM's plinth (plinth x 214 to 454). The October pass had only x 320 to 347. Diagnosis (cerberus-strip.mjs, the same floor routing and tap): the extra pixels are two at x 79 and x 83, rgb(106,180,83), steady over 6 s and right on the script's emerald cut-off (green 180); they are a lime mark on SAM's clock ring at the top-left edge (canvas crop t15-pyramid-cerberus-zoom-top40-canvas-crop.png). The proof routes the floor JSON but not /api/fleet/schedule?demo=1, which feeds the ring. With the schedule routed to an empty list, the strip holds only x 320 to 347 (11 pixels, SAM's plinth), which would pass. So the failing pixels come from the demo schedule drawn on the ring at this time of day, not from a General being cut. Neither the ring code (src/components/floor) nor the schedule route is changed by this build. I could not run the same proof on bf0efc6 at the same time of day (production tree is read only and no other build was made), so that last point is reasoned from the diff, not measured. Shots t15-pyramid-*.png.

Commands used:

- `ls -la .next/BUILD_ID; find src -newer .next/BUILD_ID -type f` (empty: no rebuild needed)
- `rm -rf .test-build && npx tsc -p tsconfig.test.json && node scripts/run-tests.cjs .test-build/components/floor/{phonePyramid,ringRender,floorGolden,floorRender,floorRender.tickets,figureHit,busts,floorPacing}.test.js` (from the worktree)
- `H=/home/col/delivery/ux-audits/samui-local-harness; bash $H/stop.sh; SAMUI_WORKTREE=/home/col/SAM_ui-completed-jobs bash $H/start.sh`, then `MODE=demo node /tmp/t15-proof/t15.mjs`
- `cd /tmp/t15-proof/pyramid && NOBUILD=1 bash run-proof.sh after t22-pyramid.mjs` (twice; it starts and stops the harness itself)
- `env -u XDG_RUNTIME_DIR -u DBUS_SESSION_BUS_ADDRESS HARNESS_HOME=/tmp/t15-proof/fxhome SAMUI_WORKTREE=/home/col/SAM_ui-completed-jobs bash $H/start.sh`, then `MODE=fixture node /tmp/t15-proof/t15.mjs`
- Diagnostics: `node /tmp/t15-proof/sheetscroll.mjs` (sheet scroll by input type), `node /tmp/t15-proof/cerberus-strip.mjs` (with and without EMPTYSCHED=1), `MODE=demo|fixture node /tmp/t15-proof/navcover.mjs` (nav over the sheet)
- `bash $H/stop.sh; ss -ltn | grep -E ':(495[01])'` (empty at the end); port 3000 never contacted, its listener PID 1675636 the same before and after.

Surprises and failures:

- FAIL, check 16: the phone bottom nav covers the second line of the last "Last 5 finished" row in every General sheet, at both phone sizes, at every scroll position (numbers above). The layering itself (nav z-50 over the sheet's z-20, the sheet's 26 px bottom padding against a bar about 56 px tall) predates this build: GeneralDetailSheet.tsx and the nav are not changed by it. But the build's new rows are what now sits under the bar, so a General's fifth job shows no outcome on the phone. Not measured on production.
- FAIL as written, check 18 (pyramid check 12, P5): demo-schedule pixels on the clock ring trip the zoom border test for Cerberus; diagnosis above. The foreman decides whether this counts against the build or against the proof's unrouted schedule.
- The General sheet now opens much taller: top at y 216.2 (698.8 px) or 201.3 (713.7 px, the 78% cap) at 412x915, against y 427.6 in the pyramid proof's October run. On opening, the zoomed General on the floor is therefore hidden behind the sheet; in October the bust showed above it (compare t15-pyramid-c12-zoom-hephaestus.png with usage-pyramid-proofs/results/shots/after-c12-zoom-hephaestus.png). This follows from must-do 11 and is inside the locked 78% cap, but it is a visible change worth Colin's eye.
- Method notes: CDP synthesizeScrollGesture with touch does not move the sheet in headless Chromium, while a raw touch drag (touchStart, touchMove, touchEnd), the mouse wheel and a mouse-type gesture all scroll it to its end (sheetscroll.mjs); the touch drag is used above. Demo rows are generated from the clock on every request, so the API copy can be a minute later than the page's poll; the time text was checked against each row's own datetime attribute, and that within 120 s (demo) or equal (fixture) to the API's endedAt.
- Not from this build: the console shows "SW registration failed" and a pageerror reading 'waiting' (service workers are blocked in these contexts, as in t22-pyramid.mjs) and 503s from /api/omni/desktop only (the harness has no desktop). /api/health reports "degraded" on the memory check, a host figure.
- As in T14: the General panel's stats are two columns now (Running, Verified); Workers now lines come from the worker summary (formatJobDetail(w)), as noted for T11/T12; the source diff against bf0efc6 leaves the Running and Verified logic untouched.

## T15 fix and recheck

Run 2026-10-24 (about 15:50 to 16:05 UTC). Verdicts first: check 16 (phone nav covering the last finished row) is FIXED and passes; check 18 (pyramid check 12, P5) still fails, and it fails identically on baseline production code bf0efc6, so it is the proof's unrouted demo schedule, not this build.

Fix (check 16): GeneralDetailView in src/components/dashboard/fleet/GeneralDetailPanel.tsx ends with `<div aria-hidden="true" data-nav-clearance className="h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:hidden" />`, a spacer the height of the phone bottom nav (NAV, fixed, z-50, 3.5rem plus the safe area). It is a spacer rather than padding because the sheet zeroes the section's padding. md:hidden, so the desktop overlay is unchanged. New test in GeneralDetailPanel.render.test.ts asserts one spacer, aria-hidden, md:hidden, 3.5rem plus safe-area-inset-bottom, placed after the finished list. `npx tsc --noEmit -p .` clean; `npx next build` clean.

Check 16 rerun on the rebuilt build (navcover.mjs, scrolled to the end of the sheet, elementFromPoint on each row's two lines): PASS in 20 of 20 sheets (5 Generals x 412x915 and 390x844 x demo and fixture); the covered list is empty in every one. The last row now ends at y 833.2 to 833.5 (412x915, bar top 859) and 761.3 to 761.9 (390x844, bar top 788): a 25 to 27 px gap above the bar; both of its lines return the row. Before the fix about 30 of its 50.4 px were under the bar. Sheets that needed no scroll before (Hermes, Cerberus in demo) now scroll by 41 px (sheet scrollHeight 754 against clientHeight 713), which is the spacer. Raw output: /tmp/t15-proof/navcover2-demo.out and navcover2-fixture.out.

Side checks (spacer-check.mjs, demo): the spacer measures 56 px at both phone sizes. No horizontal scroll: sheet scrollWidth equals clientWidth (410 and 388) and the page scrollWidth equals the viewport (412 and 390). Desktop 1920x1080, Hephaestus panel open over the right-hand column: data-nav-clearance present, computed display none, height 0, page scrollWidth 1920.

Check 18 (P5), same proof, same unrouted schedule, run back to back (about 15:54 and 15:55 UTC):
- Baseline bf0efc6 (built from `git archive` into /tmp/bf0efc6-base, node_modules symlinked to the production tree's; geometry compiled from that tree): CHECK 12 FAIL. Cerberus: 18 emerald-class pixels in the top 3 px strip, x 88 to 347, "NOT explained by SAM's plinth". Prometheus 12 pixels, explained as SAM's plinth. Hermes, Calliope 0. CHECK 8, 9, TAPS, 15, 16, REVOKE all PASS.
- Fixed build: CHECK 12 FAIL, the same way. Cerberus 24 pixels (x 88 to 347, not explained by the plinth), Prometheus 12 explained, Hermes, Calliope 0. CHECK 8, 9, TAPS, 15, 16, REVOKE PASS.
- Verdict: P5 fails on baseline production code too, so it is the proof's unrouted /api/fleet/schedule?demo=1 (lime marks on SAM's clock ring at the canvas top edge), not this build. The only difference is the sheet top (y 427.6 on baseline, 201.3 on the build, the known taller sheet), which does not enter the pixel test. The proof scripts' logic was not edited; the run-proof.sh copy (/tmp/t15-proof/pyramid-base) differs only in its worktree path and results directory.

Gates: `npm test` 924 tests, 921 pass, 0 fail, 3 skipped (baseline 857, 854 pass, 0 fail, 3 skipped; 67 more, one of them the new spacer test). `npm run lint` exit 0, 0 errors, 6 warnings, none in files this build touches (DashboardShell, MoneyInWidget, VisualiserWidget, useVoiceWebSocket, fleetMetrics, projectMetrics). The npm test log also prints "failed to connect to the docker API" lines (host has no docker), as before.

Cleanup: /tmp/bf0efc6-base removed, harness stopped, nothing listening on 4950 or 4951, port 3000 never contacted.

## Reading cost, check 10 and check 11 (T16)

Run 2026-10-24 against build/completed-jobs at cfd257d (the existing fresh build, BUILD_ID web1GOSQso1vxA3Kywfs2; no src file newer than it). Throwaway `next start` (pid 1412741, node `next-server`, started by `scripts/run-fixture-server.cjs`) on 127.0.0.1:3101, HOME `/tmp/t16-fx/home`, fixture from `make-fixture-store.cjs --chat 5000 --jobs 40` (5040 job directories: 5000 chat turns, 40 sam-job; 34 finished, 30 counted). Session: the harness passkey enrolment (virtual authenticator, `sam-enrol` run with the harness HOME), the fixture HOME's `.sam/auth` linked to the harness auth store as in T14, the session cookie sent with curl. No bypass. Raw per-poll data: /tmp/t16-proof/polls.tsv (poll.sh beside it).

The boot retention sweep deletes chat turns beyond the newest 128 within moments of start (T13 note). So the 5000 chat directories were held outside the store until the server's boot sweep had run (8 s after start), then moved in; the store held 5040 directories for all 300 polls (column `dirs` is 5040 on every row). The hourly sweep did not fall inside the run (run 16:05 to 16:58 UTC, server started 16:04). The server was started twice: a first run was aborted after 22 polls to add the handler's `latencyMs` to the log; only the second run (fresh server, 300 polls) is reported.

Schedule: real 10 s spacing, not compressed. One poll = `/api/fleet/finished-jobs` then `?general=hephaestus`, 300 polls, about 53 minutes. The memo window (`MEMO_TTL_MS`) is 2000 ms in the code, not 10 s or 30 s, so 10 s spacing is past it: every fleet poll after the first found the memo expired and ran a real rescan of the 5040-directory store; the hephaestus poll directly after it is answered from the memo. The memo was not bypassed or defeated in any other way.

Check 10, memory: PASS.
- RSS after poll 10: 181,948 kB. After poll 300: 197,100 kB. Difference +8.33% (limit 10%).
- The growth is one step, not a trend: 183,584 kB at poll 16, 198,044 kB at poll 17, then 195,524 to 198,080 kB for polls 17 to 300 (195,604 at 50, 195,764 at 100, 196,112 at 200, 197,100 at 299 and 300). Poll 1 was 204,016 kB (cold scan of 5040 directories) and fell to 181,560 kB by poll 9 (garbage collection). The step at poll 17 coincides with the anomaly below and with about 150 extra requests I sent to the server by hand around then (a diagnostic loop on an unrelated route), so part of it may be mine. Margin to the limit is 1.7 points.

Check 10, per-poll server time: FAIL as measured end to end.
- Fleet list, polls 11 to 300 (289 usable): handler time (`meta.latencyMs` in the envelope) median 274 ms, p90 309, p99 329, max 351; `curl -w %{time_total}` median 280 ms, p90 315, max 357. One of 289 polls was under 50 ms. Poll 1 (cold) 692 ms. Limit is 50 ms: not met.
- Hephaestus list, same polls, answered from the memo: handler time median 2 ms (p99 5, one 265 ms), curl median 6.6 ms, p99 16.6 ms. Under 50 ms on 288 of 289.
- Cause, found by isolating the pieces (so it is a reading, not a guess): the 5040-directory incremental scan itself is fast. `finishedJobs.ts` compiled out of tree and run against the same store with the memo expired each time took 329 ms cold (first scan) and 10.7 to 16.4 ms warm, 8 runs. The 250 to 300 ms is `getEstate()`: the route calls it first (for `estate.tick` in the envelope) and `getEstate()` runs `estate.advance()`, which on its tick calls `readFleetAgents` and `readRunStats` (`fleetMetrics.ts:92`, `jobRunMetrics.ts:47`), each a synchronous `readdirSync` plus `readFileSync` of every `meta.json`. Timed alone against the 5040-directory store, `getEstate()` took 2 to 3 ms on most calls and 88, 97 and 247 ms on the tick calls. The fleet poll lands on the tick (it is the first call after 10 s); the hephaestus poll that follows does not. A trivial route (`/api/auth/session`) on the same server also showed 100 to 295 ms stalls when it landed on a tick. Those two scans are existing code, not code from this build; but the new route pays for them on every poll when the store is this large. With the real store (about 100 to 600 directories) the cost would be a fraction of this, but it was not measured here. Nothing in `src/` was changed. Decision for Colin: accept this as the existing estate tick, or drop the `getEstate()` call from the route (the `tick` field would need another source).

Anomalies, not explained: poll 17's hephaestus request took 135.6 s and ended with curl HTTP 000 (no reply), and poll 269's hephaestus request took 68.2 s and returned 200 with a handler time of 265 ms (so it waited about 68 s before the handler ran). Every other request of the 600 answered in under 0.8 s with HTTP 200. A burst of 12 concurrent mixed requests, three rounds, run afterwards did not reproduce a stall (all 200, 0.04 to 0.33 s). The host was busy (load average about 3.5, other sessions running). Not shown to be this build's fault, not shown not to be; worth a second look in T17 or review.

Check 11: PASS.
- `grep -n 'costFleetJob\|claude-stream\|stdout.log\|jobCosts'` over `finishedJobs.ts`, `closerRecord.ts`, `app/api/fleet/finished-jobs/route.ts`, `useFinishedJobs.ts` printed nothing (exit 1). The same terms (plus `claudeCosts`) are absent from `finishedJobRules.ts`, `demoFixtures.ts`, `respond.ts`, `auth/guard.ts` and `finishedJobsView.ts`.
- Read: the files the lists open are the jobs directory listing (`fsp.readdir`, `finishedJobs.ts:154`), each directory's `meta.json` (`fsp.open`, `:227`), `cmd.sh` (`fsp.access`, `:246`) and `closer.json` (`fsp.stat` at `:338`, `fsp.open` in `closerRecord.ts:53`). No cost lookup is imported or called, and no `claude-stream.jsonl` or `stdout.log` is opened. `useFinishedJobs.ts` only calls the route by URL. The route's other imports (`getEstate`, `requireSession`, `envelope`, `demoFinishedJobs`) are not cost code; `getEstate` is the telemetry sampler discussed above, which reads `meta.json` files only.

Cleanup: both throwaway servers stopped (nothing on 3101, 4950, 4951), fixture HOME `/tmp/t16-fx/home` removed (and its empty stash dir), port 3000 count `ss -ltn | grep -c ':3000 '` was 1 before and 1 after (the live service, never contacted). The enrolled throwaway passkey: the first revoke after the 53 minute run got 401 (step-up cookie expired), so a fresh throwaway passkey was enrolled in the harness and the harness devices named "SAM ux-fixes local proof (temporary, revoke)" were deleted (three found and deleted, one more than this run made, all of that temporary name in the harness auth store, none in production). One slip: `sam-enrol --help` was run once without the harness HOME and printed a real single-use token valid 10 minutes (it was not used and has expired).

## T16a: route no longer ticks the estate

Change: `src/app/api/fleet/finished-jobs/route.ts` no longer imports or calls `getEstate()`; it passes a constant tick of 0 to `envelope()` (comment in the file says why). Nothing in `src/components/dashboard/fleet` reads `meta.tick` (grep on `.tick` found only unrelated `tickets`). `route.test.ts` lost its `getEstate()` priming call and gained a test that the route source has no telemetry import and no `getEstate(` call. `npx tsc --noEmit -p .` clean; `npm test` 922 pass, 0 fail (3 skipped); `npm run lint` 0 errors, 6 warnings (baseline).

Re-measure 2026-10-24 (about 18:07 to 19:02 UTC), same method as T16: fresh `npx next build` of the worktree (route change plus test only), throwaway `next start` on 127.0.0.1:3101 via `scripts/run-fixture-server.cjs`, HOME `/tmp/t16-fx/home`, `make-fixture-store.cjs --chat 5000 --jobs 40`, the 5000 chat directories held out until after the boot sweep then moved in (5040 directories on all 300 rows), harness passkey session cookie, `.sam/auth` linked to the harness store, no bypass. Real 10 s spacing, 300 polls, memo (2000 ms) not bypassed. Per poll: fleet, then a trivial authed route (`/api/auth/session`, added as a control), then `?general=hephaestus`. Raw data /tmp/t16-proof/a/polls.tsv, script /tmp/t16-proof/a/poll.sh.

Check 10, memory: PASS. RSS after poll 10 186,508 kB, after poll 300 187,612 kB, difference +0.59% (limit 10%). Flat throughout (185,956 at 50, 186,464 at 100, 187,032 at 200; max 188,332).

Check 10, per-poll server time: PASS for both lists, polls 11 to 300, excluding the 3 stalled requests below (288 and 287 polls).
- Fleet list: handler time (`meta.latencyMs`) median 14 ms, p90 16, p99 19, max 41; curl total median 19.7 ms, p90 23.3, p99 26.0, max 48.5. None at or over 50 ms. (T16 before: 274 ms median.)
- `?general=hephaestus`: handler median 0 ms (p99 3, max 12); curl median 5.2 ms, p99 9.5, max 26.2. None over 50 ms.
- Control, `/api/auth/session` (still calls `getEstate()`): curl median 259.7 ms, p99 324; 286 of 288 over 50 ms. This confirms the estate tick was the cost and is untouched on other routes.

Stalls: 3 of 900 requests stalled, all HTTP 000 or very slow: poll 84 fleet 134.2 s (000, no reply), poll 191 hephaestus 68.1 s (200, handler 12 ms), poll 296 fleet 132.6 s (000). These are excluded from the figures above and reported here, not hidden. The control route was never the one stalled in the same poll, so the control does not show the stall is route-independent by itself. Follow-up run (/tmp/t16-proof/b, store by then shrunk to 168 directories because the hourly retention sweep ran at about 19:06, which is itself expected behaviour): a separate 1 s prober of `/api/health` (no auth, no job store) stalled 68.0 s, 68.2 s and 36.0 s within about 6 minutes, and one fleet poll stalled 36.1 s at the same moment as a health probe (19:11:03 to 19:11:39). During that stall the server process was idle (state Ssl, wchan `ep_poll`, 2 percent CPU, 22 fds), not busy, and the probing shell loop itself ran on time. Server-side sockets for port 3101 piled up in LAST-ACK (86) with TCP retransmit backoff of 8 to 9 retries (rto up to 51 s), i.e. loopback packets for this server being lost and retried with exponential backoff, which matches stall lengths of about 36, 68 and 134 s. Port 3000 and the harness ports showed 0 in LAST-ACK. So the stall is independent of this route (`/api/health` stalls too, node is idle while it happens) and looks like loopback TCP packet loss at kernel or firewall level. Not proven further: no root here to read nft or iptables rules. Not caused by the finished-jobs code on this evidence; worth one look at whatever sits on the loopback path (firewall, tailscale, eBPF) if it matters, since it will also hit the live app.

Result: check 10 PASS (memory +0.59%, fleet 14 ms and hephaestus 0 ms handler median, both under 50 ms), with the 3 external stalls recorded above.

Cleanup: throwaway server stopped (pid 1591153), `/tmp/t16-fx` removed (the auth link removed first, harness auth store intact), port 3000 count 1 before and 1 after, nothing on 3101, 4950, 4951. Harness started only to enrol and revoke: temporary passkeys named "SAM ux-fixes local proof (temporary, revoke)" revoked (found false at the end). No token was printed.

## Real-store verdict check, check 20 (T17)

Run 2026-10-24 (about 18:12 to 18:20 UTC) against build/completed-jobs at 021e641 (BUILD_ID 02PXIrH_JDzAk6gzjYNoo, no src file newer than it, so no rebuild). No code changed.

Deviation from the ticket, and why: the server did not run on the real `HOME`. Its boot retention sweep deletes chat-turn directories beyond the newest 128 (the real store holds 212 directories), and the boot reconcile can file live jobs as killed, so a server on the real `~/.sam/jobs` is not read only. `scripts/run-fixture-server.cjs` also refuses the real home by design. What I did instead: `cp -a ~/.sam/jobs /tmp/t17-fx/home/.sam/jobs` (a byte copy taken at the start of the run, 212 job directories, the only read I made of the real store apart from the python comparisons below), a throwaway HOME `/tmp/t17-fx/home` with `.sam/auth` linked to the harness auth store (as T14 to T16), and the server started with the script on 127.0.0.1:3101 first (API fetch) and then on 127.0.0.1:4950 so the harness TLS proxy reached it for the browser. The verdict file was always read from the real `~/.sam/jobs/<id>/closer.json`, so the comparison is against the real file, not the copy. Session: harness passkey enrolled, cookie sent; no bypass. No token was printed.

Fetched `/api/fleet/finished-jobs` (10 rows) and `?general=hephaestus` (5 rows), HTTP 200. Every row in both lists was compared with the real store (the store is live, so ids below are as returned at about 18:15 UTC).

Row with a closer.json (job `job_parkfords-meter-serial-required_20261024-154501`, hephaestus, outcome passed): file verdict `PASS (5/5 checks)`, row verdict `PASS (5/5 checks)`, identical (`python3 -c` comparing the encoded bytes of the file's `verdict` and the route's `verdict`: identical). Same check on all other rows with a record, all identical, in both lists:
- `job_keystore-config-envlines_20261024-154601`: `PASS (3/3 checks)`
- `job_tiktok-week3-batch-resume_20261024-155201`: `PASS (5/5 checks)`
- `job_tiktok-week3-batch_20261024-114740`: `UNKNOWN: died on the seat limit`
- `job_samui-completed-jobs-implement_20261024-110944`: `UNKNOWN: died on the seat limit`
- `job_keystore-stage-b_20261024-120420`: `PASS (3/3 checks)`
The browser at 1440x900 shows the same strings in the Finished jobs list ("PASS (5/5 checks)" on the Parkfords row, "PASS (3/3 checks)" on the Keystore row). Screenshots (uncommitted): `implementation/shots/t17-row-with-record-1440x900.png` (full page, the row near the bottom of the Finished jobs card), `t17-row-with-record-1440x900-row.png` (the row alone), `t17-row-keystore-1440x900.png` and `-row.png`, `t17-fleet-1440x900.png`.

Row with no closer.json: `job_tiktok-timeline-W3-4_20261024-124622` (hephaestus, outcome passed, no closer.json in its real directory): the API row has no `verdict`, and the row in the browser reads "Passed" and "not checked". The same holds for `job_tiktok-timeline-W3-2_20261024-123324`, `job_tiktok-timeline-W3-6_20261024-121546`, `job_tiktok-timeline-W3-3_20261024-115828` (all four are among the ten returned). Screenshot `t17-row-no-record-1440x900.png` and `-row.png`.

Verdict kind against outcome disagreeing: no row where a PASS verdict sits on a failed job, or a FAIL verdict on a passed job, exists among the returned jobs (PASS rows are all outcome passed). The nearest is a different pairing: the two rows with outcome failed and verdict `UNKNOWN: died on the seat limit` (`job_tiktok-week3-batch_20261024-114740` and `job_samui-completed-jobs-implement_20261024-110944`). In the browser both words show on each such row: the text reads "UNKNOWN: died on the seat limit" and "Job: Failed" (checked on the two rows named in the page text, SAM_ui completed-jobs T1-T18 and TikTok week 3). A true PASS or FAIL disagreement is not in the real store; the unit tests cover it.

Check 20: PASS (verdict strings identical on every returned row that has a record; rows without a record show their own outcome and "not checked").

Proof grep, `grep -n 'writeFile\|appendFile\|rm(\|unlink\|rename' src/lib/server/fleet/finishedJobs.ts src/lib/server/fleet/closerRecord.ts src/app/api/fleet/finished-jobs/route.ts`: printed nothing (exit 1).

Job store before and after (marker `/tmp/t17-marker`, made in /tmp before anything started; `find ~/.sam/jobs ~/.sam/closer -type f -newer /tmp/t17-marker | head`):
- before: nothing listed (0 files); 1626 files under the two trees.
- after: 2 files listed, both belonging to the build that is running this ticket list, not to this check: `job_samui-completed-jobs-implement-resume_20261024-154701/events.jsonl` and `.../claude-stream.jsonl` (a live running job, still writing). 1626 files after, the same count. The throwaway server used a copy, never the real directories, so it had no path to write there; I wrote nothing under `~/.sam/jobs` or `~/.sam/closer`.
- The wider mtime signature of the real store changed between the start and the end (the live job above, and any other live job); I did not try to separate those further.

Cleanup: fixture server stopped (pid 1777333; the first on 3101 stopped earlier), harness proxy and its Next server stopped, `/tmp/t17-fx` removed (auth link removed first, harness auth store intact), nothing listening on 3101, 4950, 4951. Port 3000 count 1 before and 1 after (the live service, never contacted). Temporary harness passkey "SAM ux-fixes local proof (temporary, revoke)" revoked (found false at the end). Proof scripts and raw responses in /tmp/t17-proof.

## T18 verification: gates and coverage

Run 2026-10-24 on build/completed-jobs at 642048d (T17 commit), before this section was committed. No source file edited. Raw logs: /tmp/t18-tsc.log, /tmp/t18-lint.log, /tmp/t18-test.log, /tmp/t18-build.log.

### Gates against the T1 baseline (bf0efc6)

| Gate | T1 baseline | Now | Result |
|---|---|---|---|
| `npx tsc --noEmit -p .` | 0 errors | exit 0, no output | equal |
| `npm run lint` | 0 errors, 6 warnings | exit 0, 0 errors, 6 warnings (DashboardShell, MoneyInWidget, VisualiserWidget, useVoiceWebSocket, fleetMetrics, projectMetrics: the same six, none in a file this build touches) | equal |
| `npm test` | 857 tests, 854 pass, 0 fail, 3 skipped | 925 tests, 922 pass, 0 fail, 0 cancelled, 3 skipped (exit 0) | 68 more tests, all pass, no failure |
| `npx next build` | not recorded | exit 0, "Compiled successfully", 6 lint warnings as above | clean |

The 3 skipped names equal the baseline's, character for character in the opening words and reasons: "check 2 (live): a side message sent 8s into a 25s tool call reaches the same turn's answer" (SAM_LIVE_SIDE_MESSAGE=1), "sam-dispatch.next pins every tier to the same model as the live sam-dispatch" (box-only, /home/col/.local/bin/sam-dispatch.next missing), "a job dispatched from chat X ends with a ping linked to /chat?c=X" (SAM_LIVE_DISPATCH_PING=1). No new skip. The test log still prints "failed to connect to the docker API" lines (host has no docker), as before.

Base note: the tickets say e20d7ca; the real base is bf0efc6 (production moved on), used throughout.

### Build commits (`git log --oneline bf0efc6..HEAD`, 16 commits)

```
642048d Finished jobs: real-store verdict check recorded (T17)
021e641 Finished jobs: finished-jobs route skips the estate tick, poll time re-measured (T16a)
fd59da5 Finished jobs: reading cost measured, no cost or stream reads (T16)
cfd257d Finished jobs: phone sheet clears the bottom nav, phone checks recorded (T15)
47f3fbe Finished jobs: desktop and laptop browser check results (T14)
875b585 Finished jobs: fixture store generator and throwaway server runner (T13)
97d7a22 Finished jobs: General's panel shows its last five finished, Spend today and old fetch removed (T11, T12)
0be448c Finished jobs: phone list under Fleet status (T10)
3245caf Finished jobs: drawer placement under Fleet status (T9)
e9cd735 Finished jobs: desktop list under Fleet status (T8)
96d8eb0 Finished jobs: client poller, row view helpers and list component (T7)
b6f8ca6 Finished jobs: demo rows and /api/fleet/finished-jobs route (T6)
8b1e3e7 Finished jobs: attach closer verdicts to returned rows only (T5)
a048362 Finished jobs: incremental memoised store scan (T4)
c49fad9 Finished jobs: closer record reader (T3)
eb56a29 Finished jobs: row types and pure rules (T2)
```

Every ticket T2 to T13 has a commit (T11 and T12 share 97d7a22; T1 is the worktree). T14 to T17 each have one too (T16a is 021e641). The T18 commit follows this section.

### Nothing pushed, merged, deployed or restarted

- `git branch -r --contains HEAD`: prints nothing (no remote branch holds the build).
- Production tree, read-only git only: `git -C /home/col/SAM_ui rev-parse HEAD` is bf0efc613bd49411b42666ddfa5dcbe0c0430a9b on `claude/sam-core-dashboard-sf3639`, the base, unchanged (no commit after bf0efc6). `git -C /home/col/SAM_ui status --short` is NOT empty: 10 staged additions (`A `), all `*.bak-20261024-keystore` files (proxy/gemini-proxy.mjs, src/app/api/{fleet/dispatch,omni/desktop,operations/dispatch,os,push}/route.ts, src/lib/server/auth/session.ts and session.test.ts, src/lib/server/chat/tiers.ts, src/lib/server/jobs/manager.ts). The suffix names the keystore job, not this one; this job ran no command in the production tree except read-only git and never edited it. The ticket's "empty" cannot hold while that other job's staged files are there. Foreman to confirm they are the keystore job's.
- `systemctl --user show sam-ui.service -p ActiveEnterTimestamp`: `Tue 2026-10-20 22:50:20 BST`, equal to the T1 value (not restarted).
- Port 3000: one listener, `next-server` pid 1675636, the same pid recorded in T15, never contacted by this job. Nothing listening on 3101, 4950 or 4951 now. `npx next build` and the tests used no port.

### Worktree cleanliness

`git status --short` in the worktree prints nothing. `implementation/shots/` is already ignored: `git check-ignore -v` names `/home/col/SAM_ui/.git/info/exclude` line 7 (`implementation/shots/`), which is the common git dir shared by all worktrees (this worktree's `git rev-parse --git-path info/exclude` resolves to it), so no edit was needed and none was made. `.test-build/` is ignored by `.gitignore:51`; `.next/`, `next-env.d.ts`, `node_modules`, `public/sw.js` and `tsconfig.tsbuildinfo` are also ignored (`git status --ignored`). No other untracked file.

### Coverage: must-dos

| Must-do | Ticket(s) | Recorded result |
|---|---|---|
| 1 Desktop list under Fleet status | T8, proved T14 | Check 12 PASS: directly under Fleet status, 10 rows newest first, at 1920x1080, 1680x1050, 1601x801 (column) and the drawer sizes. |
| 2 Drawer, no new tab | T9, proved T14 | Check 14 PASS: six tabs unchanged at 1366x768, 1280x720, 1500x900, 1440x900; dashboardLayout.ts diff empty. |
| 3 Scrolls inside, at least 3 rows | T8, proved T14 | Check 13 PASS at column sizes (Job detail 166.5, Fleet status 232.5, within 0.1 px of list-hidden; 3 rows at 1601x801). Drawer 1440x900 is information only: Fleet status is now its natural 232.5 px where production filled its grid cell (T9 decision, see Notes). |
| 4 Row content, 12 px, 44 px | T2, T7, proved T14, T15 | Check 15 PASS: rows 54.3 px desktop, 50.4 px phone, text 12 to 13 px. Contrast caveat below. |
| 5 Slug when no summary | T2, T7 | finishedJobRules.test 14 pass, finishedJobsView.test 13 pass. |
| 6 Row opens /jobs/id | T7, proved T14, T15 | Checks 12, 22, 17 PASS (demo and fixture; fixture job page loaded). |
| 7 Only finished jobs | T2, T4 | finishedJobRules.test, finishedJobs.test 9 pass. |
| 8 Order by endedAt | T4 | finishedJobs.test; endedAt strictly descending in the browser runs. |
| 9 Outcome rule | T2, T4 | finishedJobRules.test 14 pass. |
| 10 sam-job only, counted general, SAM labelled | T2, T4, T6 | finishedJobs.test, route.test 5 pass; fixture 34 finished, 30 counted. |
| 11 Last 5 replaces Earlier today | T11, T12, proved T14, T15 | dashboardLayout.test 7 pass (fails on bf0efc6 panel); GeneralDetailPanel.render.test (fails 4 of 10 on bf0efc6 panel); check 16 PASS desktop; phone FAIL then fixed, below. |
| 12 Rest of panel unchanged | T12, proved T14, T15 | Running, Verified, Workers now present, logic unchanged against bf0efc6 (stat row is now two columns, noted). |
| 13 Reading cost | T4, proved T16 | Check 8, 9 (T4 tests); check 10 PASS after T16a (first run FAIL on time, below). |
| 14 Closer verdict, own outcome on disagreement | T3, T5, T7, proved T17 | closerRecord.test 16, finishedJobs.test 14, finishedJobsView.test 13; check 20 PASS on a copy of the store. |
| 15 No record: outcome and "not checked" | T3, T5, T7 | Same tests; browser rows show "not checked" exactly when no verdict. |
| 16 Closer read never blocks, returned rows only | T3, T5 | finishedJobs.test (5 new in T5). |
| 17 Demo never reads the store | T6 | route.test 5, demoFixtures.test 8 pass. |
| 18 Phone list under Fleet status | T10, proved T15 | Check 22 PASS at 412x915 and 390x844. |
| 19 "not checked" marker | T7 | Check 23 test; browser rows. |
| 20 Spend today removed, no /api/fleet/jobs request | T11, T12 | GeneralDetailPanel.render.test; grep count 0. |

### Coverage: spec checks

| Check | Ticket | Recorded result |
|---|---|---|
| 1 Fixture store rules | T4 | finishedJobs.test 9 pass, fixture rules covered. |
| 2 5000 chat directories | T4 | Pass in finishedJobs.test; also run live at 5040 directories in T16. |
| 3 Slug and summary | T2 | finishedJobRules.test 14 pass. |
| 4 General's newest 5, 2, 0 | T11, T12 | dashboardLayout.test 7 pass; empty text in the render test. |
| 5 Closer reader cases | T3, T7 | closerRecord.test 16 pass; both words render (browser: "FAIL: tests Job: Passed"). |
| 6 No record, record appears, non-closed | T5 | finishedJobs.test 14 pass. |
| 7 Demo never opens the store | T6 | route.test, demoFixtures.test pass. |
| 8 File-open counting, 16 in flight | T4 | finishedJobs.test pass. |
| 9 Deleted directory leaves the map | T4 | finishedJobs.test pass. |
| 10 Memory and time, 300 polls | T16, T16a | First run: memory +8.33% PASS, time FAIL (fleet median 274 ms, cause getEstate() tick in the route). Fixed in T16a 021e641; re-run PASS: RSS +0.59%, fleet handler median 14 ms (max 41), hephaestus 0 ms. Three of 900 requests stalled 68 to 134 s (loopback LAST-ACK retransmits, `/api/health` stalls too); excluded and reported, outside this code on that evidence. |
| 11 No cost or stream read | T16 | grep empty; read review written. |
| 12 Desktop list, 10 rows, click lands | T14 | PASS. |
| 13 Heights unchanged, 3 rows, scrolls | T14 | PASS at 1920x1080, 1680x1050, 1601x801. 1440x900 is a drawer size, measured as the drawer equivalent (see Notes). |
| 14 Drawer sizes, six tabs | T14 | PASS. |
| 15 44 px, 12 px, contrast | T7, T14, T15 | PASS on size. Contrast: plain axe judged nothing (gradient backgrounds, 0 violations but all nodes incomplete); passed only with gradients flattened (46 of 46, 50 of 50 nodes, lowest 6.21:1) plus a gradient-aware DOM probe (lowest 5.32:1 desktop, 6.29:1 phone). Method deviation, stated. |
| 16 Panel and sheet, Spend gone | T12, T14, T15 | Desktop PASS. Phone first FAILED (bottom nav covered the last row's second line in 20 of 20 sheets), fixed by the spacer in cfd257d, rechecked PASS in 20 of 20. |
| 17 Phone sheet row opens the job | T15 | PASS (the then-covered fifth row was not tap-tested; after the fix both its lines return the row under elementFromPoint). |
| 18 Floor scene hash, phone pyramid unchanged | T14, T15 | Desktop floorGolden 7 of 7, floor diff against bf0efc6 empty. Phone unit 84 of 84, but pyramid browser check 12 (P5) FAILS as written, and fails identically on a build of bf0efc6 run back to back (Cerberus, lime pixels from the proof's unrouted demo schedule on SAM's clock ring). Not caused by this build; "pass unchanged" in the strict sense is not met because the proof was already failing on the baseline. |
| 19 tsc, lint, test, build | T18 | Table above: all pass, no regression. |
| 20 Real closed job shows its verdict | T17 | PASS: 6 rows with closer.json identical byte for byte, 4 without show outcome and "not checked". Ran on a `cp -a` copy of the store (the boot sweep deletes chat directories on the real home), with the closer.json always read from the real path. A true PASS/FAIL disagreement is not in the real store; unit tests cover it. |
| 21 Colin confirms on phone and desktop | T20 (after T19) | Not run: human gate, pending. |
| 22 Phone list under Fleet status | T15 | PASS at 412x915 and 390x844. |
| 23 "not checked" rendering | T7 | finishedJobsView.test pass. |
| 24 No Spend today, no request over three polls | T12 | GeneralDetailPanel.render.test pass. |

### Gaps and failures, plainly

- No coverage row is missing. Check 21 is pending by design (T19, T20 are gates; T19 needs Colin's approval).
- Check 18, pyramid P5 browser failure: present on bf0efc6 too (so the strict wording "pass unchanged" is not achievable); foreman to rule it against the proof, not the build.
- Check 10 first failed on time (T16), then fixed by T16a and re-run PASS. The 3 stalls (68 to 134 s) are an unresolved host-level cause, outside the build.
- Check 16 (phone) first failed (nav overlap), fixed in cfd257d, rechecked PASS.
- Check 20 ran on a copy of the store, not on the live home.
- Check 15 contrast rests on gradient-flattened axe runs and a DOM probe, not a plain axe pass.
- 1440x900 is a drawer size, not a column size; checks 12, 13, 15 column measurements ran at 1920x1080, 1680x1050, 1601x801 with 1440x900 as the drawer equivalent. At 1440x900 with the fixture store only one list row is visible before the tab is scrolled.
- Production tree `git status --short` is not empty (10 staged keystore .bak files from another job); its HEAD is unchanged at bf0efc6.
- Other open notes from earlier sections: the General sheet is taller and hides the zoomed General behind it (T15); Fleet status in drawers now takes its natural height (T9).
