# SAM_ui visual upgrade — code review

- Scope: `git diff f9a90dc..HEAD` in `/home/col/SAM_ui-visual-upgrade` (HEAD `83f14a7`, branch `build/visual-upgrade`).
- Read in full first: `implementation/visual-upgrade-spec.md` (LOCKED), `implementation/visual-upgrade-tickets.md` (T1–T25).
- Reviewed the four staged system files (`sam-dispatch.next`, `sam-job.next`, `run.next.sh`, `sam-stage.next`) against their live counterparts.
- Read-only on code. This report is the only output.

## Verdict

`VERDICT: FIX FIRST` — blocking finding 1. Findings 2 and 3 are non-blocking notes.

---

## Finding 1 — Demo mode shows the live health score and the operator name in the top bar (CONFIRMED)

- `src/components/dashboard/fleet/FleetDashboardShell.tsx:198-202` — `bootstrap()` and `startPolling()` on the dashboard store run unconditionally, regardless of `demo`. The comment even names the reason: "the top bar's health chip reads the dashboard store, so keep it fed."
- `src/store/dashboardStore.ts:148-156` — the `system` slice fetches `dashboardService.getSystemHealth()` and has no `demo` branch; the same store also polls `tasks`, `projects` and `money` every 4–30 s (`startPolling`, lines 193–214).
- `src/components/dashboard/TopBar.tsx:111` — renders `score.toFixed(1)` (the live `overallScore`) as the "health" chip.
- `src/components/dashboard/TopBar.tsx:126` — renders `operatorName` (the operator's name from preferences).
- `TopBar` is mounted unconditionally in the shell (`FleetDashboardShell.tsx:248-250`).

Failure scenario: Colin opens `/` with `?demo=1` (or flips the Demo toggle) to screen-share the new Dashboard to a client. The top-left "health" chip shows his machine's real, live health score and his operator name, and the browser keeps firing live fetches to `/api/dashboard/system|tasks|projects|money` in the background. That is exactly the class of leak demo mode exists to prevent (Must 19, check 13), and it is not covered by `demoScan.test.ts`, which only scans the four fleet routes (`/api/fleet/floor|schedule|spend|jobs`). `SidebarWidgets` hides the carried-over widgets in demo (`if (demo) return null`), so the tasks/money/project data never renders, but the health chip and operator name do.

Suggested fix (not applied): gate the store feed on `!demo` in `FleetDashboardShell.tsx` (`if (!demo) { void bootstrap(); startPolling(); }` with the same cleanup), and pass `demo` to `TopBar` so it renders a fixed demo value (or nothing) for the health chip and operator name while demo is on. This is the same pattern T20/T20b already applied to the fleet routes, extended to the one remaining live surface the shell mounts.

Severity: the leak is Colin's own health score and name, not client or cost data, but it breaks the demo-mode guarantee outright and the fix is small. Ranked top because it is the one genuine Must-19 violation in the build.

## Finding 2 — `dispatchPing.test.ts` spends a real Haiku call on every full test run (CONFIRMED, non-blocking)

- `src/lib/server/push/dispatchPing.test.ts:102-122` — spawns `sam-dispatch` with `--tier haiku` and no stub for the Claude run itself. The seams redirect `SAM_JOB_STORE`, `SAM_PUSH_SUBS`, `SAM_PUSH_LOG` and `SAM_DISPATCH_LOG` (temp), so no state is corrupted and no real push is sent, but the dispatched job is a real `claude -p` call through `sam-dispatch`'s normal path. The comment admits it: "one real Haiku call."
- It is box-only (skips on a hosted runner via `boxOnlySkip`) and can fail spuriously when the Haiku seat is at its weekly limit.

Failure scenario: `npm test` on the box burns a paid Haiku call and a slice of seat quota on every run, and flakes when that seat is exhausted. It is the one test the brief's focus-5 question points at: this is the test that should be gated, because `scheduleTrigger.test.ts` already proves the full `sam-dispatch` → `sam-job` → `run.sh` pipeline with a `true`-command stub and no paid call.

Suggested fix (not applied): keep the real-call coverage but make it opt-in, e.g. run it only when an env flag (`SAM_RUN_REAL_DISPATCH=1`) is set, or point `SAM_JOB_RUN_SH` at a stub and rely on `scheduleTrigger.test.ts` for the pipeline proof. (`demoScan.test.ts`'s live-mode control also reads real systemd timers via the live schedule route, but that is read-only with no side effect; leave it.)

## Finding 3 — Floor and schedule poll every 3 s, each doing a job-store scan plus systemctl calls (PLAUSIBLE, non-blocking)

- `src/components/floor/FloorCanvas.tsx` polls `/api/fleet/floor` and `/api/fleet/schedule` every ~3 s (verified lines 887 and 918).
- `/api/fleet/floor` → `readFloorState()` (`src/lib/server/fleet/floorState.ts`) stats up to `MAX_SCAN = 300` job dirs and, per job, reads `meta.json`, `events.jsonl` and calls `costFleetJob`.
- `/api/fleet/schedule` → `readScheduledJobs()` runs `systemctl --user list-timers --all` plus a batched `systemctl --user show` per poll.

The work is bounded (the 300/128 caps) and the `show` is batched into one argv-array call, so this is not a runaway, but it is roughly 40 systemctl invocations and a large fs scan per minute per open Dashboard tab, multiplied by every open tab or phone on screen.

Suggested fix (not applied): raise the poll to 5 s (Must 13 only requires updates within 5 s), or add a short server-side cache on the schedule read. Flagged PLAUSIBLE rather than CONFIRMED because it was reasoned from the code, not profiled.

---

## What was checked clean

### Focus 1 — staged dispatch tools (`sam-dispatch.next`, `sam-job.next`, `run.next.sh`, `sam-stage.next`)

- The only diff in `sam-dispatch.next` is the `General:`/`Stages:` parse-and-refuse block plus passing `--general`/`--stages` to `sam-job`, and the `JOB_BIN=${SAM_JOB_BIN:-...}` seam. The `--model` guard, the ceiling-rank routing guard and the dispatch-log line format are unchanged (`scheduleTrigger.test.ts:395` still asserts the same tab-separated log shape).
- `delegation-check.sh` parses the dispatch log as `ts name tier task ceil why esc` and counts `--model` in `cmd.sh`. Neither is touched by the staged changes, so the 20:25 check keeps working once installed.
- `events.jsonl` writes are safe: each job's file has a single writer at a time (`sam-dispatch` writes `dispatched` before `systemd-run`; `run.sh` writes `started`/`ended` after `cmd.sh` returns; `sam-stage` appends stage lines only from the job's own shell). `floorState.readEvents` skips malformed lines rather than sinking the job's read.
- `sam-stage` validates the stage against `meta.json`'s own `stages` array (exact, case-sensitive) and writes nothing on refusal.
- Origin detection agrees end to end: `sam-job` writes `chat` (valid `SAM_CHAT_ID`), `schedule` (`SAM_ORIGIN=schedule`) or `manual`, and `floorState.resolveOrigin` accepts exactly those three plus `unknown`.

### Focus 2 — demo-mode privacy

- All four fleet routes session-gate and short-circuit on `?demo=1` before any live read: `floor`, `schedule`, `spend` (returns `demoFleetSpend()` before `readdir`/`claudeCosts`), `jobs` (validates the persona against the five General ids, never the live registry, and returns `demoFleetPersonaJobs`).
- `DashboardChatWidget` returns a plain "Chat is hidden in demo mode" notice and fetches nothing in demo; `useWakeWord` is disabled in demo (`FleetView`: `ownChat && !demo`).
- `demoFixtures.ts` is invented data; `demoScan.ts` builds patterns from the vault's `10_Clients` folder names plus home-path shapes. `demoScan.test.ts` now catches the planted leak through the jobs route (the stray-`?` false pass Colin fixed is verified in code: `persona=${g}&demo=1`).
- The one surface not covered is Finding 1.

### Focus 3 — security

- `requireSession` on every new fleet route; unauthenticated calls get the same failure shape as `/api/fleet/jobs`.
- `schedule.ts` runs `systemctl`/`crontab` via `execFile` with argv arrays, no shell; cron names come from crontab lines, never echoed through a shell.
- Job ids reaching the filesystem come from `readdir`, not from the query string; the persona query is validated against the General ids / registry before use.

### Focus 4 — correctness against the spec

- Honest live view (Must 17): stage states come only from real `stage-start`/`stage-done` events; a planned-but-unstarted stage reads as `todo`, which is a true report, never a guess.
- One figure per job: a finished job contributes only a tower slab, a queued/running job one worker; `scheduleTrigger.test.ts` proves a scheduled dispatch is the ring's trigger plus one floor worker, never a double draw.
- Zeus flare only on dispatch: `DISPATCH_FLARE_WINDOW_MS` (10 s) over the `dispatched` event.
- 5-second update: 3 s client polling. Cost agreement (Must 15): Job detail's cost is `worker.costUsd`, which is `costFleetJob`'s own figure, the same one `/api/fleet/spend` and `/api/fleet/jobs` return.
- `/classic` unchanged (T22 proof, byte-identical), Dashboard always emerald (T12 fixed palette), wake routing single-surface (`useWakeWord` gated on `enabled`).

### Focus 5 — tests touching live state

- Covered by Finding 2 (`dispatchPing.test.ts`, real Haiku call) and the note on `demoScan.test.ts` (read-only live timers).

### Focus 6 — performance

- Covered by Finding 3.

---

## Gates

- `npm run typecheck`: exit 0 (`tsc --noEmit`, no errors).
- `npm test`: 277 pass, 0 fail, 0 skipped, 0 todo, exit 0 (tail below).

```
# tests 277
# suites 4
# pass 277
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 14786.746315
```
