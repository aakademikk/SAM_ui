# Job ticket panel: spec

Status: LOCKED 2026-10-08 (Colin: "lock it", 23:55). Amended 2026-10-09: guard exit 7 to 8 (Colin "Yes", 08:15), because sam-dispatch took 7 for its General guard at 23:56.
Grilled: 2026-10-08 chat F, answers in the daily note [[2026-10-08]] (Colin switched Q1 from a separate progress file to the tickets file at ~23:50).
Touches: SAM_ui (`JobDetailModule.tsx`, its server reader), `~/.local/bin/sam-dispatch`, the `/implement` skill and brief template, the Job Closer.

## Goal

Tap any build job on the dashboard, on phone or desktop, and see the whole build's tickets with their real status,
which ticket is running now, when the job last did anything, and which test runs failed or timed out.
No more "19 of 24" frozen at launch while the job is on ticket 21, and no more guessing whether a job is stuck or just slow.

## Must do

1. A "ticket job" is a job whose brief (the `brief.md` copy in its job folder, else `closerCtx.brief` in its meta) names an `implementation/*-tickets.md` file that exists, resolved against the job's working folder.
2. Opening a ticket job's detail panel lists every ticket in that tickets file, in file order: number, title, status.
3. Status is read from each ticket's `Status:` line exactly as written. DONE, TODO, GATE, IN PROGRESS, BLOCKED, SKIPPED, SUPERSEDED and PARTLY DONE all display; any other word displays as written, never dropped or guessed.
4. The panel covers the whole build: every job in the build's job log (M16), newest first, each with its id, state (running, done, failed, or "ended, outcome unknown" when the folder is pruned and no end line exists; Colin 2026-10-09) and start and end times.
5. The panel heading shows live progress, "20 of 24 tickets done", counted from the tickets file at the moment the panel is read. The launch summary is shown underneath as the job's name only, not as progress.
6. A ticket marked IN PROGRESS shows the job id that claimed it. If that job is not running, the ticket shows as "stalled: job ended" instead of running.
7. The panel shows "last activity N minutes ago", taken from the job's last real event. Heartbeat lines (`"heartbeat":true`, every 30 s even when stuck) never count as activity.
8. The panel lists the job's failed and timed-out test and build runs only, never other commands such as searches (Colin 2026-10-09: "tests and builds"): count, plus the most recent few with the command (trimmed) and exit code. Exit 124 and 143 are labelled "timed out".
9. A job with no tickets file keeps today's stages view unchanged ("Stage n of m", or "no stage data").
10. A ticket job whose tickets file no longer exists (worktree removed) says so in one line and falls back to the stages view.
11. The same panel serves phone and desktop. On a 390 px wide phone the ticket list is readable without sideways scrolling.
12. When a job starts a ticket it sets that ticket's line to `Status: IN PROGRESS <job id>` before building; on finishing it writes DONE (after its proof check), BLOCKED or back to TODO. This is added to the `/implement` skill and the implement brief template.
13. `sam-dispatch` refuses with exit 8 (the proof guard keeps 6; 7 is the General guard) a brief that names an existing tickets file in which any ticket heading lacks a readable `Status:` line. The message names the first bad ticket. Exempt as the proof guard is: `--no-closer`; `--relaunch-of` is NOT exempt, because relaunches are exactly the resumed builds this exists for.
14. When a ticket job ends, the Job Closer flags any ticket still marked IN PROGRESS with that job's id, and any ticket marked DONE with no commit since the job started that touches one of that ticket's Files (Colin 2026-10-09), in its report.
15. Everywhere a ticket job's progress shows outside the panel (the floor canvas label in `floorRender.ts`, the active-jobs list, the phone floor view), it shows the same live "n of m tickets done" as M5, never the launch summary's numbers. Non-ticket jobs keep their stage text (Colin, 2026-10-08: "all").
16. Each build keeps a job log in `~/.sam/builds/`, one file per tickets file, outside `~/.sam/jobs` so job-folder pruning never touches it.
    `sam-dispatch` appends one line per ticket job when it sends it out (job id, time, seat, tier, brief path, tickets file);
    the Job Closer appends one line when the job ends (job id, end time, verdict). A job whose folder is pruned still appears in the panel from its log lines (Colin, 2026-10-08: "add the line").

## Won't do

- No separate progress file. The tickets file is the single record (Colin, 2026-10-08).
- No editing tickets from the dashboard; the panel is read-only.
- No change to how the floor canvas, KPI tiles or the completed-jobs lists look, beyond the progress text in M15.
- No new notification or Telegram message.
- No commit-message parsing to decide what is done. Commits are only used for the closer's cross-check in must-do 14.
- No backfill of IN PROGRESS onto builds already finished.

## Constraints and locked decisions

- "no stage data" wording and stage numbering stay as specified (ux-fixes spec, Must 17; `implementation/ux-fixes-spec.md`).
- Proof guard behaviour, exit 6 and its exemptions stay unchanged (`~/.local/bin/sam-dispatch`, live 2026-10-08, test `~/.sam/tests/test-dispatch-proof-guard.sh`).
- Seat default: main, spill to max2 (CLAUDE.md, 2026-10-08). Not touched.
- Memory: SAM_ui has an open memory-growth item ([[Active Priorities]], "SAM_ui memory and PC freezes"). The panel must not add a faster refresh than the detail panel already has, and must read only the tail of `claude-stream.jsonl` (that file is 600 KB on a one-hour job), never the whole file on each refresh.
- `/implement` stays the only thing that writes DONE, and only after its own proof check ([[implement skill]] rule "never mark a ticket done on a failed or unrun proof").
- Commits, pushes and the `sam-ui.service` restart each need Colin's explicit word.

## Done means

1. (M1, M2, M5) With kitchen R4 as fixture: the panel for `job_kitchen-r4-implement-t20_20261008-205319` lists 24 tickets in order and its heading matches the DONE count in `kitchen-v3-phone-flow-tickets.md` at the time. Unit test on a copy of that file.
2. (M3) Unit test: a fixture with every status word in M3 plus one made-up word shows all of them as written.
3. (M4, M16) Unit test: a build log naming three jobs, one of whose folders is missing, shows all three in the panel, the missing one from its log lines. Shell test in `~/.sam/tests/`: a dispatched ticket job adds exactly one line to its build log, a non-ticket job adds none, and the closer adds the end line. Fails before, passes after.
4. (M6) Unit test: IN PROGRESS naming a running job shows running; naming an ended job shows "stalled: job ended".
5. (M7) Unit test on a stream fixture whose last 100 lines are heartbeats: last activity is the last non-heartbeat event's time, not the file's modified time.
6. (M8) Unit test on a stream fixture containing an `Exit code 143` tool result: one timed-out run listed with its command.
7. (M9, M10) Unit tests: a job with no tickets file and a job whose tickets file is missing both render the existing stages view, the second with the one-line notice.
8. (M11) Browser check at 390x844 and 1440x900 on the live dashboard: a ticket job's panel opens on tap, no sideways scroll at 390.
9. (M12) The `/implement` skill and brief template contain the IN PROGRESS step; the next real ticket job shows IN PROGRESS on the panel while it runs (SAM checks once during the run).
10. (M13) New test script in `~/.sam/tests/`: a brief naming a tickets file with a ticket missing its Status line is refused with exit 8 and names that ticket; the same brief with the line fixed is accepted; a ticket-writing brief whose tickets file does not exist yet is accepted. Fails before the change, passes after.
11. (M14) Closer test: a fixture job that leaves an IN PROGRESS line with its own id is flagged in the closer's report.
12. (M15) Unit tests: the floor label and active-jobs entry for the kitchen R4 fixture read "20 of 24 tickets done" when the summary says "19 of 24"; a non-ticket job's label is unchanged.
13. (all) `npx tsc --noEmit` exits 0, `npm test` shows 0 failures (baseline 2026-10-08: 557 pass, 0 fail, 2 skipped), and Colin confirms the kitchen R4 panel on his phone.

## Open questions

1. RESOLVED 2026-10-08 (Colin: "all"): live ticket count everywhere a ticket job's progress shows. Now M15.
2. RESOLVED 2026-10-08 (Colin: "ok"): the new guard exits 7. Superseded 2026-10-09: 7 was taken at 23:56 by the General guard, so 8 (Colin "Yes").
3. RESOLVED 2026-10-08 23:55 by evidence: `npm test` on `72c32d2` gives 559 tests, 557 pass, 0 fail, 2 skipped; `fleetUsage.test` passes 4 of 4. That is the baseline for Done-means 13.
4. RESOLVED 2026-10-08 (Colin: "add the line"): per-build job log, now M16. The job-folder pruner was not found in `sam-job` or `sam-dispatch` (only a launch-failure `rm -rf`); the ticket that builds M16 must find it and prove it leaves `~/.sam/builds/` alone.
