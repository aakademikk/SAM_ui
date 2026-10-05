# SAM_ui floor fixes: code review (pipeline step 5)

Reviewed 2026-10-04 by a headless reviewer (hephaestus brief), read-only on code.

- Scope: the staged work on `build/floor-fixes`, `git diff --cached 55ac55e` (34 files, +2290 / -238, T1 to T14; T15 superseded by production). I read every file in the diff in full, plus the code each change calls into: `userPreferencesStore`, the zustand 5 persist middleware, `JobDetailModule`, `floorRender.Figure`, `AppShell` stacking, `taskState`, `moneyState`, and the harness `start.sh`.
- Spec: `implementation/floor-fixes-spec.md` (LOCKED). Tickets: `implementation/floor-fixes-tickets.md`. Build report: job `job_samui-floor-fixes-build_20261004-152901`. Proof table: `floor-fixes-proofs/results/summary.md`.
- Method: the `/code-review` checklist at high effort, done by hand. CONFIRMED means I traced the code path end to end, or reproduced the behaviour. PLAUSIBLE means I did not fully trace it. I dropped anything I could not support.

## Commands run in the worktree

`npm run typecheck`:

```
> sam-ui@0.1.0 typecheck
> tsc --noEmit

TYPECHECK EXIT 0
```

`npm test`, using this branch's own runner (pre-merge):

```
1..418
# tests 427
# suites 4
# pass 425
# fail 0
# cancelled 0
# skipped 2
# todo 0
# duration_ms 31060.691743
TEST EXIT 0
```

These match the build report: 425 pass, 0 fail, 2 skipped. The test run left no tracked changes (`.test-build` is git-ignored). I did not run `next build`, lint or any proof script, as the brief instructed.

## Overlap with production (`55ac55e..2e60de6`)

Production commits since the branch point:

- `ed78a0c` changes `manager.ts`, `reconcileUnit.test.ts` and `types/jobs.ts`.
- `a32508b` changes `manager.ts` and `reconcileUnit.test.ts`.
- `2e60de6` (tidy fixes) changes 46 files. Among them: a new test runner `scripts/run-tests.cjs` with a temp-leak gate, `testing/tempDir.ts`, `FieldLabel`, the chat, fleet and terminal pages, `jobsService`, `DashboardChatWidget`, and the headers of 39 test files.

**Files both lines touch:**

| File | Production change | Floor change | Textual merge |
|---|---|---|---|
| `src/components/dashboard/fleet/dashboardLayout.test.ts` | Header: `fs.mkdtempSync` replaced by `tempDir()` | One test appended at the end (T11 `selectJob`) | Clean |
| `src/components/dashboard/fleet/phoneView.test.ts` | Header: `fs.mkdtempSync` replaced by `tempDir()` | Import line gains `scrollBehaviorFor`, and one test appended | Clean |

A trial `git merge-tree --write-tree --merge-base=55ac55e 2e60de6 <staged tree>` exits 0 with no conflicts.

**Semantic clashes** (no shared file, but production changed something this build relies on):

- **Production's new test gate.** `npm test` now runs `scripts/run-tests.cjs`, which fails the run if any temp entry is left behind. One new floor test leaves an entry behind. See finding 1. This is the only clash that breaks anything.
- **Job manager (`ed78a0c`, `a32508b`).** A headless job now stays `running` while the unit probe is `unknown`. The floor build only reads worker status through `figureWorkers` and `activeJobEntries`, so there is no clash: such a job simply keeps its figure and its row. `JobRecord.unit` is new and unused by the floor code. Spec check 34 (Must 30) is covered by production's `reconcileUnit.test.ts`; re-run it after the rebase. (The build report says "the spec has no check 34". It does: section 5, item 34.)
- **Jobs API and jobs service.** The only change is a new `closed` status, `unauthorized`, in `jobsService`. The floor code does not use `jobsService`, so no clash.
- **Theme (`FieldLabel` on Chat, Fleet brief and Terminal).** It uses `text-dim-500` on `bg-void-950` / `bg-void-900`, which does not depend on the theme. That is the same grey T10 moved to for contrast. The T10 contrast sweep (check 31) ran before this markup existed, so re-run `t10-contrast.mjs` once on the merged build. I expect it to pass. PLAUSIBLE risk only.
- **Tiles and the dashboard chat.** The `DashboardChatWidget` change is close-status logic only, with no layout change. The T7 column CSS is unaffected.

## Findings (most severe first)

### 1. CONFIRMED. After the merge, `npm test` fails: `jobSelection.test.ts` leaves a temp dir behind

- **Where:** `src/components/dashboard/fleet/jobSelection.test.ts:13`. The line is `process.env.HOME = fs.mkdtempSync(`${os.tmpdir()}/jobselect-home-`)`, and the file has no `after` or `rmSync` to remove it.
- **Failure scenario:** production `2e60de6` changes `npm test` to `node scripts/run-tests.cjs`. That runner points `TMPDIR` at a private directory and exits 1 with `TEMP LEAK` if anything is left in it. I reproduced the leak: I ran the compiled test alone with `TMPDIR` set to a private directory. It passed 6 of 6, and `jobselect-home-qFGBY1` was left in the directory. So once this branch is rebased onto or merged with `2e60de6`, the full suite goes red, even though every test passes. Pre-merge the suite is green only because this branch still has the old runner.
- **Fix (not applied):** while rebasing, change the header to production's pattern: `import { tempDir } from '@/lib/server/testing/tempDir';` and `process.env.HOME = tempDir('jobselect-home-');`. That is the same change production made to `dashboardLayout.test.ts` and `phoneView.test.ts`. The other three new test files (`tileLayout`, `figureHit`, `preferencesBoot`) make no temp dirs. Then run `npm test` on the merged tree.

### 2. CONFIRMED. Phone: a tapped failed (red) figure gives a contradictory job panel

- **Where:** `src/components/dashboard/fleet/FleetPhoneView.tsx:238`, used at `:276` and `:289`.
- **Code path:** `jobId = resolveJobId(...)` can be a recently failed job, by design (Must 25; `pickableJobIds` includes failed figures). But `flight` is then looked up in `activeJobEntries(floor)`, which holds only queued and running jobs, so for a failed job `flight` is `null`.
- **Failure scenario:** at 412×915, with two Generals running and a third holding a red figure, tap the red figure:
  - `JobDetailModule` shows the failed job. It finds the worker itself via `findWorker`.
  - The hero caption reads "No jobs running" (`heroCaption(floor, null)`, `phoneView.ts:106`), although two jobs are running.
  - `StageTimeline` disappears.

  Must 13 says the phone shows "Job detail and its stage timeline", and `lifecycleSteps` already has a failed path (all steps up to Running done, last step red) that this never reaches. Check 30 only ran at 1920×1080, so the proofs did not catch this.
- **Fix (not applied):** derive `flight` from every floor worker: the Generals' workers plus `samWorkers`, the same lookup as `JobDetailModule.findWorker`, rather than from `activeJobEntries`. Teach `heroCaption` a `failed` case (for example `${who} · failed`) so it never says "running" for a red figure.

### 3. CONFIRMED. Hide drops keyboard focus to `<body>`

- **Where:** the menu item at `src/components/dashboard/WidgetFrame.tsx:253-256` calls `tile.onHide`. That is `SidebarWidgets.tsx:392`, `() => hide(item.id)`, with no focus handling.
- **Failure scenario:** a keyboard or screen-reader user opens Daily Tasks' options and chooses Hide. The tile, and with it the focused menu item, unmounts. Focus falls to `<body>`, the next Tab starts again from the top of the page, and a screen reader announces nothing.

  Move up / Move down (`focusAfterMove`) and Restore both handle focus already; Hide is the one action that loses it. This is an accessibility regression added by this build (UX standard §6, focus order).
- **Fix (not applied):** wrap `onHide` in `SidebarWidgets`, as `onMove` and `onRestore` already are:
  - Set `focusAfterMove.current` to the next visible tile, or the previous one when the hidden tile was last.
  - When no tile is left, focus the "Hidden tiles (n)" disclosure button instead. This needs a ref or a `data-` hook on it in `HiddenTiles.tsx:40`.

### 4. CONFIRMED. Hard-coded live paths ignore the harness `HOME`, so proofs can write live data

The harness (`samui-local-harness/start.sh:18`) isolates only `HOME`, and refuses to start if `$HARNESS_HOME/.sam` resolves into the real `~/.sam`. These modules use absolute paths, which bypass that guard. Not part of this diff, but the brief asked for the list. The local server still reads and writes the live files below.

**Written by the app:**

- `src/lib/server/taskState.ts:18-19`: `STATE_DIR = '/home/col/.sam'`, giving `daily-tasks-state.json`. The env override `SAM_TASK_STATE_PATH` exists but the harness does not set it. This is the file check 6's "add a task" step writes (T6 note; the foreman did not re-run it for that reason).
- `src/lib/server/moneyState.ts:18-19`: `money-state.json`, overridden by `SAM_MONEY_STATE_PATH`. A Money In "log income" proof would write live income.
- `src/lib/server/taskMetrics.ts:15`: the vault's `Active Priorities.md`, with no env override. It is written at `:121` when a vault task is ticked, so a proof that ticks a task edits the live vault.
- `src/lib/server/operations.ts:22-24`: the vault's `Named Operations.md` (`SAM_OPERATIONS_PATH`), written at `:308` and `:346`.
- `src/lib/server/chat/turnPing.ts:34`: `SAM_PUSH_BIN` defaults to the real `sam-push`, so a proof that runs a chat turn on the harness would ping Colin's phone.

**Read by the app** (live data shows up in proof screenshots):

- `vaultMetrics.ts:13`
- `telemetry.ts:53`
- `projectMetrics.ts:18,20`
- `contacts.ts:25` (`SAM_VAULT_PATH`)

**How to make them follow `HOME`:**

- **Code fix (not applied):** resolve the path per call from `os.homedir()` and keep the env override. For example, `const statePath = () => process.env.SAM_TASK_STATE_PATH ?? path.join(os.homedir(), '.sam', 'daily-tasks-state.json')`, called inside `load` and `save`. Do the same in `moneyState.ts`.
  - It must be per call, not a module-level `const`, so a test or harness that sets `HOME` is honoured. `chatStore.ts:30` and `notifications.ts:39` already use this pattern.
  - For the vault paths, use `process.env.SAM_VAULT_DIR ?? path.join(os.homedir(), 'ai-memory-vault')`, as `demoScan.ts:20` and `handoff.ts:70` already do.
  - Production runs with `HOME=/home/col`, so live behaviour does not change.
- **Immediate mitigation, before any re-run of t6:** export these in the harness `start.sh` next to `HOME=`:
  - `SAM_TASK_STATE_PATH`, `SAM_MONEY_STATE_PATH` and `SAM_OPERATIONS_PATH`, pointing under `$HARNESS_HOME/.sam`;
  - `SAM_PUSH_BIN=/bin/true`.

  `Active Priorities.md` has no override until the code fix lands, so no proof should tick a vault task.

### 5. CONFIRMED (code path), impact low. `PreferencesApplier` briefly writes the defaults over the boot script on every load

- **Where:** `src/components/shell/PreferencesApplier.tsx:22-30`. The header comment at `:9-11` is incorrect.
- **Code path:** during hydration, zustand 5's hook uses `useSyncExternalStore` with `api.getInitialState()` as its server snapshot (`node_modules/zustand/react.js:11`). The persist middleware sets that to the un-hydrated defaults (`node_modules/zustand/middleware.js:380`). So the first effect run after hydration sees `toxic`, intensity `0.75` and grid on. It writes them over whatever the boot script set. React's store-consistency check then forces a SyncLane re-render, and the effect writes the saved values back.
- **Failure scenario:** today both writes land in the same task (the forced re-render runs in a microtask and its passive effects flush synchronously), so nothing paints in between. Check 15 passed, and its `MutationObserver` samples after the second write, so it could not see the first. But any later change that delays that re-render would bring back the Toxic flash that Must 11 forbids, and the comment tells the next maintainer the opposite. Examples: wrapping part of `AppShell` in Suspense or a transition, or a zustand upgrade.
- **Fix (not applied):** apply the store imperatively, outside render snapshots:

  ```ts
  useEffect(() => {
    const apply = (s) => { /* the same three writes */ };
    apply(useUserPreferencesStore.getState());
    return useUserPreferencesStore.subscribe(apply);
  }, []);
  ```

  Then correct the comment.

### 6. CONFIRMED, informational. The committed docs carry private local paths

- **Where:** `implementation/floor-fixes-spec.md:5` (a daily-note path in the vault), `:83`, `:86`, `:129`; `implementation/floor-fixes-tickets.md:3`, `:20-22`, `:39`, `:47` and every ticket's proof path.
- **Risk:** the repo is public. These reveal the home-directory layout, the delivery and audit folder structure, and a vault note path. No client, prospect or third-party name appears anywhere in the diff: I scanned the spec, the tickets and all the code. Only the owner's first name appears. This matches 11 docs already committed under `implementation/`, so it is not new exposure, but it adds to it.
- **Fix (optional, not applied):** replace absolute paths with `~/…` or `<harness>`, and drop the daily-note path, before committing.

### Checked and found sound (no finding)

- **Per-device tile layout:**
  - `tileLayoutStore` uses its own key, `sam.fleet-tiles.v1`, and imports neither `userPreferencesStore` nor `dashboardService`.
  - Tile-mode menu items never call `setWidgetSize` or `setWidgetVisible`.
  - No API route is touched; `/api/dashboard/layout` is unchanged.
  - The `/classic` path of `WidgetFrame` is behaviourally identical: the same header, menu, `layout` / `layoutId` and footer condition when `tile` is absent.
  - `StatCardGrid` and `WIDGET_REGISTRY` are untouched.
  - `reconcileTiles` repairs garbage.
  - Server and client both render the defaults first (zustand's initial-state snapshot), so the tiles cause no hydration mismatch.
- **Hide / Restore and Move up / down:** hidden tiles keep their slot, `moveTile` steps over hidden tiles, and focus after a move or a restore is handled.
- **Full screen:**
  - One instance only: the widget's host node moves, not the React subtree.
  - The host carries `fleet-dashboard`, so it keeps the emerald pins in `<body>`.
  - z-60 sits above the tab bar (z-50) and below `SignedOutOverlay` (z-200) and `BootSequence` (z-100). `AppShell`'s root creates no stacking context, so this ordering holds.
  - Esc is caught in the capture phase, Tab is trapped, the scroll lock is restored on exit and on unmount, and turning demo on closes it.
- **Theme before first paint:** the boot script is ES5 built from constants only, validated against the six theme ids, and wrapped in try/catch. `suppressHydrationWarning` on `<html>` covers `data-ambient` and the style attribute. No CSP header exists that would block the inline script. `/classic` sits under `(app)/layout` → `AppShell`, so its gear picker still applies live.
- **Fleet surface emerald, chrome follows the accent:** `.fleet-dashboard` pins the accent on `.fd`, `.fp`, the pending placeholder and the full-screen host, and `body:has(.fleet-dashboard)::before` pins the grid overlay. The Sidebar and tab bar follow the accent.
- **Active jobs rows:** `onSelectGeneral` is removed from rows on every layout. `selectJob` closes the General and Schedule panels and switches the drawer to the Job tab. The phone scrolls the job panel into view, instantly under reduced motion. Statues and Fleet status rows still open the General.
- **Figure hit-testing:**
  - The figure hit box is a 44×44 square centred on the pad, and a figure wins over its General's column.
  - Returned or invisible figures are ignored, and the pointer becomes a hand over a figure.
  - The overlay is `aria-hidden` with `pointer-events:none` and adds no tab stops.
  - Clock-ring capture deviation: the capture handler only acts on a real pointer click (`e.detail !== 0`) on `.fd-ring-hit` / `.fp-ring-hit` within 22px of a figure. Keyboard activation of the ring still opens Schedule. This is accepted per T13.
  - The figure overlay rebuilds only when rounded positions change: pads are static, so only during camera moves.
- **Demo mode:** the three tiles, the Hidden control and any full-screen tile are unmounted. Job detail uses the demo floor and `&demo=1`. A live `selectedJobId` carried into demo is not pickable on the demo floor, so it falls back to the first demo job. I found no new path by which demo shows live data.
- **Security:** no new or changed API route. The only localStorage values that reach the DOM are whitelisted theme ids, clamped numbers and known tile ids. Selectors are built only from known tile ids. Overlay attributes are set through `dataset` and numeric `cssText`. There is no new `innerHTML` beyond the constant boot script.
- **Accessibility:**
  - The grip, options, Exit full screen, the Hidden control, Restore and the tile menu items are all at least 44px (`size-11` / `min-h-11 min-w-11`).
  - Tile text is 12px.
  - The grip and options button are always visible on coarse pointers and visible on focus otherwise.
  - Keyboard drag uses dnd-kit's `KeyboardSensor` with named announcements.
  - The canvas has no tab stops (check 23).
  - The only regression found is finding 3.

## Notes carried from the build report (not defects in this diff)

- Spec check 4 conflicts with the amended Must 4 (Hide, Move up / down). Testing against Must 4 was right.
- Check 29 says the change is made "in Settings", but Settings has no intensity or grid controls; the proof used `/classic`'s gear. A new ticket is needed if Colin wants those controls in Settings.
- The Daily Tasks and Money In inner controls are still under 44px (shared with `/classic`). The fleet Schedule button's focus ring is 2.49:1. On the phone, the hero's figure row sits under the Ask SAM bar until the page is scrolled.

## Verdict

Finding 1 blocks the merge: the merged suite fails until the one-line `tempDir` change is made during the rebase. Findings 2 and 3 are small and worth fixing in the same pass. Neither blocks a deploy. Before any further proof runs, finding 4's mitigation should go into the harness.

VERDICT: FIX FIRST (1)
