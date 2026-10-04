VERDICT: COMPLETE

Built T20, T20b (added 2026-10-03, between T20 and T21), T21 and T22 of `implementation/visual-upgrade-tickets.md`, in order, each gated on `npm run typecheck`, `npm run lint` and `npm test` before moving to the next. Status lines updated in the tickets file for all four. Final state: 277/277 tests pass (263 baseline + 14 new: 7 demoFixtures, 2 spend-route, 2 jobs-route, 3 demoScan), typecheck and lint both exit 0, `next build` succeeds with `/` and `/classic` both present and no `preview-*` routes.

## What each ticket did

**T20** — `src/lib/server/fleet/demoFixtures.ts`: `demoFloorStateAt(t)`/`demoScheduleAt(t)`, pure functions of a millisecond clock, replaying three invented demo jobs (Open House/Hephaestus, the CVE audit/Cerberus, Bait the Hook/Hermes) on a 90 s loop — queued, then running with stages lighting in order, then done with one tower slab — plus a demo schedule exercising every ring-mark shape (bead/line/diamond), a cron "not recorded" entry and a failed-timer red tick. Wired `?demo=1` into `/api/fleet/floor` and `/api/fleet/schedule`. Added `DemoModeToggle.tsx` and wired it into `FleetDashboardShell`/`FleetPhoneView` as a local override of the `demo` prop, doubling as the persistent "Demo" marker (Must 20).

**T20b** (SAM's addition, serves Must 19/check 13) — `/api/fleet/spend` and `/api/fleet/jobs` were adding `demo=1` to their URLs from three call sites (`KpiTiles`, `SpendByHourModule`, `JobDetailModule`/`GeneralDetailPanel`/`GeneralDetailSheet`) but neither route read it, so demo mode showed live costs and job names. Wrote `src/app/api/fleet/spend/route.test.ts` and `.../jobs/route.test.ts` first; ran them against the unmodified routes and confirmed both failed (live `scannedJobs`/persona counts and a live job's command text both came straight back with `demo=1` set). Fixed both routes to branch on `demo=1` to `demoFleetSpend()`/`demoFleetPersonaJobs()` (extended into `demoFixtures.ts`), never touching the live job store, registry or `claudeCosts()` on that path. Reran — both pass.

**T21** — `src/lib/server/fleet/demoScan.ts`: `buildLeakPatterns()` reads client folder names under `<SAM_VAULT_DIR>/02 - Atwood Systems/10_Clients/` plus a generic home-folder path shape; `scanForLeaks(text)` runs them. The test first proves the scan isn't a no-op on a small fixture string, then — per the added instruction — drives the four real routes the Dashboard actually polls in demo mode (`/api/fleet/floor`, `/api/fleet/schedule`, `/api/fleet/spend`, `/api/fleet/jobs` × 5 personas, found by reading `FloorCanvas`/`KpiTiles`/`SpendByHourModule`/`JobDetailModule`/`GeneralDetailPanel`): once live, against a job store seeded with a fake leak ("Example Co" + a fake `/home/...` path) — scores ≥1 hit, proving the scan can fail; once with `demo=1` on every call — scores 0. `SidebarWidgets` (System Health/Daily Tasks/Money In) already renders nothing in demo mode (T15), so check 23 needed no new route to scan.

**T22** — `/` now renders `FleetView` (T13's breakpoint chooser); `/classic` is a new page with page.tsx's exact pre-ticket content (`<DashboardShell />`). Grepped `Sidebar.tsx`/`TabBar.tsx`: their one "Dashboard" nav entry already points at `/`, neither ever linked `/classic` — no edit needed there, noted as such. Deleted the three untracked `preview-floor`/`preview-shell`/`preview-view` pages. Ran a full `next build` to confirm the route swap end to end (not strictly required by this ticket's Proof line, but it's the integration ticket touching the live route, so worth the extra check): both `/` and `/classic` build as static routes, no `preview-*` routes remain.

## What turned out wrong or worth flagging

- Nothing in the spec or tickets was wrong. T20's own description already anticipated T20b's gap in its own wording ("extended as needed") — T9–T18 had already threaded `demo` props and `&demo=1` query strings through every client component in anticipation of T20, so the only missing piece really was the two routes' server-side handling, exactly as SAM's brief said.
- The ticket's literal function signature `scanForLeaks(text: string): string[]` (no vault/patterns argument) means it rebuilds `buildLeakPatterns()` — and re-reads the vault directory — on every call. Fine at this test/demo scale (a handful of calls), but worth knowing if it's ever called in a hot path later.
- T15's existing `SidebarWidgets` already returns `null` in demo mode, so there is no "demo data" branch for System Health/Daily Tasks/Money In to build — they simply don't render, which already satisfies Must 19/check 23. Flagging only because the T20b brief's wording ("show demo data or are hidden") left both options open; "hidden" was already the shipped choice from T15, so T20b made no change there.

## Scope notes

- T23 (install the live dispatch tools) and T24 (full gates, browser/device checks, Colin's go, `./deploy.sh`) were explicitly out of scope for this run and are untouched.
- No live system file, real timer, crontab entry, or `~/ai-memory-vault` content was read, written or touched — `demoScan.test.ts` uses a temp fixture vault via the `SAM_VAULT_DIR` seam, and the only client name anywhere in this branch's new files is the invented "Example Co".
- Browser/device checks named in the tickets' Proofs (console errors, pixel checks, on-device dispatch, A16 confirmation) are T24's job, per the task brief, and were not attempted here.

## Final gate output

### `npm run typecheck`
```
> sam-ui@0.1.0 typecheck
> tsc --noEmit
```
(exit 0, no output)

### `npm run lint`
```
> sam-ui@0.1.0 lint
> next lint

`next lint` is deprecated and will be removed in Next.js 16.
For new projects, use create-next-app to choose your preferred linter.
For existing projects, migrate to the ESLint CLI:
npx @next/codemod@canary next-lint-to-eslint-cli .


./src/components/dashboard/DashboardShell.tsx
10:10  Warning: 'AvatarReceptionist' is defined but never used. Allowed unused vars must match /^_/u.  @typescript-eslint/no-unused-vars

./src/components/dashboard/widgets/MoneyInWidget.tsx
5:20  Warning: 'Plus' is defined but never used. Allowed unused vars must match /^_/u.  @typescript-eslint/no-unused-vars

./src/components/visualiser/VisualiserWidget.tsx
33:7  Warning: 'AMBER' is assigned a value but never used. Allowed unused vars must match /^_/u.  @typescript-eslint/no-unused-vars

./src/hooks/useVoiceWebSocket.ts
237:21  Warning: The ref value 'audioQueueRef.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'audioQueueRef.current' to a variable inside the effect, and use that variable in the cleanup function.  react-hooks/exhaustive-deps

./src/lib/server/fleetMetrics.ts
31:45  Warning: 'name' is defined but never used. Allowed unused args must match /^_/u.  @typescript-eslint/no-unused-vars

./src/lib/server/projectMetrics.ts
19:7  Warning: 'CLIENTS_DIR' is assigned a value but never used. Allowed unused vars must match /^_/u.  @typescript-eslint/no-unused-vars
204:9  Warning: 'anyText' is assigned a value but never used. Allowed unused vars must match /^_/u.  @typescript-eslint/no-unused-vars

info  - Need to disable some ESLint rules? Learn more here: https://nextjs.org/docs/app/api-reference/config/eslint#disabling-rules
```
(exit 0; all seven warnings pre-exist on this branch, none touch files this run changed)

### `npm test`
```
# Subtest: a counter that went backwards (phone app restarted) is a new baseline, not a wake
ok 268 - a counter that went backwards (phone app restarted) is a new baseline, not a wake
  ---
  duration_ms: 0.271631
  type: 'test'
  ...
1..268
# tests 277
# suites 4
# pass 277
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 14509.001358
```
(exit 0; 277/277, up from the 263 recorded before this run)
