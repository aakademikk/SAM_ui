# Job ticket panel: spec

Status: DRAFT 2026-10-08 (not locked)
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
4. The panel covers the whole build: every job whose brief names the same tickets file, newest first, each with its id, state (running, done, failed) and start and end times.
5. The panel heading shows live progress, "20 of 24 tickets done", counted from the tickets file at the moment the panel is read. The launch summary is shown underneath as the job's name only, not as progress.
6. A ticket marked IN PROGRESS shows the job id that claimed it. If that job is not running, the ticket shows as "stalled: job ended" instead of running.
7. The panel shows "last activity N minutes ago", taken from the job's last real event. Heartbeat lines (`"heartbeat":true`, every 30 s even when stuck) never count as activity.
8. The panel lists the job's failed and timed-out test runs: count, plus the most recent few with the command (trimmed) and exit code. Exit 124 and 143 are labelled "timed out".
9. A job with no tickets file keeps today's stages view unchanged ("Stage n of m", or "no stage data").
10. A ticket job whose tickets file no longer exists (worktree removed) says so in one line and falls back to the stages view.
11. The same panel serves phone and desktop. On a 390 px wide phone the ticket list is readable without sideways scrolling.
12. When a job starts a ticket it sets that ticket's line to `Status: IN PROGRESS <job id>` before building; on finishing it writes DONE (after its proof check), BLOCKED or back to TODO. This is added to the `/implement` skill and the implement brief template.
13. `sam-dispatch` refuses (exit code distinct from the proof guard's 6) a brief that names an existing tickets file in which any ticket heading lacks a readable `Status:` line. The message names the first bad ticket. Exempt as the proof guard is: `--no-closer`; `--relaunch-of` is NOT exempt, because relaunches are exactly the resumed builds this exists for.
14. When a ticket job ends, the Job Closer flags any ticket still marked IN PROGRESS with that job's id, and any ticket marked DONE with no matching commit since the job started, in its report.

## Won't do

- No separate progress file. The tickets file is the single record (Colin, 2026-10-08).
- No editing tickets from the dashboard; the panel is read-only.
- No change to how the floor canvas, KPI tiles or the completed-jobs lists look, beyond the job card's progress text.
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
3. (M4) The kitchen R4 panel lists every R4 job whose folder still exists and whose brief names the tickets file: three at 23:55 2026-10-08 (`t7`, `t7-resume`, `t20`; `resume_20261008-071457` has no brief copy and `implement_20261007` is already pruned). Unit test on fixture job folders.
4. (M6) Unit test: IN PROGRESS naming a running job shows running; naming an ended job shows "stalled: job ended".
5. (M7) Unit test on a stream fixture whose last 100 lines are heartbeats: last activity is the last non-heartbeat event's time, not the file's modified time.
6. (M8) Unit test on a stream fixture containing an `Exit code 143` tool result: one timed-out run listed with its command.
7. (M9, M10) Unit tests: a job with no tickets file and a job whose tickets file is missing both render the existing stages view, the second with the one-line notice.
8. (M11) Browser check at 390x844 and 1440x900 on the live dashboard: a ticket job's panel opens on tap, no sideways scroll at 390.
9. (M12) The `/implement` skill and brief template contain the IN PROGRESS step; the next real ticket job shows IN PROGRESS on the panel while it runs (SAM checks once during the run).
10. (M13) New test script in `~/.sam/tests/`: a brief naming a tickets file with a ticket missing its Status line is refused with the new exit code and names that ticket; the same brief with the line fixed is accepted; a ticket-writing brief whose tickets file does not exist yet is accepted. Fails before the change, passes after.
11. (M14) Closer test: a fixture job that leaves an IN PROGRESS line with its own id is flagged in the closer's report.
12. (all) `npx tsc --noEmit` exits 0, the existing SAM_ui test suite shows no new failures, and Colin confirms the kitchen R4 panel on his phone.

## Open questions

1. OPEN: should a job's card on the floor and in the active-jobs list also show "20 of 24", or only the detail panel? (Colin's complaint was the card label.)
2. OPEN: the new guard's exit code number (proof guard is 6). Proposal: 7 (`grep "exit 7"` finds no use in `sam-dispatch` on 2026-10-08).
3. OPEN: the existing SAM_ui test failure (`fleetUsage.test` 2 of 4, from the staged fewer-pings work, per the 2026-10-08 handoff) must be settled or recorded as the baseline before Done-means 12 can be judged.
4. OPEN: job folders in `~/.sam/jobs` are pruned within about a day, so the build's job list in M4 loses older runs (kitchen R4's first run is already gone). Accept that, or keep a small per-build job log that pruning does not touch?
