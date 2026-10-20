# SAM_ui audit 2026-10-19: critical and high fixes, tickets

Spec: [audit-fixes-2026-10-19-spec.md](audit-fixes-2026-10-19-spec.md) (Status: LOCKED, plan locked by Colin 2026-10-19).
Audit: `/home/col/ai-memory-vault/02 - Atwood Systems/00_SAM_Control/SAM_ui_Audit_2026-10-19.md`
and the slice reports in the folder of the same name (full file:line lists and measurements).

Read before any ticket:

- Model: every build runs on Opus or Sonnet, never Fable. Each ticket names its tier.
- Order: harness tickets first (T1 to T7), then SAM_ui (T8 to T16), then cleanup (T17) and release (T18).
  No ticket depends on a later one.
- Harness tickets edit live scripts under `~/.sam`, `~/.local/bin` or the seat `settings.json`
  files. Before editing, copy each file to `<file>.bak-20261019-audit`, and end the job output with
  a one-paste rollback (copy the `.bak` back). The closer reads its modules on each run, so there
  is nothing to restart. Harness tests live in `~/.sam/tests/` and run with `bash <test>`.
- Fails first: write the new test, run it on today's code and record the FAIL lines in the job
  output, then make the fix and record the PASS. A test that passes before the fix is wrong.
- SAM_ui tests: `npm test` (pretest compiles to `.test-build/`). One file:
  `npm test -- .test-build/src/<path>.test.js`.
- Deploy block (every SAM_ui ticket, as soon as its Proof passes):
  1. Commit the ticket's files on `claude/sam-core-dashboard-sf3639` (message `fix(audit): T<n> <title>`).
  2. Check node_modules is whole:
     `node -e "const p=require('./package.json'),fs=require('fs');const a={...p.dependencies,...p.devDependencies};const m=Object.keys(a).filter(n=>!fs.existsSync('node_modules/'+n));console.log(m.length?'MISSING: '+m.join(' '):'all present')"`.
     If it prints MISSING, run `npx npm@10 install` and check again (never `npm ci`).
  3. `./deploy.sh --list` to see what ships, then `./deploy.sh --reviewed $(git rev-parse --short HEAD)`.
     It must exit 0 and `/api/health` must report the new SHA. If `--list` shows commits that are
     not this ticket's or earlier tickets' (another session's work), stop and report; do not ship them.
- Must not break (audit protect rows): A-20, B-19, B-20, C-17, D-20 (see the spec's constraints).

## T1: Review the two staged closer fixes, install only if clean
Status: BLOCKED 2026-10-20: stage review found 1 issue (staged _block_at accepts 'BLOCKED: none' with no unblock text, and detect() runs it before the exit check, so a PASS job ending 'BLOCKED: none' becomes UNKNOWN: blocked and asks Colin; reproduced). Nothing installed; note in audit-fixes-2026-10-19-stage-review.md. unblock: Colin decides. Note: T2/T3 now edit the live files, so the .stage copies need re-cutting before any later install.
Model: Sonnet (a read and compare job; the install is a scripted copy with its own tests).
Spec: must-do 5, check 6
Depends on: none
Blocked by: none
Context: Job `job_closer-message-blocked-fix_20261018-235802` staged two closer fixes as
`.stage-20261019` files that were never installed. Colin's rule: review before any install,
install only on a clean review. This runs first because T2 and T3 edit the same two live files;
installing a stage file after them would overwrite their fix.
Files: `~/.sam/closer/closer_blocked.py.stage-20261019` (read), `~/.sam/closer/closer_message.py.stage-20261019` (read),
`~/.sam/closer/closer_blocked.py` and `~/.sam/closer/closer_message.py` (replaced only on a clean review),
`~/.sam/closer/INSTALL-20261019-message-blocked.txt` (read, it holds the install and rollback paste),
`/home/col/SAM_ui/implementation/audit-fixes-2026-10-19-stage-review.md` (new)
Steps:
1. Read `INSTALL-20261019-message-blocked.txt` in full. Diff each `.stage-20261019` file against its live file.
2. Confirm the live files have not changed since the stage was cut (compare against the stage job's
   own base, or check the diff only contains the staged change). If live has moved on, the review is not clean.
3. Review the diff for correctness: `_block_at` and the BLOCKED tail search in closer_blocked.py;
   `_kind`, `_job_name` and the non-PASS titles in closer_message.py. Check `needs_message` is untouched
   (T3 changes it). Look for a crash on a missing field, a regex that matches the template line, and any
   path that would message on a PASS.
4. Run `bash ~/.sam/tests/test-closer-t28-honest.sh` on the live files and record that it fails (fails first).
5. Write the review note: each diff, each finding, the verdict (clean or not).
6. Only if clean: run the INSTALL paste from the txt file exactly (it makes its own `.bak-20261019-message-blocked`
   copies and runs the tests). Record the output in the review note.
7. If not clean: install nothing, list the findings in the note, and end the job with `BLOCKED: stage review found <n> issues; unblock: Colin decides`.
Do not touch: `needs_message` (T3), `dispatch()` and `write_decision_brief()` in closer_blocked.py (T2), any `.next` file (T17).
Proof: `test -f /home/col/SAM_ui/implementation/audit-fixes-2026-10-19-stage-review.md` and the note contains
a verdict line. On a clean verdict: `bash ~/.sam/tests/test-closer-t28-honest.sh | tail -1` reads "39 passed, 0 failed",
and `bash ~/.sam/tests/test-closer-message.sh | tail -1` and `bash ~/.sam/tests/test-closer-blocked.sh | tail -1` report 0 failed.

## T2: Carry why, escalatedFrom and the folder override into every relaunch
Status: DONE 2026-10-20 (test-closer-relaunch-why.sh 4 passed/17 failed on originals, 21 passed/0 failed live; relaunch 77, blocked 120, dispatch 30, folder-guard 9, relaunch-cancel 9, plan-ceiling 9 all 0 failed; .bak-20261019-audit copies made)
Model: Sonnet (small, well-located change; the fail-first test pins it).
Spec: must-do 1, check 1
Depends on: T1
Blocked by: none
Context: Audit A-02 and A-05, the same fix as waiting item w_7cd6afda (its relaunch half only; the
merge-waiter half is A-19, out of scope). sam-dispatch writes a closer context with no `why` and no
folder override, so on 19 Oct all four relaunches were refused: "task type 'review' tops out at opus;
--tier fable needs --why". Siblings in one folder also cannot relaunch without the override.
Files: `~/.local/bin/sam-dispatch` (edit, the `CTX=$(jq -nc ...)` block near line 506),
`~/.sam/closer/closer-relaunch.sh` (edit, lines 28-30 and 75-78),
`~/.sam/closer/closer_blocked.py` (edit, `dispatch()` near line 306 and `write_decision_brief()` near line 438),
`~/.sam/tests/test-closer-relaunch-why.sh` (new)
Steps:
1. Write `test-closer-relaunch-why.sh`, using `~/.sam/tests/closer-fixtures.sh` like `test-closer-relaunch.sh` does.
   Fixture job: closerCtx `{tier: fable, task: review, why: "audit needs Fable", folderOverride: "parallel slices", escalatedFrom: "", ...}`,
   a closer.json with a relaunch unit, an ended meta, a matching fingerprint, and `SAM_DISPATCH_BIN` pointing at a stub
   that writes its argv one per line to a file and exits 0. Assert the argv has `--why` `audit needs Fable` and
   `--folder-override` `parallel slices`. Also call `closer_blocked.dispatch()` and build the `write_decision_brief()`
   command with the same ctx and assert the same two flags. Add a case with `escalatedFrom` set (a dir that exists in the
   temp store) and assert `--escalated-from`. Run it now: it must FAIL.
2. sam-dispatch: add `--arg why "$WHY" --arg folderOverride "$FOLDEROVR"` to the jq call and `why:$why,folderOverride:$folderOverride`
   to the object. Update the header comment listing the closer context keys.
3. closer-relaunch.sh: read `WHY`, `ESC` (`escalatedFrom`) and `FOVR` (`folderOverride`) with `cx`, and append
   `--why`, `--escalated-from`, `--folder-override` to `args` when each is non-empty. Update the header comment.
4. closer_blocked.py: in both arg loops add `("--why", "why"), ("--escalated-from", "escalatedFrom"), ("--folder-override", "folderOverride")`.
5. Run the new test (PASS), then `test-closer-relaunch.sh`, `test-closer-blocked.sh`, `test-closer-dispatch.sh`,
   `test-dispatch-folder-guard.sh`, `test-dispatch-relaunch-cancel.sh` and `test-dispatch-plan-ceiling.sh`: all pass.
Do not touch: the task-type ceiling check (no `--relaunch-of` exemption, spec Won't do), the seat guard (T4),
`needs_message` (T3), the "never a seat override" rule in closer-relaunch.sh.
Proof: `bash ~/.sam/tests/test-closer-relaunch-why.sh` FAILS before the edit and reports 0 failed after;
the six tests in step 5 report 0 failed.

## T3: One short message when a job dies on the seat limit
Status: DONE 2026-10-20 (test-closer-limit-death-message.sh 5 passed/8 failed on originals, 13 passed/0 failed live; quiet-pass PASS, message 32/0, relaunch 77/0, blocked 120/0; t28-honest 13 passed/26 failed before and after, unchanged: it needs T1's blocked stage install. Outside Files: test-closer-quiet-pass.sh overlay now skips a .next older than its live module, else it tested the old code)
Model: Sonnet (one predicate and one body line).
Spec: must-do 2, check 2
Depends on: T1 (same file), T2
Blocked by: none
Context: Audit A-04. `needs_message` returns False for verdictKind UNKNOWN with a relaunch booked, so on 19 Oct
all four slices closed quietly and Colin heard 2.5 hours later from the relaunch failures. A quiet PASS is right
(Colin, 2026-10-08); a quiet death is not.
Files: `~/.sam/closer/closer_message.py` (edit, `needs_message` near line 290 and the body builder),
`~/.sam/tests/test-closer-limit-death-message.sh` (new), `~/.sam/tests/test-closer-quiet-pass.sh` (edit, the case at line 26)
Steps:
1. Write the new test: run the real closer.py on a fixture job whose stdout.log ends "You've hit your session limit · resets 8:30pm (Europe/London)",
   exit 1, with a notify stub that logs each call (follow `test-closer-relaunch.sh`'s systemd-run record-mode stub so a relaunch is booked).
   Assert the stub is called exactly once and the body contains "seat limit" and "relaunch". Run it: it must FAIL (messageSkipped set, no call).
2. In `needs_message`, make UNKNOWN with a relaunch return True when the verdict is a seat-limit death
   (verdict starts "UNKNOWN: died on the seat limit").
3. Make that message one short line: "Died on the seat limit at HH:MM, relaunch booked for HH:MM." Times are local; the booked
   time is `record["relaunch"]["at"]`; the death time is the job's `endedAt`.
4. Update `test-closer-quiet-pass.sh` line 26 to expect True for UNKNOWN with a relaunch, keep the PASS case quiet.
5. Run the new test, `test-closer-quiet-pass.sh`, `test-closer-message.sh`, `test-closer-relaunch.sh`, `test-closer-t28-honest.sh`.
Do not touch: the PASS quiet rule, `question_message`, the relaunch planning in closer_relaunch.py.
Proof: `bash ~/.sam/tests/test-closer-limit-death-message.sh` FAILS before and reports 0 failed after;
the four other tests in step 5 report 0 failed.

## T4: Per-seat lock, running-job cap on main and a launch stagger in sam-dispatch
Status: DONE 2026-10-20 (test-dispatch-seat-lock.sh 1 passed/14 failed on pre-edit copy, 15 passed/0 failed live; seat-guard 9, seat-default 10, folder-guard 9, routing 23, relaunch-cancel 9, sigpipe 2, relaunch-why 21, plan-ceiling 9 all 0 failed; built main-only. Outside Files: test-dispatch-relaunch-cancel.sh --seat max2 -> main (max2 retired, it refused exit 1); test-closer-dispatch.sh still 11/19 on --seat max2 before and after, not touched)
Model: Opus (locked decision: A-03 is Opus; concurrency in bash with a lock held across a launch).
Spec: must-do 3, check 3
Depends on: T2
Blocked by: none
Context: Audit A-03. The seat guard (sam-dispatch:283-401) is a snapshot with no lock and no count of running jobs.
On 19 Oct four dispatches in 42 s all read main at 33 percent and took it to 104 percent in six minutes. Locked:
flock round read-and-launch per seat; main runs at most 2 Fable and at most 4 other sam-job units at once (chat turns
do not count); a stagger between launches; a stale or missing reading must no longer mean "allowed" without the count.
No max2-specific cap (max2 is cancelled 2026-10-20). sam-job writes meta.json with status "queued" before systemd-run
(sam-job:240-301), so a job is countable once sam-job returns.
Files: `~/.local/bin/sam-dispatch` (edit, seat guard section lines 283-401 and the launch near line 515),
`~/.sam/tests/test-dispatch-seat-lock.sh` (new)
Steps:
1. Write the new test against a temp `SAM_JOB_STORE`, `SAM_QUOTA_RUNS`, `SAM_DISPATCH_LOG`, a stub `SAM_JOB_BIN` that
   records its start time and writes a queued meta.json with a fake unit, and a stub `SAM_SYSTEMCTL_BIN`/is-active seam
   for counting (add the seam if the count uses systemctl). Cases a to e from spec check 3. Run it: it must FAIL.
2. After the seat is chosen, take `flock -w "${SAM_SEAT_LOCK_WAIT:-120}"` on `${SAM_LOCK_DIR:-$HOME/.sam/locks}/seat-$SEAT.lock`
   (mkdir the dir). On timeout exit 4 with "seat lock busy for $SEAT". Hold it until sam-job has returned, then release.
3. Inside the lock, re-read the quota rows (`QALL`) and run the existing percent guard, so the reading is fresh.
4. Inside the lock, count running work on the seat from the job store: dirs whose meta.json has a non-empty `unit`,
   status queued or running, unit active, and `closerCtx.seat` (fallback: cmd.sh points at `.claude-max2`) equal to the
   seat. Dirs with no unit are chat turns and are skipped. Split by meta `tier` == fable. For seat main only: refuse with
   exit 4 when the new job is Fable and Fable running >= `${SAM_MAIN_MAX_FABLE:-2}`, or not Fable and others running >=
   `${SAM_MAIN_MAX_OTHER:-4}`; the message names the running job ids. `--seat-override "reason"` lifts the cap and is
   logged like today's override. This count runs whether the reading is fresh, stale or missing.
5. Stagger: inside the lock, if `${SAM_LOCK_DIR}/seat-$SEAT.last` holds a launch time less than `${SAM_SEAT_STAGGER:-60}`
   seconds ago, sleep the remainder (never longer than the lock wait). After a successful launch write the time there.
6. Update the header comment (date, Colin's lock, the knobs, the test name). Make the "stale, allowed" message say the
   running-count check still ran.
7. Run the new test, then `test-dispatch-seat-guard.sh`, `test-dispatch-seat-default.sh`, `test-dispatch-folder-guard.sh`,
   `test-dispatch-routing.sh`, `test-dispatch-relaunch-cancel.sh`, `test-dispatch-sigpipe.sh`. All pass.
Do not touch: the default-seat choice logic (`seat_full`, `week_out`), max2 limits, the folder guard's own rules, the proof,
tickets and zero-count guards, the exit codes other than 4.
Proof: `bash ~/.sam/tests/test-dispatch-seat-lock.sh` FAILS before and reports 0 failed after; the six tests in step 7 report 0 failed.

## T5: A seat-limit relaunch refused by the running cap waits and retries
Status: DONE 2026-10-20 (test-closer-relaunch-cap-retry.sh 19 passed/16 failed on pre-edit copy, 35 passed/0 failed live; relaunch 77, relaunch-why 21, blocked 120, relaunch-cancel 9 all 0 failed; retries only exit 4 naming the cap or seat lock, inside the existing wait; a max2-recorded job relaunches --seat main. Outside Files: test-closer-relaunch.sh line 169 expects --seat main (max2 retired))
Model: Opus (part of A-03, locked as Opus).
Spec: must-do 3 (last point), check 4
Depends on: T4
Blocked by: none
Context: With T4, four dead siblings whose timers fire in the same second would get two launches and two exit 4s, and
closer-relaunch.sh stops on the first exit 4 ("the seat guard refused the dispatch") and notifies. The relaunch must
keep trying inside its existing wait window instead. Never with a seat override (header rule).
Files: `~/.sam/closer/closer-relaunch.sh` (edit, lines 79-82), `~/.sam/tests/test-closer-relaunch-cap-retry.sh` (new)
Steps:
1. Write the new test: a fixture as in `test-closer-relaunch.sh`, `SAM_CLOSER_RELAUNCH_POLL=1`, `SAM_CLOSER_RELAUNCH_WAIT=10`,
   a stub sam-dispatch that exits 4 on its first call and 0 on its second. Assert two calls, `relaunch-dispatched` written,
   no notify. Second case: always 4: the script stops with exit 4 after the wait and notifies once. Run it: it must FAIL.
2. Wrap the dispatch in a loop: on exit 4, if the wait deadline has not passed, sleep `$POLL` and dispatch again; otherwise
   stop as today. Keep `relaunch-dispatch.out` as the last attempt's output, appending a line per retry.
3. Update the header comment.
4. Run the new test, `test-closer-relaunch.sh` and `test-closer-relaunch-why.sh`.
Do not touch: the ended/busy wait, the fingerprint check, the never-a-seat-override rule.
Proof: `bash ~/.sam/tests/test-closer-relaunch-cap-retry.sh` FAILS before and reports 0 failed after; the two other tests report 0 failed.

## T6: Job history lasts 7 days: count cap for chat turns only
Status: DONE 2026-10-20 (sweepRetention.test.js not ok before, 1 pass/0 fail after; full npm test 811 pass/0 fail; commit 04dd3ad, deployed 440566f, deploy rc 0, /api/health gitSHA 440566f)
Model: Sonnet (one filter in one function, guarded by an existing protect rule and a new test).
Spec: must-do 7, check 8, check 18
Depends on: none (kept after T5 by Colin's order)
Blocked by: none
Context: Audit A-01/C-16 (critical). `JobManager.sweepDisk()` in `src/lib/server/jobs/manager.ts` (constants at lines 30-31,
cut near line 1387) deletes `ts < cutoff || index >= MAX_JOBS` over all dirs, so ~106 chat-turn dirs a day push dispatched
jobs out after about 22 hours. The closer's chain lookups and the fleet spend and jobs windows assume 7 days.
Protect row A-20: a running sam-job dir touched inside the window is never deleted.
Files: `src/lib/server/jobs/manager.ts` (edit, `sweepDisk`), `src/lib/server/jobs/sweepRetention.test.ts` (new,
follow `sweepBuilds.test.ts` for the temp HOME and dynamic import)
Steps:
1. Write the test: temp HOME, 130 chat-turn dirs (`job_<base36 now>_...`, meta with no `unit`) all newer than one ended
   sam-job dir `job_x_<YYYYMMDD-HHMMSS>` 2 days old (meta with a `unit`); one sam-job dir 8 days old; one running sam-job dir
   with old id but fresh mtime. Run the sweep. Assert spec check 8. Run it: it must FAIL (the 2-day dir is deleted).
2. In `sweepDisk`, tag each candidate as a sam-job dir (its meta.json has a non-empty `unit`, or a `cmd.sh` exists) or a
   chat turn. Apply `index >= MAX_JOBS` only over the chat-turn list (sorted newest first); apply the age cutoff to both.
   Keep the running-dir guards as they are.
3. Update the comments at the constants to say which rule applies to which kind.
4. Run the new test, `sweepBuilds.test.ts` and `streamOrphan.test.ts`, then the full `npm test`.
5. Deploy block.
Do not touch: `RETENTION_MS`, the waiting mirror skip, the running-dir guards, other sweeps.
Proof: `npm test -- .test-build/src/lib/server/jobs/sweepRetention.test.js` FAILS before and passes after; full `npm test`
passes; deploy exits 0 and `/api/health` shows the new SHA.

## T7: Keep chat transcripts: cleanupPeriodDays on both seats
Status: DONE 2026-10-20 (test-seat-transcript-retention.sh 0 passed/2 failed before, 2 passed/0 failed after; test-seat-permission-mode.sh passes; both seats only gain cleanupPeriodDays 3650 vs .bak-20261019-audit; 2-day check: SAM re-runs find ~/.claude/projects/-home-col-claude -name '*.jsonl' -mtime +31 | wc -l on or after 2026-10-21, expects above 0)
Model: Sonnet (one key in two JSON files).
Spec: must-do 4, check 5
Depends on: none (kept after T6 by Colin's order)
Blocked by: none
Context: Audit B-02. SAM_ui keeps no copy of chat text; the CLI deletes transcripts after 30 days and neither seat sets
`cleanupPeriodDays`. 85 of 294 chats are already empty. max2 is cancelled on 2026-10-20 but setting it there too is harmless.
Files: `~/.claude/settings.json` (edit), `~/.claude-max2/settings.json` (edit), `~/.sam/tests/test-seat-transcript-retention.sh` (new,
same shape as `test-seat-permission-mode.sh`)
Steps:
1. Write the test: for each seat file, PASS when `cleanupPeriodDays` is 3650, FAIL otherwise; exit non-zero on any FAIL. Run it: FAIL.
2. Back up both files, then add `"cleanupPeriodDays": 3650` at the top level with a JSON-safe edit (python json load and dump,
   keeping key order and indent 2). Read only that key back; do not print or change any other key.
3. Run the new test and `test-seat-permission-mode.sh`.
4. Book the 2-day check: add a line to the job output saying SAM re-runs
   `find ~/.claude/projects/-home-col-claude -name '*.jsonl' -mtime +31 | wc -l` on or after 2026-10-21 and expects above 0.
Do not touch: any other settings key, hooks, permissions, model settings.
Proof: `bash ~/.sam/tests/test-seat-transcript-retention.sh` FAILS before and passes after; `test-seat-permission-mode.sh` passes.

## T8: Mark chats whose history has expired
Status: IN PROGRESS job_samui-audit-fixes-build_20261020-191109
Model: Sonnet (a computed flag and one label).
Spec: must-do 8, check 9, check 18
Depends on: T7
Blocked by: none
Context: Audit B-02, SAM_ui half. Chats whose transcript the CLI deleted still list and open to an empty page.
`transcriptPath(id)` in `src/lib/server/chat/transcripts.ts:51` already returns null when the file is on neither seat;
`listChatSummaries` in `src/lib/server/chat/chatActions.ts:86` maps records to summaries.
Files: `src/types/chat.ts` (edit, the summary type), `src/lib/server/chat/chatActions.ts` (edit, `toSummary`),
`src/app/(app)/chat/page.tsx` (edit, the chat list row), `src/lib/server/chat/expiredHistory.test.ts` (new)
Steps:
1. Write the test with a temp HOME (see `transcripts.test.ts` for the pattern): one chat with a transcript file, one without.
   Assert `historyExpired` true and false. Run it: it must FAIL.
2. Add `historyExpired: boolean` to the summary, computed in `toSummary` from `transcriptPath(id) === null` for chats that
   have had at least one turn (a brand-new chat with no turn yet is not expired).
3. In the chat list, show "history expired" (dim, small) on those rows. Opening one shows a one-line notice instead of an empty thread.
4. Full `npm test`, then the deploy block.
5. Ask Colin to confirm on his phone that an old September chat shows "history expired".
Do not touch: the import registry, adopt and restore flows, deleteChat.
Proof: `npm test -- .test-build/src/lib/server/chat/expiredHistory.test.js` FAILS before and passes after; full `npm test` passes;
deploy exits 0; Colin confirms the label on his phone.

## T9: Store each chat's context size and show a banner at 200k
Status: TODO
Model: Opus (locked decision: B-01/B-03 is Opus).
Spec: must-do 9, check 10, check 18
Depends on: T8
Blocked by: none
Context: Audit B-01/B-03 (critical). A chat is one CLI session resumed for ever: median turn starts at 249k tokens, max 966k.
Locked: banner at 200k. Only Max and Max 2 chats (spec Won't do). The stream's usage fields are already parsed in
`src/lib/agentStream.ts` near line 204 (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
Exit hooks are registered on `onTurnExit` in `src/lib/server/chat/startTurn.ts` (the usage hook must stay the last one).
Files: `src/lib/contextCeiling.ts` (new: `CONTEXT_BANNER_TOKENS = 200_000`, `CONTEXT_HANDOFF_TOKENS = 400_000`, and
`contextOf(usage)` = input + cache read + cache creation of the last model call), `src/types/chat.ts` (edit: `contextTokens?`,
`contextAt?` on ChatRecord), `src/lib/server/chat/startTurn.ts` (edit: one exit hook, registered before the usage hook) and
`src/lib/server/chat/chatStore.ts` (edit: a setter), `src/app/(app)/chat/page.tsx` (edit: the banner),
`src/lib/server/chat/contextCeiling.test.ts` (new)
Steps:
1. Write the test: feed a fake finished turn (a job record whose output has stream-json assistant messages with usage) to the
   hook; assert the stored `contextTokens` is the last call's sum (150k: stored, banner false; 210k: stored, banner true).
   Run it: FAIL.
2. Add `contextCeiling.ts` and the hook. Read the turn's output the way the manager stores it; take the LAST assistant
   message's usage. Skip non-Max tiers and internal turns. Write through a chatStore setter (atomic, like the others).
3. Expose `contextTokens` on the chat info the page already reads (the same place `handedOffTo` comes from, page.tsx near
   lines 570 and 1051).
4. Banner: when `contextTokens >= CONTEXT_BANNER_TOKENS` and the chat is not handed off, show above the composer:
   "Context is <N>k tokens. Hand off now" with a button that opens the existing handoff picker (`setHandoffPickerOpen(true)`).
   It must fit a 390 px screen with no sideways scroll.
5. Full `npm test`, then the deploy block. Check the banner on a chat over 200k at 390 px (SAM's browser or Colin's phone).
Do not touch: `startHandoff` and `continueHandoff` (T10), the usage hook's position as the last exit hook, the per-message
token chip at page.tsx:2227.
Proof: `npm test -- .test-build/src/lib/server/chat/contextCeiling.test.js` FAILS before and passes after; full `npm test` passes;
deploy exits 0; the banner shows on a chat over 200k at 390 px and the button opens the picker.

## T10: Hand off by itself at 400k, at the start of the next turn
Status: TODO
Model: Opus (locked decision: B-01/B-03 is Opus; it changes the turn flow).
Spec: must-do 10, check 11, check 18
Depends on: T9
Blocked by: none
Context: Locked: at 400k SAM_ui starts the existing handoff by itself at the start of the next turn, never mid-reply.
The message Colin just sent is carried into the new chat (spec, derived decisions). `startHandoff(chatId, tier, device)` in
`src/lib/server/chat/handoff.ts:147` runs a memo turn; `continueHandoff` (line 202) starts the child with
"Continue from the handoff memo at ...". The agent route (`src/app/api/chat/agent/route.ts`) is auth, step-up, then `startTurn`.
Files: `src/lib/server/chat/startTurn.ts` (edit: the check at turn start), `src/lib/server/chat/handoff.ts` (edit: carry the
message in `PendingHandoff`, append it in `continueHandoff`), `src/app/api/chat/agent/route.ts` (edit: return the handoff
result), `src/app/(app)/chat/page.tsx` (edit: follow an automatic handoff like a manual one), `src/lib/server/chat/autoHandoff.test.ts` (new)
Steps:
1. Write the test with the fake CLI (`src/lib/server/testing/fakeClaude.ts`, see `handoff.test.ts`): a Max chat with stored
   `contextTokens` 410k; a startTurn with message "next thing" starts a memo turn (not a normal turn) and the pending handoff
   holds "next thing"; when the memo turn exits with a memo file, the child's first prompt contains "next thing". A 390k chat
   runs a normal turn. An internal turn never triggers it. Run it: FAIL.
2. At the top of `startTurn`, for an existing non-internal Max or Max 2 chat with `contextTokens >= CONTEXT_HANDOFF_TOKENS`,
   not handed off and with no handoff pending, call `startHandoff(chatId, chat.tier, device)` with the carried message and
   attachments, and return its result marked `autoHandoff: true` with the memo job id. Never act while a turn is running
   (startHandoff already refuses a locked chat).
3. In `continueHandoff`, append to the child's first prompt: "Colin's message, sent just before the handoff: <message>",
   with the attachments passed through.
4. The route returns the auto-handoff result in the same envelope; the page sets `handoffWaitingFor` and follows the memo job
   exactly as after the picker, then opens `handedOffTo`. Show "Context passed 400k, handing off" while it runs.
5. Full `npm test` (including `handoff.test.ts` and `startTurn.test.ts`), then the deploy block.
6. Book the one-week check in the job output: on or after 2026-10-27 run
   `python3 ~/.sam/work/samui-audit-2026-10-19/tmp-B/turns.py` and expect no chat above 450k at turn start.
Do not touch: the manual handoff route and picker, the memo prompt, side messages, non-Max tiers.
Proof: `npm test -- .test-build/src/lib/server/chat/autoHandoff.test.js` FAILS before and passes after; full `npm test` passes;
deploy exits 0.

## T11: Atomic, mtime-checked writes to Active Priorities and Named Operations
Status: TODO
Model: Sonnet (a small helper and three call sites; the test pins the race).
Spec: must-do 11, check 12, check 18
Depends on: T10
Blocked by: none
Context: Audit C-02. `setTaskDone` in `src/lib/server/taskMetrics.ts:101-127` and `setOperationVariables` and `recordRun` in
`src/lib/server/operations.ts` (near lines 265 and 324) read, edit and `writeFileSync` with no temp file, no lock and no mtime
check, and swallow every error. Active Priorities has four writers (these routes, Obsidian, Claude sessions, closer_vault.py,
which already does temp plus rename and a drift check at closer_vault.py:277-295). Protect row C-17: copy the store.ts pattern
(temp, fsync, rename; see `src/lib/server/auth/store.ts` near line 111).
Files: `src/lib/server/vaultWrite.ts` (new: `editVaultFile(path, edit, opts)` reads text and mtime, applies `edit(text)`, writes
a temp file in the same folder, fsyncs, re-checks mtime, renames; on mismatch redoes the edit once on the fresh text; logs a
`[vault-write]` warning on a retry, a second mismatch or an error; an optional `beforeWrite` test hook),
`src/lib/server/taskMetrics.ts` (edit), `src/lib/server/operations.ts` (edit), `src/lib/server/vaultWrite.test.ts` (new)
Steps:
1. Write the test against temp copies of both notes: a `beforeWrite` hook appends a line once; assert both edits survive, one
   warning is logged, no `.tmp` file is left. Before the fix (calling today's functions with the file swapped mid-way) the appended
   line is lost. Run it: FAIL.
2. Add the helper. Move the three call sites onto it, keeping their edit logic unchanged. Replace the silent catches with a
   logged warning; the API responses stay as today.
3. Full `npm test`, then the deploy block.
Do not touch: closer_vault.py, the vault real-path gate (C-17), the parsing of either note.
Proof: `npm test -- .test-build/src/lib/server/vaultWrite.test.js` FAILS before and passes after; full `npm test` passes; deploy exits 0.

## T12: Unmount the background animation under a fleet view
Status: TODO
Model: Sonnet (a mount gate; no rendering logic changes).
Spec: must-do 12, check 13, check 18
Depends on: T11
Blocked by: none
Context: Audit D-01. `AppShell` mounts `<SamBackground />` for every route (`src/components/shell/AppShell.tsx` near line 61).
The fleet views paint opaque over it (`FleetPhoneView.tsx:83` background #030a07; `FleetDashboardShell.tsx:105` 86 to 94 percent
opaque), so a full-screen Three.js loop runs that nobody can see.
Files: `src/components/shell/ambientGate.ts` (new: a tiny store, `registerFleetView()` returns an unregister, plus a
`useFleetViewMounted()` hook via useSyncExternalStore), `src/components/shell/AppShell.tsx` (edit: `{!booting && !fleetUp && <SamBackground />}`),
`src/components/dashboard/fleet/FleetPhoneView.tsx` and `src/components/dashboard/fleet/FleetDashboardShell.tsx` (edit: register on
mount, unregister on unmount), `src/components/shell/ambientGate.test.ts` (new)
Steps:
1. Write the test: the store reports false, true after one register, still true with two, false after both unregister; a small
   gate component rendered with `renderToStaticMarkup` (see `jobTicketPanel.render.test.ts`) omits the background while registered.
   Run it: FAIL (no module).
2. Add the store and wire the three files.
3. Full `npm test`, then the deploy block.
4. Browser check on the live `/` at desktop and 390 px: the vault-graph-visualiser canvas is absent while the fleet view shows,
   and present on `/chat`. Record it in the job output.
Do not touch: SamBackground and VaultGraphVisualiser internals, BootSequence, the demand frameloop when hidden (D-20).
Proof: `npm test -- .test-build/src/components/shell/ambientGate.test.js` FAILS before and passes after; full `npm test` passes;
deploy exits 0; the browser check shows no canvas under the fleet view.

## T13: Throttle the floor canvas when nothing moves
Status: TODO
Model: Sonnet (a pure pacing rule plus one call in the loop).
Spec: must-do 13 (frame rate), check 14, check 18
Depends on: T12
Blocked by: none
Context: Audit D-02 (citation corrected in the merge). The floor loop (`startLoop` in `src/components/floor/FloorCanvas.tsx`
near line 918) calls `draw` on every animation frame, rebuilding the whole scene. At rest the only motion is the core bob,
the ring hand and the figure glow. Protect row D-20: backdrop cache, overlay diffing and the demand frameloop when hidden stay.
Files: `src/components/floor/floorPacing.ts` (new: `frameDue(now, lastDraw, busy)` true always when busy, else at most every
100 ms; `isBusy(state)` true while an effect, zoom (`view.t0` within 950 ms), pulse, idle flip ramp or flare is in flight),
`src/components/floor/FloorCanvas.tsx` (edit: `tick` skips `draw` when not due), `src/components/floor/floorPacing.test.ts` (new)
Steps:
1. Write the test: 60 frames 16.7 ms apart, not busy: at most 12 draws; busy: 60. Run it: FAIL (no module).
2. Add the module; in `tick`, keep requesting frames but only `draw` when `frameDue`. Reduced motion is unchanged.
3. Full `npm test` (floorGolden, figureHit, floorRender, ringRender stay green), then the deploy block.
4. Optional dev check: a draw counter shows about 10 a second on an idle floor.
Do not touch: `buildScene`, `paint`, the ring code (T14), the overlay diffing.
Proof: `npm test -- .test-build/src/components/floor/floorPacing.test.js` FAILS before and passes after; full `npm test` passes; deploy exits 0.

## T14: Compute the clock ring's outer marks once per change
Status: TODO
Model: Sonnet (memoising one pure function).
Spec: must-do 13 (ring), check 14, check 18
Depends on: T13
Blocked by: none
Context: Audit D-02. `buildRing` (`src/components/floor/ringRender.ts:426`) calls `spreadOuter` (line 329, iterative placement
over the 67 live timers, O(n squared)) every frame (line 447), although jobs and geometry change only per schedule poll.
Files: `src/components/floor/ringRender.ts` (edit: cache the `spreadOuter` result keyed by the outer items' shapes and angles,
the geometry and the gap), `src/components/floor/ringRender.test.ts` (edit: new case)
Steps:
1. Add a test case: a counting seam on `spreadOuter` (an exported counter or an injected function); call `buildRing` 1,800 times
   with the same jobs and geometry: before, 1,800 calls; after, 1. Change the jobs: one more call. Run it: FAIL.
2. Add the cache (one entry is enough). Angles that change per frame (the hand) must not be part of the key; the outer marks'
   day angles change only when a job's time moves past a minute, so key on the rounded inputs `spreadOuter` actually uses.
3. Full `npm test`, then the deploy block.
Do not touch: the ring's look, `smooth` easing in FloorCanvas, the ring golden tests' expectations.
Proof: `npm test -- .test-build/src/components/floor/ringRender.test.js` FAILS on the new case before and passes after; full `npm test` passes; deploy exits 0.

## T15: Bound the nightly vault graph build
Status: TODO
Model: Sonnet (a contained Python change with a size test).
Spec: must-do 14, check 15, check 18
Depends on: T14
Blocked by: none
Context: Audit C-01. `scripts/build_vault_graph.py` runs `SOLVE_STEPS = 220` passes over every pair of notes (loop near line 207):
10 min 23 s CPU nightly at 2,930 notes, about 17 hours at 10x. The timer runs the repo copy directly
(`scripts/sam-vault-graph.service`: ExecStart python3 /home/col/SAM_ui/scripts/build_vault_graph.py).
Files: `scripts/build_vault_graph.py` (edit), `src/lib/server/vaultGraphBuild.test.ts` (new),
`src/app/api/vault/graph/route.ts` (read; edit only if gzip is missing)
Steps:
1. Write the test: generate a temp vault of 900 notes with random wikilinks, run
   `python3 scripts/build_vault_graph.py --vault <tmp> --out <tmp>/g.json --stats`; assert one node per note and the stats
   line reports at most 400 force-pass nodes. Run it: FAIL (no `--stats`, or 900 in the pass).
2. Add `--stats` (prints `force_nodes=<n> total=<n>` to stderr). Pick the top 400 notes by degree (`FORCE_TOP = 400`) for the
   force pass; place the rest on their ring by golden angle with no pair forces. Keep the output shape.
3. Time it on the live vault: `time python3 scripts/build_vault_graph.py --out /tmp/g.json` under 60 s; node count equals the
   note count. Record both.
4. Check gzip: `curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' -b <session cookie> http://127.0.0.1:3000/api/vault/graph`.
   If `Content-Encoding: gzip` is already there (Next compresses by default), record it and change nothing. If not, gzip in the route.
5. Full `npm test`, then the deploy block. The next nightly run uses the new script.
Do not touch: the committed snapshot, VaultGraphVisualiser, the timer schedule.
Proof: `npm test -- .test-build/src/lib/server/vaultGraphBuild.test.js` FAILS before and passes after; the live run is under 60 s
with all notes present; the curl shows gzip; deploy exits 0.

## T16: Tests use the live helper scripts unless SAM_TEST_STAGED=1
Status: TODO
Model: Sonnet (the same helper in six test files).
Spec: must-do 6 (tests), check 7
Depends on: T15
Blocked by: none
Context: Audit A-06. Six SAM_ui tests prefer a staged `.next` copy when one exists (`stagedOrLive`), so `npm test` exercises a
sam-dispatch from 2026-10-09 that lacks the zero-count guard and the max2-first default. They must default to the live script.
This comes before T17 deletes the copies.
Files: `src/lib/server/testing/stagedOrLive.ts` (new: `stagedOrLive(staged, live)` returns live unless
`process.env.SAM_TEST_STAGED === '1'` and the staged file exists), `src/lib/server/testing/stagedOrLive.test.ts` (new), and
edit to import the helper: `src/lib/server/fleet/samDispatchBrief.test.ts` (line 43-49), `src/lib/server/fleet/samDispatchStageInstruction.test.ts`
(line 54-60), `src/lib/server/usage/fleetUsage.test.ts` (line 22-31), `src/lib/server/fleet/samDispatchTier.test.ts` (lines 61-66),
`src/lib/server/fleet/samStage.test.ts` (line 60), `src/lib/server/fleet/samJobEvents.test.ts` (line 67). Also `usageCollect.test.ts`
and `quotaLog.test.ts`, which carry the same local helper for `sam-quota-log.next.py`.
Steps:
1. Write `stagedOrLive.test.ts` with a temp staged file: unset env returns live; `SAM_TEST_STAGED=1` returns staged; staged missing
   returns live. Before: the local helpers return staged whenever it exists. Run it: FAIL (no module).
2. Replace each local helper with the import. Keep each test's own env override variable if it has one.
3. Full `npm test` with the `.next` files still present: passes on the live scripts. Then the deploy block (tests only, but the
   rule is every SAM_ui ticket deploys).
Do not touch: what the six tests assert, the live scripts, any `.next` file (T17 deletes them).
Proof: `npm test -- .test-build/src/lib/server/testing/stagedOrLive.test.js` FAILS before and passes after; full `npm test` passes; deploy exits 0.

## T17: Delete the stale staged copies of sam-dispatch, sam-job and run.sh
Status: TODO
Model: Sonnet (a search, then deletes, with a recorded list).
Spec: must-do 6 (delete), check 7
Depends on: T16
Blocked by: none
Context: Audit A-06. `~/.local/bin/sam-dispatch.next` (2026-10-09), `~/.local/bin/sam-job.next` (2026-10-07) and
`~/.sam/sam-job/run.sh.next` outlived their install; the closer MANIFEST still lists them. Colin's rule: delete only after
confirming no live path or test reads them. T16 moved the tests off them.
Files: `~/.local/bin/sam-dispatch.next`, `~/.local/bin/sam-job.next`, `~/.sam/sam-job/run.sh.next` and the `.bak*` copies of
sam-dispatch and sam-job in `~/.local/bin` (delete), `~/.sam/closer/MANIFEST` (edit: drop the three `.next` lines),
`~/.sam/tests/test-no-stale-staged.sh` (new)
Steps:
1. Write the test: FAIL if any of the three `.next` files exist, or if `grep -rIl` over `~/.sam` (excluding `jobs/`, `work/`, logs),
   `~/.local/bin`, `~/.claude/hooks`, `~/.config/systemd/user` and `/home/col/SAM_ui/src` finds a reference to
   `sam-dispatch.next`, `sam-job.next` or `run.sh.next` outside comments in files that are themselves `.bak`/`.next`.
   Run it: FAIL.
2. Run that same search by hand and list every hit in the job output. If any hit is a live reader (a script, hook, unit or
   test that would run it), stop: `BLOCKED: live reader <path>; unblock: SAM fixes the reader first`.
3. Move the files to `~/.sam/trash/20261019-stale-staged/` (not `rm`, so the rollback is one `mv`), including the sam-dispatch
   and sam-job `.bak*` copies. Drop the three lines from MANIFEST (back it up first).
4. Run the new test, `test-closer-all.sh` (its `.next` checks may change: record before and after counts), the dispatch tests,
   and `npm test` in SAM_ui.
Do not touch: the closer's own `.next`/`.bak` files (not in scope of this ticket), `.stage` files, sam-quota-log copies.
Proof: `bash ~/.sam/tests/test-no-stale-staged.sh` FAILS before and passes after;
`ls ~/.local/bin/sam-dispatch.next ~/.local/bin/sam-job.next ~/.sam/sam-job/run.sh.next 2>/dev/null` prints nothing;
`npm test` in SAM_ui passes.

## T18: Bring main up to date with the dashboard branch and push
Status: TODO
Model: Sonnet (a fast-forward and a push; Colin approved the push on 2026-10-19).
Spec: must-do 16, check 17, check 16
Depends on: T1 to T17 all DONE (any BLOCKED ticket: stop and ask Colin before pushing)
Blocked by: none
Context: Production runs from `claude/sam-core-dashboard-sf3639`, 141+ commits ahead of `main`, which has not moved since
2026-09-20 (audit, "Regressed"). `main` is an ancestor of the branch, so a fast-forward is possible.
Files: none (git only)
Steps:
1. `git fetch origin`. Confirm `git merge-base --is-ancestor main claude/sam-core-dashboard-sf3639` and that `origin/main`
   equals local `main`. If either fails, stop and report; never force.
2. Confirm the working tree is clean and `npm test` passes on the branch head.
3. `git checkout main && git merge --ff-only claude/sam-core-dashboard-sf3639 && git push origin main`, then check out the
   branch again.
4. Push the branch too: `git push origin claude/sam-core-dashboard-sf3639`.
Do not touch: tags, other branches, the default-branch setting, history (no rebase, no force).
Proof: `git rev-parse main` equals `git rev-parse claude/sam-core-dashboard-sf3639` equals `git rev-parse origin/main`.

## Coverage

| Spec check | Ticket |
|---|---|
| 1 | T2 |
| 2 | T3 |
| 3 | T4 |
| 4 | T5 |
| 5 | T7 |
| 6 | T1 |
| 7 | T16, T17 |
| 8 | T6 |
| 9 | T8 |
| 10 | T9 |
| 11 | T10 |
| 12 | T11 |
| 13 | T12 |
| 14 | T13, T14 |
| 15 | T15 |
| 16 | this table, every ticket's Proof |
| 17 | T18 |
| 18 | T6, T8, T9, T10, T11, T12, T13, T14, T15, T16 (deploy block) |

| Must-do | Ticket |
|---|---|
| 1 | T2 |
| 2 | T3 |
| 3 | T4, T5 |
| 4 | T7 |
| 5 | T1 |
| 6 | T16, T17 |
| 7 | T6 |
| 8 | T8 |
| 9 | T9 |
| 10 | T10 |
| 11 | T11 |
| 12 | T12 |
| 13 | T13, T14 |
| 14 | T15 |
| 15 | every ticket |
| 16 | T18 |
