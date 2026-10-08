# Job ticket panel: tickets

Spec: `/home/col/SAM_ui/implementation/job-ticket-panel-spec.md` (LOCKED 2026-10-08, Colin "lock it", 23:55). Read it in full before any ticket.
Tickets written 2026-10-08 from the locked spec and a read of the code named in each ticket.
Consumer: SAM, running `/implement` on Colin's go.

## Read this first (every ticket)

Where things live:
- Live tree `/home/col/SAM_ui` (branch `claude/sam-core-dashboard-sf3639`): read-only for the build. The only file the build edits there is THIS tickets file (Status lines, and the Pruner line in T1).
- Build worktree `/home/col/SAM_ui-job-ticket-panel`, branch `build/job-ticket-panel` (created in T1). All SAM_ui code goes here, by absolute path. No merge, no deploy, no restart of `sam-ui.service`. `npm test` and `npx tsc --noEmit` run inside the worktree.
- Live system files are NEVER edited in place. `/home/col/.local/bin/sam-dispatch`, `/home/col/.local/bin/sam-job`, every module in `/home/col/.sam/closer/`, `/home/col/.claude/skills/implement/SKILL.md` and the implement brief template are changed as `<file>.next` beside the live file. Tests take a seam so they run against the `.next` copy (patterns: `SAM_DISPATCH_BIN` in `~/.sam/tests/test-dispatch-proof-guard.sh`, the overlay in `~/.sam/tests/closer-overlay.sh`, `SAM_CLOSER_PY`).
- Already staged by other work and NOT part of this build: `closer.py.next` and `closer_vault.py.next` differ from live (they add `closer_questions`, which also has a `closer_questions.py.next`). Build on top of those `.next` files, never from live, and never revert the staged lines. If a `.next` you need is missing, copy the live file to `.next` first (`cp -p`).
- New shell tests live in `/home/col/.sam/tests/`. New files only; existing tests are edited only where a ticket says so, with a `.bak-20261009-jtp` copy first.

Shared definitions (every ticket uses these exactly; they keep TypeScript, Python and shell in step):
- Ticket heading: a line matching `^## T(\d+)\b[:.]?\s*(.*)$`. Ticket number is group 1, title is group 2.
- Status line: the first line after a ticket heading, before the next `^## ` heading, matching `^Status:\s*(.*)$`. "Readable" means the text after `Status:` is not empty after trimming.
- Status split: try these known statuses, longest first, case-insensitive prefix: `IN PROGRESS`, `PARTLY DONE`, `SUPERSEDED`, `SKIPPED`, `BLOCKED`, `DONE`, `TODO`, `GATE`. If one matches, the status label is the matched words as written and the rest is the note. If none matches, the label is the first whitespace-delimited word as written and the rest is the note. A label is never dropped, mapped or guessed. For `IN PROGRESS`, the first word of the note is the claiming job id.
- "Done" for the count is label `DONE` only (not `PARTLY DONE`). Total is every ticket. Heading text: `N of M tickets done`.
- Ticket job (M1): `brief.md` in the job folder, else `meta.closerCtx.brief`, mentions a path matching `implementation/[A-Za-z0-9._-]+-tickets\.md`; resolved against `meta.closerCtx.cwd`; the first mentioned path whose file exists wins.
- Build log name: `<builds dir>/<stem>-<h8>.jsonl`. `<builds dir>` is `~/.sam/builds` (shell and Python seam: env `SAM_BUILDS_DIR`; TypeScript reads `os.homedir()` at call time so tests set HOME). `<stem>` is the tickets file's basename without `.md`. `<h8>` is the first 8 hex digits of the sha1 of the tickets file's `realpath` string with no trailing newline. One JSON object per line:
  `{"kind":"dispatch","jobId":"...","at":"<ISO UTC>","seat":"...","tier":"...","brief":"<abs path>","tickets":"<abs path>"}` and `{"kind":"end","jobId":"...","at":"<ISO UTC>","verdict":"<closer verdict string>"}`.
- Tail read: `TAIL_BYTES = 262144`. Never read more of `claude-stream.jsonl` than this from the end of the file, drop the first partial line.
- Panel refresh: the panel's own fetch never runs faster than every 3000 ms (the floor poll's period), and stops once the job is not running.
- New guard exit code: 8, not 7. Spec M13 and check 10 say 7, but `sam-dispatch` took exit 7 at 23:56 on 2026-10-08 for its General guard (`General: sam` with a build task type). Every ticket below that says "the tickets guard" means exit 8. The spec text needs a one-word correction when Colin next opens it; no ticket edits the spec.
- Stuck workers end with exactly one last line: `BLOCKED: <reason>; unblock: <what>`.

## T1: Find the job-folder pruner, record it, make the worktree
Status: TODO
Spec: must-do #16, check #13
Depends on: none
Blocked by: none
Context: M16 needs to prove job-folder pruning leaves `~/.sam/builds/` alone, so we must know what prunes `~/.sam/jobs`. It is not `sam-job` or `sam-dispatch`. Read-through found the likely answer: SAM_ui's own `JobManager.sweepDisk()` in `src/lib/server/jobs/manager.ts` (boot plus hourly, `RETENTION_MS` 7 days, `MAX_JOBS` 128, only directories named `job_*` directly under `~/.sam/jobs`, removed with `fsp.rm`). `sam-quota-log.py` says "the job store prunes after 7 days". Confirm; do not assume.
Files: /home/col/SAM_ui/implementation/job-ticket-panel-tickets.md (edit: the Pruner line below only); worktree /home/col/SAM_ui-job-ticket-panel (new, via git)
Steps:
1. Search for anything that deletes under `~/.sam/jobs`: user timers (`systemctl --user list-timers --all`, the matching `.service` ExecStart files in `~/.config/systemd/user`), `crontab -l`, `~/.sam/*.sh` and `~/.sam/*.py` (including `sam-janitor.py`, which sweeps `/tmp` only, and `jobs-watch.sh`), `~/bin`, `~/.local/bin`, `~/.config/logrotate/sam.conf`, and the Job Closer (`~/.sam/closer/*.py`, `*.sh`). Read-only: run nothing that deletes.
2. Read `sweepDisk()` and `prune()` in `manager.ts` and state in one line what each deletes and what it never deletes.
3. Add one line to the end of this ticket, replacing the placeholder: `Pruner: <absolute path of the file and function>; deletes <what>; schedule <when>; other candidates ruled out: <list>.` T9 reads this line.
4. Create the worktree: `git -C /home/col/SAM_ui worktree add -b build/job-ticket-panel /home/col/SAM_ui-job-ticket-panel 72c32d2`. Then `ln -s /home/col/SAM_ui/node_modules /home/col/SAM_ui-job-ticket-panel/node_modules` (if `npx tsc --noEmit` rejects the symlink, run `npm ci` in the worktree instead and say so).
5. In the worktree run `git status --short` (must be clean apart from the symlink, which `.gitignore` should cover) and `git log -1 --format=%h`.
Do not touch: anything under `~/.sam/jobs`, any timer or unit, `sam-ui.service`, the live tree's code, the live branch.
Proof: `grep -c '^Pruner: /home/col/SAM_ui' /home/col/SAM_ui/implementation/job-ticket-panel-tickets.md` prints 1 (it prints 0 before this ticket); `git -C /home/col/SAM_ui worktree list | grep -c 'job-ticket-panel .*build/job-ticket-panel'` prints 1 (0 before); `cd /home/col/SAM_ui-job-ticket-panel && git rev-parse --abbrev-ref HEAD` prints `build/job-ticket-panel`.
Pruner: (T1 fills this line in)

## T2: Tickets-file parser (TypeScript)
Status: TODO
Spec: must-do #2, #3, #5, check #1, #2
Depends on: T1
Blocked by: none
Context: Everything in the panel reads the tickets file through one parser. It must return tickets in file order with number, title, status label and note exactly as written (shared definitions above), plus the `Files:` line text (T18's Python repeats the same grammar). Pure functions, no I/O in the parser itself; one thin reader that reads a path. New code; nothing in the repo parses tickets files today.
Files: /home/col/SAM_ui-job-ticket-panel/src/lib/server/fleet/ticketsFile.ts (new), ticketsFile.test.ts (new, same folder), fixtures/kitchen-v3-phone-flow-tickets.md (new, a copy), fixtures/status-words-tickets.md (new)
Steps:
1. Copy `/home/col/Atwood_demos/kitchen-v3-wt/implementation/kitchen-v3-phone-flow-tickets.md` to the first fixture with `cp`. Never edit the original. Count its tickets and its `DONE` ticket lines yourself and use those numbers in the test (24 tickets at the time of writing; the DONE count moves while that build runs, so assert against the copy, not a constant from the spec).
2. Write `status-words-tickets.md`: one ticket per status word DONE, TODO, GATE, IN PROGRESS job_x_20261008-000000, BLOCKED, SKIPPED, SUPERSEDED, PARTLY DONE, plus one made-up word (`WOBBLY`), each with a note on some lines, and one ticket with NO Status line.
3. Export `parseTickets(text): { tickets: Ticket[] }`, `ticketProgress(tickets): { done: number; total: number }` and `readTicketsFile(path): Promise<Ticket[] | null>` (null when the file is missing). `Ticket` = `{ n: number; title: string; label: string; note: string; claimJobId: string | null; files: string | null }`. A ticket with no readable Status line gets label `no status` (it exists so the panel can show it; it is not guessed as TODO).
4. Tests: the kitchen copy gives 24 tickets in order with the right labels and `ticketProgress` equal to a count made by grepping the copy; the status-words fixture shows every word as written including `WOBBLY`; IN PROGRESS gives `claimJobId`; the no-status ticket gives `no status`.
Do not touch: `floorState.ts`, any component, the original kitchen tickets file.
Proof: `cd /home/col/SAM_ui-job-ticket-panel && node scripts/run-tests.cjs src/lib/server/fleet/ticketsFile.test.ts` (or the form `npm test` accepts for one file; read `scripts/run-tests.cjs`) shows 0 failures and at least 4 passing tests; before the ticket the test file does not exist, so the command fails. Also `npx tsc --noEmit` exits 0.

## T3: Ticket-job resolver (TypeScript)
Status: TODO
Spec: must-do #1, #9, #10, check #7
Depends on: T2
Blocked by: none
Context: Decides, from a job folder, whether the job is a ticket job and where its tickets file is. Reads `brief.md` first, else `meta.json` `closerCtx.brief` (a path to the original brief), and resolves the tickets path against `meta.closerCtx.cwd`. Three outcomes: `none` (no tickets file mentioned, or a ticket-writing brief whose file is not there yet and was never there), `ok` with the path, `missing` (a tickets path was mentioned and the file does not exist now, M10). To tell "never existed" from "removed" the resolver cannot know; define it as: a brief that mentions a tickets path whose file is absent is `missing` only when the job's meta shows it is a build (closerCtx `task` is `build`); otherwise `none`. Real fixture: `/home/col/.sam/jobs/job_kitchen-r4-implement-t20_20261008-205319/` (`brief.md` mentions `implementation/kitchen-v3-phone-flow-tickets.md`; `closerCtx.cwd` is `/home/col/Atwood_demos/kitchen-v3-wt`). Do not read that folder from the test; build a temp folder shaped like it.
Files: /home/col/SAM_ui-job-ticket-panel/src/lib/server/fleet/ticketJob.ts (new), ticketJob.test.ts (new)
Steps:
1. Export `resolveTicketJob(jobDir: string): Promise<{ kind: 'none' } | { kind: 'ok'; ticketsPath: string } | { kind: 'missing'; ticketsPath: string }>`.
2. Use the shared regex. Prefer `brief.md`; fall back to `closerCtx.brief` only if `brief.md` is absent; a job with neither is `none`.
3. Tests with temp dirs (use `tempDir` from `@/lib/server/testing/tempDir` and clean up): a temp job whose brief names an existing tickets file in the temp cwd gives `ok`; no tickets mention gives `none`; mention of a file that does not exist with `task: build` gives `missing`; the same with `task: tickets` gives `none`; `brief.md` absent but `closerCtx.brief` present still resolves.
Do not touch: the real `~/.sam/jobs` folders, `floorState.ts`.
Proof: `node scripts/run-tests.cjs src/lib/server/fleet/ticketJob.test.ts` (same invocation form as T2) shows 0 failures and at least 5 passing tests; the file does not exist before, so it fails then. `npx tsc --noEmit` exits 0.

## T4: Live ticket count on every worker
Status: TODO
Spec: must-do #5, #15, check #1, #12
Depends on: T2, T3
Blocked by: none
Context: `FloorWorker` (src/types/floor.ts) is what the floor canvas, the active-jobs list, the phone view and the detail panel all read, and `readFloorState` builds it every 3 s from `meta.json` and `events.jsonl`. Add one optional field `tickets?: { done: number; total: number } | null`, set only for ticket jobs whose tickets file exists, read from the file at that moment. Memory is a live concern (SAM_ui memory-growth item): cache the parsed result per tickets path keyed on the file's mtime and size, hold at most 16 entries, and read ticket files only for workers whose status is not `done` or `failed` (an ended job keeps `null`; the panel route in T10 reads the file itself). Add no faster polling. The launch summary stays in `summary` untouched (M5: it is the job's name only).
Files: /home/col/SAM_ui-job-ticket-panel/src/types/floor.ts (edit), src/lib/server/fleet/floorState.ts (edit), src/lib/server/fleet/floorState.test.ts (edit)
Steps:
1. Add the field to `FloorWorker` with a doc comment in the same style as `lastAction` (optional, always set explicitly by `floorState.ts`).
2. In `readJob`, after the status is known, call `resolveTicketJob(dir)`; for `ok` and a live status, read via a small mtime cache and set `tickets = ticketProgress(...)`, else `null`.
3. Test in `floorState.test.ts` using its scratch-HOME pattern: a running job with `meta.summary` "Kitchen R4 build (resume, 19 of 24 done)" whose brief names a copy of the T2 kitchen fixture shows `tickets.done` equal to the copy's DONE count and `summary` still the launch text; a job with no tickets file shows `tickets === null`; editing the fixture on disk between two reads changes the count (cache invalidates).
4. Run the whole existing `floorState.test.ts` and fix nothing outside this change.
Do not touch: `floorRender.ts`, any component, other fields of `FloorWorker`, the poll interval in `FloorCanvas.tsx`.
Proof: `node scripts/run-tests.cjs src/lib/server/fleet/floorState.test.ts` shows 0 failures and the three new tests passing (they fail before: the field does not exist); `npx tsc --noEmit` exits 0; `grep -n "pollMs = 3000" src/components/floor/FloorCanvas.tsx` still matches.

## T5: Floor canvas label shows live ticket progress
Status: TODO
Spec: must-do #15, check #12
Depends on: T4
Blocked by: none
Context: `workerLines(w)` in `src/components/floor/floorRender.ts` (about line 633) builds the two label lines from stage data: line 2 reads `Stage n of m`. For a worker with `tickets` set, line 2 must read `N of M tickets done` (live count). Line 1 can keep the stage name when stages exist, else `Running`. Non-ticket workers must be byte-for-byte unchanged, and `failed`/`queued` branches stay as they are. `workerLines` is not exported today; export it (or test through `buildScene`) without changing its signature.
Files: /home/col/SAM_ui-job-ticket-panel/src/components/floor/floorRender.ts (edit), and the existing floor render test file for it (find it with `ls src/components/floor/*.test.ts`; edit, or new `floorRender.tickets.test.ts` in the same folder)
Steps:
1. Add the ticket branch at the top of the running-case logic, after the `failed` and `queued` returns.
2. Test: a worker fixture with `summary` "Kitchen R4 build (resume, 19 of 24 done)", `tickets {done: 20, total: 24}` gives line 2 exactly `20 of 24 tickets done`; the same worker with `tickets: null` and stages gives the old `Stage n of m`; a worker with neither gives `Running` and the elapsed text as before.
3. Run the whole floor test folder to confirm nothing else moved.
Do not touch: the scene geometry, `FloorCanvas.tsx`, label size or font.
Proof: the new test passes and fails before the edit (assert the `20 of 24 tickets done` string); `npx tsc --noEmit` exits 0; all other `src/components/floor` tests still pass.

## T6: Active-jobs list and phone floor view show live ticket progress
Status: TODO
Spec: must-do #15, check #12
Depends on: T4
Blocked by: none
Context: `ActiveJobsModule.tsx` rows show General, status and job id only (no progress text today). For a worker with `tickets` set add a third small line `N of M tickets done`; rows for other workers do not change. On the phone floor view, `stageTimeline(w)` in `phoneView.ts` returns the `Stages` section summary (`n of m stages`, or `No stage events`) used by `StageTimeline` in `FleetPhoneView.tsx`; for a ticket worker the summary must read `N of M tickets done` instead. `heroCaption` stays as is (it names the running stage, not progress). "no stage data" wording (ux-fixes Must 17) stays untouched everywhere.
Files: /home/col/SAM_ui-job-ticket-panel/src/components/dashboard/fleet/ActiveJobsModule.tsx (edit), src/components/dashboard/fleet/phoneView.ts (edit), src/components/dashboard/fleet/phoneView.test.ts (edit), and a small export from ActiveJobsModule (e.g. `activeJobProgress(worker)`) tested in a new `activeJobs.test.ts` in the same folder
Steps:
1. Add `activeJobProgress(worker): string | null` (null for non-ticket workers) and render it only when non-null.
2. `stageTimeline`: when `w.tickets` is set return `{ stages: w.stages, summary: 'N of M tickets done' }`; otherwise exactly as now.
3. Tests: kitchen R4 shaped worker (summary says 19 of 24, tickets 20 of 24) gives `20 of 24 tickets done` from both functions; a non-ticket worker gives `null` and the old stage summary.
Do not touch: `floorRender.ts` (T5), the layout and look of the rows beyond the one extra line, `jobSelection.ts`.
Proof: `node scripts/run-tests.cjs src/components/dashboard/fleet/phoneView.test.ts src/components/dashboard/fleet/activeJobs.test.ts` (or the single-file form twice) shows 0 failures; the new asserts fail before the edit; `npx tsc --noEmit` exits 0.

## T7: Stream tail reader, last real activity
Status: TODO
Spec: must-do #7, check #5
Depends on: T1
Blocked by: none
Context: `claude-stream.jsonl` is 600 KB to 1 MB on a long job and must never be read whole on each refresh (SAM_ui memory item). Read at most `TAIL_BYTES` from the end, drop the first partial line, scan backwards. In a real stream only `assistant` and `user` lines carry `"timestamp"`; `system`, `rate_limit_event` and `tool_progress` lines do not. `tool_progress` lines with `"heartbeat":true` arrive every 30 s even when the job is stuck and must never count. Last activity = the `timestamp` of the last non-heartbeat line that has one. If the tail holds none, report `null` ("unknown"), never the file's modified time. Real shape to copy for the fixture (do not read the real file in a test): `/home/col/.sam/jobs/job_kitchen-r4-implement-t20_20261008-205319/claude-stream.jsonl`.
Files: /home/col/SAM_ui-job-ticket-panel/src/lib/server/fleet/streamTail.ts (new), streamTail.test.ts (new)
Steps:
1. Export `readStreamTail(path, maxBytes = TAIL_BYTES): Promise<string[]>` using `fs.open` + `read` at `size - maxBytes`, and `lastActivity(lines): string | null`.
2. Test fixture built in a temp dir: 20 normal lines (last real one at a known time T), then 100 heartbeat lines; make the file's mtime much later than T with `fs.utimes`. `lastActivity` must equal T, not the mtime.
3. Test the tail bound: a 2 MB file only has `TAIL_BYTES` read (spy on bytes read through an injected reader, or assert the returned lines total less than `TAIL_BYTES + 1 line`). A missing file returns an empty list and `null`.
Do not touch: `jobCosts.ts` (it reads `stdout.log`), `floorState.ts`.
Proof: `node scripts/run-tests.cjs src/lib/server/fleet/streamTail.test.ts` shows 0 failures and the heartbeat test passing; before the ticket the file does not exist; `npx tsc --noEmit` exits 0.

## T8: Stream tail reader, failed and timed-out runs
Status: TODO
Spec: must-do #8, check #6
Depends on: T7
Blocked by: none
Context: Bash tool results in the stream are `user` lines whose `message.content[]` holds `{"type":"tool_result","tool_use_id":...,"content":"Exit code 143\n...","is_error":true}`; the command is in the earlier `assistant` line's `tool_use` block with the same id (`input.command`). A real job has four `Exit code 143` results. Within the tail only: list every Bash result whose content begins `Exit code N` with N not 0; count them, and return the most recent 5 with the command trimmed to 120 characters (collapse whitespace) and the exit code. Exit 124 and 143 carry `timedOut: true`. If the matching `tool_use` is outside the tail window, the command is `(command not in the recent log)`. The count is "in the recent log" (the tail window), and the panel says so. Interpretation to confirm with Colin: every non-zero Bash exit counts as a failed run, not only commands that look like tests.
Files: /home/col/SAM_ui-job-ticket-panel/src/lib/server/fleet/streamTail.ts (edit), streamTail.test.ts (edit)
Steps:
1. Export `failedRuns(lines): { count: number; recent: { command: string; exitCode: number; timedOut: boolean; at: string | null }[] }`.
2. Fixture lines: one successful Bash result, one `Exit code 1`, one `Exit code 143` with its tool_use command `timeout 470 node scripts/t-v3-phone-flow.mjs --rows T21 2>&1 | tail -20`, and an `Exit code 143` whose tool_use is missing.
3. Assert count 3, the 143 entries `timedOut`, the `Exit code 1` entry not, newest first, command trimmed.
Do not touch: T7's `lastActivity` behaviour.
Proof: `node scripts/run-tests.cjs src/lib/server/fleet/streamTail.test.ts` shows 0 failures and the new tests pass (they fail before: the export does not exist); `npx tsc --noEmit` exits 0.

## T9: Build log reader, and proof the pruner leaves builds alone
Status: TODO
Spec: must-do #4, #16, check #3
Depends on: T1, T2
Blocked by: none
Context: Reads `~/.sam/builds/<stem>-<h8>.jsonl` (shared definitions) and merges it with whatever job folders still exist, newest first. Every job named in the log appears with id, state (running, done, failed) and start and end times; a job whose folder is gone appears from its log lines (`dispatch.at` is its start, `end.at` its end, verdict starting `PASS` means done, anything else with an end line means failed). A pruned job with a dispatch line and no end line shows state `ended, outcome unknown` (a small honest extension of the three states in M4: the closer may never have run). When the folder exists, `meta.json` status and `startedAt`/`endedAt` win over the log. Also prove the pruner T1 recorded (read its `Pruner:` line in the tickets file) never touches `~/.sam/builds`.
Files: /home/col/SAM_ui-job-ticket-panel/src/lib/server/fleet/buildLog.ts (new), buildLog.test.ts (new); the pruner proof goes in a new /home/col/SAM_ui-job-ticket-panel/src/lib/server/jobs/sweepBuilds.test.ts
Steps:
1. Export `buildLogPath(ticketsPath, homeDir?)` (sha1 of `fs.realpathSync` string, first 8 hex, per the shared definition) and `readBuildJobs(ticketsPath): Promise<BuildJob[]>`.
2. Unit test (scratch HOME): a log naming three jobs, one of whose folders is missing, returns all three, the missing one built from its log lines, newest first; a malformed log line is skipped; a missing log file gives only jobs found by folder.
3. Pruner test, following `manager.ts`'s own pattern (scratch HOME set before dynamic import; the boot sweep runs when a `JobManager` is constructed, see the constructor near line 681 and `sweepDisk` near line 1337): create `~/.sam/jobs/job_old_20240101-000000` (aged, with an old mtime) and `~/.sam/builds/anything.jsonl` (also aged 30 days with `fs.utimes`); construct the manager (stop its timer as the other tests do), wait for the boot sweep to finish, assert the old job folder is gone and the builds file and its folder are untouched. If the Pruner line from T1 names a different file than `manager.ts`, test that one instead and say so.
Do not touch: `manager.ts` itself (the proof is that it needs no change).
Proof: `node scripts/run-tests.cjs src/lib/server/fleet/buildLog.test.ts src/lib/server/jobs/sweepBuilds.test.ts` (or twice) shows 0 failures; both files are new so the command fails before; `npx tsc --noEmit` exits 0.

## T10: Panel data assembler
Status: TODO
Spec: must-do #2, #3, #4, #5, #6, #7, #8, #9, #10, check #1, #4, #7
Depends on: T2, T3, T7, T8, T9
Blocked by: none
Context: One server function builds everything the panel needs for a job id. For a ticket job (`ok`): every ticket (T2), the live heading counts, the build's jobs (T9), `lastActivity` (T7, from the job's own stream, only if it is running or ended recently; null otherwise) and `failedRuns` (T8). For an IN PROGRESS ticket: the claiming job id, its running state (its `meta.json` status is `queued` or `running`, and for the job itself the unit is active is not needed), and `stalled: true` when that job is not running or its folder is gone. For `none`: `{ mode: 'stages' }` so the component keeps today's view. For `missing`: `{ mode: 'stages', notice: 'Tickets file not found (worktree removed?): showing stages.' }` (one line). Job ids come from outside: accept only `^job_[A-Za-z0-9._-]+$` and join under the jobs root with a check that the resolved path stays inside it.
Files: /home/col/SAM_ui-job-ticket-panel/src/lib/server/fleet/jobTicketPanel.ts (new), jobTicketPanel.test.ts (new)
Steps:
1. Export `readJobTicketPanel(jobId): Promise<JobTicketPanel>` with a discriminated type (`mode: 'tickets' | 'stages'`).
2. Fixture test (scratch HOME): rebuild a kitchen R4 shaped job folder (`meta.json` with `closerCtx.cwd` pointing at a temp dir holding the T2 kitchen copy, `brief.md` mentioning it, a short stream) and assert 24 tickets in order and heading `N of 24 tickets done` where N equals the DONE count of the copy (check #1).
3. IN PROGRESS tests: a ticket claimed by a running fixture job is shown running; claimed by an ended job, or one with no folder, `stalled: true` (check #4).
4. Stages-mode tests: no tickets file gives `mode: 'stages'` with no notice; missing tickets file gives the one-line notice (check #7).
5. A bad job id (`../x`, `job_..`) returns `mode: 'stages'` and reads nothing outside the root.
Do not touch: `floorState.ts`, `FleetPersonaJob` types, the legacy `/api/fleet/jobs` route.
Proof: `node scripts/run-tests.cjs src/lib/server/fleet/jobTicketPanel.test.ts` shows 0 failures with at least 6 tests; before, the file does not exist; `npx tsc --noEmit` exits 0.

## T11: API route for the panel data
Status: TODO
Spec: must-do #2, #4, #11
Depends on: T10
Blocked by: none
Context: Mirror `src/app/api/fleet/floor/route.ts` (session-gated through `requireSession`, `envelope(...)`, `export const dynamic = 'force-dynamic'`, `?demo=1` answers from fixtures and never reads the live store). Route: `GET /api/fleet/job-tickets?jobId=<id>`. Demo mode returns `{ mode: 'stages' }` so a screen-share never leaks a real job. `route.test.ts` next to the floor route shows the test pattern.
Files: /home/col/SAM_ui-job-ticket-panel/src/app/api/fleet/job-tickets/route.ts (new), route.test.ts (new, same folder)
Steps:
1. Implement `GET`: auth, parse `jobId`, call `readJobTicketPanel`, return the envelope; a missing or malformed `jobId` returns `{ mode: 'stages' }`, status 200.
2. Test as in `floor/route.test.ts`: unauthenticated request is refused the same way as the floor route; authenticated request with a fixture job returns the tickets payload; `demo=1` returns stages mode without touching the store.
Do not touch: the floor route, auth code, `middleware`/proxy rules.
Proof: `node scripts/run-tests.cjs src/app/api/fleet/job-tickets/route.test.ts` shows 0 failures; fails before (file absent); `npx tsc --noEmit` exits 0.

## T12: Panel view model (pure formatters)
Status: TODO
Spec: must-do #3, #4, #5, #6, #7, #8, check #2, #4, #5, #6
Depends on: T10
Blocked by: none
Context: `JobDetailModule.tsx` has pure `formatJobDetail` / `formatAge` tested in `jobDetail.test.ts`. Add the same style of pure formatter for the new data so the component stays thin: heading `N of M tickets done`; the launch summary underneath as the job's name only; per-ticket row (number, title, label as written, running job id for IN PROGRESS or `stalled: job ended`); build job rows (id, state label, start and end as short local times); `last activity N minutes ago` using `formatAge` (read it: "5 min" style; the panel text is `last activity 5 min ago`; the spec's "N minutes ago" is satisfied by the same relative age, keep `formatAge`); failed-run rows (`timed out` for 124 and 143, else `exit N`, command trimmed). "no stage data" and `Stage n of m` wording stays in `formatJobDetail` untouched.
Files: /home/col/SAM_ui-job-ticket-panel/src/components/dashboard/fleet/jobTicketView.ts (new), jobTicketView.test.ts (new)
Steps:
1. Export `formatTicketPanel(data, now): TicketPanelView` (pure, `now` injected).
2. Tests: every status word of the T2 status-words fixture renders as written (check #2); IN PROGRESS with stalled true renders `stalled: job ended` and not `running`; exit 143 and 124 render `timed out`, exit 1 renders `exit 1`; a null `lastActivity` renders no activity line, not a guess; heading count correct.
Do not touch: `formatJobDetail`'s existing outputs or `jobDetail.test.ts` expectations.
Proof: `node scripts/run-tests.cjs src/components/dashboard/fleet/jobTicketView.test.ts src/components/dashboard/fleet/jobDetail.test.ts` shows 0 failures (the first fails before: file absent); `npx tsc --noEmit` exits 0.

## T13: Panel component, phone and desktop
Status: TODO
Spec: must-do #2, #4, #5, #9, #10, #11, check #7, #8
Depends on: T11, T12
Blocked by: none
Context: `JobDetailModule.tsx` is the single panel on phone (inside `FleetPhoneView.tsx`) and desktop; keep it single. It gets a second effect: when a job is selected, fetch `/api/fleet/job-tickets?jobId=...` once, then re-fetch every 3000 ms only while the worker is queued or running (never faster than the floor poll; no fetch at all for ended jobs beyond the first), abort on change/unmount like the existing legacy-lookup effect, primitive deps only. `mode: 'tickets'` shows heading, name, ticket list, builds list, activity and failed runs; `mode: 'stages'` shows today's view unchanged, plus the one-line notice when present. On a 390 px phone the ticket list must not scroll sideways: rows wrap or truncate with `min-w-0`, no fixed widths, no `whitespace-nowrap` without `truncate`, ticket lists in a vertical scroll area with a sensible max height. Check #8 on the live dashboard cannot be done before deploy; here prove what can be proved: a render test, and read `FleetPhoneView.tsx`'s style block so nothing overflows the `.fp-job` container.
Files: /home/col/SAM_ui-job-ticket-panel/src/components/dashboard/fleet/JobDetailModule.tsx (edit), src/components/dashboard/fleet/jobTicketPanel.render.test.ts (new, uses `react-dom/server` `renderToStaticMarkup` if available in the repo, else tests the view model's class hooks)
Steps:
1. Add the fetch effect and the tickets-mode render using T12's view model; keep every existing export (`formatJobDetail`, `formatElapsed`, `formatAge`, `briefFromCommand`) as is.
2. Render test with 24 tickets (long titles, a long IN PROGRESS job id): the markup contains no `whitespace-nowrap` without `truncate`/`break-words`, no fixed pixel widths over 360, and the heading string `20 of 24 tickets done`.
3. Stages-mode render equals the old output: assert the `Stages` stat still reads `no stage data` for a job with no stage data.
4. Run `npx tsc --noEmit` and the whole `src/components/dashboard` test folder.
Do not touch: `ActiveJobsModule.tsx`, `StageEventsModule.tsx`, the Fleet pages, the card styling tokens (reuse the existing colours and borders).
Proof: `node scripts/run-tests.cjs src/components/dashboard/fleet/jobTicketPanel.render.test.ts src/components/dashboard/fleet/jobDetail.test.ts` shows 0 failures; `npx tsc --noEmit` exits 0; `grep -n "job-tickets" src/components/dashboard/fleet/JobDetailModule.tsx` matches and `grep -n "3000" src/components/dashboard/fleet/JobDetailModule.tsx` shows the interval floor.

## T14: Shared Python module for tickets files and the build log
Status: TODO
Spec: must-do #13, #16, check #3, #10
Depends on: T1
Blocked by: none
Context: `sam-dispatch` already calls into the closer's code (`closer_proof.parse_checks` through `PYTHONPATH=/home/col/.sam/closer`) so the guard and the closer can never disagree. Do the same here: one new module with the shared definitions in Python, used by `sam-dispatch.next` (T15, T16) and the closer (T17, T18). Because the live closer directory has no such file yet, ship it as `closer_tickets.py.next` (new, no live twin). `~/.sam/tests/closer-overlay.sh` copies every `*.py.next` over the live names, which is how tests import it before install. `SAM_CLOSER_DIR` is the seam `sam-dispatch.next` will use.
Files: /home/col/.sam/closer/closer_tickets.py.next (new), /home/col/.sam/tests/test-closer-tickets.sh (new)
Steps:
1. Functions: `find_tickets_file(brief_text, cwd) -> str|None` (shared regex, first existing wins), `parse(text) -> list of tickets` (number, title, status label, note, claim, files), `first_bad(tickets) -> ticket|None` (a ticket with no readable Status line), `build_log_path(tickets_path, builds_dir=None)`, `append_line(path, obj)` (creates the folder, single `write` of one line plus newline so concurrent appends do not interleave, mode 0600 file).
2. Test script `test-closer-tickets.sh`: builds the overlay, imports the module from the overlay and checks: the status-split table against the T2 fixture words (copy `status-words-tickets.md` from the worktree fixtures), `first_bad` names the ticket with no Status line, `build_log_path` for a fixed realpath gives the same `<stem>-<h8>.jsonl` name as the TypeScript `buildLogPath` (compute the expected sha1 with `sha1sum` in the script and compare), `append_line` adds exactly one line per call.
3. Follow `~/.sam/tests/test-closer-questions.sh` for the fixture and overlay sourcing and its pass/fail output style.
Do not touch: any live `.py` in `~/.sam/closer/`, `MANIFEST`, `stage.sums` (T20).
Proof: `bash /home/col/.sam/tests/test-closer-tickets.sh | tail -1` prints `N passed, 0 failed` with N at least 5; before the ticket the script does not exist.

## T15: sam-dispatch.next, the tickets guard (exit 8)
Status: TODO
Spec: must-do #13, check #10
Depends on: T14
Blocked by: none
Context: Copy the live `sam-dispatch` (358 lines, with the proof guard exit 6 and the General guard exit 7) to `sam-dispatch.next` (it is byte-identical to live right now; check with `cmp` and copy fresh if not). Add a guard AFTER the proof guard and with the proof guard's code untouched: if the brief names a tickets file (shared regex, resolved against `--cwd`) that exists and any ticket heading lacks a readable `Status:` line, refuse with exit 8 and a message naming the first bad ticket (`T<n>: <title>`). Exempt: `--no-closer`. NOT exempt: `--relaunch-of`. A brief naming a tickets file that does not exist yet (a ticket-writing brief like this ticket job's own) is accepted. Python comes from the `closer_tickets` module through `PYTHONPATH=${SAM_CLOSER_DIR:-/home/col/.sam/closer}`; if the module cannot be read the guard refuses with exit 8 and says so (same fail-closed tone as the proof guard's exit 6 on a parse failure). Add a header comment block describing the guard in the style of the proof-guard paragraph.
Files: /home/col/.local/bin/sam-dispatch.next (edit), /home/col/.sam/tests/test-dispatch-tickets-guard.sh (new)
Steps:
1. Edit `.next` only. Run `bash -n` on it.
2. New test modelled on `test-dispatch-proof-guard.sh` (stub `sam-job`, temp dirs, `SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch.next`, `SAM_CLOSER_DIR` pointing at an overlay dir made with `closer-overlay.sh`, briefs with a `## Proof required` file: line so exit 6 does not fire): a brief naming a tickets file with one ticket missing its Status line is refused with exit 8 and the output names that ticket; the same brief with the line fixed is accepted (exit 0); a ticket-writing brief whose tickets file does not exist yet is accepted; the broken brief with `--no-closer "reason"` is accepted; the broken brief with `--relaunch-of <existing job>` is still refused with exit 8.
3. Run the existing guard tests against `.next`: `SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch.next bash /home/col/.sam/tests/test-dispatch-proof-guard.sh` must still pass (exit 6 and its exemptions unchanged), and the same for `test-dispatch-folder-guard.sh`, `test-dispatch-seat-guard.sh`, `test-dispatch-routing.sh` if they accept `SAM_DISPATCH_BIN` (read how each picks its binary).
Do not touch: the live `sam-dispatch`, the proof guard block, the General guard block, `sam-job`.
Proof: `SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch.next bash /home/col/.sam/tests/test-dispatch-tickets-guard.sh | tail -1` prints `N passed, 0 failed` (N at least 5) and the same script against the live `sam-dispatch` (`SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch`) reports failures (fails before); `SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch.next bash /home/col/.sam/tests/test-dispatch-proof-guard.sh | tail -1` prints `9 passed, 0 failed`.

## T16: sam-dispatch.next, one build-log line per ticket job
Status: TODO
Spec: must-do #16, check #3
Depends on: T14, T15
Blocked by: none
Context: When `sam-dispatch.next` sends out a ticket job (brief names an existing tickets file, any `--no-closer` setting) it appends one `kind: dispatch` line to the build log (shared definitions): job id, time, seat, tier, brief path, tickets file. The job id is made by `sam-job`, not by `sam-dispatch`; `sam-job` prints `sam-job: <ID>  unit=<unit>` on stdout on success. So read the launch output. Today `sam-job` is run with stdout inherited. Change to `"$JOB_BIN" ... | tee "$OUTF"` with `rc=${PIPESTATUS[0]}`, keep the output on the user's terminal unchanged, parse the id from the `sam-job: ` line, and clean the temp file (the script's tmp rules: use `mktemp` under `$TMPDIR`, remove it in the existing EXIT trap; this script already sets `trap '' PIPE`, keep that). A launch that fails (rc not 0) appends nothing. If the id cannot be parsed, append nothing and print one warning to stderr; the dispatch itself must never fail because of the log. Non-ticket jobs append nothing. Honour `SAM_BUILDS_DIR`.
Files: /home/col/.local/bin/sam-dispatch.next (edit), /home/col/.sam/tests/test-dispatch-build-log.sh (new)
Steps:
1. Edit `.next` (already edited by T15; keep T15's block).
2. Test with a stub `sam-job` that prints `sam-job: job_stub_20261008-000000  unit=sam-job-stub` and exits 0: a dispatched ticket job adds exactly one line to the build log with the right fields; a second dispatch of the same tickets file adds one more line to the same file; a non-ticket brief adds none; a failing stub (exit 1) adds none; `--no-closer` with a ticket brief still adds one; the dispatch's own stdout still shows the stub's line.
3. Re-run T15's test and the existing dispatch tests against `.next`.
Do not touch: the live `sam-dispatch`, the seat and folder guards, the closer context JSON, `sam-job`.
Proof: `SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch.next bash /home/col/.sam/tests/test-dispatch-build-log.sh | tail -1` prints `N passed, 0 failed` (N at least 5); against the live binary it fails (fails before); T15's proof command still passes.

## T17: Closer writes the end line to the build log
Status: TODO
Spec: must-do #16, check #3
Depends on: T14
Blocked by: none
Context: In `closer.py.next` (already carries the staged `closer_questions` work; edit it, do not start from live), after the verdict is final and `core.write_record` has run for an ended ticket job, append `{"kind":"end","jobId","at","verdict"}` to the build log. The tickets file comes from the job's brief and `closerCtx.cwd` through `closer_tickets.find_tickets_file`. It must never stop the record or the message: wrap in try/except and log through the same `closer_bug`-style helper the staged code uses. Idempotent: the early `status == "closed"` return already prevents a second run; also skip if an `end` line for that job id is already in the log. Honour `SAM_BUILDS_DIR`. Run-closer's other callers (relaunch module) are unchanged.
Files: /home/col/.sam/closer/closer.py.next (edit), /home/col/.sam/tests/test-closer-build-log.sh (new)
Steps:
1. Add `import closer_tickets as tickets  # noqa: E402` and a small `_log_build_end(job, job_dir, verdict)` called once after the verdict is known.
2. Test with the fixture helpers (`closer-fixtures.sh`, overlay): a fixture ended ticket job gets exactly one `end` line with its verdict; a non-ticket job gets none; running the closer twice on the same job adds still one line; a job whose tickets file is missing adds none and the closer still closes and sends its one message.
3. Run `test-closer-record.sh`, `test-closer-e2e.sh` and `test-closer-message.sh` (overlay mode) to confirm no regression.
Do not touch: the live `closer.py`, `closer_proof.py`, `closer_core.py`, the staged questions lines, the message text.
Proof: `bash /home/col/.sam/tests/test-closer-build-log.sh | tail -1` prints `N passed, 0 failed` (N at least 4); before the ticket the script fails on the missing line; the three named existing tests still end `0 failed`.

## T18: Closer flags stalled IN PROGRESS and unproven DONE tickets
Status: TODO
Spec: must-do #14, check #11
Depends on: T14, T17
Blocked by: none
Context: When a ticket job ends the closer reads the tickets file as it stands and flags two things in its report. (a) Any ticket whose status is `IN PROGRESS <this job's id>`: "T<n> still IN PROGRESS for this job (it ended without finishing it)". (b) Any ticket marked DONE that was not DONE when the job started and has no matching commit since the job started. No commit-message parsing (spec Won't do), so "matching" means: at least one commit since `meta.startedAt`, in the repo that holds the tickets file, touches a path named in the ticket's `Files:` line. The "not DONE at start" test reads the tickets file as of the last commit before `startedAt` (`git show <rev>:<path>`; if that file is not in git, skip (b) and record "DONE cross-check skipped: tickets file not under git"). A ticket whose `Files:` paths are all outside that repo is not checkable: skip it and say so in one summary line, never flag it. Interpretation to confirm with Colin: "matching commit" is path-based, as above. Flags go in the closer record as `ticketFlags` (list of strings) and into the report as needs-you style lines in `closer_message.py.next` under one short "Tickets" paragraph; the message count rules stay (still one message).
Files: /home/col/.sam/closer/closer_tickets.py.next (edit), /home/col/.sam/closer/closer.py.next (edit), /home/col/.sam/closer/closer_message.py.next (new copy of live, then edit), /home/col/.sam/tests/test-closer-ticket-flags.sh (new)
Steps:
1. Add `ticket_flags(job, job_dir, tickets_path) -> (flags, skipped_notes)` to the module; wire it into `closer.py.next` before the record is written; each flag also goes into `rec["ticketFlags"]`.
2. Copy `closer_message.py` to `closer_message.py.next` (they are identical now) and add the paragraph only when `ticketFlags` is non-empty.
3. Test with a temp git repo and a fixture job: a job that leaves `Status: IN PROGRESS <its own id>` is flagged (check #11); a job whose id is different in the line is not flagged; a ticket newly DONE with no commit touching its Files is flagged; the same ticket with such a commit is not; a non-ticket job has no flags and its message is unchanged byte-for-byte.
4. Re-run `test-closer-message.sh` and `test-closer-record.sh` in overlay mode.
Do not touch: live closer files, the proof-check code, the "BLOCKED" handling (T23 of the closer build), the vault writer.
Proof: `bash /home/col/.sam/tests/test-closer-ticket-flags.sh | tail -1` prints `N passed, 0 failed` (N at least 5); it fails before the ticket (no flags produced); the two re-run tests end `0 failed`.

## T19: /implement skill and brief template write IN PROGRESS
Status: TODO
Spec: must-do #12, check #9
Depends on: none
Blocked by: none
Context: Today `/home/col/.claude/skills/implement/SKILL.md` (32 lines) says per ticket: brief a fresh agent, verify its proof, then `Status: DONE <date>`. Add the missing steps: before briefing the agent, set the ticket's line to `Status: IN PROGRESS <job id>`; on pass write `DONE <date> (<proof>)` only after the foreman's own proof check; on a stop write `BLOCKED <reason>` or put it back to `TODO`. The job id is the foreman's own: `basename "$SAM_JOB_DIR"` (the job runner exports `SAM_JOB_DIR`; `sam-dispatch` uses it the same way). If `SAM_JOB_DIR` is empty (a hand-run `/implement`), use `manual`. The edit must be to that one ticket's line only, with a fresh read just before the edit, never a wholesale rewrite (other foremen may edit the same file). The skill's rule "never mark a ticket done on a failed or unrun proof" stays word for word. There is no implement brief template file today (briefs in `~/.sam/briefs/*implement*.md` are written by hand). Search once more (`~/.sam/briefs`, `~/.claude`, `~/.sam/closer`); if there is none, create `~/.sam/briefs/implement-brief-template.md` (new) holding the standard foreman brief skeleton (task header lines, Where, How each ticket runs with the IN PROGRESS step, Hard limits, Proof required, BLOCKED line), based on `~/.sam/briefs/pier-kpi-implement-t1-t5-20261008.md`; say in the report that it was created because none existed.
Files: /home/col/.claude/skills/implement/SKILL.md.next (new, copy of live then edit), /home/col/.sam/briefs/implement-brief-template.md (new), /home/col/.sam/tests/test-implement-in-progress.sh (new)
Steps:
1. `cp -p SKILL.md SKILL.md.next`, then edit the `.next`.
2. Write the template.
3. Test script: both files contain `IN PROGRESS`; the skill `.next` still contains the exact phrase `Never mark a ticket done on a failed or unrun proof`; the live `SKILL.md` does not contain `IN PROGRESS` (so the test fails before and passes after the edit of `.next`); the template contains `Proof required` and `BLOCKED:`.
Do not touch: the live `SKILL.md`, other skills, existing briefs.
Proof: `bash /home/col/.sam/tests/test-implement-in-progress.sh | tail -1` prints `N passed, 0 failed` (N at least 5); `grep -c 'IN PROGRESS' /home/col/.claude/skills/implement/SKILL.md.next` is at least 2. The second half of check #9 (the next real ticket job shows IN PROGRESS on the panel while it runs) is T23's job.

## T20: Closer suite bookkeeping and shell suites on the .next files
Status: TODO
Spec: must-do #13, #14, #16, check #3, #10, #11
Depends on: T15, T16, T17, T18, T19
Blocked by: none
Context: `~/.sam/tests/test-closer-all.sh` runs every `test-closer-*.sh` against the `.next` files, requires each closer script in `MANIFEST` to be named in a test, and keeps a `NEXTS` list and `stage.sums` of live checksums. The new module and the extra `.next` files must be known to it before install, without touching the live `MANIFEST` or `stage.sums` yet (those change in the install line, T22).
Files: /home/col/.sam/tests/test-closer-all.sh (edit; copy to `.bak-20261009-jtp` first)
Steps:
1. Add `closer_tickets.py.next`, `closer_message.py.next` and `closer_questions.py.next` (already on disk) to `NEXTS` only if the script's step 5 needs them to exist; read it first and change the least possible.
2. Run `bash /home/col/.sam/tests/test-closer-all.sh | tail -3` and read every FAIL. Expected remaining FAIL: only the "re-stage needed" / "unlisted script" style lines that the install line fixes. Anything else is a defect in T14 to T18: report it, do not paper over it.
3. Write the exact list of remaining FAIL lines into the ticket's report so T22 can handle each.
Do not touch: `MANIFEST`, `stage.sums`, any live closer file, any other test.
Proof: `bash /home/col/.sam/tests/test-closer-all.sh | grep -c '^FAIL'` prints a number the report lists line by line, each explained as install-time bookkeeping; `bash /home/col/.sam/tests/test-closer-tickets.sh`, `test-closer-build-log.sh`, `test-closer-ticket-flags.sh`, `test-dispatch-tickets-guard.sh`, `test-dispatch-build-log.sh`, `test-implement-in-progress.sh` each end with `0 failed`.

## T21: Whole-build verification in the worktree
Status: TODO
Spec: check #13 (first two halves), all checks
Depends on: T1 to T13
Blocked by: none
Context: Baseline on the live branch at `72c32d2` (2026-10-08): `npm test` gives 559 tests, 557 pass, 0 fail, 2 skipped. The build must add tests and break none. Nothing is committed, merged or deployed here; the foreman may commit on `build/job-ticket-panel` only if Colin has said so (the `/implement` rule), otherwise the changes stay uncommitted in the worktree.
Files: none (verification only; list any defect found as BLOCKED)
Steps:
1. In `/home/col/SAM_ui-job-ticket-panel`: `npx tsc --noEmit` and `npm test`. Record the totals.
2. `git -C /home/col/SAM_ui-job-ticket-panel status --short` and `git diff --stat`: confirm every changed file is in some ticket's Files list and that nothing under `/home/col/SAM_ui` (live tree) changed except this tickets file (`git -C /home/col/SAM_ui status --short`).
3. Confirm the leak gate: `npm test` must not report leftover temp directories.
Do not touch: anything. If a test fails, report which ticket owns it.
Proof: `cd /home/col/SAM_ui-job-ticket-panel && npx tsc --noEmit; echo $?` prints 0 and `npm test 2>&1 | tail -15` shows 0 failures with a pass count above 557.

## T22: Write the install line
Status: TODO
Spec: must-do #12, #13, #14, #16, check #3, #9, #10, #11
Depends on: T20, T21
Blocked by: none
Context: Colin or SAM installs, not a worker. This ticket only writes the instructions, as ONE line, to `/home/col/.sam/logs/job-ticket-panel-INSTALL.txt`, in the style of `/home/col/.sam/closer/INSTALL-T24.txt`. It must not run the line, copy anything over a live file, edit `MANIFEST` or `stage.sums`, or restart anything. Live files touched by the line: `~/.local/bin/sam-dispatch`, the closer's `closer.py`, `closer_message.py`, `closer_vault.py` and `closer_questions.py` (staged work that `closer.py.next` already imports: say so in the file, since installing `closer.py.next` ships it), the new `closer_tickets.py`, `~/.sam/closer/MANIFEST` and `stage.sums` (append and recompute the new entries), and `~/.claude/skills/implement/SKILL.md`. `sam-job` is not changed by this build; do not list it.
Files: /home/col/.sam/logs/job-ticket-panel-INSTALL.txt (new)
Steps:
1. Read `INSTALL-T24.txt` and `INSTALL.txt` for the exact shape. Before writing, re-check with `cmp` that each live file still equals the version T15 to T19 started from (the staged `closer.py.next` and `closer_vault.py.next` differences may have been installed by someone else meanwhile; if so, adapt).
2. The line, joined with `&&` so it stops at the first failure: for each file `cp -p <live> <live>.bak-20261009-jtp`, `cp -p <file>.next .tmp-install-<n>`, `mv -f .tmp-install-<n> <live>`; closer files in dependency order (`closer_tickets.py` and `closer_questions.py` before the files that import them); then the MANIFEST and stage.sums updates; then the tests on live: `bash ~/.sam/tests/test-dispatch-tickets-guard.sh | tail -1`, `test-dispatch-build-log.sh`, `test-dispatch-proof-guard.sh`, `bash ~/.sam/tests/test-closer-all.sh | tail -1`, and `grep -c 'IN PROGRESS' ~/.claude/skills/implement/SKILL.md`. Because the tests default to the live binary, they run on live after the moves.
3. Under the line add: a one-line rollback (restore each `.bak-20261009-jtp` the same temp-file-plus-`mv` way), the list of files changed, the note that exit 8 is the new guard, and the note "Not touched: sam-job, run.sh, units, timers, job dirs, sam-ui.service."
4. Dry-check: `bash -n` of the line pasted into a temp script under `$HOME/.cache/` (not `/tmp`, removed after) and nothing else.
Do not touch: every live file, `MANIFEST`, `stage.sums`, `sam-ui.service`.
Proof: `[ -s /home/col/.sam/logs/job-ticket-panel-INSTALL.txt ] && grep -c 'mv -f' /home/col/.sam/logs/job-ticket-panel-INSTALL.txt` prints a number of at least 8; `grep -c 'bak-20261009-jtp' /home/col/.sam/logs/job-ticket-panel-INSTALL.txt` is at least 8; the file contains exactly one line starting `cd /home/col` (`grep -c '^cd /home/col' ...` prints 1); it fails before (file absent).

## T23: GATE, SAM installs and deploys once Colin approves
Status: TODO
Spec: must-do #11, #12, check #8, #9, #13
Depends on: T22
Blocked by: Colin's approval (an explicit word; nothing in T1 to T22 is approval)
Context: The foreman stops here and reports. It does not install, merge, build for production or restart anything on its own. When Colin approves: SAM first checks the proof (below), then runs the line in `job-ticket-panel-INSTALL.txt`; then SAM_ui is deployed only through `/home/col/SAM_ui/deploy.sh`, the one sanctioned build and restart wrapper (read its header; build and restart are one atomic step; never `next dev` while `sam-ui.service` is up), after merging `build/job-ticket-panel` into the live branch with Colin's separate word for the merge and for the restart.
Files: none
Steps:
1. Proof check (all must hold, SAM runs them): T21's proof (`npx tsc --noEmit` exit 0, `npm test` 0 failures, pass count above 557); `bash /home/col/.sam/tests/test-closer-all.sh | tail -1` shows `0 failed` apart from the install-time lines T20 listed; T22's proof.
2. Run the install line, read its test output (every test `0 failed`).
3. Merge, then run `deploy.sh` per its header.
4. Browser check on the live dashboard (check #8): at 390x844 and 1440x900 open a ticket job's panel by tap; assert no sideways scroll at 390 (`document.documentElement.scrollWidth <= 390`) and that the kitchen R4 job lists 24 tickets in order with a heading matching the file's DONE count.
5. Check #9, second half: the next real ticket job's panel shows IN PROGRESS with its job id while it runs (one check during that run).
6. Run `npx tsc --noEmit` and `npm test` once more on the merged live tree.
Do not touch: anything before Colin's word; `sam-ui.service` outside `deploy.sh`.
Proof: all of step 1 passes before step 2; after step 6, `npx tsc --noEmit; echo $?` prints 0, `npm test` shows 0 failures, and `systemctl --user is-active sam-ui.service` prints `active`.

## T24: GATE, Colin confirms the kitchen R4 panel on his phone
Status: TODO
Spec: check #13 (last half)
Depends on: T23
Blocked by: Colin
Context: The foreman stops here. Colin opens the kitchen R4 job (`job_kitchen-r4-implement-t20_20261008-205319`, or its newest relaunch) from the phone floor view and the panel shows the whole 24-ticket list with real statuses, the live "N of 24 tickets done" heading (not the launch summary's 19), which ticket is IN PROGRESS and who claimed it, last activity, and any timed-out runs. This ticket is complete only when Colin says so.
Files: none
Steps:
1. Tell Colin what to look at, in four lines.
2. Record his answer in this ticket's Status line.
Do not touch: anything.
Proof: Colin's explicit confirmation. No command can stand in for it.

## Coverage

Every must-do 1 to 16 and every check 1 to 13 maps to at least one ticket. A gap here is a bug in the tickets.

| Spec item | Ticket(s) |
|---|---|
| Must 1 ticket job defined | T3 |
| Must 2 list every ticket in order | T2, T10, T13 |
| Must 3 status as written | T2, T12 |
| Must 4 whole build, job log | T9, T10, T13 |
| Must 5 live heading, launch summary as name | T2, T4, T12, T13 |
| Must 6 IN PROGRESS claim, stalled | T10, T12 |
| Must 7 last activity, heartbeats ignored | T7, T10, T12 |
| Must 8 failed and timed-out runs | T8, T10, T12 |
| Must 9 no tickets file keeps stages view | T3, T10, T13 |
| Must 10 missing tickets file notice | T3, T10, T13 |
| Must 11 one panel, readable at 390 px | T13, T23 |
| Must 12 skill and brief template IN PROGRESS | T19, T22, T23 |
| Must 13 dispatch guard (exit 8, see shared definitions) | T14, T15, T22 |
| Must 14 closer flags | T18, T22 |
| Must 15 live count everywhere | T4, T5, T6 |
| Must 16 build log in ~/.sam/builds, pruning leaves it alone | T1, T9, T14, T16, T17 |
| Check 1 kitchen R4 fixture lists 24, heading matches | T2, T4, T10 |
| Check 2 every status word as written | T2, T12 |
| Check 3 build log unit test and shell test | T9, T14, T16, T17, T20 |
| Check 4 IN PROGRESS running or stalled | T10, T12 |
| Check 5 heartbeats do not count | T7, T12 |
| Check 6 Exit code 143 listed as timed out | T8, T12 |
| Check 7 no tickets file and missing file | T3, T10, T13 |
| Check 8 browser check 390 and 1440 | T13 (render proxy), T23 (live) |
| Check 9 skill and template contain the step; live job shows it | T19, T23 |
| Check 10 dispatch guard test | T14, T15, T20 |
| Check 11 closer flags IN PROGRESS | T18, T20 |
| Check 12 floor label and active-jobs entry | T5, T6 |
| Check 13 tsc, npm test, Colin on phone | T21, T23, T24 |
