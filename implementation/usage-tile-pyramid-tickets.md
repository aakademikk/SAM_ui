# SAM_ui: usage-limits tile + phone Generals pyramid: tickets

Spec (LOCKED 2026-10-05): [usage-tile-pyramid-spec.md](./usage-tile-pyramid-spec.md). Base commit `789589e` (production, floor-fixes merged and live). 27 tickets. Build order: T1 to T23, then T26 and T27, then T24, then T25 at deploy (T26 and T27 were added 2026-10-05 on Colin's go, after T25 was numbered). Foreman: SAM. Builders: one fresh agent per ticket.

## Shared facts (the foreman repeats these in every brief)

- Repo `/home/col/SAM_ui`, branch `claude/sam-core-dashboard-sf3639`. Never edit `/home/col/SAM_ui` directly. Build on a NEW branch `build/usage-pyramid` in a worktree `/home/col/SAM_ui-usage-pyramid`, cut from `789589e` (the foreman creates it once: `git -C /home/col/SAM_ui worktree add -b build/usage-pyramid /home/col/SAM_ui-usage-pyramid 789589e`). Work only there. Never run `deploy.sh`, never use port 3000, never restart a service. No deploy without Colin's go.
- No `git commit`, `push`, `merge`, `stash`, `reset`. The foreman checkpoints with `git add -A`.
- The shell has `NODE_ENV=production`. `node_modules` is installed; if you must reinstall, use `npx -y npm@10 ci --include=dev`, never plain `npm install`.
- Tests: `npm test` runs `pretest` (`rm -rf .test-build && tsc -p tsconfig.test.json`) then `scripts/run-tests.cjs` over `.test-build/**/*.test.js`. Test files are `*.test.ts` beside the code, use `node:test` and `node:assert/strict`, import with the `@/` alias or `./x.js` relative paths (see `src/components/floor/floorRender.test.ts`). Run one file: `npm run pretest && node scripts/run-tests.cjs .test-build/<path under src/>.test.js` (the build's rootDir is `src`, so `src/lib/x.test.ts` compiles to `.test-build/lib/x.test.js`; there is no `src/` inside `.test-build`). A test that makes a temp dir must use `tempDir` from `@/lib/server/testing/tempDir` (the suite fails on any leaked temp dir). Set `process.env.HOME = tempDir('...')` BEFORE importing the module under test (house rule). Known flake: `sideMessage.test` "review 3" can fail once when parallel test files race on `.test-build`; re-run before treating it as real.
- Live-file rule: any new reader of a live `~/.sam` file resolves its path through `src/lib/server/livePaths.ts` (`samStateDir()` and friends, resolved per call from `os.homedir()`), never a module-level constant, so the proof harness (isolated `HOME`) and tests can redirect it.
- System-change rule: a ticket that edits `~/bin`, `~/.sam` or `~/.local/bin` scripts or a user unit is a system change. Such edits are STAGED as `<name>.next` beside the live file (the pattern `sam-job.next`, `run.next.sh` already used here; `src/lib/server/push/dispatchPing.test.ts` has the `stagedOrLive` helper), tested there, and installed only by the install ticket (T25) with a dated `.bak`. No new systemd units or timers in this build. Repo tests that run those scripts are box-only (`boxOnlySkip` in `src/lib/server/testing/boxOnly.ts`) and use a temp `HOME` so they never touch live state.
- Harness and ports: `/home/col/delivery/ux-audits/samui-local-harness/` (`start.sh`, `stop.sh`, `proxy.mjs`, `lib.mjs`). `SAMUI_WORKTREE=<worktree> bash start.sh` serves a worktree's production build (`npx next build` first) on 127.0.0.1:4950 behind a TLS proxy on 127.0.0.1:4951, with an isolated `HOME` (`<harness>/home`) and its own auth store; `SAM_PUSH_BIN=/bin/true` is already set so no real push is sent. One server at a time (another session may share 4950/4951: check `ss -ltn | grep -E ':49(5[01])'` first and leave its servers alone). Always run `stop.sh` before you finish; leave no listener. The floor-fixes proofs in `/home/col/delivery/ux-audits/floor-fixes-proofs/` (`common.mjs`, `run-proof.sh`, `t*.mjs`) are the model for browser proofs; this build's proofs live in `/home/col/delivery/ux-audits/usage-pyramid-proofs/` (built by T21), never in the repo.
- Never print the enrolment token, a cookie, a session value, or any env file or key. No single command may run longer than about 8 minutes.
- UX standard for anything new: tap targets at least 44x44px, no text under 12px (canvas text no under 11px, as the floor already does), contrast 4.5:1 body / 3:1 large and non-text, axe serious/critical zero. The fleet surface uses emerald literals (`#3dff5a`, `#9dff70`, `#98b6a6`, `#5f7d6e`), not theme variables.
- Code style: read the surrounding code and match it (comment density, naming, idiom). Floor code is plain maths on plain objects, no canvas calls in `floorRender.ts`.
- Finish every ticket by running its Proof and reporting the raw output, plus `npm run typecheck`, `npm run lint`, `npm test`. Record the baseline counts (pass, skipped, fail) from `789589e` in your first report so later tickets can compare.

## Design decisions the tickets rely on (so a cold agent does not re-derive them)

- Where the data comes from. `sam-quota-log.py` reads `rate_limit_event` frames from job stdout. Only SAM_ui chat turns (stream-json via `JobManager`, `src/lib/server/chat/startTurn.ts`) emit them. `sam-dispatch` fleet jobs run `claude -p --output-format text` and carry no reading, and terminal sessions are not in the job store at all (known gap, spec section 4). So the real "job end" hook for U9 is the chat turn exit hook `onTurnExit` in `startTurn.ts`, not `run.sh`, not `sam-jobs-watch.timer`. Reasons: it is in this repo (no system edit to `run.sh`), it fires exactly when a reading is produced, and the 5-minute `jobs-watch.sh` runs every 5 minutes with a 30 s accuracy slack (so it can miss "within 5 minutes") and re-reminds every 6 hours, which breaks U8. The hourly timer stays as the safety net and is not changed.
- One source of truth. The hook runs the harvester (so `runs.jsonl` gets the row the tile reads), then evaluates alerts in TypeScript from the same rows the tile uses. The alert state (which windows were already pinged) is a small JSON file `~/.sam/quota/alerts.json`.
- Reading rules (`buildUsage`, T2). Per seat (`main`, `max2`; rows with `seat: null` are ignored) and per window, the reading is the newest row (by `endedAt`) with a non-null value for that window. Percent = `Math.round(utilization * 100)`. A window is `reset` (no percent shown, "reset, not checked since <time of that reading>") when its reset time is at or before now. The 5-hour reset comes from the new `fiveHourResetsAt` field (T1). Rows written before T1 lack it: for those, the 5-hour reading counts as `reset` once it is more than 5 hours old (a window cannot outlive that) and shows "reset time not recorded" while younger. Weekly uses `sevenDayResetsAt` (epoch seconds, as stored).
- Alert rule (T9). Fires when the rounded percent is 80 or more, the reading is not `reset`, and the window's reset time is known. A window is identified by its reset epoch. Once a window id has been pinged for a seat, no further ping until that seat's reset epoch for that window changes. A legacy 5-hour row with no reset time never alerts (the ping must name the reset time).
- Phone pyramid geometry. Row order is the spec's P1: top (back) row Cerberus, Prometheus; bottom (front) row Hermes, Hephaestus, Calliope. `GENERALS` in `floorRender.ts` stays in its desktop order (hermes, hephaestus, calliope, cerberus, prometheus); only the phone layout assigns rows. Spacing stays 170 (the mockup's variant B). The mockup's row order and its `PYRAMID_VARIANT` flag are not carried over.
- Known tension, P2 against P7. Variant B's measured bust height at 412x915 was 57.5 px with a 10 px side margin; P7 needs platforms at least 16 px inside the edge, which shrinks the scale about 0.6 percent and the bust to about 57.1 px. Resolve it by raising the phone's `bustU` option just enough (phone only, desktop keeps its value) so the bust stays at or above 57.5 px, without breaking the overlap rules. T14 owns this.
- Desktop must not change by one pixel (spec section 3). T12 writes a golden guard captured on `789589e` before any floor edit; every floor ticket must keep it green and must not edit it.

---

## T1: Harvester records the five-hour reset and runs one harvest at a time
Status: DONE 2026-10-05 (quotaLog.test 3/3 pass on staged sam-quota-log.next.py, 2 of 3 fail on live; typecheck clean; npm test 455/453 pass/2 skip/0 fail)
Spec: must-do #U6, check #6
Depends on: none
Blocked by: none
Context: Today `harvest_one` stores `fiveHour`, `sevenDay` and `sevenDayResetsAt` but drops `unifiedWindows.five_hour.resetsAt`, so the tile cannot say when the 5-hour window resets or detect that it already has. Also, from T11 on, the harvester runs both from the hourly timer and from the chat-turn hook, so two harvests can overlap and append the same job twice (it builds its `seen` set once, then appends). This is a SYSTEM CHANGE to `~/bin`: do not edit the live file. Make a staged copy.
Files: /home/col/bin/sam-quota-log.next.py (new, a copy of `/home/col/bin/sam-quota-log.py` with the change), src/lib/server/usage/quotaLog.test.ts (new, box-only)
Steps:
1. `cp /home/col/bin/sam-quota-log.py /home/col/bin/sam-quota-log.next.py` (keep the live file untouched).
2. In the `.next.py` copy, `harvest_one`: add `'fiveHourResetsAt': (windows.get('five_hour') or {}).get('resetsAt')` beside `sevenDayResetsAt` (epoch seconds, same unit as the event; no conversion). The last `rate_limit_event` in the stream wins already (it overwrites `rl`); keep that.
3. In `harvest()`: take an exclusive `fcntl.flock` on `~/.sam/quota/.harvest.lock` for the whole read-seen/append section so a second harvest waits, then finds the job already in `seen`. Update the module docstring with one line on each change (dated 2026-10-05).
4. Write `quotaLog.test.ts` (box-only via `boxOnlySkip`, resolving the script with the `stagedOrLive` pattern, and honouring an env override `SAM_QUOTA_LOG_BIN` so T25 can pin it to the live path). It builds a temp `HOME` with `~/.sam/jobs/<id>/meta.json` (`endedAt` set, a `command` starting `sam-agent (x)`) and a `stdout.log` of framed events (4-byte channel, 4-byte big-endian length, JSON body, as `frames()` reads them) holding one `rate_limit_event` with `five_hour: {utilization: 0.12, resetsAt: 1791202200}` and `seven_day: {utilization: 0.57, resetsAt: 1791237600}` plus a `result` event. Run the script with `HOME` set to the temp dir. Assert (a) the one row written has `fiveHourResetsAt === 1791202200` and `sevenDayResetsAt === 1791237600`; (b) two harvests started at the same moment (two `spawn`s, awaited together) leave exactly one row for that job id.
5. Add a second case that replays a REAL stream-json run: copy the newest job dir under `/home/col/.sam/jobs` whose `stdout.log` contains a `rate_limit_event` into the temp `HOME` (read-only copy, never write to the real store), harvest it, and assert the row's `fiveHourResetsAt` equals the `resetsAt` read independently from that log's last `five_hour` window. This is the spec's check 6 on real data.
Do not touch: `/home/col/bin/sam-quota-log.py` (the live file, T25 installs), `sam-quota-log.timer` and its service, `~/.sam/quota/runs.jsonl` (never write to the real quota dir), any other script.
Proof: Before the change (no `.next.py` yet, the test resolving the live script): `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/quotaLog.test.js` FAILS on the missing `fiveHourResetsAt` and on the duplicate row. After: the same command passes all three cases. `git -C /home/col/SAM_ui status --short` unchanged; `diff /home/col/bin/sam-quota-log.py /home/col/bin/sam-quota-log.next.py` shows only the intended lines; `ls ~/.sam/quota` shows no new file.

## T2: Usage types and the pure reading builder
Status: DONE 2026-10-05 (usageReadings.test 12/12 pass; typecheck clean; npm test 467/465 pass/2 skip/0 fail)
Spec: must-do #U1, #U2, check #2 (the test half)
Depends on: none
Blocked by: none
Context: The tile and the alerts both need one definition of "what is the current reading for each seat". It must never show a stale percent as current (U2) and must carry the age (U1). This ticket is pure: rows in, payload out, no file access.
Files: src/types/usage.ts (new), src/lib/server/usage/usageReadings.ts (new), src/lib/server/usage/usageReadings.test.ts (new)
Steps:
1. `src/types/usage.ts`: `UsageSeatId = 'main' | 'max2'`; `UsageWindow { pct: number | null; resetsAt: string | null; readAt: string; state: 'current' | 'reset' | 'unknown-reset' }` (`pct` integer 0 to 100, null when `reset`; `resetsAt` ISO string or null; `readAt` is the reading row's `endedAt`; `unknown-reset` is a pre-T1 five-hour row younger than 5 h); `UsageSeat { id; fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }` (null: no reading ever); `UsagePayload { seats: UsageSeat[]; generatedAt: string }`. Seats always listed `main` then `max2`.
2. `usageReadings.ts`: `export interface QuotaRow { endedAt: string | null; seat: string | null; fiveHour: number | null; sevenDay: number | null; fiveHourResetsAt?: number | null; sevenDayResetsAt?: number | null }` and `buildUsage(rows: QuotaRow[], now: number): UsagePayload` applying the "Reading rules" in this file's design block exactly. Tolerate junk rows (missing fields, bad dates): skip them, never throw.
3. Tests (`node:test`): a current 5h and weekly reading gives pct and ISO reset; a reading whose `fiveHourResetsAt` is before `now` gives `state: 'reset'`, `pct: null`, `readAt` kept (check 2: this fails on today's code, which has no such builder); same for weekly; a legacy 5h row (no reset field) 2 h old is `unknown-reset` with its pct, 6 h old is `reset`; the newest row per window wins even when a newer row has a null value for the other window; a row with `seat: null` is ignored; a seat with no rows has both windows null; rounding (0.795 gives 80, 0.804 gives 80); junk rows ignored.
Do not touch: `sam-quota-log` files, any widget, the dashboard store.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/usageReadings.test.js` passes; the 'reset' test has no counterpart on `789589e` (no `buildUsage` exists there, so the file cannot compile), which is the before-fail. `npm run typecheck` clean.

## T3: Read the quota runs and serve them (no probes)
Status: DONE 2026-10-05 (usageRuns.test 4/4 pass incl. 20-poll no-probe; grep clean; typecheck clean; npm test 471/469 pass/2 skip/0 fail)
Spec: must-do #U1, #U3, check #3
Depends on: T2
Blocked by: none
Context: `GET /api/dashboard/usage` returns `buildUsage` over `~/.sam/quota/runs.jsonl`. U3: it only shows what runs already reported; it must never start a Claude run, spawn anything, or call out to the network. The file grows by about 100 rows a day (rows carry cumulative token tables, about 1 KB each), polled every 30 s, so cache the parsed rows by file mtime and size. Follow the dashboard posture of `src/app/api/dashboard/money/route.ts` (`envelope`, `getEstate`, reads open).
Files: src/lib/server/livePaths.ts (edit: add `quotaRunsPath()` returning `path.join(samStateDir(), 'quota', 'runs.jsonl')`), src/lib/server/usage/usageRuns.ts (new: `readQuotaRows(): QuotaRow[]` and `getUsage(now = Date.now())`), src/app/api/dashboard/usage/route.ts (new), src/lib/server/usage/usageRuns.test.ts (new)
Steps:
1. Add `quotaRunsPath()` to `livePaths.ts` in the file's existing style (resolved per call).
2. `usageRuns.ts`: read the file synchronously, parse line by line (skip bad lines), keep `{ endedAt, seat, fiveHour, sevenDay, fiveHourResetsAt, sevenDayResetsAt }` only, cache on `mtimeMs:size`, return `[]` when the file is missing. Import nothing from `node:child_process` and never call `fetch`.
3. `route.ts`: `export const dynamic = 'force-dynamic'`, `GET` returns `envelope(getUsage(), 'sam.usage.limits', startedAt, estate.tick)` as the money route does.
4. Tests, with `HOME` set to a temp dir and a fixture `~/.sam/quota/runs.jsonl`: the route returns both seats with the right pct and reset; a missing file returns two seats with null windows; HOME override really redirects (write to a second temp HOME, see different data); check 3: `mock.method` on `child_process.spawn`, `exec`, `execFile`, `fork` and on `globalThis.fetch` (and `http`/`https` `request`), call the route's `GET` 20 times (20 polls is 10 minutes at the 30 s poll interval), assert none of them was called and that `~/.sam/jobs` in the temp HOME still does not exist or is empty.
5. Also grep proof in your report: `grep -rn "child_process\|fetch(\|anthropic\|claude" src/lib/server/usage src/app/api/dashboard/usage` shows no match in non-test files.
Do not touch: other dashboard routes, `src/lib/server/telemetry.ts`, the quota files under `~/.sam`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/usageRuns.test.js` passes (all cases, including the 20-poll no-probe case); the grep returns nothing; `npm run typecheck` clean. Before: no route exists, `curl` of the path on `789589e` (or the test file failing to compile) is the fail.

## T4: Dashboard service and store slice for usage
Status: DONE 2026-10-05 (usageParse.test 4/4 pass; typecheck clean; npm test 475/473 pass/2 skip/0 fail)
Spec: must-do #U1
Depends on: T3
Blocked by: none
Context: The widget reads its data like the others do: `dashboardService.getX` then a `Slice` in `useDashboardStore`, polled. Usage only changes when a chat turn ends, so poll every 30 s like money. The wire shape is `UsagePayload` (T2); parse defensively like `parseMoney`.
Files: src/lib/dashboardService.ts (edit: `getUsage`, `parseUsage`), src/store/dashboardStore.ts (edit: `usage` slice, `SliceKey`, `POLL_INTERVALS.usage = 30_000`, `refresh` case, the `bootstrap` key list), src/lib/usageParse.test.ts (new)
Steps:
1. Read how `getMoney` and `parseMoney` validate; write `parseUsage(raw: unknown): UsagePayload` that coerces anything malformed to a seat with null windows rather than throwing.
2. Add `getUsage(opts)` calling `request('/dashboard/usage', { signal })`.
3. Add the `usage` slice everywhere `money` appears in `dashboardStore.ts` (type, `emptySlice`, `SliceKey`, intervals, `refresh` switch, `bootstrap` keys, the polling loop picks it up from `POLL_INTERVALS`).
4. Test `parseUsage`: a good payload round-trips; garbage (null, a string, seats with wrong types) yields two seats with null windows and does not throw.
Do not touch: other slices' behaviour or intervals, the system 4 s poll, any widget.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/usageParse.test.js` passes; `npm run typecheck` clean (the `Record<SliceKey, number>` forces every spot). `npm test` unchanged counts plus the new tests.

## T5: Usage formatting helpers
Status: DONE 2026-10-05 (usageFormat.test 7/7 pass; typecheck clean; npm test 482/480 pass/2 skip/0 fail)
Spec: must-do #U1, #U2, check #2
Depends on: T2
Blocked by: none
Context: The tile's words are logic worth testing on their own: "read 14 min ago", the reset time, and the U2 wording "reset, not checked since <time>". Times are shown in Europe/London (Colin's clock), 24 hour.
Files: src/components/dashboard/widgets/usageFormat.ts (new), src/components/dashboard/widgets/usageFormat.test.ts (new)
Steps:
1. `formatAge(readAt: string, now: number): string`: under 1 min "read just now", then "read 14 min ago", "read 3 h ago", "read 2 d ago" (integers, floor).
2. `formatReset(iso: string | null, now: number): string`: same day "resets 18:40", another day "resets Mon 23:00", null "reset time not recorded".
3. `windowLine(w: UsageWindow | null, now: number): { text: string; sub: string; tone: 'ok' | 'warn' | 'high' | 'reset' | 'none' }`: `current` gives `text` "12%", `sub` the reset words; tone `warn` from 60 to 79, `high` from 80; `reset` gives `text` "reset" and `sub` "not checked since 14:05" (time of `readAt`, with the day name if not today), no percent anywhere in either string (U2); `unknown-reset` gives the pct and "reset time not recorded"; null gives "no reading yet".
4. Tests for each branch, including the U2 case (a `reset` window's `text` and `sub` contain no digits followed by `%`), run with an explicit `now` and a fixed time zone so they do not depend on the machine's zone.
Do not touch: the widget component, the store.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/dashboard/widgets/usageFormat.test.js` passes; `npm run typecheck` clean.

## T6: The Usage limits widget component
Status: DONE 2026-10-05 (UsageLimitsWidget.tsx compiles against store; typecheck clean; lint 0 errors/6 warnings; npm test 482/480 pass/2 skip/0 fail (visual proof is T22))
Spec: must-do #U1, #U2, #U7
Depends on: T4, T5
Blocked by: none
Context: A new widget in the existing style (read `SystemHealthWidget.tsx` and `WidgetFrame.tsx` first, and `fleet/SidebarWidgets.tsx` for how a tile renders it: tile mode, 176 px high at size `sm`, narrow on a phone). It shows, per seat (`main`, `max2`), the 5-hour and weekly percent with a `Meter`, the reset time, and one line for the reading's age. It never offers a "check now" action (spec section 3). This ticket only adds the component; it is not registered anywhere yet, so nothing visible changes.
Files: src/components/dashboard/widgets/UsageLimitsWidget.tsx (new)
Steps:
1. Copy the shape of `SystemHealthWidget`: `useDashboardStore((s) => s.usage)`, `resolveStatus`, `WidgetFrame` with `id="usage-limits"` (a string cast is fine until T7 adds the kind), title "Usage limits", `onRefresh={() => refresh('usage')}` (re-reads the file only, same as the others' refresh), `tile` passed through, `skeletonVariant="chart"` or the nearest existing variant.
2. Render two seat blocks. Each: seat name ("main", "max2"), a row per window labelled "5-hour" and "Weekly" with `windowLine` text, a `Meter` (hidden for `reset` and null), the `sub` text, and one age line using `formatAge` of the newer of the two windows' `readAt`. All text 12 px or larger. Must fit in a 176 px tile at 340 px wide without clipping; if it cannot fit both seats in `sm`, make the compact profile show the seat's higher percent only and the full profile (`md-tall`, `lg`) show everything.
3. Tone: `high` (80 and over) uses the existing warning or critical tone from `Indicators`; `reset` uses a muted tone. Add `aria-label`s that read the numbers ("main seat, 5-hour limit, 12 percent, resets 18:40").
4. No timers, no fetch of its own, no buttons beyond the frame's menu.
Do not touch: `WidgetFrame.tsx`, `Indicators`, other widgets, the registry (T7).
Proof: `npm run typecheck` and `npm run lint` clean (the component compiles against the real store type). `npm test` counts unchanged. The visual proof is T22.

## T7: Register the widget kind
Status: DONE 2026-10-05 (userPreferencesStore.test 3/3 pass (3/3 fail with the default line removed); typecheck clean; npm test 485/483 pass/2 skip/0 fail. Ticket wrong: no existing reconcileLayout test, new test file made)
Spec: must-do #U1, #U7
Depends on: T6
Blocked by: none
Context: Adding a `WidgetKind` touches four places that must agree: the type, the registry (`Record<WidgetKind, ...>`, so the compiler enforces it), the layout API's `VALID_IDS` (and its length check), and the persisted default layout. Persisted layouts outlive deploys: `reconcileLayout` appends widgets shipped after the operator last saved, so existing saved layouts must keep working.
Files: src/types/dashboard.ts (edit: add `'usage-limits'` to `WidgetKind`), src/components/dashboard/widgetRegistry.tsx (edit: entry with a `Gauge` or `BarChart3` icon from lucide, tone `warning` or `accent`, the T6 component), src/app/api/dashboard/layout/route.ts (edit: `VALID_IDS`), src/store/userPreferencesStore.ts (edit: `DEFAULT_LAYOUT`, `md-wide`, visible)
Steps:
1. Make the four edits. Remove the `as` cast in `UsageLimitsWidget.tsx` if T6 left one (a fifth, one-line file edit allowed for that).
2. Update any existing test that hard-codes the four widget kinds (grep `dashboardLayout.test.ts`, `reconcileLayout`, `VALID_IDS`, `WIDGET_ORDER`).
3. Add a test next to the existing `reconcileLayout` test (find it): a persisted layout with the old four widgets reconciles to five, `usage-limits` appended; a persisted layout that already has it is unchanged.
Do not touch: the order or sizes of the four existing widgets, `tileLayout.ts` (T8).
Proof: the new reconcile test passes and fails on `789589e` (kind unknown, so the appended entry is absent); `npm run typecheck` clean; `npm test` all pass.

## T8: Show it as a fleet tile (phone and desktop)
Status: DONE 2026-10-05 (tileLayout.test 13/13 pass; typecheck clean; npm test 486/484 pass/2 skip/0 fail. Default size tall, not sm (sm compact shows only the higher percent))
Spec: must-do #U1, #U7
Depends on: T7
Blocked by: none
Context: The fleet dashboard (desktop drawer and phone Job tab) renders its carried-over widgets through `SidebarWidgets.tsx` and a per-device `tileLayout` (`system-health`, `daily-tasks`, `money-in`, localStorage key `sam.fleet-tiles.v1`). `reconcileTiles` already appends tiles a device has not seen, so Colin's existing saved layout gains the tile at the end with no migration.
Files: src/components/dashboard/fleet/tileLayout.ts (edit: `TileId`, `DEFAULT_TILES`), src/components/dashboard/fleet/SidebarWidgets.tsx (edit: `TILE_WIDGETS`), src/components/dashboard/fleet/tileLayout.test.ts (edit)
Steps:
1. Add `'usage-limits'` to `TileId` and as the fourth `DEFAULT_TILES` entry (`sm`, visible). If T6's content cannot fit an `sm` tile without clipping at 412 px wide, make the default `tall` and say so in your report.
2. Map it in `TILE_WIDGETS` to `UsageLimitsWidget`; check `titleOf` resolves its registry title.
3. Update `tileLayout.test.ts` (default ids now four; tests that rely on 'money-in' being last, or on hide/move positions, must be kept correct, not weakened); add a case: a persisted layout of the old three reconciles to four with `usage-limits` last.
Do not touch: the three existing tiles' behaviour, order of existing defaults, the drag and menu code, `FleetPhoneView.tsx`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/dashboard/fleet/tileLayout.test.js` passes (the four-tile and old-three-reconcile cases fail on `789589e`); `npm run typecheck`, `npm run lint`, `npm test` pass.

## T9: Alert decision logic (80%, once per window)
Status: DONE 2026-10-05 (usageAlerts.test 6/6 pass; typecheck clean; npm test 492/490 pass/2 skip/0 fail)
Spec: must-do #U4, #U5, #U8, checks #4, #5, #21
Depends on: T2
Blocked by: none
Context: Pure function so every rule is testable without a push. It takes the `UsagePayload` and the already-alerted state and returns the pings to send and the next state. Rules are in the "Alert rule" design block above. Window id = that window's reset epoch (ISO to epoch ms).
Files: src/lib/server/usage/usageAlerts.ts (new), src/lib/server/usage/usageAlerts.test.ts (new)
Steps:
1. `export type AlertState = Record<string, { fiveHour?: number; sevenDay?: number }>` (seat to last pinged reset epoch ms per window) and `export interface UsagePing { seat; window: 'fiveHour' | 'sevenDay'; pct: number; resetsAt: string; title: string; body: string; tag: string }`.
2. `decideAlerts(usage: UsagePayload, state: AlertState, now: number): { pings: UsagePing[]; next: AlertState }`. Threshold uses the rounded pct (0.80 gives 80, fires; 0.79 gives 79, does not). Skip `reset` and `unknown-reset` windows and null windows. `body` names the seat, the percent and the reset time using `formatReset` style wording from T5 (import it, do not duplicate), for example "main seat: 5-hour limit at 82%, resets 18:40". `title` "SAM usage". `tag` `usage-<seat>-<fiveHour|sevenDay>`.
3. Tests: check 4: a 5-hour pct of 0.80 gives exactly one ping naming seat, percent and reset; 0.79 gives none. Check 5: the same for weekly (0.80 one, 0.79 none). Check 21: feed `decideAlerts` three readings over 0.80 in one window threading `next` back in (one ping total), then a reading with a new reset epoch over 0.80 (second ping): exactly two pings overall, for 5-hour and again for weekly. A seat at 5-hour 85 and weekly 81 gives two pings in one call. An expired window never pings. Two seats are independent.
Do not touch: the reader, the route, any push code (T10).
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/usageAlerts.test.js` passes; no `usageAlerts` exists on `789589e`, so every case fails before. `npm run typecheck` clean.

## T10: Alert runner: state file and the push
Status: DONE 2026-10-05 (usageAlertRunner.test 7/7 pass with recording SAM_PUSH_BIN; no alerts.json in real ~/.sam/quota; typecheck clean; lint 0 errors; npm test 499/497 pass/2 skip/0 fail)
Spec: must-do #U4, #U5, #U8, checks #4, #5, #21
Depends on: T3, T9
Blocked by: none
Context: Glue between the readings, `decideAlerts` and `sam-push`. Phone pings go through the existing path: `pushBin()` in `src/lib/server/chat/turnPing.ts` (`SAM_PUSH_BIN` or `~/.local/bin/sam-push`), called with `--title --body --url --tag`, as `sendPing` does there. Unlike `sendPing`, await the child so the state is only recorded after the push command exits 0 (it exits 0 with no subscribers). State file `~/.sam/quota/alerts.json`, resolved through `livePaths.ts`, written atomically (tmp file then rename). Never throws to the caller.
Files: src/lib/server/livePaths.ts (edit: add `quotaAlertsPath()`), src/lib/server/usage/usageAlertRunner.ts (new: `runUsageAlerts(now = Date.now()): Promise<UsagePing[]>`), src/lib/server/usage/usageAlertRunner.test.ts (new)
Steps:
1. Add `quotaAlertsPath()` to `livePaths.ts` (per-call, like the others).
2. `runUsageAlerts`: serialise calls with an in-process promise chain (two chat turns ending together must not double-ping); `getUsage(now)` (T3), load state (missing or corrupt file means `{}`), `decideAlerts`, send each ping with a 10 s timeout, record into state only the pings whose push exited 0, write state, return the sent pings. `--url "/"` (the dashboard) on every ping.
3. Tests with a temp `HOME`, a fixture `runs.jsonl`, and `SAM_PUSH_BIN` pointing at a tiny executable script that appends its args to a file: check 4, a 5-hour 0.80 reading sends exactly one push whose args contain the seat, `80%` and the reset time; 0.79 sends none. Check 5, same for weekly. Check 21, call `runUsageAlerts` four times as the fixture is edited (three over-0.80 readings in one window, then one after the reset with a new reset epoch): exactly two pushes in the file; same for weekly. A push command that exits 1 leaves the state unmarked, so the next call retries. A corrupt `alerts.json` does not throw. Two concurrent calls send one push.
Do not touch: `turnPing.ts` (import `pushBin` from it, do not copy it), `sam-push`, the notifications code.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/usageAlertRunner.test.js` passes (fails before: no runner exists); `npm run typecheck` clean; `ls` of the real `~/.sam/quota` shows no `alerts.json` created by the tests.

## T11: Collect and alert at the end of every chat turn (U9)
Status: DONE 2026-10-05 (usageCollect.test 3/3 pass (push 0.08 s after endedAt, no timer; hook registered once); typecheck clean; lint 0 errors; npm test 502/500 pass/2 skip/0 fail)
Spec: must-do #U9, #U4, #U5, #U8, check #22
Depends on: T1, T10
Blocked by: none
Context: This is the smallest real hook point (see the design block): `startTurn.ts` has an `onTurnExit` hook list that already runs the title hook and `pingOffScreenChat` after every turn, with each hook in its own try/catch. Push one more hook that runs the harvester (so `runs.jsonl` has the new row and the tile sees it) and then `runUsageAlerts()`. The harvester path is `~/bin/sam-quota-log.py` (live; T25 installs the new one, until then rows simply lack `fiveHourResetsAt` and 5-hour alerts do not fire) with env override `SAM_QUOTA_LOG_BIN` (tests, and the staged copy). Handoff memo turns (`event.internal`) also use quota, so they are included. Verify first, by reading `startTurn.ts` around the `runExitHooks` call, that the job's `meta.json` already has `endedAt` and the stream is complete when hooks run (the harvester only takes jobs with `endedAt`); if not, wait for it with a bounded retry (up to 10 s) before harvesting.
Files: src/lib/server/usage/usageCollect.ts (new: `collectUsage(): Promise<void>`), src/lib/server/chat/startTurn.ts (edit: one `onTurnExit.push(...)` line), src/lib/server/usage/usageCollect.test.ts (new, box-only)
Steps:
1. `usageCollect.ts`: `collectUsage()` spawns `python3 <bin>` (`SAM_QUOTA_LOG_BIN` else `path.join(os.homedir(), 'bin', 'sam-quota-log.py')`) with a 60 s timeout, ignores its stdout, swallows every error (log with `console.error` like `runExitHooks`), then `await runUsageAlerts()`. Calls are serialised in-process. The harvester never runs `claude`; it only reads the job store.
2. `startTurn.ts`: `onTurnExit.push(() => collectUsage());` after the existing pushes, with a short comment citing U9. The hook must not delay the next turn: the chat lock is already released before hooks run, and this hook is fire-and-forget at the call site (`void`), as the title hook is.
3. Test (check 22), box-only, temp `HOME`: a fake finished job in `~/.sam/jobs/<id>/` (`meta.json` with `endedAt` = now, a framed `stdout.log` whose `rate_limit_event` has `five_hour: {utilization: 0.81, resetsAt: <now + 2 h in epoch s>}`), a session transcript file under `~/.claude/projects/x/<session>.jsonl` so the seat resolves to `main`, `SAM_QUOTA_LOG_BIN` set to the staged-or-live harvester that carries `fiveHourResetsAt` (the `.next.py` from T1; the test must name which one it ran), `SAM_PUSH_BIN` a recording script. Call `collectUsage()` with no timer involved and assert: one push recorded, its body names `main`, `81%` and the reset time, and the elapsed time from the job's `endedAt` to the recorded push is under 300 s (in practice seconds). Second call (a later turn at 0.82, same window): still one push in total (U8). A harvester that fails or a missing binary does not throw.
4. Show the hook is wired: a unit test (or an assertion in the same file) that `onTurnExit` includes the collect hook after import of `startTurn`.
Do not touch: `~/.sam/jobs-watch.sh`, `sam-jobs-watch.timer`, `run.sh`, `sam-job`, the hourly quota timer, `pingOffScreenChat`, the title hook, the chat lock logic.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/usageCollect.test.js` passes (fails on `789589e`: no hook, no module); `npm test` all pass; `grep -n "collectUsage" src/lib/server/chat/startTurn.ts` shows the single registration; no file created under the real `~/.sam`.

---

## T12: Desktop and laptop golden guard (captured on 789589e)
Status: DONE 2026-10-05 (floorGolden.test 7/7 pass on untouched floor; spacing mutation fails the 2 desktop sizes, reverted; typecheck clean; npm test 509/507 pass/2 skip/0 fail)
Spec: check #18 (the guard half), Won't do: desktop
Depends on: none
Blocked by: none
Context: The spec forbids any desktop or laptop floor change and proves it by a hash of the scene. The mockup's hash script was thrown away, so this ticket makes a permanent one, FIRST, on untouched `789589e` floor code, so every later floor ticket is checked against it. This ticket is a guard: it passes before and after later changes; show it can fail by a deliberate mutation. It must be written and its golden values captured BEFORE any other floor ticket edits `floorRender.ts`.
Files: src/components/floor/floorGolden.test.ts (new)
Steps:
1. Use the floor test fixture style (`fixture()` state in `floorRender.test.ts`, a fixed `NOW`). Six sizes with the options the app really uses: `DESKTOP_OPTIONS` at 1150x666 (1920x1080 hero) and 1600x760; `LAPTOP_OPTIONS` at 1166x596, 996x546, 910x516, and 800x500. Choose these six and say so.
2. For each size, build a canonical JSON of: `computeLayout` (all numeric fields, `GU`, `home`), `camFor` for each of the five Generals and for none, `buildScene` output for both motion modes (`reduced: false` at fixed `time` inputs 0 and 1.37 s, and `reduced: true`) with stations, links, pads, figures, labels, and `hitGeneral` over a 24 by 16 grid across the canvas at the home camera and at each General's camera. Round numbers to 6 decimals; drop functions. Hash it with `node:crypto` sha256.
3. Run it on the untouched base and write the 6 hashes into the file as constants (`GOLDEN`), with a comment: captured on 789589e, never edit except for a deliberate desktop change signed off by Colin.
4. The test recomputes each hash and `assert.equal`s it. Print the failing size name in the message.
5. Show it can fail: temporarily change `DESKTOP_OPTIONS.spacing` by 1 in `floorRender.ts`, run the test, see it fail on the desktop sizes, then revert (report both outputs; `git diff --stat` must show `floorRender.ts` clean at the end).
Do not touch: `floorRender.ts` (except the temporary mutation, reverted), `PHONE_OPTIONS`, any existing test.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/floorGolden.test.js` passes on base; passes again after the mutation is reverted; fails during the mutation (output pasted). `git diff --stat` lists only the new test file.

## T13: Per-General row offset in the scene (no visible change)
Status: DONE 2026-10-05 (floor group 39/39 pass incl. golden unchanged and new GV test; typecheck clean; npm test 510/508 pass/2 skip/0 fail. Ticket wrong: GV had to be non-enumerable so the golden JSON stays identical)
Spec: must-do #P1, #P3, #P4, #P8, check #18
Depends on: T12
Blocked by: none
Context: Today every General sits at v = 0. The pyramid needs a row offset `GV[id]` (all zero everywhere for now), threaded through the scene: platforms, towers, stage pads, bust slots, cards, worker pads and figures, returns, and the links (`samLink`, `wkLink`). This is pure plumbing and must change nothing: with `GV` all zero the scene is identical, which `floorGolden.test.ts` proves. `camFor` and `hitGeneral` are NOT touched here (T16 and T17 own them, with their own tests). The mockup diff (`git -C /home/col/SAM_ui-pyramid-mock diff`) shows the places; it was cut before the worker figures and `figureHit.ts`, so also thread `gv` through the figure and `lp` (label point) code that `789589e` has and the mockup lacks. Use it for reference only, copy nothing blind.
Files: src/components/floor/floorRender.ts (edit), src/components/floor/floorRender.test.ts (edit)
Steps:
1. `Layout` gains `GV: Record<GeneralId, number>`; `computeLayout` fills it with zeros for every option set. `samLink(layout, gu, gv = 0)`, `wkLink(layout, gu, padU, cardBot, gv = 0)`.
2. In `buildScene`'s General loop add `const gv = layout.GV[g.id]` and add it to every v coordinate that belongs to that General: `isoBox`, `P` calls, tower slabs, stage pads, `bBase` and `emitter`, the card's `y` (`Y(gv + layout.cardTop)`), worker pads `padV`, `P(u, padV, 3)`, `lp`, return figures, both `wkLink` call sites and `samLink`.
3. `phoneLabels`: the label `y` per General uses `layout.GV[st.id] + layout.cardTop`.
4. New test in `floorRender.test.ts`: take `computeLayout(1100, 640, DESKTOP_OPTIONS)`, copy it with `GV.hephaestus = 120` (others 0), build the scene, and assert that hephaestus's platform, bust slot, card, pads and figures all moved down by `120 * view.cam.k` canvas px against the zero-offset scene, that every other General is unchanged to 1e-9, and that its `samLink` end point moved by 120 in v. Fails before: `GV` does not exist (compile error, then no movement).
Do not touch: `camFor`, `hitGeneral`, `computeLayout`'s fitting maths, `PHONE_OPTIONS`, `figureHit.ts`, `FloorCanvas.tsx`, `ringRender.ts`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/floorGolden.test.js .test-build/components/floor/floorRender.test.js .test-build/components/floor/ringRender.test.js` all pass (golden unchanged is check 18's guard; the new GV test fails on base). `npm run typecheck`, `npm run lint`, `npm test` pass with the same counts plus the new test.

## T14: Pyramid layout and the geometry helpers (opt-in)
Status: DONE 2026-10-05 (phonePyramid.test 5/5 + golden 7/7 pass; 412x915 bust 58.0 px samK 1.15, margins 16.0 px at 360/390/412; typecheck clean; npm test 515/513 pass/2 skip/0 fail. CAVEAT: at 390x371 scale drops to 0.149 (bust 7.5 px), name labels overlap there)
Spec: must-do #P1, #P2, #P7, #P9, checks #8 (numbers), #9, #14, #16 (edge half)
Depends on: T13
Blocked by: none
Context: Add the pyramid as a layout mode a phone options object can opt into. `PHONE_OPTIONS` is NOT switched on here (T20 does that), so production behaviour is unchanged until then. The mockup's `pyramidLayout` (`git -C /home/col/SAM_ui-pyramid-mock diff`) is a starting point: the widest row sets the scale, rows are full columns, the next row's busts clear this row's pads, and SAM takes the height left (largest `f` from `samMax` down to `samMin` 0.6 whose ring fits across the screen and clears the top row). Differences to design in: a 16 px minimum margin to every platform and label (the mockup's pad of 10 gave about 14 px, failing P7), room under BOTH rows for worker pads and the figure label (the mockup reserved it only for the top row), and the P2 tension noted in the design block (raise phone `bustU` so the bust stays at or above 57.5 px at 412x915). Where `PYRAMID_ROWS` is exported, Cerberus and Prometheus are the top row, Hermes, Hephaestus and Calliope the bottom (P1).
Files: src/components/floor/floorRender.ts (edit: `SceneOptions.pyramid`, `pyramidLayout`, exported `PYRAMID_ROWS`, exported test-only-for-now `PHONE_PYRAMID_OPTIONS = { ...PHONE_OPTIONS, pyramid: ... }`), src/components/floor/phoneGeometry.ts (new: pure box helpers), src/components/floor/phonePyramid.test.ts (new)
Steps:
1. `SceneOptions.pyramid?: { rows: GeneralId[][]; samMin: number; edge: number }`. In `computeLayout`, when `opts.pyramid` and the phone anchors are set, call `pyramidLayout`; otherwise the existing code path runs untouched (the golden guard proves desktop). `GV` and `GU` come from the rows (rows centred, each General at `(i - (n - 1) / 2) * spacing`).
2. Scale: the widest row's outer platform edges at least `edge` (16) px inside the canvas at every width from 360 to 430; spacing stays 170. Reserve the pads and the figure label under each row; SAM sizing and `home` as in the mockup, `samMin` 0.6, `samMax` stays 2.5 (P2).
3. `phoneGeometry.ts`: pure helpers over a `Scene` and `Layout`, used by this and later tickets' tests: `platformPoly(station)` (union hull of `box.top/left/right`), `bustBox(station)`, `labelBox(label)` (the phone name and state text box, at least 11 px canvas text, generous to the name's length), `samTagBox`, `numeralBox` (the ring's 12 numeral, from `ringGeometry` in `ringRender.ts`), `padBoxes`, `rectsOverlap`. Keep them dependency-free of the canvas.
4. `phonePyramid.test.ts`, using `PHONE_PYRAMID_OPTIONS` and fixtures at 360x780, 390x844, 412x915, and 390x371: rows (P1: top row's stations are cerberus and prometheus, strictly above hermes, hephaestus, calliope; each row centred on the canvas); P2 (at 412x915 each bust height is at least 57.5 px, `layout.samK` between 0.6 and 2.5 at all sizes); P7 (check 14: every platform polygon and label box is at least 16 px inside the canvas edges at 360, 390, 412 and at 390x371); P9 (at 390x371 both rows and SAM are present and `samK` is between 0.6 and 2.5, no General box overlaps another, the SAM tag or the 12 numeral).
5. Existing `ringRender.test.ts` phone cases keep using `PHONE_OPTIONS` and must still pass untouched.
Do not touch: `PHONE_OPTIONS` itself, desktop and laptop option sets, `FloorCanvas.tsx`, the existing phone tests.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/phonePyramid.test.js .test-build/components/floor/floorGolden.test.js` passes (the pyramid tests fail on base: no `pyramid` option); `npm test` all pass, same counts plus new. Report the measured bust px, `samK`, and the smallest platform margin at each of the four sizes.

## T15: SAM links never pass through another General (P3)
Status: DONE 2026-10-05 (check-10 link test passes at 360/390/412 and 390x371, idle and all-busy (failed on today's curve: hermes link crosses SAM tag); golden 7/7; typecheck clean; npm test 516/514 pass/2 skip/0 fail. Centre link routes round the right of the back row, not between the columns)
Spec: must-do #P3, check #10
Depends on: T14
Blocked by: none
Context: In the mockup, Cerberus's link dropped through a 10 to 25 px gap between top-row platforms, the outer bottom-row links swung across the ring's front, and Hermes's lit link ran close to the SAM tag. With the spec's order, the bottom row's centre General (Hephaestus) sits under the gap between Cerberus and Prometheus, and its link must thread that gap. P3 covers lit links too ("lit links stay visible end to end"): the same curve is used for the lit route, so one fix covers both. Only the phone pyramid (rows set) changes: when `gv` is 0 the existing curve stays exactly as is (golden guard).
Files: src/components/floor/floorRender.ts (edit: `samLink` row-aware control points), src/components/floor/phonePyramid.test.ts (edit)
Steps:
1. For a General with `gv > 0` replace the control points so the route leaves SAM, stays clear of the top row's platforms, busts and label boxes, and lands on its own platform's back corner. Start from the mockup's `[gu * 0.9, a[1] + 30], [gu, b[1] - 70]` and adjust until the test passes; the centre link must pass between the two top-row columns, the outer links outside them, and none may cross the ring's front arc or the SAM tag box.
2. Test (check 10): sample each curve at 80 points (`bez`) at 360, 390, 412 wide (full height) and at 390x371; for every General's link, no sample lies inside another General's platform polygon, bust box or label box, nor inside the SAM tag or 12 numeral box (`phoneGeometry.ts`), with a 3 px margin. Also assert the link's end point is inside its own platform's bounds. Also run the same assertion on the lit links in a scene where all five Generals are busy (`litLinks`).
3. Fails before: with the mockup-style or today's curve, the centre link crosses a top-row label or bust (confirm by running the test first against the unmodified `samLink`).
Do not touch: `wkLink`, desktop curve code path, `PHONE_OPTIONS`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/phonePyramid.test.js .test-build/components/floor/floorGolden.test.js` passes; paste the failing output of the new link test before the `samLink` change.

## T16: Camera framing for a tapped General, either row (P5)
Status: DONE 2026-10-05 (check-12 framing test passes for all 5 Generals at 360/390/412 (failed before: hermes platform -30 px outside canvas); golden 7/7; typecheck clean; npm test 517/515 pass/2 skip/0 fail)
Spec: must-do #P5, check #12 (the numbers; screenshots in T23)
Depends on: T14
Blocked by: none
Context: `camFor(layout, id)` centres on `GU[id]` and a fixed v range (`top = -110` to `layout.bot`). A bottom-row General sits at `GV` below, so the camera must follow its row and show its whole platform, bust and label, whichever row. In the mockup this was changed but never checked for framing.
Files: src/components/floor/floorRender.ts (edit: `camFor`), src/components/floor/phonePyramid.test.ts (edit)
Steps:
1. `camFor`: add `layout.GV[id]` to the camera's y, and bound the zoom `k` so the General's own platform, bust and label (the v range `top` to the row's own foot, using the row's pad and label reservation from T14, not `layout.bot` of the other row) fit within the canvas minus `pad` and `padTop`. Desktop path unchanged (`GV` zero gives the old formula exactly).
2. Test (check 12): for each of the five Generals, with `PHONE_PYRAMID_OPTIONS` at 360x780, 390x844, 412x915, build the scene with `cam: camFor(layout, id)` and assert the General's platform polygon, bust box and label box lie fully inside `[0, W] x [0, H]`, and that the camera zoom `k` is larger than the home `s` (it actually zooms). Fails before: the bottom-row Generals are framed off-centre or clipped.
3. Check `lerpCam` between home and each General still gives sane in-between frames (no NaN).
Do not touch: `lerpCam`, desktop `zoom` options, `FloorCanvas.tsx`'s animation code.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/phonePyramid.test.js .test-build/components/floor/floorGolden.test.js` passes; the new framing test fails on the pre-change `camFor` (paste it).

## T17: Tap areas per row that never overlap (P4)
Status: DONE 2026-10-05 (check-11 grid test passes at 360/390/412 and areas pairwise disjoint (failed on old hitGeneral: hermes platform null); floor group 36/36; typecheck clean; npm test 518/516 pass/2 skip/0 fail)
Spec: must-do #P4, check #11
Depends on: T14
Blocked by: none
Context: `hitGeneral` tests a column rectangle (x within 0.48 of the spacing, y from the platform top minus 70 to the General's foot). In a pyramid the rows are offset by half a column and the top row's foot overlaps the bottom row's busts, so rectangles overlap; the mockup patched it with "nearest row wins" (not carried over). Replace it with proper per-row bounds when rows exist, keep the old formula untouched when all `GV` are zero. Worker figures keep their own 44 px square that wins over a General (floor-fixes rule, `figureHit.ts`); T19 handles that.
Files: src/components/floor/floorRender.ts (edit: `hitGeneral`, new exported `hitAreas(layout, cam)`), src/components/floor/phonePyramid.test.ts (edit)
Steps:
1. For `GV` rows, a General's area is its column x-range and a y-range that starts above its bust top and ends at the top of the NEXT row's bust area (for the last row, its foot). No two Generals' areas may intersect. `hitAreas` returns the rectangles so the test can check disjointness directly.
2. Test (check 11): at 360, 390, 412 wide, with an idle fixture (no figures): a 12 by 12 grid over each General's platform polygon, bust box and label box (from `phoneGeometry.ts`) returns that General through `hitGeneral`, and never another; the `hitAreas` rectangles are pairwise disjoint; points outside every area (the SAM ring, the canvas corners) return null. Fails before: top-row labels and bottom-row busts return the wrong General.
Do not touch: `hitFigure`, `pickAt`, `figureHit.ts`, `FloorCanvas.tsx`, the desktop hit rectangle.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/phonePyramid.test.js .test-build/components/floor/floorRender.test.js .test-build/components/floor/figureHit.test.js .test-build/components/floor/floorGolden.test.js` all pass; the new grid test fails on the old `hitGeneral` (paste it).

## T18: Labels, SAM tag and the 12 numeral never overlap (P6)
Status: DONE 2026-10-05 (check-13 test passes at 360/390/412 and 390x371 with no exemption (before the fix 390x371 failed with 8 overlaps); phonePyramid+ringRender+golden 36/36; typecheck clean; npm test 520/518 pass/2 skip/0 fail. At 390x371 the layout trims fixed reservations, scale 0.376, bust 18.9 px, label gap 2.53 px; T15 link-vs-label still exempt at 390x371)
Spec: must-do #P6, check #13
Depends on: T14
Blocked by: none
Context: With two rows, the SAM tag (27 px tall, put under the ring when the ring fills the width) sat about 20 px above a top-row bust in the mockup. P6 needs the SAM tag, the 12 numeral and every General's name and state to be readable and not overlap anything: each other, a bust, a platform, or the ring. The fix may be in the layout's SAM-size search (it already reserves room for the numeral and tag) or in `phoneLabels` placement.
Files: src/components/floor/floorRender.ts (edit: `phoneLabels` and/or the pyramid SAM-size search if needed), src/components/floor/phonePyramid.test.ts (edit)
Steps:
1. Add the test first (check 13): at 360x780, 390x844, 412x915 and 390x371, using the `phoneGeometry.ts` boxes, assert no overlap (with a 2 px margin) between any two of: the SAM tag box, the 12 numeral box, the five name-and-state label boxes; and no label box overlaps any General's platform polygon or bust box (a General's own label sits below its own platform by design: allow only the label's own platform edge touching, say so in the test); and the tag and numeral clear every bust by at least 4 px. Run it, paste the failures if any.
2. Fix whatever it finds (label y from `GV`, the tag's x/y, or the SAM-size loop's clearance constant). If the layout from T14 already passes, say so; the test still ships as the guard and its before-fail is that the helper boxes for the bottom row did not exist on base (compile error).
Do not touch: ring drawing in `ringRender.ts` (SAM's ring and clock), the desktop `SamLabel`, label fonts under 11 px.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/phonePyramid.test.js .test-build/components/floor/ringRender.test.js .test-build/components/floor/floorGolden.test.js` passes. Report the smallest gap found between any two boxes at each size.

## T19: Worker figures and job pads on both rows (P8)
Status: DONE 2026-10-05 (P8 figure/pad test passes at 360/390/412 with margins 40-60 px, phonePyramid+figureHit+golden 26/26; typecheck clean; npm test 521/519 pass/2 skip/0 fail. Test passes on T14 reservation already, no floorRender change; 390x371 exempt for figure squares and caption)
Spec: must-do #P8, checks #15 (the numbers; screenshot in T23), #11 (figures interplay)
Depends on: T15, T17
Blocked by: none
Context: Floor-fixes added worker figures with a 44x44 px hit square that wins over the General behind it (`figureHit.ts`, `pickAt`). In the pyramid, the top row's pads and figures sit between the rows, and the bottom row's must not be under the Ask SAM bar or the caption (the caption's top is `CAPTION_PX` = 110 px above the canvas foot, see `ringRender.test.ts`). A top-row figure's 44 px square must not reach the bottom row's bust, or a tap on that bust would open a job instead of the General (P4).
Files: src/components/floor/floorRender.ts (edit: the pyramid row-step and foot reservation), src/components/floor/phonePyramid.test.ts (edit)
Steps:
1. Test first. Fixture: one running job on one General per row (cerberus on the top row, hephaestus on the bottom) and a second with two figures (`slotOffsets` spreads them). At 360x780, 390x844, 412x915: every visible figure and its pad box is inside the canvas, above `H - 110` (the caption top), and not inside any other General's platform polygon, bust box or label box; the top-row figure's 44 px hit square (from `FIGURE_HIT_PX` in `figureHit.ts`) does not intersect the bottom row's bust box or platform polygon; the bottom row's lowest figure square ends above `H - 110`.
2. Fix the pyramid layout's row step and foot reservation (T14's constants) until the test passes. If at the short 390x371 hero the clearance cannot hold even at `samK` 0.6, exempt that one size from the figure-square clearance only (state it in a comment and in your report); the pads still must stay inside the canvas there, and both rows and SAM remain visible (P9).
3. Re-run T14's P7 and P9 cases and T18's overlap case: they must still pass with the larger reservation.
Do not touch: `figureHit.ts` and its 44 px size (floor-fixes Must 17, 18), figure drawing in `FloorCanvas.tsx`, desktop pad spacing.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/floor/phonePyramid.test.js .test-build/components/floor/figureHit.test.js .test-build/components/floor/floorGolden.test.js` passes; the new figure test fails against T14's reservation (paste it before the fix); `npm test` all pass.

## T20: Switch the pyramid on for the phone and update the phone tests
Status: DONE 2026-10-05 (grep PYRAMID_VARIANT/MOCKUP/PHONE_PYRAMID_OPTIONS empty; golden unedited; 4 phone cases fail on single row, pass now; typecheck clean; lint 0 errors; npm test 521/519 pass/2 skip/0 fail. 412x915 bust 57.97 px samK 1.15 Zeus 109.6 px; 390x371 bust 18.95 samK 0.6. Extra edit: fleet/phoneView.test.ts row order; dial-size and crowded-times cases rewritten for 0.6 floor)
Spec: must-do #P1, #P2, #P9, #P10, checks #8, #9, #16, #17
Depends on: T15, T16, T17, T18, T19
Blocked by: none
Context: Until now the pyramid was opt-in through `PHONE_PYRAMID_OPTIONS` and `PHONE_OPTIONS` was untouched. This ticket makes it the phone layout and removes the scaffolding: the spec forbids a flag or "MOCKUP" shortcut left in the code (P10). The five existing phone tests that assert today's sizes (the ring size, Zeus's size at three phone sizes, SAM's size on a short screen: the `full` cases and the `samK === 1 on a short phone hero` case in `ringRender.test.ts`, and the ring cases at the phone sizes) must be rewritten to the new sizes, not deleted.
Files: src/components/floor/floorRender.ts (edit: `PHONE_OPTIONS` gains `pyramid`, `bustU` as set in T14; delete `PHONE_PYRAMID_OPTIONS`), src/components/floor/ringRender.test.ts (edit), src/components/floor/phonePyramid.test.ts (edit: use `PHONE_OPTIONS`)
Steps:
1. Set `pyramid: { rows: PYRAMID_ROWS, samMin: 0.6, edge: 16 }` (and the phone `bustU`) inside the `PHONE_OPTIONS` literal. Delete the temporary export and point every test in `phonePyramid.test.ts` at `PHONE_OPTIONS`. Run the whole floor test group and note which `ringRender.test.ts` phone cases now fail.
2. Rewrite those cases to assert the new geometry: Zeus is at least 0.6 and at most 2.5 times his base size (`layout.samK`), the ring still grows with Zeus and stays centred (`geo.rx`, `zeusSlot.x`), the Generals' labels end above the caption (`foot <= cap - 8`) with both rows counted, the SAM tag is on screen and clears the busts of both rows, the 12 numeral clears the top row's busts. The short-hero case now asserts `samK` between 0.6 and 2.5 and no overlap (P9) instead of `=== 1`. Keep the strictness of every other existing assertion.
3. Confirm P10: `grep -rn "PYRAMID_VARIANT\|MOCKUP\|PHONE_PYRAMID_OPTIONS" src/` returns nothing.
4. Report the measured numbers at 412x915: bust px (at least 57.5), `samK`, Zeus px, and at 390x371 the same.
Do not touch: desktop and laptop options, `floorGolden.test.ts` (must stay byte-identical to T12's), `FloorCanvas.tsx`.
Proof: `grep -rn "PYRAMID_VARIANT\|MOCKUP\|PHONE_PYRAMID_OPTIONS" src/` prints nothing; `git diff --stat` shows `floorGolden.test.ts` untouched; `npm test` all pass, with the phone cases asserting the new sizes (the old cases failed against the pyramid, the new ones fail against `789589e`'s single row: paste one example); `npm run typecheck`, `npm run lint` clean.

## T21: Proof rig and the 789589e "before" build
Status: DONE 2026-10-05 (CHECK 0 PASS on before and after builds, no 49xx listener, before worktree clean; baseline npm test at 789589e 452/450 pass/2 skip/0 fail)
Spec: whole (enables checks #1, #8, #12, #15, #16, #7)
Depends on: none
Blocked by: none
Context: Browser checks need a logged-in, isolated, repeatable rig and a BEFORE build of `789589e` so each browser check can be shown to fail before and pass after. Reuse, do not copy, the floor-fixes rig. Files live OUTSIDE the repo. Read `/home/col/delivery/ux-audits/floor-fixes-proofs/common.mjs` and `run-proof.sh`, and the harness `lib.mjs`, `start.sh`, `stop.sh` first.
Files: new files only in `/home/col/delivery/ux-audits/usage-pyramid-proofs/` (`common.mjs`, `run-proof.sh`, `t0-smoke.mjs`, `results/`); a detached worktree `/home/col/SAM_ui-usage-pyramid-before` at `789589e`
Steps:
1. `git -C /home/col/SAM_ui worktree add --detach /home/col/SAM_ui-usage-pyramid-before 789589e`, then `npx next build` there (needs `node_modules`: symlink or `npx -y npm@10 ci --include=dev`, as the floor-fixes BEFORE did; check how `/home/col/SAM_ui-floor-fixes-before` was set up if it still exists).
2. `common.mjs`: `export * from '/home/col/delivery/ux-audits/floor-fixes-proofs/common.mjs'` plus helpers: `seedQuota(rows)` writes `<harness>/home/.sam/quota/runs.jsonl` (the harness `HOME`, so `livePaths` resolves it; delete it again in a `cleanupQuota()`), `floorRoute(page, mutate)` using `page.route('**/api/fleet/floor*', ...)` to rewrite the floor JSON (put workers on named Generals), `shot(page, name)` writing PNGs to `results/shots/`.
3. `run-proof.sh <before|after> <script.mjs>`: as the floor-fixes one, with `SAMUI_WORKTREE` set to the BEFORE worktree or `/home/col/SAM_ui-usage-pyramid`, `next build` first for `after` unless `NOBUILD=1`, always `stop.sh` on exit, never leave a 4950/4951 listener, propagate the exit code.
4. `t0-smoke.mjs`: open `/` at 412x915 on both builds, assert `/api/health` is ok and the fleet view renders, print one `CHECK 0 PASS|FAIL` line.
Do not touch: `/home/col/SAM_ui`, the harness directory (edit nothing in it), `/home/col/delivery/ux-audits/floor-fixes-proofs/`, the real `~/.sam`.
Proof: `bash run-proof.sh before t0-smoke.mjs` and `bash run-proof.sh after t0-smoke.mjs` both print `CHECK 0 PASS`; `ss -ltn | grep -E ':49(5[01])'` prints nothing afterwards; `git -C /home/col/SAM_ui-usage-pyramid-before status --short` is clean.

## T22: Browser proof: the Usage limits tile
Status: DONE 2026-10-05 (before: checks 1, 2, 3-axe/targets/text FAIL tile absent, rc 1; after: all CHECK PASS rc 0 at 412x915 and 1440x900, 120 s quiet 8 polls no jobs or off-origin requests, quota file removed, no 49xx listener)
Spec: must-do #U1, #U2, #U7, checks #1, #2 (in the page), #3 (browser half)
Depends on: T8, T21
Blocked by: none
Context: Proves the tile on a real production build, both viewports, with seeded readings under the harness `HOME` (the reader resolves `~/.sam/quota/runs.jsonl` through `livePaths.ts`, so no `start.sh` change is needed or allowed).
Files: new files only: `/home/col/delivery/ux-audits/usage-pyramid-proofs/t21-usage-tile.mjs`
Steps:
1. Seed rows: `main` with a 5-hour 0.42 (reset 2 h ahead) and weekly 0.58 (reset 3 days ahead), read 14 minutes ago; `max2` with a 5-hour 0.30 whose `fiveHourResetsAt` is already past (so it must show "reset, not checked since <time>"), weekly 0.12. Use the real field names.
2. At 412x915 (touch context) and 1440x900: open `/` logged in (phone: the Job tab / below-job slot; desktop: the drawer, as `openHome` and the floor-fixes `t4-tiles-order.mjs` do), find the "Usage limits" tile, and print `CHECK n` lines: both seats named, both percentages, both reset times, an age phrase matching `read \d+ min ago`; the expired window shows the words "reset" and "not checked since" and no `%` figure for it (check 2 in the page); screenshot both viewports.
3. Axe on the tile region at both sizes: zero serious or critical; every interactive element 44x44 or larger; no text under 12 px (computed style).
4. Check 3 in the browser: record the job store listing (`<harness>/home/.sam/jobs`) and the count of requests to non-origin hosts (`page.on('request')`) before and after keeping the page open for 120 s (4 polls of 30 s; the 20-poll case is the unit test in T3); both unchanged, no request leaves the origin except fonts already on the BEFORE build.
5. BEFORE build run: the tile is absent, so checks 1 and 2 FAIL there; paste both.
Do not touch: the repo, the harness dir, `start.sh`, the real `~/.sam`.
Proof: `bash run-proof.sh before t21-usage-tile.mjs` exits non-zero with checks 1 and 2 FAIL; `bash run-proof.sh after t21-usage-tile.mjs` exits 0 with all `CHECK` lines PASS and screenshots saved under `results/shots/`; no 49xx listener left; seeded quota file removed.

## T23: Browser proof: the phone pyramid
Status: DONE 2026-10-05 (before: checks 8, 9, 12, 15, 16 FAIL (single row, bust 32.9 px) rc 1; after: all CHECK PASS rc 0, bust 58 px samK 1.15, 10 of 10 taps right, 390x371 two rows samK 0.6. Note: the zoom sheet at y 427 covers the zoomed General platform on screen, as on the floor-fixes build; Cerberus/Prometheus zoom shows SAM plinth in top 3 px strip)
Spec: must-do #P1, #P2, #P5, #P8, #P9, checks #8, #9, #12, #15, #16
Depends on: T20, T21
Blocked by: none
Context: The unit tests prove the geometry; this proves what is drawn, with the screenshots the spec asks for. Demo mode and `page.route('**/api/fleet/floor*', ...)` give deterministic jobs.
Files: new files only: `/home/col/delivery/ux-audits/usage-pyramid-proofs/t22-pyramid.mjs`
Steps:
1. Check 8: at 412x915 (touch context), open `/`, screenshot the floor; assert via the canvas's General labels (read `phoneLabels` text from the page, or read the DOM overlay/labels the shell exposes; if neither exists, assert by the stations' screen positions from the unit-tested layout and say so) that Cerberus and Prometheus are on the top row and Hermes, Hephaestus, Calliope below; screenshot saved.
2. Check 9: measure at 412x915 the drawn bust height and SAM's scale from the page (the floor-fixes `t13-figures.mjs` shows how it reads layout values; if not exposed, use image measurement on the screenshot and state the tolerance). Bust at least 57.5 px, `samK` between 0.6 and 2.5. This is a guard-versus-spec number, record the BEFORE value (about 33 px bust on the single row) for contrast.
3. Check 12: for each of the five Generals, tap its bust on the phone (touch), wait for the zoom to finish, screenshot, and assert the screenshot's General is fully in frame (use the unit-tested `camFor` plus pixel checks that platform and label are not cut at any edge: sample the 3 px border of the canvas for the General's emerald pixels, must be none).
4. Check 15: route the floor JSON so one General on each row has a running job (cerberus on the top, hephaestus on the bottom, one with two jobs); screenshot at 412x915; assert via figure positions (or pixel regions) that figures and pads are visible, none under the Ask SAM bar (above `H - 110`) and none over the other row.
5. Check 16: at 390x371 (viewport height 371 with the hero as the canvas, as the unit tests size it) screenshot; both rows and SAM visible, no overlap by the unit geometry already asserted, plus no horizontal scroll.
6. Taps: tap one point on each of the five Generals' labels and platforms and assert the focused General (the detail sheet or panel title) is the one tapped.
7. BEFORE run: checks 8, 9 (bust size) and 12, 15, 16 must FAIL or show the single row; record.
Do not touch: the repo, harness dir, `start.sh`, desktop viewports (not part of this proof; T24 covers desktop).
Proof: `bash run-proof.sh before t22-pyramid.mjs` shows the expected FAIL lines; `bash run-proof.sh after t22-pyramid.mjs` exits 0, every `CHECK` PASS, screenshots saved; no 49xx listener left.

## T24: Whole-build gate (checks 7, 18, 19)
Status: DONE 2026-10-05 (results/summary.md 22 rows: 19 PASS, 2 PASS with live half at T25 (6, 22), 1 Colin (20); golden 7/7 on build and pristine 789589e; axe serious/critical 0 after; typecheck 0, lint 0 errors/6 warnings, npm test 526/524/2 skip/0 fail, next build clean)
Spec: whole; checks #7, #18, #19 (and a recount of #3 to #6, #17 to #22 against the coverage table)
Depends on: T1 to T23, T26, T27 (all build tickets)
Blocked by: none
Context: Final regression run on `build/usage-pyramid`. No feature work here: if anything fails, report it, do not fix it (the foreman re-tickets).
Files: new files only in `/home/col/delivery/ux-audits/usage-pyramid-proofs/` (`t23-ux.mjs`, `results/summary.md`); no repo files.
Steps:
1. Check 18: run `.test-build/components/floor/floorGolden.test.js` (six desktop and laptop sizes, both motion modes, every General's zoom, hit-test grid) and confirm `git diff 789589e -- src/components/floor/floorGolden.test.ts` is empty (the golden values were never edited) and `git diff 789589e --stat -- src/components/floor/floorRender.ts` touches only phone and pyramid code (read the diff; list any hunk outside them).
2. Check 7: the UX gate rules, as the floor-fixes run did (the `ux-gate.sh` pipeline cannot log in, so use the rig): `t23-ux.mjs` runs axe (serious and critical zero), tap targets 44x44, text 12 px or larger, and contrast (model it on `/home/col/delivery/ux-audits/floor-fixes-proofs/t10-contrast.mjs`) on the fleet page with the usage tile at 412x915 and 1440x900, and on the phone floor at 412x915, 390x844 and 360x780; BEFORE and AFTER, record both.
3. Check 19: `npm run typecheck` (0 errors), `npm run lint` (0 errors; compare the warning count with the baseline from your first report), `npm test` (all pass, record counts), `npx next build` (clean). Run the `sideMessage` flake once more if it appears.
4. `/api/health` ok on the AFTER build through the harness; `ss -ltn | grep -E ':49(5[01])'` empty afterwards; `git -C /home/col/SAM_ui status --short` and HEAD unchanged from what the foreman supplies; no new file under real `~/.sam/quota` or `~/.sam/jobs` made by any test.
5. Write `results/summary.md`: a table of checks 1 to 22 with the result, the covering ticket, and for check 20 "Colin, after deploy (not run)".
Do not touch: any repo file, `/home/col/SAM_ui`, system files.
Proof: `results/summary.md` has all 22 rows filled, zero gaps, check 20 marked Colin's; the four project commands pass with counts pasted verbatim; the UX run shows zero serious or critical axe findings AFTER; the golden test passes and its file is unedited.

## T25: Install the staged system script (deploy time, Colin's go required)
Status: TODO
Spec: must-do #U6, #U9, check #6 (live), #22 (live)
Depends on: T1, T24, T26
Blocked by: Colin's go to deploy (the foreman runs this ticket together with the deploy, never earlier)
Context: SYSTEM CHANGE to `~/bin` and `~/.local/bin`. `/home/col/bin/sam-quota-log.next.py` (T1, T26) becomes the live `sam-quota-log.py`, and `/home/col/.local/bin/sam-dispatch.next` (T26) becomes the live `sam-dispatch`, each with a dated `.bak`. Install the harvester FIRST (the new `sam-dispatch` calls its `--job` mode). Nothing else changes: no unit, no timer, no `run.sh` or `jobs-watch.sh` edit. For `sam-dispatch`, repeat steps 1 to 3 with T26's `fleetUsage.test.ts` pinned via `SAM_DISPATCH_BIN` (fails before, passes after) and `bash ~/.sam/tests/test-dispatch-routing.sh` (passes after); backup name `sam-dispatch.bak-20261005-usage`. Colin's rule: no change without enforcement, so this ticket ships a check that fails before the install and passes after.
Files: /home/col/bin/sam-quota-log.py (replace), /home/col/bin/sam-quota-log.py.bak-20261005-usage (new backup), /home/col/bin/sam-quota-log.next.py (remove after install), /home/col/.local/bin/sam-dispatch (replace), /home/col/.local/bin/sam-dispatch.bak-20261005-usage (new backup), /home/col/.local/bin/sam-dispatch.next (remove after install)
Steps:
1. Enforcement check, BEFORE install: run T1's `quotaLog.test.ts` pinned to the live script, `SAM_QUOTA_LOG_BIN=/home/col/bin/sam-quota-log.py npm run pretest && SAM_QUOTA_LOG_BIN=/home/col/bin/sam-quota-log.py node scripts/run-tests.cjs .test-build/lib/server/usage/quotaLog.test.js`: it must FAIL (the live script lacks `fiveHourResetsAt` and the lock). Also `grep -c fiveHourResetsAt /home/col/bin/sam-quota-log.py` prints 0. Paste both.
2. `cp -p /home/col/bin/sam-quota-log.py /home/col/bin/sam-quota-log.py.bak-20261005-usage`; `cp -p /home/col/bin/sam-quota-log.next.py /home/col/bin/sam-quota-log.py`; `rm /home/col/bin/sam-quota-log.next.py`. Do not touch the timer or service (`systemctl --user cat sam-quota-log.service` still points at the same path).
3. AFTER install: the same pinned test passes; `grep -c fiveHourResetsAt /home/col/bin/sam-quota-log.py` is at least 1; `python3 /home/col/bin/sam-quota-log.py --report 1` still prints a summary (the report path is unchanged).
4. Live smoke without writing to the real store: run the live script with a temp `HOME` holding a copy of one real recent job dir (T1's second case does exactly this); the row carries `fiveHourResetsAt`. Then, on the first real chat turn after deploy, record that the newest row in `~/.sam/quota/runs.jsonl` carries `fiveHourResetsAt` equal to that turn's `rate_limit_event` `five_hour.resetsAt` (check 6 on a live run; non-blocking if no turn has run yet, note it for Colin).
5. Rollback note in the report: `cp -p /home/col/bin/sam-quota-log.py.bak-20261005-usage /home/col/bin/sam-quota-log.py` restores the old harvester.
Do not touch: `sam-quota-log.timer`, `sam-quota-log.service`, `~/.sam/jobs-watch.sh`, `~/.sam/sam-job/run.sh`, `~/.local/bin/sam-job`, the real `~/.sam/quota/runs.jsonl` (the harvester appends to it on its own schedule, this ticket does not).
Proof: the pinned `quotaLog.test.js` FAILS before step 2 and PASSES after; `ls /home/col/bin | grep sam-quota-log` shows the live file and the dated `.bak` only; `systemctl --user is-active sam-quota-log.timer` still prints active.


## T26: Fleet jobs record their usage (sam-dispatch streams, harvest at job end)
Status: DONE 2026-10-05 (fleetUsage.test 3/3 pass on staged, 3/3 fail pinned to live; quotaLog.test 3/3; routing test 23/23 on staged copy; diff live vs .next is the launch line only; stale .next replaced; typecheck clean; npm test 524/522/2 skip/0 fail. Extra: SAM_QUOTA_LOG_BIN seam in .next; fleet rows classify as other in sam-quota-log, tile does not filter on kind)
Spec: must-do #U9, #U6, check #22 (fleet half), #6
Depends on: T1
Blocked by: none
Context: Added 2026-10-05 on Colin's go. Fleet jobs run `claude -p ... --output-format text` (`/home/col/.local/bin/sam-dispatch`, the `bash -c` line near the end), so they emit no `rate_limit_event` and the tile never sees fleet usage: in `runs.jsonl` there are 1,123 chat rows and 2 fleet rows. Fix: the fleet command streams JSON to a side file in the job dir and prints only the final result text to stdout, so `stdout.log`, the sam-job notify ping and everything that reads a job's report stay exactly as they are today. SYSTEM CHANGE to `~/.local/bin` and `~/bin`: staged only, installed by T25.
TRAP, read first: `/home/col/.local/bin/sam-dispatch.next` already exists and is STALE. Verified 2026-10-05: it adds nothing over the live file and lacks the live 2026-10-04 tidiness fix (`trap 'rm -f "$WORKBRIEF"' EXIT` and the `B=$(cat $WB) && rm -f $WB` launch), so installing it would revert that fix. Start this ticket by replacing it with a fresh `cp -p` of the live `sam-dispatch`, then make the change there.
Files: /home/col/.local/bin/sam-dispatch.next (replace with a fresh copy of live, then edit), /home/col/bin/sam-quota-log.next.py (edit, T1's staged copy), src/lib/server/usage/fleetUsage.test.ts (new, box-only)
Steps:
1. `cp -p /home/col/.local/bin/sam-dispatch /home/col/.local/bin/sam-dispatch.next` (overwrites the stale copy; say so in the report with the before diff).
2. In `sam-dispatch.next`, change only the launch line's claude call: `claude -p "$B" --model ... --allowedTools ... --output-format stream-json --verbose`, with its stdout `tee`d to `"$SAM_JOB_DIR/claude-stream.jsonl"` (`run.sh` exports `SAM_JOB_DIR` to the command) and piped through `jq -r --unbuffered 'select(.type=="result") | .result // empty'` so stdout carries only the final text, as text mode did. Keep `set -o pipefail` semantics: the command exits with claude's own exit code (use `PIPESTATUS`). After claude exits, run `python3 /home/col/bin/sam-quota-log.py --job "$SAM_JOB_DIR"` with a 60 s timeout, output discarded, failure ignored, so the reading lands at job end. Keep the tidiness fix, the EXIT trap and every other line byte-identical.
3. In `sam-quota-log.next.py`: (a) a `--job <dir>` mode that harvests that one job now, without waiting for `endedAt` (use the time of the stream's `result` event, else now, as `endedAt`), under the same flock and `seen` check as T1, so the hourly run later skips it; (b) the normal hourly mode also reads `claude-stream.jsonl` (plain JSON lines, not the framed `stdout.log` format) when a job dir has one. Both take `five_hour.resetsAt` into `fiveHourResetsAt` as T1 does. Seat resolution is unchanged (the transcript lands under `~/.claude` or `~/.claude-max2` by `CLAUDE_CONFIG_DIR`).
4. `fleetUsage.test.ts` (box-only, temp `HOME`, staged-or-live resolution as T1, with `SAM_DISPATCH_BIN` and `SAM_QUOTA_LOG_BIN` overrides so T25 can pin live paths): put a fake `claude` first on `PATH` that prints a canned stream (`system` init, one `rate_limit_event` with `five_hour {utilization: 0.81, resetsAt: <now + 2 h>}` and `seven_day`, one `assistant` message, a `result` with `result: "REPORT TEXT"`) and exits with a chosen code; run the dispatch through its `SAM_JOB_BIN` seam into a temp job store (see `~/.sam/tests/test-dispatch-routing.sh` for the seams). Assert: (a) `stdout.log` is exactly `REPORT TEXT` plus the notify line, no JSON; (b) `claude-stream.jsonl` holds the raw lines; (c) exit codes 0 and 3 both propagate; (d) one `runs.jsonl` row for that job with `fiveHour` 0.81 and the right `fiveHourResetsAt`, written before the job's `ended` event; (e) a second, hourly-mode harvest adds no duplicate; (f) the brief's working copy is gone from `/tmp` afterwards (the tidiness fix survived).
5. Run `bash ~/.sam/tests/test-dispatch-routing.sh` against the staged file (its seam or a copy) and show it still passes.
Do not touch: the live `sam-dispatch`, `sam-job`, `sam-job.next`, `run.sh`, `jobs-watch.sh`, any unit or timer, the real job store or `~/.sam/quota`, the tier and routing table in `sam-dispatch`.
Proof: `fleetUsage.test.js` pinned to the LIVE `sam-dispatch` FAILS (text mode: no stream file, no row); against the staged `.next` it PASSES all six assertions; `test-dispatch-routing.sh` passes against the staged file; `diff` of live against `.next` shows only the launch-line change (paste it); `ls /tmp` shows no leaked brief.

## T27: The server checks for alerts every minute, whatever wrote the reading
Status: DONE 2026-10-05 (usageSweep.test 2/2 pass covering a-d; harness AFTER build: one push 62 s after server start, recorded; typecheck clean; lint 0 errors; next build clean; npm test 526/524/2 skip/0 fail. start.sh hardcodes SAM_PUSH_BIN so a temp copy was used for the recording run)
Spec: must-do #U4, #U5, #U8, #U9, #U3, checks #4, #5, #21, #22 (fleet half), #3
Depends on: T10, T26
Blocked by: none
Context: Added 2026-10-05 with T26. T11 runs the alerts when a SAM_ui chat turn ends, but a reading written by a fleet job (T26) or the hourly timer has no hook in SAM_ui. A light sweep inside the SAM_ui server calls `runUsageAlerts()` every 60 s, so any new row pings within a minute, with or without the dashboard open. It reads the mtime-cached rows (T3) and sends only through `sam-push`: no Claude run, no probe, no network (U3). `runUsageAlerts` already serialises and records state, so the sweep and the T11 hook can never double-ping.
Files: src/instrumentation.ts (edit: start the sweep once on server start, read how the file starts other server work and match it; `src/lib/server/serialTick.ts` may be the right helper), src/lib/server/usage/usageSweep.ts (new: `startUsageSweep(intervalMs = 60_000)`, idempotent, unref'd timer), src/lib/server/usage/usageSweep.test.ts (new)
Steps:
1. `usageSweep.ts`: a single unref'd interval that calls `runUsageAlerts()`, swallows errors, never overlaps itself, and returns a stop function for tests. Calling `startUsageSweep` twice starts one timer.
2. Wire it in `instrumentation.ts` for the Node.js server runtime only, the way the file already guards its other start-up work, and not during `next build` or tests.
3. Tests, temp `HOME`, recording `SAM_PUSH_BIN`, a short interval: (a) a row with 5-hour 0.81 appended to `runs.jsonl` by hand (as a fleet harvest would, no chat turn) gives exactly one push within two intervals; (b) further sweeps send nothing more in the same window (U8); (c) starting the sweep twice still gives one push; (d) during the sweep, `child_process` is used only for the push binary and `fetch` is never called (U3).
Do not touch: T11's chat-turn hook (it stays: it is faster for chat turns), the push code, the 30 s client poll.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/usage/usageSweep.test.js` passes (fails on `789589e`: no sweep exists); `npm test`, `npm run typecheck`, `npm run lint`, `npx next build` pass; on the harness AFTER build, with a seeded 0.81 row and `SAM_PUSH_BIN` pointed at a recording script for that run only, the record shows one push within 2 minutes of starting the server (paste the record).

---

## Coverage: every spec check mapped to the ticket whose Proof covers it

| Check | What | Ticket(s) |
|---|---|---|
| 1 | Tile in browser at 412x915 and 1440x900, screenshot (U1) | T22 (T6, T8 build it) |
| 2 | Reset reading shows "reset, not checked since", fails on today's code (U2) | T2 (unit), T5 (wording), T22 (in the page) |
| 3 | No Claude run or outbound call from the tile (U3) | T3 (20-poll unit test, grep), T22 (browser, 120 s), T27 (the sweep makes none) |
| 4 | 5-hour 0.80 sends one push, 0.79 none (U4) | T9 (pure), T10 (real push command), T27 (from the sweep) |
| 5 | Weekly the same (U5) | T9, T10 |
| 6 | Newest `runs.jsonl` row carries the five-hour reset, matching a real run (U6) | T1 (real job replayed in a temp HOME), T25 (live install and first live row) |
| 7 | UX gate at phone and desktop sizes (U7) | T24 (axe, targets, text, contrast; T22 for the tile alone) |
| 8 | Phone row order screenshot (P1) | T14 (rows asserted), T23 (screenshot), T20 (switch on) |
| 9 | Bust at least as tall as variant B, SAM scale 0.6 to 2.5 (P2) | T14 (numbers), T20 (production options), T23 (browser) |
| 10 | No SAM link crosses another General's platform, bust or label (P3) | T15 |
| 11 | Hit test grid returns the right General, at 360, 390, 412 (P4) | T17 (idle grid), T19 (figure squares clear the next row) |
| 12 | Zoom frames each General fully (P5) | T16 (numbers), T23 (screenshots) |
| 13 | SAM tag, 12 numeral and labels do not overlap (P6) | T18 |
| 14 | Platforms and labels at least 16 px inside the edges (P7) | T14 |
| 15 | Worker figures and pads show on both rows, screenshot (P8) | T19 (geometry), T23 (screenshot) |
| 16 | 390x371 hero shows both rows and SAM, checks 10, 13, 14 run at that size (P9) | T14 (edges and presence), T15, T18, T23 (screenshot) |
| 17 | No `PYRAMID_VARIANT` or `MOCKUP` in `src/`, phone tests assert the new sizes (P10) | T20 |
| 18 | Desktop scene hash identical to production, six sizes, both motion modes | T12 (golden captured on 789589e), kept green by T13 to T20, final check T24 |
| 19 | typecheck, lint, `npm test`, `next build` | every ticket (typecheck, lint, test), T24 (all four, `next build`) |
| 20 | Colin confirms on his phone after deploy (P1 to P9, U1) | Colin, after deploy (not run here) |
| 21 | Three over-80 readings in one window then one after reset gives two pushes, 5-hour and weekly (U8) | T9 (pure), T10 (against the real push command and state file) |
| 22 | A job ending at 0.81 pings within 5 minutes, without the hourly timer (U9) | T11 (chat turns: exit hook runs the harvester and the alerts), T26 (fleet jobs: stream to a side file, harvest at job end), T27 (server sweep pings within 60 s of any new row), T25 (live install) |

