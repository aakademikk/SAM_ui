# SAM_ui visual upgrade (the fleet view): build tickets

Spec: [visual-upgrade-spec.md](visual-upgrade-spec.md) (Status: LOCKED 2026-10-02)
Design source: `/home/col/Atwood_demos/sam-ui-concepts/` (README section "E: Hybrid"), read in full 2026-10-02: `src/engine.js`, `src/e-scene.js`, `src/e-hybrid.html`, `src/e-phone.html`, `src/audit.js`, `assets/busts/make-web.py`. That tree is design source only — read it, never edit it, never ship it.
Written: 2026-10-02, from a read of SAM_ui at `bd302c2` on `claude/sam-core-dashboard-sf3639`.

## Read before any ticket

- **Branch.** Build on a new branch `build/visual-upgrade`, cut from `claude/sam-core-dashboard-sf3639` at `bd302c2` (production is built from this tree). Recommended: a worktree (`git worktree add ../SAM_ui-visual-upgrade -b build/visual-upgrade bd302c2`, then `npx npm@10 install` in it), so `/home/col/SAM_ui` stays on the production branch under the live `sam-ui.service`. Copy this file and the spec into the worktree's `implementation/` if it's untracked there.
- **Gates for every ticket.** `npm run typecheck`, `npm run lint` and `npm test` pass at the end of the ticket. Never run `next dev` while `sam-ui.service` is up. Never run `./deploy.sh`, push or merge; that needs Colin's go (final ticket).
- **Tests never touch live state.** Every new test sets `HOME` to a fresh temp dir before importing the module under test, same as the multi-chat work (`implementation/multi-chat-tickets.md` T1, T3). Tests that exercise `sam-dispatch`/`sam-job`/`sam-stage` use the `.next` staged copies (see below) and the env seams `SAM_JOB_STORE`, `SAM_JOB_RUN_SH`, `SAM_DISPATCH_LOG`, never the live job store or the live dispatch log. No test creates, fires or deletes a real systemd user timer or crontab entry; a test that needs a "live timer" creates a throwaway one in a temp unit file under a seam (see T16/T19) and removes it in the test's own cleanup.
- **Job store has two shapes today (read 2026-10-02).** `~/.sam/jobs/<id>/meta.json` is written by two different code paths: (a) `sam-job` (CLI dispatch via `sam-dispatch`), fields `id, command, status, exitCode, createdAt, startedAt, endedAt, outputBytes, unit, notify, summary, chatId`; (b) `JobManager.writeMeta` (`src/lib/server/jobs/manager.ts:1007`), the `JobRecord` shape in `src/types/jobs.ts:20` (`id, command, status, exitCode, createdAt, startedAt, endedAt, outputBytes, lastSeq, pid?, procStart?, signal?, exitSource?`). Neither has a `general`, `stages` or `events` field yet — Must 16/16a add them to shape (a) only. Any reader must handle both shapes and treat all new fields as optional.
- **`/api/fleet/dispatch` bypasses `sam-dispatch`/`sam-job` entirely.** `src/app/api/fleet/dispatch/route.ts:50` calls `getJobManager().createArgs()` directly; it never runs `sam-job`, so those jobs never get `events.jsonl`, `General:`/`Stages:` or an `origin` field. They do carry the General as free text today, in `command`: `fleet:<persona> (<model>) — <brief>` (same regex as `src/app/api/fleet/jobs/route.ts`). The floor reader (T1) must parse that convention as a fallback so these jobs still show under their real General (Must 7's honesty), even though they'll never get stage events (Must 17 covers them: shown with start/running/end only). This is existing, unrelated behaviour — the spec's "live dispatch tools" (Must 16–16e) are `sam-dispatch`/`sam-job`/`sam-stage` only; `/api/fleet/dispatch` is not touched by this build (it is also not reachable from the new view — Won't-do: "No control of jobs from the view").
- **System files** (`/home/col/.local/bin/sam-dispatch`, `/home/col/.local/bin/sam-job`, `/home/col/.sam/sam-job/run.sh`, and the new `/home/col/.local/bin/sam-stage`) are live the moment they are written. The tool tickets (T2–T4) therefore stage their changes as `.next` copies beside the live files, exactly as `implementation/multi-chat-tickets.md` T9/T11 did, and the install ticket (T23) puts them live on Colin's double-confirm. Keep the `sam-job` `--model` guard (`/home/col/.local/bin/sam-job:76-85`) and the `sam-dispatch` ceiling-rank routing guard (`/home/col/.local/bin/sam-dispatch:54-98`) exactly as they are. `~/.sam/tests/test-dispatch-routing.sh` (15 assertions) and `~/.sam/delegation-check.sh` must keep passing unchanged. Every staged or installed change needs a line in today's daily note (`~/ai-memory-vault/01 - Daily Notes/<MM - Month YYYY>/<YYYY-MM-DD>.md`) naming the file, with `Enforced by: <mechanism>`.
- **No live caller to update yet (checked 2026-10-02).** A repo-wide grep of `~/.sam`, `~/bin` and `~/.claude/skills` for scripts that actually invoke `sam-dispatch` found exactly one: `~/.sam/tests/test-dispatch-routing.sh`. There is no production wrapper script that builds briefs today, so Must 16a's refusal (missing `General:`/`Stages:`) cannot break a live caller on day one. If a new caller appears before T23 installs the change, it needs the two lines added to its brief before that day.
- **Reused busts, not new art.** The six approved, compressed WebP busts already exist at `/home/col/Atwood_demos/sam-ui-concepts/assets/busts/web/` (built by that repo's `assets/busts/make-web.py` from Colin's approved renders). Copy those files as-is into SAM_ui's `public/`; do not regenerate or recolour them (Won't-do: no new bust artwork).
- **"Within 5 seconds, without a page reload" (Must 13, 28).** Short client-side polling (every 2–3 s) of the new floor/schedule API routes satisfies this; no SSE/websocket is required and none exists today for this data.
- **Demo-mode data has zero tolerance for leaks.** No client name, personal note, file path under the home folder, chat text or live cost may appear in demo fixtures or in any committed file. The demo schedule and demo jobs are original, invented data (not a copy of any real client's name) — the mockup's own demo fixtures (`src/engine.js` SCENARIOS, `src/e-scene.js` JOBS) are already invented and safe to reuse as a shape to follow.
- **Tests never launch real work (SAM, 2026-10-02).** No test sends a real push (never pass `--notify`, or point `SAM_PUSH_BIN` at a stub), launches a real `claude -p` (point `SAM_JOB_RUN_SH` at a stub run script whose command is `true`, or `SAM_JOB_BIN` at a stub), or writes the live dispatch log (`SAM_DISPATCH_LOG` at a temp file). This applies to T2, T3, T4 and especially T19.
- **Deploys and Colin's time.** Budget: the main-seat $100 cloud credit (expires 5 Nov 2026). Every `./deploy.sh` or `sam-ui` restart kills Colin's in-flight chat turn — warn him before each deploy. Only the final ticket touches the live system files, deploys, or the live `/` route.

---

## T1: Floor state: a live job-store reader
Status: DONE 2026-10-02 (npm test 144/144 incl. floorState.test covering all six fixture cases; typecheck and lint exit 0)
Spec: must-do 7, 8, 10, 13, 17; checks 6, 8, 11
Depends on: none
Blocked by: none
Model: sonnet
Context: This is the one function every renderer and module reads from, same role as the mockup's `stateAt(job, t)` (`src/engine.js:83`, and its own note: "When real stage events arrive, `stateAt` is replaced by the event stream and nothing else needs to change"). It must handle both `meta.json` shapes (see "Read before any ticket"), parse the legacy `fleet:<persona> (...)` command convention as a fallback General, and never invent a stage: a job with no `events.jsonl` and no `stages` field shows start/running/end only (Must 17).
Files: src/types/floor.ts (new file), src/lib/server/fleet/floorState.ts (new file), src/lib/server/fleet/floorState.test.ts (new file)
Steps:
1. `src/types/floor.ts`: `GeneralId = 'hermes'|'hephaestus'|'calliope'|'cerberus'|'prometheus'`; `FloorWorker { jobId, general: GeneralId | 'sam', status: 'queued'|'running'|'verifying'|'done'|'failed', origin: 'chat'|'schedule'|'manual'|'unknown', stages: { name: string, state: 'todo'|'now'|'done' }[] | null, stagesPlanned: string[] | null, elapsedMs, costUsd: number | null, startedAt, endedAt }`; `FloorState { generals: Record<GeneralId, { idle: boolean; workers: FloorWorker[] }>; samWorkers: FloorWorker[]; towers: Record<GeneralId, number>; dispatchFlares: { jobId: string; at: string }[] }`.
2. `floorState.ts` exports `readFloorState(): Promise<FloorState>`. It lists `~/.sam/jobs/*/meta.json` (same root as `src/app/api/fleet/spend/route.ts`'s `JOBS_ROOT`, capped like that route at a few hundred most-recent), and for each: determine General from, in order, (a) a `general` field once Must 16a ships, (b) the `fleet:<persona>` regex on `command` (copy the exact pattern from `src/app/api/fleet/jobs/route.ts`), else none → group under `sam`. Read `events.jsonl` beside `meta.json` if present (one JSON object per line: `{type: 'dispatched'|'started'|'stage-start'|'stage-done'|'ended', stage?, exitCode?, at}`); if absent, synthesize only `queued`/`running`/`done` or `failed` from `meta.json`'s own `status`/timestamps, with `stages: null` (never invented). Cost comes from `costFleetJob` (`@/lib/server/fleet/jobCosts`) when a cost can be computed, else `null`. A tower count is one slab per job that reached `done` today (local day) for that General (Must 12).
3. `dispatchFlares`: one entry per job whose `events.jsonl` has a `dispatched` event in roughly the last few seconds (used by T8 to fire Zeus's flare only at that moment, Must 9).
4. Test with a temp `HOME` and fixture job directories covering: a sam-job-shaped job with full `events.jsonl` (stages light in event order); a sam-job-shaped job with no General and no events (shows under `sam`, no stages, Must 17); a `JobManager`-shaped job whose `command` is `fleet:cerberus (sonnet) — ...` (shows under Cerberus with no stages); two running jobs under the same General (two separate `FloorWorker`s, Must 7); a job that ended non-zero (General shown with no tower slab added, `status: 'failed'`); two jobs verified today under one General (tower count 2).
Do not touch: `costFleetJob`, `JobManager`, the `/api/fleet/*` routes (read only, for the regex convention).
Proof: `npm test` passes, including `floorState.test` (checks 6, 8, 11; Must 7, 8, 10, 13, 17). `npm run typecheck` and `npm run lint` pass.

## T2: `sam-dispatch` requires `General:` and `Stages:` (failing test first, staged)
Status: DONE 2026-10-02 (samDispatchBrief.test 0/3 against live, 3/3 against .next; npm test 147/147; routing test 15/15 on live; live sam-dispatch sha256 unchanged; dispatchPing.test brief given the two lines)
Spec: must-do 16, 16a; check 10
Depends on: none
Blocked by: none
Model: sonnet
Context: Today `/home/col/.local/bin/sam-dispatch` extracts `Task type:` from the brief at line 80 and refuses an over-tier request without `--why`/`--escalated-from` (lines 91–98); there is no check at all for `General:`/`Stages:`. This ticket adds that check next to the existing one, using the same `grep -m1 -iE '^[[:space:]]*...:'` pattern, and copies both values into the job's `meta.json` (written downstream by `sam-job`, so this ticket passes them through as env/args that T3 picks up — see step 3). The five Generals are `hermes, hephaestus, calliope, cerberus, prometheus`; `sam` is also accepted for SAM's own work. The model-routing case statement (lines 54–59) and seat selection (lines 64–74) must not change.
Files: /home/col/.local/bin/sam-dispatch.next (new file: a copy of sam-dispatch with the change), src/lib/server/fleet/samDispatchBrief.test.ts (new file)
Steps:
1. Copy `sam-dispatch` to `sam-dispatch.next`, changing only the copy. Add, near the existing `Task type:` extraction (line 80): read `General: <name>` and `Stages: <a>, <b>, ...` from `$BRIEF` the same way. Refuse (stderr message, `exit 1`) if either line is missing, or if `General:` names anything other than the five Generals or `sam` — mirroring the existing refusal's tone and exit code, same as the `Task type:` check does today.
2. Add seams: `JOB_BIN=${SAM_JOB_BIN:-/home/col/.local/bin/sam-job}` (if not already a seam) and pass the parsed General and Stages through to `sam-job` as two new flags, `--general <name>` and `--stages "<a>,<b>,..."`, appended to the existing exec line (lines 104–105). Leave the `claude -p ...` command construction itself untouched.
3. `samDispatchBrief.test.ts`: uses `sam-dispatch.next` if present, else the live `sam-dispatch` (so it survives T23), with `SAM_JOB_BIN` pointed at a small stub script (temp dir) that just records its argv to a file and exits 0 — this test is about brief validation, not the real job pipeline. Cases: a brief with `Task type:` but no `General:` is refused; a brief with `General: pluto` (unknown) is refused; a good brief with `General: cerberus` and `Stages: Scan, Report` causes the stub to be invoked with `--general cerberus` and `--stages Scan,Report`. Run this test file first against the unmodified live `sam-dispatch` (rename the `.next` reference temporarily or point `SAM_DISPATCH_BIN` env at the live file) and record that the first two cases fail there (no such refusal exists today); then point it at `.next` and show all three pass. Record both outputs in the ticket result.
4. Daily note line: `sam-dispatch.next staged (visual-upgrade T2): requires General:/Stages: lines. Enforced by: SAM_ui npm test src/lib/server/fleet/samDispatchBrief.test.ts`.
Do not touch: the live `sam-dispatch`, the model/seat routing lines, `~/.sam/tests/test-dispatch-routing.sh` (run it unchanged against the live file to confirm it still passes).
Proof: the before-run (against the live file) fails on the two refusal cases; `npm test` passes against `.next`, including `samDispatchBrief.test` (check 10). `~/.sam/tests/test-dispatch-routing.sh` still passes against the live `sam-dispatch`.

## T3: `sam-job` writes `events.jsonl` and records job origin (failing test first, staged)
Status: DONE 2026-10-02 (samJobEvents.test 0/5 against live sam-job/run.sh, 5/5 against .next; npm test 152/152; live files sha256 unchanged, --model guard untouched)
Spec: must-do 16b, 16d, 16e; check 10
Depends on: none
Blocked by: none
Model: sonnet
Context: `sam-job` writes `meta.json` fields at lines 114–131 and already has the test seams `SAM_JOB_STORE`/`SAM_JOB_RUN_SH` (lines 33–36) and reads `SAM_CHAT_ID` (lines 109–112, validated as a UUID) because `systemd-run` does not inherit the caller's env. This ticket adds a per-job `events.jsonl` (one line per lifecycle event, each with a timestamp — Must 16d) and an `origin` field: `chat` if `SAM_CHAT_ID` is a valid UUID, `schedule` if a new `SAM_ORIGIN=schedule` env var is set (a scheduled unit sets this before calling `sam-dispatch`/`sam-job`; none does yet — T16/T19 add a test-only one), else `manual`. Accept the `--general`/`--stages` flags T2 added (store them in `meta.json`, write `dispatched` into `events.jsonl` immediately with those stages as the planned list) even if `sam-dispatch` isn't using them yet.
Files: /home/col/.local/bin/sam-job.next (new file: a copy of sam-job with the change), src/lib/server/fleet/samJobEvents.test.ts (new file)
Steps:
1. Copy `sam-job` to `sam-job.next`. Accept `--general <name>` and `--stages <csv>` (no-ops if absent). Add `ORIGIN=${SAM_ORIGIN:-}`; write `origin` into `meta.json` as `chat` (valid `SAM_CHAT_ID`), `schedule` (`SAM_ORIGIN=schedule`), or `manual` (neither).
2. At the moment the job is created (before `systemd-run`), append one line to `<job dir>/events.jsonl`: `{"type":"dispatched","at":"<ISO8601>","general":"<name|null>","stages":["<a>","<b>"]|null}`. Pass `SAM_JOB_EVENTS=<job dir>/events.jsonl` through to the unit's env (another `--setenv`, same pattern as the existing `SAM_PUSH_*` ones at lines 142–145) so `run.sh` (T3 continues below) and `sam-stage` (T4) can append to the same file without recomputing the job dir.
3. `/home/col/.sam/sam-job/run.next.sh` (new file: a copy of `run.sh`): at the point it marks `status: running` (lines 29–35), append `{"type":"started","at":"<ISO8601>"}` to `$SAM_JOB_EVENTS` if set; at the point it writes the final status (lines 55–68), append `{"type":"ended","at":"<ISO8601>","exitCode":<n>}`. Everything else in `run.sh` (the ping/summary/digest logic, lines 74–140) is unchanged — this ticket does not touch chat-id ping behaviour.
4. `samJobEvents.test.ts`: temp `HOME`, `SAM_JOB_STORE` pointed at a temp dir, `SAM_JOB_BIN`/`SAM_JOB_RUN_SH` pointed at the `.next` files (or the live files if `.next` is absent, so the test survives T23). Run a real short job (e.g. `sam-job.next -- true`) once with `SAM_CHAT_ID=<uuid>` and assert `origin: 'chat'`; once with `SAM_ORIGIN=schedule` and assert `origin: 'schedule'`; once with neither and assert `origin: 'manual'`. Assert `events.jsonl` holds `dispatched`, `started`, `ended` in order, each with a timestamp, and `ended.exitCode` matches the real exit code. Run the same assertions against the unmodified live `sam-job` first and show they fail (no `events.jsonl` exists, no `origin` field) before pointing at `.next`.
5. Daily note lines for `sam-job.next` and `run.next.sh`: `staged (visual-upgrade T3): events.jsonl + origin field. Enforced by: SAM_ui npm test src/lib/server/fleet/samJobEvents.test.ts`.
Do not touch: the live `sam-job`/`run.sh`, the `--model` guard block (diff it before/after and confirm it's byte-identical), the ping/summary logic in `run.sh`, `chatId` handling.
Proof: the before-run (live files) fails on `events.jsonl`/`origin` assertions; `npm test` passes against `.next`, including `samJobEvents.test` (check 10).

## T4: `sam-stage` helper (new file, failing test first, staged)
Status: DONE 2026-10-02 (samStage.test 2/6 with the script missing, 6/6 with sam-stage.next incl. an end-to-end job: dispatched, started, stage-start, stage-done, ended 0 in order; npm test 158/158; no live sam-stage created)
Spec: must-do 16c, 16d; check 10
Depends on: T3
Blocked by: none
Model: sonnet
Context: The worker script (whatever `sam-dispatch` launches) calls `sam-stage start <stage>` / `sam-stage done <stage>` as it goes, to append to the same `events.jsonl` T3 created. It must refuse a stage that isn't in the job's planned list (from `meta.json`'s `stages`, written by T2/T3). It finds its job the same way `run.sh` does today: `$SAM_JOB_EVENTS`/`$SAM_JOB_DIR` in its env (set by `run.next.sh`, extend it in this ticket to also export `SAM_JOB_DIR` if it doesn't already).
Files: /home/col/.local/bin/sam-stage.next (new file), /home/col/.sam/sam-job/run.next.sh (edit: export SAM_JOB_DIR if not already present), src/lib/server/fleet/samStage.test.ts (new file)
Steps:
1. `sam-stage.next`, a small bash script: `sam-stage start <stage>` appends `{"type":"stage-start","stage":"<stage>","at":"<ISO8601>"}`; `sam-stage done <stage>` appends `{"type":"stage-done","stage":"<stage>","at":"<ISO8601>"}`. Both read `$SAM_JOB_DIR/meta.json`'s `stages` array and exit 1 with a clear stderr message if `<stage>` isn't in it, writing nothing. Both append to `$SAM_JOB_EVENTS` (default `$SAM_JOB_DIR/events.jsonl`).
2. Confirm (edit if needed) that `run.next.sh` exports `SAM_JOB_DIR` to the job's own shell environment before running `cmd.sh`, so a worker invoked by the job can call `sam-stage` without knowing its own job id.
3. `samStage.test.ts`: temp job dir with a `meta.json` holding `stages: ["Scan", "Report"]` and an empty `events.jsonl`. Run `sam-stage.next start Scan` then `sam-stage.next done Scan` with `SAM_JOB_DIR`/`SAM_JOB_EVENTS` pointed at it; assert both lines land in order with timestamps. Run `sam-stage.next start Nope` and assert exit 1 and no new line written. Since `sam-stage` doesn't exist live yet, there is no "before" run against a live file — the failing-first proof here is: write the test, run it against an empty/missing script first (it fails because the script doesn't exist), then write `sam-stage.next` and show it passes.
4. Daily note line: `sam-stage.next staged (visual-upgrade T4): new stage-event helper. Enforced by: SAM_ui npm test src/lib/server/fleet/samStage.test.ts`.
Do not touch: `run.sh` itself (only the `.next` copy), `sam-dispatch`, `sam-job`.
Proof: the test fails before `sam-stage.next` exists; `npm test` passes after, including `samStage.test` (check 10).

## T5: `/api/fleet/floor` route
Status: DONE 2026-10-02 (route.test: FloorState shape with a signed session, 401 shape matches /api/fleet/jobs without one; npm test 160/160; envelope() takes positional args, not the ticket's options object)
Spec: must-do 13; check 6
Depends on: T1
Blocked by: none
Model: sonnet
Context: Session-gated like the other `/api/fleet/*` routes (`requireSession` from `@/lib/server/auth/guard`, `envelope()`/`failure()` from `@/lib/server/respond`). This is what the floor canvas and modules poll every few seconds; it must stay cheap (same job-store scan cap as `/api/fleet/spend`).
Files: src/app/api/fleet/floor/route.ts (new file), src/app/api/fleet/floor/route.test.ts (new file)
Steps:
1. `GET /api/fleet/floor`: `requireSession`, call `readFloorState()` (T1), return it via `envelope(state, { source: 'sam.fleet.floor' })`.
2. Test: with a temp `HOME` and a couple of fixture jobs (reuse T1's fixtures or a subset), call the route handler directly and assert the JSON shape matches `FloorState` and that an unauthenticated call (no session) gets the same failure shape as `/api/fleet/jobs` does today.
Do not touch: the other `/api/fleet/*` routes.
Proof: `npm test` passes, including the new route test. `npm run typecheck` and `npm run lint` pass.

## T6: Port the bust assets
Status: DONE 2026-10-02 (11 files in public/busts, sha256 all match the mockup's assets/busts/web; BUST_PATHS typed; typecheck 0, npm test 160/160)
Spec: must-do 2; check 3
Depends on: none
Blocked by: none
Model: sonnet
Context: Won't-do: no new bust artwork. The six files already exist, compressed, at `/home/col/Atwood_demos/sam-ui-concepts/assets/busts/web/` (256 px for scene/cards/Fleet rows, 512 px for zoom/phone sheet, no 512 px Zeus). Copy them as-is into `public/busts/` so Next.js serves them as static assets with no change to the files' bytes.
Files: public/busts/zeus-256.webp (new), public/busts/hermes-256.webp (new), public/busts/hermes-512.webp (new), public/busts/hephaestus-256.webp (new), public/busts/hephaestus-512.webp (new), public/busts/calliope-256.webp (new), public/busts/calliope-512.webp (new), public/busts/cerberus-256.webp (new), public/busts/cerberus-512.webp (new), public/busts/prometheus-256.webp (new), public/busts/prometheus-512.webp (new), src/lib/busts.ts (new file: exports BUST_PATHS, a typed map from GeneralId | 'sam' to its 256/512 px public path)
Steps:
1. Copy the 11 WebP files byte-for-byte from the mockup's `assets/busts/web/` into `public/busts/` under the same names.
2. `src/lib/busts.ts`: `BUST_PATHS: Record<GeneralId | 'sam', { small: string; large?: string }>` (Zeus has no `large`), pointing at `/busts/<name>-256.webp` and `/busts/<name>-512.webp`.
Do not touch: the source files in `/home/col/Atwood_demos/sam-ui-concepts/` (read-only design source), the busts' pixel content.
Proof: `ls public/busts` lists 11 files; `sha256sum` of each matches the corresponding file under the mockup's `assets/busts/web/`. `npm run typecheck` passes.

## T7: Floor canvas: isometric scene, stations, pads, towers, workers
Status: DONE 2026-10-02 (floorRender.test 12/12, npm test 189/189, typecheck and lint exit 0; prod build at 1920x1080 matches the mockup floor by eye, shots/t7-floor-1920*.png; reduced motion: no travelling lights, 0 console errors from the canvas)
Spec: must-do 1, 2 (SAM's and Generals' platform, no busts yet), 6, 7, 10, 11, 12, 13; checks 2, 5, 6, 8
Depends on: T5
Blocked by: none
Model: opus — porting the mockup's isometric floor pixel-for-pixel is a visual-fidelity job, judged against the mockup's screenshots, not a routine build.
Context: Port the shared drawing primitives from `src/e-scene.js` (`box`, `drawBackdrop`, `drawPlinth`, `drawStation`, `drawPad`, `figure`) into a React client component driven by `/api/fleet/floor` (T5) instead of `stateAt(job, t)`. Busts are deliberately left out of this ticket (T8 adds them) to keep this one buildable and testable on its own — stations draw as plain platforms for now. Honour `prefers-reduced-motion`: no travelling lights, no bob, static current state (Must 6).
Files: src/components/floor/FloorCanvas.tsx (new file), src/components/floor/floorRender.ts (new file: pure, canvas-context-free geometry/draw-step functions, so they're unit-testable), src/components/floor/floorRender.test.ts (new file)
Steps:
1. `floorRender.ts`: port the isometric projection and box/pad/tower/figure geometry as pure functions taking a `FloorState` (T1) and returning drawable shapes (positions, sizes, states) — no `CanvasRenderingContext2D` calls here, so the logic is testable without a browser. Keep the same visual proportions as `e-scene.js` (plinth/station sizing, stage-pad row, one tower slab per job verified today).
2. `FloorCanvas.tsx`: a `'use client'` component with a `<canvas>` and `requestAnimationFrame` loop, polling `/api/fleet/floor` every 3 s, calling `floorRender.ts`'s functions each frame and drawing the returned shapes. One worker figure per running job (Must 7, from `FloorState.generals[g].workers`), idle General has no worker figures and no link traffic (Must 10). On job end: `exitCode === 0` adds a tower slab in teal-return colour; non-zero shows red and adds no slab (Must 11, 12). Honour `window.matchMedia('(prefers-reduced-motion: reduce)')`: skip the animation loop, draw one static frame per state change.
3. `floorRender.test.ts`: given a fixed `FloorState` fixture, assert the returned shapes have the right station count (5 + SAM), the right worker-figure count per General, and that an idle General's bust-slot brightness value (even though T8 draws the bust) is flagged `idle: true` vs `idle: false` for a working one — this is the seam T8 reads.
Do not touch: `src/engine.js`/`src/e-scene.js` (read-only design source), the `/api/fleet/floor` route.
Proof: `npm test` passes, including `floorRender.test`. `npm run typecheck`/`npm run lint` pass. Manual check (recorded in the ticket result): with reduced motion forced in a browser dev tools override, no travelling lights are drawn and there are 0 console errors (check 5, automated fully in T24's browser pass).

## T8: Busts, idle/working brightness, Zeus's dispatch flare
Status: DONE 2026-10-02 (busts.test 11/11, npm test 200/200, typecheck and lint exit 0; prod build: six busts draw, Zeus at SAM node with no diamond, idle Generals dimmer, Zeus flares once on a new dispatch and not on later polls or under reduced motion, shots/t8-*.png; step 3's 'idle 0.4 at msSinceChange=0' read as steady idle, since step 1 and the mockup ramp down from 1)
Spec: must-do 2, 9, 10; checks 3, 7
Depends on: T6, T7
Blocked by: none
Model: opus — the brightness ramp and flare timing are judged against the mockup's screenshots and its brightness-gain audit math, which is a visual-fidelity job.
Context: Port `bust()`, `bustLevel()` and `flareAt()` from `src/e-scene.js` (idle 40% brightness, working 100%, 0.3 s linear ramp either way; Zeus's flare is a sharp strike plus a smaller second strike over about a second, firing only at the moment a job's `dispatched` event lands — Must 9, "It flares at no other time"). Draw with `globalCompositeOperation = 'lighter'` as the mockup does, over `FloorCanvas`'s stations from T7.
Files: src/components/floor/busts.ts (new file: pure brightness/flare-timing functions, ported from e-scene.js bustLevel/flareAt), src/components/floor/busts.test.ts (new file), src/components/floor/FloorCanvas.tsx (edit: draw busts from src/lib/busts.ts (T6) using busts.ts's brightness/flare functions)
Steps:
1. `busts.ts`: `bustLevel(idle: boolean, msSinceChange: number): number` (0.4 idle, ramps to 1 over 300 ms on becoming working, back down over 300 ms on becoming idle); `flareIntensity(msSinceDispatch: number): number` (0 outside roughly a 1.2 s window, sharp rise then decay, a smaller second pulse after about 240 ms — copy the timing constants from `e-scene.js`'s `flareAt`). Both pure, no canvas/DOM.
2. `FloorCanvas.tsx`: for each station, draw its bust (`src/lib/busts.ts` path) at `bustLevel(...)` opacity, additive blend; for SAM's node, draw Zeus and, when `FloorState.dispatchFlares` has a recent entry, layer the flare per `flareIntensity`. Under reduced motion: no flare ever, bust shows its static idle/working level only (no ramp, no bob).
3. `busts.test.ts`: `bustLevel` is 0.4 at `msSinceChange=0` when idle, 1 when working and ramp-complete, and strictly between on a mid-ramp sample; `flareIntensity` is 0 at `-1ms` and at `2000ms`, positive within the window, and 0 for any input when a `reduced` flag is passed.
Do not touch: `src/lib/busts.ts`'s file paths (T6), `FloorState` shape (T1).
Proof: `npm test` passes, including `busts.test`. Manual/browser check (full pass in T24): Zeus flares once at a real dispatch and not otherwise (check 7); the six images all load and draw, Zeus sits at the SAM node with no diamond, an idle General is visibly dimmer than a working one (check 3).

## T9: Modules A — KPI tiles, Active jobs, Job detail
Status: DONE 2026-10-02 (jobDetail.test 7/7 incl. readFloorState cost == costFleetJob on the same fixture; npm test 206/206; typecheck and lint exit 0; name and tier come from /api/fleet/jobs by jobId, else 'unknown', since FloorWorker carries neither)
Spec: must-do 3, 14; check 9
Depends on: T5
Blocked by: none
Model: sonnet
Context: These three panels sit beside the floor (Must 3). Job detail shows name, General, model tier, stages done/planned, elapsed and cost, with no percentage bars (Must 14) — cost must agree with `/api/fleet/spend` and `/api/fleet/jobs` for the same job (Must 15, check 9), since both read the same `costFleetJob`.
Files: src/components/dashboard/fleet/KpiTiles.tsx (new file), src/components/dashboard/fleet/ActiveJobsModule.tsx (new file), src/components/dashboard/fleet/JobDetailModule.tsx (new file), src/components/dashboard/fleet/jobDetail.test.ts (new file)
Steps:
1. `KpiTiles.tsx`: small summary tiles (jobs today, spend today, busy/idle count) reading `/api/fleet/floor` plus `/api/fleet/spend` for the totals (reuse, don't recompute).
2. `ActiveJobsModule.tsx`: list of currently queued/running jobs from `FloorState`, one row per `FloorWorker`, clicking a row opens that General's detail (wired up in T11).
3. `JobDetailModule.tsx`: for the selected job, show name, General, model tier (from the job's `command`/meta), `stagesDone / stagesPlanned.length` or "no stage data" (Must 17), elapsed (`mmss`-style), and cost. No progress bar.
4. `jobDetail.test.ts`: a pure formatter function extracted from the component (e.g. `formatJobDetail(worker: FloorWorker): {...}`) — assert its cost output for a fixture job matches what `costFleetJob` would report for the same fixture (cross-check against the existing `jobCosts.test` fixtures if any exist, else a matching fixture of your own).
Do not touch: `costFleetJob`, `/api/fleet/spend`, `/api/fleet/jobs`.
Proof: `npm test` passes, including `jobDetail.test` (check 9, cost-agreement half). `npm run typecheck`/`npm run lint` pass.

## T10: Modules B — Fleet status, Stage events, Spend by hour
Status: DONE 2026-10-02 (spendByHour.test 5/5 plus stageEvents.test 9/9, npm test 220/220, typecheck and lint exit 0; Fleet status reads the same generals[g].idle as the busts; /api/fleet/spend has no time data, so the module shows spend by persona over 7 days, honestly labelled, not by hour)
Spec: must-do 3, 15; check 9
Depends on: T5
Blocked by: none
Model: sonnet
Context: Fleet status lists SAM and the five Generals with busy/idle state (Must 10). Stage events is the live log of real stage events (Must 8) — not a timeline guess. Spend by hour must use the same costing as `/api/fleet/spend` (Must 15).
Files: src/components/dashboard/fleet/FleetStatusModule.tsx (new file), src/components/dashboard/fleet/StageEventsModule.tsx (new file), src/components/dashboard/fleet/SpendByHourModule.tsx (new file), src/components/dashboard/fleet/spendByHour.test.ts (new file)
Steps:
1. `FleetStatusModule.tsx`: one row per General (plus SAM) from `FloorState`, busy/idle derived the same way T7/T8 derive bust brightness, so the two can't disagree.
2. `StageEventsModule.tsx`: a scrolling log built from each `FloorWorker.stages` state transitions as `FloorState` changes between polls (keep the last N transitions client-side; don't re-derive a fake timeline).
3. `SpendByHourModule.tsx`: calls `/api/fleet/spend` directly for the totals-by-model bar (same route the existing dashboard-less fleet view would use), so it is byte-for-byte the same costing, not a second implementation.
4. `spendByHour.test.ts`: a pure aggregation function (e.g. bucket spend by hour from a `FleetSpend`-shaped fixture) matches hand-computed totals for a small fixture.
Do not touch: `/api/fleet/spend`'s computation, `costFleetJob`.
Proof: `npm test` passes, including `spendByHour.test` (check 9, spend-agreement half). `npm run typecheck`/`npm run lint` pass.

## T11: Fleet dashboard shell — zoom/detail, small-laptop drawer
Status: DONE 2026-10-02 (dashboardLayout.test 5/5, npm test 225/225, typecheck and lint exit 0, next build 0; breakpoints copied from e-hybrid.html; prod build at 1920x1080 and 1280x650 matches e-busts-1920/e-fit-1280 by eye, shots/t11-*.png; agent's browser run: click a General opens detail, Esc and empty-floor click close, gear opens; harness can't render .tsx so the hook test is dashboardLayout.test.ts)
Spec: must-do 1, 3c, 4, 5; checks 1, 2, 4, 32
Depends on: T7, T8, T9, T10
Blocked by: none
Model: opus — the drawer breakpoints and zoom layout are judged against the mockup's recorded fit boxes, a visual-fidelity job.
Context: This assembles T7–T10 into one page-shaped component, following the mockup's D-style layout (SAM top, five Generals in a row, modules around the floor) and the drawer breakpoint from `e-hybrid.html` (laptop range `(min-width:820px) and (max-width:1600px)`, or short laptops, folds the six modules into tabs: Job, Fleet, Jobs, Events, Spend, Chat). This component is NOT yet mounted at `/` — it is built and tested standalone; T22 wires the route swap. Clicking a General (on the floor, its card, or its row in a module) opens its zoom/detail; Esc or Back returns to the full floor (Must 4).
Files: src/components/dashboard/fleet/FleetDashboardShell.tsx (new file), src/components/dashboard/fleet/GeneralDetailPanel.tsx (new file), src/components/dashboard/fleet/FleetDashboardShell.test.tsx (new file, if the test harness supports component rendering; otherwise a pure `useDrawerTab`-style hook extracted and tested headlessly)
Steps:
0. Mount today's top bar (`src/components/dashboard/TopBar.tsx`, unchanged: health chip, sync badge, UTC clock, `ControlDeck` gear) at the top of the shell (Must 3c); `FleetPhoneView` (T13) mounts the same component above its hero.
1. `FleetDashboardShell.tsx`: lays out `FloorCanvas` (T7/T8) plus the six modules (T9/T10) per the mockup's density; at laptop widths/heights (match the `e-hybrid.html` media query), folds the six into a tabbed drawer, Job tab open by default; on a taller laptop, Job detail and Fleet show together (match the mockup's sub-breakpoint).
2. Clicking a General anywhere (floor, card, Fleet status row, Active jobs row) opens `GeneralDetailPanel.tsx` for that General (desktop: side panel; drawer: swaps the open tab to that detail). Esc or a click on empty floor space closes it and returns to the full view.
3. Extract the breakpoint/tab logic into a small pure hook (e.g. `useDashboardLayout(width, height)`) so it can be unit tested without a full render.
4. Test the pure hook: given the mockup's documented breakpoints (1200–1600 wide or under about 800 tall → drawer; else full layout), assert the right mode and default tab.
Do not touch: T7–T10's internals beyond composing them; `src/app/(app)/page.tsx` (untouched until T22).
Proof: `npm test` passes, including the new hook/component test. `npm run typecheck`/`npm run lint` pass. Browser check (full pass in T24): a real click on a General opens its detail, Esc returns to the full floor (check 4), the top bar shows its chip, badge, clock and a working gear at 1920x1080, 1280x650 and 412x915 (check 32), and the layout matches the mockup's recorded fit at 1920×1080/1536×730/1366×680/1280×650 (checks 1, 2).

## T12: Dashboard always emerald, regardless of the theme switch
Status: DONE 2026-10-02 (scoped .fleet-dashboard block in globals.css redeclares the six --sam-accent vars, so the unchanged TopBar is emerald too; prod build with ambient forced to plasma and ember: 0 purple/violet pixels, mean colour equal to emerald within animation noise, /login's --sam-accent still follows the theme; FleetDashboardShell.tsx needed no edit; typecheck, lint 0, npm test 225/225)
Spec: must-do 3d; check 24
Depends on: T11
Blocked by: none
Model: sonnet
Context: Research finding (2026-10-02): the app's live 3D background (`SamBackground`/`VaultGraphVisualiser`) already ignores `ambientTheme` and is hardcoded to the emerald palette (`src/components/visualiser/VaultGraphVisualiser.tsx:71`) — only the UI chrome's CSS variables (`--sam-accent` etc., set from `document.documentElement.dataset.ambient` in `DashboardShell.tsx:35`) actually change with the theme switch today. This ticket makes sure the new fleet view's own chrome (module panels, cards, the drawer) never reads those theme-driven CSS variables, and instead uses fixed emerald tokens, so picking Plasma/Ember changes other pages but not this one.
Files: src/components/dashboard/fleet/FleetDashboardShell.tsx (edit: use fixed emerald CSS values/classes, not `var(--sam-accent)` etc.), src/app/globals.css (edit: add a scoped `.fleet-dashboard` rule block with hardcoded emerald values, if the shell needs shared CSS vars locally)
Steps:
1. Audit everything T7–T11 wrote for any use of `var(--sam-accent)`, `var(--sam-accent-2)`, `var(--sam-accent-3)` or the ambient theme dataset; replace with the fixed values from `globals.css:153-160`'s `[data-ambient='emerald']` block (`#3dff5a`, `#9dff70`, `#2dd4bf`), either as literals or a scoped `.fleet-dashboard { --fleet-accent: #3dff5a; ... }` block that does not depend on `document.documentElement.dataset.ambient`.
2. Do not set `document.documentElement.dataset.ambient` from this component at all (leave the global dataset exactly as the user's picked theme, since Status and other pages still need to read it).
Do not touch: `ControlDeck.tsx`, `useUserPreferencesStore`, the theme switch itself (it must keep changing other pages).
Proof: `npm run typecheck`/`npm run lint` pass. Browser check (full pass in T24): with the theme set to Plasma then Ember, the Dashboard passes the purple/violet pixel check and shows the same emerald as the default theme; Status (or another page) does change theme (check 24).

## T13: Phone layout
Status: DONE 2026-10-02 (phoneView.test 12/12, npm test 236/236, typecheck and lint 0, next build 0; prod build: 412x915 lands on the phone layout, 1920 on desktop, ?view= override works, no overflow; tap opens the sheet with the 512 px bust and swipe/outside/Esc close it; matches e-busts-phone/-sheet by eye, shots/t13-*.png; additive phone variant in FloorCanvas/floorRender; PHONE_QUERY max-height 560 to 559 per the ticket)
Spec: must-do 6a, 6b, 6c, 6d; checks 18, 19, 20
Depends on: T11
Blocked by: none
Model: opus — porting `e-phone.html`'s hero/sheet layout faithfully (no redesign allowed, per Won't-do) is a pixel-fidelity job.
Context: Won't-do: no redesign of the approved phone layout; its canvas labels stay as in the mockup even though they're under the laptop's 11 px floor (documented mockup limitation, accepted). One link serves both: narrower than 820 px, or a touch screen under 560 px tall, gets the phone layout; a laptop/desktop gets the desktop layout; no flash of the wrong one (Must 6c — port the `e-hybrid.html`/`e-phone.html` top-of-page redirect-before-paint pattern, not a client-side flash-then-swap). Must 6d: live data and demo mode behave the same on the phone as on desktop (checks 6, 7, 13 must also pass at 412×915 — verified in T24, built here).
Files: src/components/dashboard/fleet/FleetPhoneView.tsx (new file), src/components/dashboard/fleet/GeneralDetailSheet.tsx (new file), src/components/dashboard/fleet/FleetView.tsx (new file: a tiny pre-paint check — viewport width/touch+height — chooses `FleetDashboardShell` or `FleetPhoneView` before any content renders, matching the mockup's media-query gate. NOT mounted at `/` here: `src/app/(app)/page.tsx` stays untouched until T22, so the live home page does not change mid-build)
Steps:
1. `FleetPhoneView.tsx`: hero (Zeus top, five busts on the General row, reusing `floorRender.ts`/`busts.ts` from T7/T8 with the phone's canvas-label mode from `e-phone.html`), then job-in-flight with its stage timeline, Fleet, Active jobs, Spend stacked, and a solid `Ask SAM` bar fixed at the bottom (opens T14's chat widget).
2. `GeneralDetailSheet.tsx`: bottom sheet with the large (512 px) bust, opened by tapping a General in the hero or a list row; swipe-down or a tap outside closes it (reuse the same `GeneralDetailPanel` content from T11 inside a sheet shell).
3. The breakpoint check in `FleetView.tsx` runs synchronously before the first paint (matching media query `(max-width: 819px), (pointer: coarse) and (max-height: 559px)`), so there's no flash of the wrong layout; `?view=desktop`/`?view=phone` override for testing, same as the mockup.
Do not touch: the mockup's `e-phone.html` itself (read-only), the desktop shell beyond the shared breakpoint check.
Proof: `npm run typecheck`/`npm run lint`/`npm test` pass. Browser checks (full pass in T24): fit checks pass at 412×915 and 390×844 with the Ask SAM bar solid (check 18); opening at 412×915 lands on the phone layout and 1920 on desktop (check 18); a tap on a General at 412×915 opens the sheet with the large bust and closes (check 19); checks 6, 7, 13 also pass at 412×915 (check 20).

## T14: Dashboard chat widget — real SAM chat, most-recent chat, picker, wake routing
Status: DONE 2026-10-02 (DashboardChatWidget.test 8/8, npm test 244/244, typecheck and lint 0, next build 0; chat/page.tsx's three wake effects moved into useWakeWord unchanged in order, intervals and visibility handling; the wake listener sits in FleetView, not the widget, so the phone keeps polling while the sheet is closed; startTurn is server-side, the widget uses startAgentTurn like the Chat page; openChatById/attachToRun are page-local, so the widget has its own compact copy; no ?wake=1 URL clean-up exists today; browser and A16 checks are T24)
Spec: must-do 3a, 3e; check 26
Depends on: T11
Blocked by: none
Model: opus — coordinating wake-word/hands-free routing across two pages (today page-local to `/chat`) is a real concurrency/state-ownership problem, not a routine UI wire-up.
Context: Today's `ChatVoiceWidget` (`src/components/chat/ChatVoiceWidget.tsx`) talks to a separate voice-websocket service, not the multi-chat job-based agent turn system — it is not what Must 3a asks for. The real chat (list, open, send, history) is `chatsService`/`chatStore`/`startTurn` from the multi-chat work, used today only from `src/app/(app)/chat/page.tsx`. Wake-word detection (`?wake=1`, `desktopWakeSeq`/`phoneWakeSeq` polling via `observeWakeSeq`, `src/lib/wakeSeq.ts`) is currently page-local state inside `chat/page.tsx` (lines ~1590–1660) — there is no global store or event bus for it. This ticket extracts that polling into a reusable hook so both `/chat` and the new Dashboard widget can use it, and makes sure only the page actually on screen acts on a wake event (multi-chat Must 8: the wake word sends to the chat on screen).
Files: src/lib/useWakeWord.ts (new file: extracted from chat/page.tsx's wake-polling effects), src/app/(app)/chat/page.tsx (edit: use the extracted hook instead of its inline effects, behaviour unchanged), src/components/dashboard/fleet/DashboardChatWidget.tsx (new file), src/components/dashboard/fleet/DashboardChatWidget.test.ts (new file, for the picker/most-recent-chat logic only)
Steps:
1. `useWakeWord(onWake: () => void, enabled: boolean)`: pulls the three mechanisms out of `chat/page.tsx` (phone-launch `?wake=1`, desktop `desktopWakeSeq` poll, phone-foreground `phoneWakeSeq` poll) into one hook that calls `onWake()` when any fires, only while `enabled` (so the Dashboard widget and the Chat page never both react to the same wake event — only the page currently mounted/visible has `enabled: true`). Rewire `chat/page.tsx` to use it with its existing behaviour unchanged (verify with `npm test`/manual: chat's hands-free loop still works).
2. `DashboardChatWidget.tsx`: on mount, call `GET /api/chats?archived=0` (`chatsService`), pick the most recently active chat (`listChatSummaries`'s sort order), open it via the same `openChat`/`attachToRun` pattern `chat/page.tsx` uses, and render a compact message list + composer + a small chat picker (a dropdown of the main list) to switch chats. Sending a message calls `startTurn` with that chat's id, same as the Chat page. Use `useWakeWord(..., enabled: <widget is the visible chat surface, e.g. Dashboard is the active route>)`; a "Hey Sam" while the Dashboard is on screen sends to the widget's open chat (Must 3e).
3. `DashboardChatWidget.test.ts`: a pure "pick most-recent chat" selector given a `ChatSummary[]` fixture returns the right id; the picker's filter-by-title behaviour reuses `filterChatTitles` from `src/lib/chatListFilter.ts` (multi-chat T16) rather than reimplementing it.
Do not touch: `ChatVoiceWidget.tsx` (leave it as-is; it is not mounted by the new shell — T11/T22 do not render `DashboardShell`), `chatStore.ts`, `startTurn.ts`, the Chat page's own send/attach logic beyond swapping in the extracted hook.
Proof: `npm test` passes, including `DashboardChatWidget.test`; the Chat page's existing tests (if any) still pass, proving the extraction didn't change its behaviour. `npm run typecheck`/`npm run lint` pass. Browser check (full pass in T24, on the A16): the widget shows the most recent chat's history; a message sent from it appears in that chat on the Chat page; picking another chat switches the widget; "Hey Sam" with the Dashboard on screen lands in the widget's chat (check 26).

## T15: Carry-over widgets — System Health, Daily Tasks, Money In
Status: DONE 2026-10-03 (typecheck 0, lint 0 errors, npm test 244/244; SidebarWidgets mounts the three unchanged widgets at sm beside the floor, folded into the drawer's Job tab (no seventh tab), and directly below the job in flight on the phone; hidden in demo mode; mounted once at a time because WidgetFrame's framer-motion layoutId breaks with two live copies; browser value check is T24)
Spec: must-do 3b; check 22
Depends on: T11
Blocked by: none
Model: sonnet
Context: These three keep showing exactly what they show today (Must 3b) — they are not rebuilt, just relocated: beside the floor on desktop/laptop (in the drawer on a small laptop), below the job-in-flight on the phone. `ActiveProjectsWidget` is dropped (Won't-do) and must not appear here.
Files: src/components/dashboard/fleet/SidebarWidgets.tsx (new file), src/components/dashboard/fleet/FleetDashboardShell.tsx (edit: mount SidebarWidgets in the desktop/drawer layout), src/components/dashboard/fleet/FleetPhoneView.tsx (edit: mount SidebarWidgets below the job-in-flight section)
Steps:
1. `SidebarWidgets.tsx`: renders `SystemHealthWidget`, `DailyTasksWidget`, `MoneyInWidget` (imported directly from `src/components/dashboard/widgets/`, unchanged) outside the `dnd-kit`/`StatCardGrid` machinery — they don't need to be draggable here, just present. Do not import `ActiveProjectsWidget` or touch `widgetRegistry.tsx`/`WIDGET_REGISTRY` (that registry stays exactly as it is for `/classic`, T22).
2. Wire `SidebarWidgets` into the small-laptop drawer as its own tab (or folded into an existing tab per the mockup's drawer density — match whichever the mockup's six-tab layout implies; if it doesn't fit as a seventh tab, follow the mockup's own note about not adding a seventh label and fold these into the Job tab's scroll).
3. On the phone (`FleetPhoneView.tsx`), mount below the job-in-flight/stage-timeline section, above Fleet/Active jobs/Spend or below them — match the spec's wording ("below the job in flight on the phone"), i.e. directly after it.
Do not touch: `SystemHealthWidget.tsx`, `DailyTasksWidget.tsx`, `MoneyInWidget.tsx`, their APIs, `WIDGET_REGISTRY`.
Proof: `npm run typecheck`/`npm run lint` pass. Browser/manual check (full pass in T24): the three widgets on the new Dashboard show the same values as their APIs return, checked against the old widgets on the same data (check 22).

## T16: Scheduled-jobs data reader
Status: DONE 2026-10-02 (schedule.test 17/17 with a stubbed runner: daily plain-words + next run, failed Result, cron lastRun 'not recorded', sam-dispatch ExecStart sets launchesFleetJob; npm test 177/177; typecheck and lint exit 0)
Spec: must-do 23 (data half), 25, 27 (detection half); check 27
Depends on: none
Blocked by: none
Model: sonnet
Context: `systemctl --user list-timers --all` plus `systemctl --user show <unit>` give each timer's `Result`, `ExecMainStatus`, last/next trigger (about 48 live timers checked 2026-10-02); `crontab -l` gives cron entries with no run record ("not recorded" — Must 25). Tests must never touch Colin's real timers/crontab; use an injectable command runner seam.
Files: src/lib/server/fleet/schedule.ts (new file), src/lib/server/fleet/schedule.test.ts (new file), src/app/api/fleet/schedule/route.ts (new file)
Steps:
1. `schedule.ts`: `readScheduledJobs(run = defaultCommandRunner): Promise<ScheduledJob[]>`, where `run` is an injectable `(cmd: string, args: string[]) => Promise<string>` (defaulting to a real `child_process.execFile` wrapper) so tests can stub it. Parse `systemctl --user list-timers --all` output into `{name, schedulePlain, lastRun, lastResult: 'ok'|'failed'|'running', nextRun}` per timer (plain-words schedule derived from the unit's `OnCalendar=`, read via `systemctl --user show <unit> -p OnCalendar,Result,ExecMainStatus`); parse `crontab -l` lines into the same shape with `lastRun: 'not recorded'` always. A timer whose last run's `Result` was not `success` is `lastResult: 'failed'` until a later successful run (Must 25).
2. `ScheduledJob` type (in the same file or `src/types/floor.ts`): include a `launchesFleetJob: boolean` flag for the (currently zero, per 2026-10-02's grep) timers that call `sam-dispatch` — detect this by checking the unit's `ExecStart=`/cron command line for `sam-dispatch` (Must 27's detection half; T19 wires the actual linkage).
3. `GET /api/fleet/schedule`: `requireSession`, returns `readScheduledJobs()`'s result via `envelope()`.
4. Test with a stubbed `run` returning fixed fixture text (a handful of generic, invented timer/cron names — never Colin's real names): a daily timer parses to the right plain-words schedule and next run; a timer whose last `Result` is non-zero shows `lastResult: 'failed'`; a cron line shows `lastRun: 'not recorded'`; a unit whose `ExecStart` contains `sam-dispatch` sets `launchesFleetJob: true`.
Do not touch: the real `systemctl`/`crontab` state (read-only, and only through the injectable seam in tests).
Proof: `npm test` passes, including `schedule.test` (check 27, data half). `npm run typecheck`/`npm run lint` pass.

## T17: Scheduled-jobs ring
Status: DONE 2026-10-03 (ringRender.test 12/12 over six sizes incl. 8/6 px spacing, shapes, dim, SAM-label clearance, fire/settle/red/reduced motion; npm test 256/256, typecheck and lint 0; prod build at 1920x1080 matches e-ring2-1920 by eye, shots/t17-*.png; headless fps with and without ring both about 60; T16 has no interval field so frequency is read from schedulePlain; 'other' cadence drawn as a diamond; jobs with no next or last run (cron @reboot) are not placed, which check 27's tick count will need to allow for)
Spec: must-do 23, 24, 28; checks 27, 31
Depends on: T7, T16
Blocked by: none
Model: opus — the ring's spacing/numeral/dimming rules are exact pixel-fidelity requirements carried over from the mockup's own audit (`e-ring`/`e-ring2`), a visual-fidelity job, not a routine build.
Context: Port `src/e-scene.js`'s ring geometry (`ringLayout`, `drawRing`, `drawLaps`, `drawNumerals`) onto `FloorCanvas` (T7), fed by `/api/fleet/schedule` (T16) instead of `window.ESCHED`. Keep the polished ring's exact rules: outer dial one tick per daily/every-few-hours/weekly/weekday job at its next run; an inner bead track for anything hourly or faster; diamonds for weekly/weekday-only jobs; any tick whose next run is over 24 h away dimmed; numerals 00/06/12/18; at least 8 px apart at 1920, 6 px at laptop/phone sizes; nothing of the ring under the SAM label. A light runs round the ring once when a job fires; the tick stays lit while running and settles when it ends (Must 24); ring changes show within 5 s like the floor (Must 28, via T16's polling).
Files: src/components/floor/ringRender.ts (new file: pure geometry, ported from e-scene.js's ring functions), src/components/floor/ringRender.test.ts (new file), src/components/floor/FloorCanvas.tsx (edit: draw the ring from ringRender.ts, fed by /api/fleet/schedule)
Steps:
1. `ringRender.ts`: pure functions mirroring `ringLayout`/`drawRing`'s geometry (dial rect, per-job mark position/shape/dim-flag, inner bead positions, numeral positions/sizes) given a `ScheduledJob[]` and a canvas size, so spacing/placement can be asserted without a browser.
2. Wire into `FloorCanvas.tsx`: draw the dial, the 24 hour ticks, the inner bead track, per-job marks (line/diamond/bead per T16's job kind), numerals, and the travelling light on fire; respect reduced motion (ticks static: lit if running, red if failed, no travelling light).
3. `ringRender.test.ts`: for a fixture job list at each of 1920/1536/1366/1280/412/390 widths, assert every pair of marks is at least 8 px (1920) or 6 px (others) apart; a weekly/weekday job's mark shape is `diamond`; an hourly-or-faster job's mark is `bead` on the inner track; a job whose next run is over 24 h away is flagged `dim: true` and a job due today is not; no mark/numeral falls inside a given SAM-label rect fixture.
Do not touch: `FloorState`/`floorRender.ts` (T1/T7) beyond adding the ring draw call.
Proof: `npm test` passes, including `ringRender.test` (checks 27 shape half, 31). `npm run typecheck`/`npm run lint` pass. Browser check (full pass in T24): the ring's fit at 1920/1280×650/412×915 matches the polish's recorded results (check 31), and fps at 1440×900/1280×650 is within 5 of the floor without the ring (check 31).

## T18: Schedule panel
Status: DONE 2026-10-03 (SchedulePanel.test 4/4 plus one swap case each in dashboardLayout.test and phoneView.test; npm test 262/262, typecheck and lint 0; prod build with fixture data: a real click on the ring at 1920x1080 and 1280x650 and a tap at 412x915 open the panel with all 14 jobs in next-run order, Esc closes; panel shares FloorCanvas's schedule poll; on a small laptop it opens in the drawer's focus slot like a General's detail, not a seventh tab, per the mockup README; reducers in dashboardLayout.ts/phoneView.ts extended)
Spec: must-do 26; check 28
Depends on: T17, T11
Blocked by: none
Model: sonnet
Context: Clicking/tapping the ring opens the Schedule panel: each job's name, plain-words schedule, last run, last result, next run, sorted by next run. It opens where a General's detail opens — the drawer's Schedule tab on a small laptop, the bottom sheet on the phone, the side panel at 1920. Esc or Back closes it, and opening a General swaps away from it (reuse T11's single-open-panel state, same as the mockup's `E.setFocus`/schedule interplay).
Files: src/components/dashboard/fleet/SchedulePanel.tsx (new file), src/components/dashboard/fleet/FleetDashboardShell.tsx (edit: wire the ring's click target to open SchedulePanel, sharing the same "one open panel" state as GeneralDetailPanel), src/components/dashboard/fleet/FleetPhoneView.tsx (edit: same wiring for the ring tap and the bottom sheet)
Steps:
1. `SchedulePanel.tsx`: list from `/api/fleet/schedule` (T16), sorted by next run, each row showing name/plain schedule/last run+result (ok/failed/running badge, or "not recorded")/next run.
2. A transparent click/tap target over the ring (keyboard-reachable, Tab + Enter) opens it; opening a General's detail while the Schedule panel is open closes the Schedule panel first (and vice versa), so the two never stack — reuse whatever single-panel state T11 introduced.
3. Esc or Back closes it and returns to the full floor.
Do not touch: T16's data shape, T17's ring drawing beyond adding the click target.
Proof: `npm run typecheck`/`npm run lint`/`npm test` pass. Browser check (full pass in T24): a real click on the ring at 1920×1080 and 1280×650, and a tap at 412×915, opens the Schedule panel listing every job in next-run order; Esc and Back close it (check 28).

## T19: A scheduled job's dispatch shows as the ring's trigger, not a double job
Status: DONE 2026-10-03 (scheduleTrigger.test 1/1: a throwaway samui-t19-test-<hex> timer ran sam-dispatch.next -> sam-job.next, which ran only `true` via a stub run script, with temp store/log, --notify stripped, stub push; one job, origin 'schedule', the only worker on the floor (under Cerberus), then one slab; readScheduledJobs marks the timer launchesFleetJob; buildRing gives the timer's marks only plus one trigger light into SAM, none when reduced or not launching; npm test 263/263, typecheck and lint 0; list-timers --all 53 before and 53 after, no tagged units left; live dispatch log and job store hold no samui-t19 entries; box-only skip if the tools are absent, loud fail if systemd-run --user is)
Spec: must-do 16e (origin half), 27; check 29
Depends on: T17, T3
Blocked by: none
Model: opus — this is the one piece of real concurrency in the build: a live timer firing `sam-dispatch`, inside the ring's compressed-time drawing and the floor's job list, both of which must agree on exactly one job existing once — a routine component wire-up would miss the double-draw risk the mockup's own audit calls out.
Context: Must 27: "A scheduled job that launches a fleet job shows on the ring as the trigger only; the fleet job appears on the floor like any other, marked as coming from the schedule." The ring must never draw a worker for it, and the floor must never draw a second "scheduled job" entity — there's exactly one real job, tagged `origin: 'schedule'` by T3's `SAM_ORIGIN=schedule` env var. The proof needs a real timer firing `sam-dispatch` end to end, but it must be a throwaway test timer, never a real one of Colin's 48.
Files: src/lib/server/fleet/floorState.ts (edit: surface origin: 'schedule' jobs distinctly, already typed in T1 — confirm the ring-trigger linkage reads it), src/components/floor/ringRender.ts (edit: a firing tick whose job's `launchesFleetJob` is true draws the trigger pulse rising into SAM, no separate worker spawn on the ring itself), src/lib/server/fleet/scheduleTrigger.test.ts (new file)
Steps:
1. In `ringRender.ts`, when a job with `launchesFleetJob: true` fires, draw the trigger light rising from that tick into SAM's node (per the mockup's "Schedule · <name> fired" treatment) instead of (or in addition to) the normal tick-fires-and-settles animation, and never spawn a worker figure on the ring for it (the floor's own station/worker drawing, fed by `FloorState`, already shows the real job under its General — don't duplicate it here).
2. Test (`scheduleTrigger.test.ts`): create a temporary systemd user timer + oneshot service in a temp unit directory (`systemd-run --user --on-active=1 ... sam-dispatch.next ... ` with `SAM_ORIGIN=schedule` set in the unit's env, `SAM_JOB_STORE` pointed at a temp dir), wait for it to fire (poll the temp job store, timeout a reasonable number of seconds), then: assert the resulting job's `meta.json` has `origin: 'schedule'`; assert `readFloorState()` (T1) places it under its General with `origin: 'schedule'`; assert `readScheduledJobs()` (T16, stubbed to see the temp unit) marks that unit `launchesFleetJob: true`. Clean up the temp timer/service unconditionally (even on test failure) with `systemctl --user stop`/`disable`/unit-file removal in the test's teardown.
3. If `systemd-run --user` is unavailable in the test environment, the test must fail loudly, not skip (same rule as multi-chat T5).
Safety (SAM, 2026-10-02): the test timer's `sam-dispatch.next` call must reach `sam-job.next` with `SAM_JOB_RUN_SH` pointed at a stub that runs `true`, `SAM_DISPATCH_LOG` at a temp file and no `--notify`, so the end-to-end proof never starts a real Claude run, sends a push or touches the live dispatch log.
Do not touch: any of Colin's real 48 timers or the 53 cron entries, `FloorState`'s shape beyond what's already typed in T1.
Proof: `npm test` passes, including `scheduleTrigger.test` (check 29), and the test's teardown leaves no stray systemd user unit behind (`systemctl --user list-timers` before and after the test run shows the same count).

## T20: Demo mode — fixtures and the loop
Status: DONE 2026-10-03 (demoFixtures.test 7/7: three jobs cycle hephaestus→cerberus→hermes over a 90s loop, queued→running (stages lighting in order)→done with one tower slab, dispatch flare fires only in a ~3s window at dispatch, background jobs never invent stages; demoScheduleAt covers bead/line/diamond plus a cron "not recorded" and a failed timer; npm test 270/270, typecheck and lint 0; DemoModeToggle wired into FleetDashboardShell/FleetPhoneView's tiles row as a local override of the demo prop, doubling as the persistent "Demo" marker)
Spec: must-do 18, 20; check 12
Depends on: T1, T16
Blocked by: none
Model: sonnet
Context: Demo mode replays the mockup's three-job loop (Open House/Hephaestus, CVE audit/Cerberus, Bait the Hook/Hermes) and a made-up 14-job schedule, with no live data (Must 18) and a visible "Demo" marker (Must 20). All of this is original invented data (not copied from any real client) — follow the shape of the mockup's own `SCENARIOS`/`JOBS` (`src/engine.js`, `src/e-scene.js`) without reusing any of Colin's real timer or client names.
Files: src/lib/server/fleet/demoFixtures.ts (new file: FloorState-shaped and ScheduledJob-shaped demo data, matching T1/T16's types exactly, with a `demoFloorStateAt(t)`/`demoScheduleAt(t)` pair analogous to the mockup's `stateAt`), src/app/api/fleet/floor/route.ts (edit: `?demo=1` returns demoFloorStateAt instead of readFloorState), src/app/api/fleet/schedule/route.ts (edit: `?demo=1` returns demoScheduleAt), src/components/dashboard/fleet/DemoModeToggle.tsx (new file), src/lib/server/fleet/demoFixtures.test.ts (new file)
Steps:
1. `demoFixtures.ts`: three demo jobs with the same shape as the mockup's (a build pipeline on Hephaestus, a two-worker task on Cerberus, a two-worker task on Hermes), looping on a timer the same way `src/engine.js`'s `currentT`/`cycleStart` does; a demo schedule of generic invented jobs (keep-warm ping, vault commit, quota log, etc. — names of this shape, not Colin's real ones) with the same every-15-min/hourly/daily/weekly/weekday mix the mockup's ring needs to exercise every mark shape.
2. Wire `?demo=1` into both routes (session-gated as before); add a demo switch somewhere visible in `FleetDashboardShell`/`FleetPhoneView` (T11/T13) that toggles a client-side flag appending `?demo=1` to the polls, and show a persistent "Demo" marker on screen while it's on (Must 20).
3. `demoFixtures.test.ts`: `demoFloorStateAt(t)` cycles through the three jobs over its loop period the same way the live-data reader's shape is consumed by T7/T9/T10 (reuse their types); `demoScheduleAt(t)` produces at least one job of each ring-mark shape (bead, line, diamond).
Do not touch: `readFloorState`/`readScheduledJobs` themselves (demo mode is a separate branch, not a flag inside the live reader).
Proof: `npm test` passes, including `demoFixtures.test`. `npm run typecheck`/`npm run lint` pass. Browser check (full pass in T24): demo mode plays the three demo jobs on a loop with a visible "Demo" marker (check 12).

## T20b: Demo mode must not leak live costs or job names (SAM, 2026-10-03, serves Must 19/check 13)
Status: DONE 2026-10-03 (spend/route.test.ts and jobs/route.test.ts: 2/4 failing against the unfixed routes — `demo=1` was silently ignored on both, live scannedJobs/persona counts and the live job's command text came straight back; 4/4 after the fix; both routes now branch to demoFleetSpend/demoFleetPersonaJobs on `demo=1` and never touch the live job store, registry or claudeCosts on that path; npm test 274/274, typecheck and lint 0)
Spec: must-do 19; check 13
Depends on: T20
Files: src/app/api/fleet/spend/route.ts (edit), src/app/api/fleet/spend/route.test.ts (new file), src/app/api/fleet/jobs/route.ts (edit), src/app/api/fleet/jobs/route.test.ts (new file), src/lib/server/fleet/demoFixtures.ts (edit: demoFleetSpend/demoFleetPersonaJobs, added under T20)
Proof: the before-run against the unmodified routes fails on the two demo-mode assertions (live scannedJobs/persona-job-count and the live command text both come back); `npm test` passes after the fix, including both new route test files.

## T21: Demo-mode leak scan (failing test first)
Status: DONE 2026-10-03 (demoScan.test 3/3: scanForLeaks catches a fixture vault's fake client name and a home path and clears a clean string; the live-mode control run — the real floor/schedule/spend/jobs×5 routes against a seeded live job whose command carries "Example Co" and a fake /home/ path — scores ≥1 hit; the same four routes with demo=1 score 0 (T20b's fixtures route never surface the live job's command text at all, since FloorState/FleetSpend carry no raw command and the jobs route returns demoFleetPersonaJobs); npm test 277/277, typecheck and lint 0; SidebarWidgets' existing demo-mode `return null` already satisfies check 23, no route for it to scan)
Spec: must-do 19; checks 13, 23, 30
Depends on: T20, T15, T17
Blocked by: none
Model: sonnet
Context: Must 19/check 13: an automated scan of the demo-mode page text and demo data for every client name in the vault's `02 - Atwood Systems/10_Clients/` folder and for any path under the home folder — 0 hits in demo mode, at least one hit when the same scan runs against the live view (proving the check can actually fail). Check 23 extends the scan to System Health/Daily Tasks/Money In (T15); check 30 extends it to the ring/Schedule panel (T17/T18). This ticket must write the scan and show it fails (finds 0 live-mode hits, i.e. the "proves it can fail" condition is unmet) against whatever's live before rechecking, per the task's rule that proof-style checks like this get a failing-test-first ticket.
Files: src/lib/server/fleet/demoScan.ts (new file), src/lib/server/fleet/demoScan.test.ts (new file)
Steps:
1. `demoScan.ts`: `buildLeakPatterns(): RegExp[]` reads every folder/file name directly under `<SAM_VAULT_DIR ?? ~/ai-memory-vault>/02 - Atwood Systems/10_Clients/` (a seam `SAM_VAULT_DIR` like the multi-chat handoff ticket used) and any string matching a home-folder path shape (`/home/<user>/...` or `~/...`), and builds matchers from them. `scanForLeaks(text: string): string[]` returns which patterns matched.
2. `demoScan.test.ts`: with `SAM_VAULT_DIR` pointed at a temp vault containing a fake `10_Clients/Example Co` folder, assert `scanForLeaks` on a string containing "Example Co" or a `/home/...` path returns a hit, and on a clean string returns none. Then assert that running the scan over the full rendered text of the new Dashboard's live mode (T9/T10/T15/T17/T18's module output, using a live-mode fixture that deliberately includes a fake client name and a home path, standing in for the real live view) finds at least one hit — proving the scan isn't a no-op — before asserting it finds zero hits over the equivalent demo-mode output (T20's fixtures, T15's demo-data branch, T17/T18's demo schedule).
3. Record, in the ticket result, the run that shows the scan finding ≥1 hit against the live-mode fixture (the "proves it can fail" requirement) before the final all-demo run shows 0.
Do not touch: the real vault contents beyond reading folder names under `10_Clients/` (never read file contents, never print a real client name in test output or in this repo — use a temp fixture vault for the test itself, as in step 2).
Proof: `npm test` passes, including `demoScan.test`, and its own output/ticket result records the live-fixture run finding ≥1 hit and the demo run finding 0 (checks 13, 23, 30).

## T22: Swap `/` for the fleet view; move the old Dashboard to `/classic`
Status: DONE 2026-10-03 (`/classic` created with `page.tsx`'s exact pre-ticket content; `/` now renders `FleetView`; Sidebar.tsx/TabBar.tsx's one `dashboard` nav entry already points at `/`, neither ever linked `/classic` — confirmed by grep, no edit needed; the three untracked preview-floor/preview-shell/preview-view pages deleted; typecheck, lint, npm test 277/277 and `next build` all exit 0 — build output lists both `/` and `/classic` as static routes, no preview-* routes)
Spec: must-do 22; check 25
Depends on: T11, T12, T13, T14, T15, T17, T18, T19, T20, T21
Blocked by: none
Model: sonnet
Context: This is the integration ticket: everything above exists and is tested in isolation; this ticket is the only one that touches routing. The old Dashboard (`DashboardShell`, its four widgets via `StatCardGrid`/`widgetRegistry`) is untouched code, just relocated to `/classic`, and removed from the nav (Must 22). `src/app/(app)/page.tsx` today is a five-line wrapper (`<DashboardShell />`) — trivial to relocate.
Files: src/app/(app)/page.tsx (edit: render the new fleet view — `FleetDashboardShell`/`FleetPhoneView` per T13's breakpoint check — instead of `DashboardShell`), src/app/(app)/classic/page.tsx (new file: renders `<DashboardShell />`, i.e. exactly what `page.tsx` rendered before this ticket), src/components/shell/Sidebar.tsx (edit: remove or don't add any `/classic` nav entry — confirm none exists after the change), src/components/shell/TabBar.tsx (edit: same check)
Steps:
1. Create `src/app/(app)/classic/page.tsx` with the exact content `src/app/(app)/page.tsx` had before this ticket (`<DashboardShell />`).
2. Replace `src/app/(app)/page.tsx`'s content with the new fleet view entry point (T13's `FleetView`, which chooses between `FleetDashboardShell` and `FleetPhoneView`).
3. Grep `Sidebar.tsx`/`TabBar.tsx` for any `/classic` or "Dashboard" nav entry that would need removing or redirecting; confirm neither links to `/classic` (it's reachable only by typing the URL, per spec).
Do not touch: `DashboardShell.tsx`, `StatCardGrid.tsx`, `widgetRegistry.tsx`, the four original widgets — none of their code changes, only where they're mounted.
Proof: `npm run typecheck`/`npm run lint`/`npm test` pass. Browser check (full pass in T24): after deploy, `/classic` loads the old Dashboard with its four widgets and no console errors, and no nav item links to it (check 25).

## T23: Install the live dispatch tools (needs Colin's double-confirm)
Status: TODO
Spec: must-do 16–16e
Depends on: T2, T3, T4
Blocked by: Colin's double-confirm (spec section 4: changing `sam-dispatch`/`sam-job` is a change to live tools and needs it; this is separate from the general deploy go in T24)
Model: sonnet (run by SAM with Colin)
Context: `sam-dispatch`/`sam-job` are live the instant their `.next` copies replace them — every future dispatch, including anything queued or scheduled overnight, is affected immediately. T2–T4's tests already prove the `.next` copies work and that `~/.sam/tests/test-dispatch-routing.sh` still passes against them. The research confirms no live caller script needs its own brief updated first (none calls `sam-dispatch` in production today besides the test harness) — but double-check that's still true right before installing, since time has passed.
Files: /home/col/.local/bin/sam-dispatch, /home/col/.local/bin/sam-job, /home/col/.local/bin/sam-stage (new, installed from sam-stage.next), /home/col/.sam/sam-job/run.sh (each live file replaced by its `.next` copy after a dated `.bak-YYYYMMDD` backup), today's daily note
Steps:
1. Re-run the grep from "Read before any ticket" (`grep -rl sam-dispatch ~/.sam ~/bin ~/.claude/skills`) to confirm no new live caller appeared since this ticket set was written; if one has, update its brief with `General:`/`Stages:` lines before continuing.
2. Get Colin's double-confirm (ask once, then confirm again before actually moving files — this is the "needs Colin's double-confirm" the spec requires, distinct from T24's general deploy go).
3. Back up each live file (`cp sam-dispatch sam-dispatch.bak-$(date +%Y%m%d)`, etc.), then move each `.next` copy over its live file (install `sam-stage.next` as the new `sam-stage`, chmod +x).
4. Re-run `~/.sam/tests/test-dispatch-routing.sh` and `~/.sam/delegation-check.sh` (dry) against the now-live files to confirm they still pass.
4b. Update the dispatch convention so SAM's own briefs carry the new lines from the moment the tools go live: add `General:` and `Stages:` to the brief format in `~/ai-memory-vault/02 - Atwood Systems/20_Agents/Delegation_Charter.md` and to the usage header of `sam-dispatch` itself (SAM writes most briefs by hand, so the refusal is the enforcement; this step is the documentation).
5. Write daily-note lines for each file: `<file> installed (visual-upgrade T23): <one-line summary>. Enforced by: SAM_ui npm test <the relevant .test.ts path(s)>`.
Do not touch: anything not listed here; the model/seat routing behaviour (confirm unchanged by diffing the relevant blocks before/after, same as T2/T3's steps did on the `.next` copies).
Proof: `~/.sam/tests/test-dispatch-routing.sh` and `~/.sam/delegation-check.sh` pass against the live files after install; the four daily-note lines are written; `ls -l` shows no `.next` files left beside the live ones (renamed/removed after install), and the `.bak-YYYYMMDD` backups exist.

## T24: Full gates, browser checks, Colin's go
Status: TODO
Spec: checks 1–32 (final confirmation of all)
Depends on: T22, T23
Blocked by: Colin's go to merge and deploy (and T23's install, since the staged tools go live in the same build)
Model: sonnet (run by SAM with Colin)
Context: This is where every "full pass in T24" promissory note above gets actually run. The new Dashboard is now the home page the moment this deploys — check 21 says the phone pass (on Colin's A16) must happen before the new Dashboard goes live, so do the device checks before `./deploy.sh`, not after, wherever the spec's ordering allows it (checks 1–20, 22–31 can run against a worktree build on another port; checks 17, 21, 26's on-device parts need the real deploy or a close equivalent — use judgement and flag anything that can only be confirmed post-deploy).
Files: none changed (fix-ups go back to the ticket that owns the file)
Steps:
1. In the `build/visual-upgrade` worktree: `npx npm@10 install`, `npm run typecheck`, `npm run lint`, `npm test` (confirm every new test file from T1–T21 appears in the output), `next build`. All four must exit 0 (check 16).
2. Browser pass (Playwright, borrowed read-only from `/home/col/Atwood_demos/kitchen-v3-wt/node_modules/playwright`, same as the mockup's own audit) against a production build on another port, never `next dev` while `sam-ui.service` is up:
   - Screenshots at 1920×1080, 1536×730, 1366×680, 1280×650 compared against the mockup E shots (check 1); fit checks at those sizes plus 412×915/390×844 (checks 2, 18); bust checks (check 3); click-General/Esc (check 4); reduced motion forced, 0 console errors (check 5); a real 3-stage test job dispatched through the staged `sam-dispatch`/`sam-job`/`sam-stage` appears and lights within 5 s, other Generals idle (check 6); Zeus flares once (check 7); exit-0 adds a slab, non-zero shows red/no slab (check 8); job detail fields and cost agreement (check 9); checks 6/7/13 also at 412×915 (check 20); a tap opens the sheet and closes (check 19); 0 console errors/failed requests, no purple/violet pixels in ten states (check 14); fps within 5 of the mockup at two sizes (check 15); theme Plasma/Ember purple-check + emerald-unchanged, another page does change (check 24); `/classic` loads with no console errors and no nav link (check 25); timer fixture tick-count/5s-light/red-to-green/not-recorded (check 27); a real ring click/tap opens the Schedule panel in next-run order, Esc/Back close (check 28); scheduled-trigger job shows origin schedule with no ring worker (check 29); demo-mode scan hits 0, live finds ≥1 (check 13, built in T21); ring polish results (check 31); top bar at three sizes (check 32).
   - `/api/health` is ok; every existing page still loads (check 16).
3. On Colin's go, deploy: warn him first (every deploy kills his in-flight chat turn), `./deploy.sh`.
4. On-device confirmations (check 17, 21, 26): Colin watches a real dispatch on his laptop and confirms it reads right (check 17); opens the view in the SAM app on the A16, watches a real dispatch, confirms it runs smoothly and reads right, done *before* this is the live home page if at all possible given it already will be post-deploy — note any ordering gap honestly in the result (check 21); the chat widget's most-recent-chat/picker/"Hey Sam" behaviour on the A16 (check 26).
Do not touch: anything not on this list without a fresh go from Colin.
Proof: every check above passes and is recorded in the ticket result; Colin confirms checks 17, 21 and 26 by name.

---

## Order

T1 → T2 → T3 → T4 → T5 → T6 → T16 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T17 → T18 → T19 → T20 → T21 → T22 → T23 → T24.
T2, T3, T4, T6 and T16 depend on nothing earlier and can move anywhere before the tickets that need them. Every ticket leaves the app building and working; the live `/` route and the live system tools don't change until T22/T23.

## Coverage

| Spec check | Must-do | Ticket(s) whose Proof covers it |
|---|---|---|
| 1 | 1, 2 | T24 (browser); built in T7, T8, T11 |
| 2 | 1, 5 | T24 (browser); built in T7, T11 |
| 3 | 2 | T24 (browser); built in T8 |
| 4 | 4 | T24 (browser); built in T11 |
| 5 | 6 | T7, T8 (proof note); full in T24 |
| 6 | 7, 8, 10, 13 | T1, T5, T7 (built); T24 (browser confirmation) |
| 7 | 9 | T8; T24 (browser confirmation) |
| 8 | 11, 12 | T1 (built); T24 (browser confirmation) |
| 9 | 14, 15 | T9, T10 (cost-agreement proofs) |
| 10 | 16–16d | T2, T3, T4 |
| 11 | 17 | T1 |
| 12 | 18, 20 | T20 |
| 13 | 19 | T21 (failing test first) |
| 14 | 1–20 | T24 |
| 15 | 1 | T24 |
| 16 | 21 | T24 |
| 17 | 1, 3, 9, 10 | T24 (Colin) |
| 18 | 6a, 6c | T13 |
| 19 | 6b | T13 |
| 20 | 6d | T13 |
| 21 | 6a–6d | T24 (Colin, A16) |
| 22 | 3b | T15 |
| 23 | 19, 3b | T21 |
| 24 | 3d | T12 |
| 25 | 22 | T22 |
| 26 | 3a, 3e | T14; T24 (Colin, A16) |
| 27 | 23, 24, 25, 28 | T16, T17 |
| 28 | 26 | T18 |
| 29 | 27, 16e | T19 |
| 30 | 19 | T21 |
| 31 | 23 | T17 |
| 32 | 3c | T11 (built, phone half in T13); T24 (browser) |

## Blocked

- T23 is blocked on Colin's double-confirm to install the live `sam-dispatch`/`sam-job`/`sam-stage` changes (spec section 4: changing live dispatch tools needs it, separately from the general deploy go).
- T24 is blocked on T23 and on Colin's go to merge and deploy; checks 17, 21 and 26 additionally need Colin's own confirmation by name, not just an automated pass.
- No spec question is open (all were answered 2026-10-01/02, see spec section 6); nothing else is blocked.
