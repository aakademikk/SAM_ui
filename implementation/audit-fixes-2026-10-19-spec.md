# SAM_ui audit 2026-10-19: critical and high fixes

Status: LOCKED (plan locked by Colin 2026-10-19 after grill; spec written from the locked decisions below)

Source: `/home/col/ai-memory-vault/02 - Atwood Systems/00_SAM_Control/SAM_ui_Audit_2026-10-19.md`
and its slice reports A to D in the folder of the same name.
Tickets: `implementation/audit-fixes-2026-10-19-tickets.md`.

## Goal

Stop the two things that broke on 19 October: seats running out with no working recovery,
and history quietly disappearing (job dirs after 22 hours, chat transcripts after 30 days).
Then fix the three high costs left in scope: unsafe vault writes, the background animation
nobody can see, the floor redrawing at full rate when idle, and the nightly graph build.

In scope, only these audit rows:
A-01/C-16, B-01/B-03, B-02, A-02/A-05, A-03, A-04, A-06, C-02, C-01, D-01, D-02.

## Must do

Harness (the job scripts under `~/.sam`, `~/.local/bin` and the seat settings files):

1. A relaunch keeps its routing reasons (A-02, A-05). When a job is dispatched with `--why`,
   `--escalated-from` or `--folder-override`, those three values are stored in the job's
   closer context. Every relaunch path (the seat-limit timer, the blocked-job unblock, the
   decision-job relaunch) passes them back to sam-dispatch. A Fable job that dies on the seat
   limit is relaunched, not refused with "tops out at opus". Sibling jobs in one folder that
   were dispatched with a folder override can all relaunch.
2. A limit death says so (A-04). A job that dies on the seat limit with a relaunch booked sends
   Colin one short message: it died on the seat limit at a time, and the relaunch is booked for
   a time. A clean PASS stays quiet, as today.
3. The seat guard is race-free and counts running jobs (A-03).
   - Choosing a seat, reading the quota and launching happen inside one per-seat lock,
     so two dispatches at the same second cannot both read "33 percent" and both launch.
   - On the main seat, at most 2 Fable jobs and at most 4 other jobs run at once.
     Only dispatched sam-job units count. Chat turns do not count.
   - A dispatch over the cap is refused with exit 4 and names the running jobs.
   - Launches on one seat are spaced by a stagger (a minimum gap between launches).
   - A stale or missing quota reading no longer means "allowed" on its own:
     the running-count check always runs.
   - A seat-limit relaunch refused only by the running cap waits and tries again inside its
     existing wait window, instead of giving up at once.
4. Chat transcripts are kept (B-02). Both seats' `settings.json` set `cleanupPeriodDays` to 3650,
   so the CLI stops deleting transcripts after 30 days.
5. Staged closer fixes are reviewed before they go live (A-06, part 1). The two files
   `closer_blocked.py.stage-20261019` and `closer_message.py.stage-20261019` are reviewed first.
   They are installed only if the review is clean. If not, they stay staged and the findings
   are written down.
6. Stale staged copies are retired (A-06, part 2). The six SAM_ui tests that prefer a `.next`
   copy use the live script unless `SAM_TEST_STAGED=1` is set. Only after that, and after a
   search proves no live path or test reads them, the stale `.next` and `.bak` copies of
   sam-dispatch, sam-job and run.sh are deleted.

SAM_ui (this repo, each deployed through `./deploy.sh` once it passes):

7. Job history lasts 7 days (A-01, C-16). The hourly disk sweep applies the newest-128 count cap
   to chat-turn directories only. Dispatched sam-job directories are kept for 7 days by age alone.
   The rule that a running sam-job directory is never deleted stays.
8. Chats whose transcript is gone are marked (B-02). A chat with no transcript on either seat
   shows "history expired" in the chat list instead of opening to an empty page.
9. The chat shows how full its context is (B-01, B-03). After each Max or Max 2 turn the server
   stores that turn's context size (input plus cache tokens of its last model call) on the chat.
   At 200,000 tokens or more the chat page shows a banner: the context size and a "Hand off now"
   button that opens the existing handoff picker.
10. A chat at 400,000 tokens hands off by itself (B-01, B-03). When Colin sends a message to a
    Max or Max 2 chat whose stored context is 400,000 tokens or more, SAM_ui does not run that
    message on the old chat. It starts the existing handoff (`startHandoff` in
    `src/lib/server/chat/handoff.ts`) on the chat's own tier, at the start of that turn, never
    in the middle of a reply. The message Colin sent (and its attachments) is carried into the
    new chat's first turn, so nothing he typed is lost. The chat page follows it exactly like
    a handoff Colin started by hand.
11. Vault writes from the dashboard are safe (C-02). Ticking a priority and editing or logging a
    Named Operation write a temp file and rename it into place. Before the rename the file's
    modification time is compared with the one read. On a mismatch the edit is redone once on
    the fresh file. A second mismatch or any write error is logged as a warning, never swallowed.
12. The background animation stops under a fleet view (D-01). While the fleet view (phone or
    desktop) is on screen, the Three.js background is not mounted. It comes back on other pages.
13. The floor rests when nothing moves (D-02). With no effect, zoom or pulse in flight, the floor
    canvas draws at most about 10 frames a second. The clock ring's outer-mark placement
    (`spreadOuter`) is computed once per change of jobs or geometry, not every frame.
14. The nightly vault graph build scales (C-01). The force pass runs only on the top 400 notes by
    link count. The rest are placed on their ring by golden angle with no pair forces. Every
    note is still in the output. The graph route answers gzip when the client accepts it.

Release:

15. Every ticket ships with a check that fails before and passes after, in a named test file.
16. When all fix tickets pass, `main` is brought up to date with `claude/sam-core-dashboard-sf3639`
    and pushed to origin (Colin approved the push).

## Won't do

- Any audit row not listed in the Goal (medium and low rows, C-03 to C-07, D-03 onwards,
  B-04 onwards, A-07 onwards).
- Any max2-specific cap or guard work: max2 is being cancelled on 2026-10-20.
  The lock and stagger apply per seat, but the running cap is for main only.
- Counting chat turns toward the running cap.
- `--autocompact` or any change to the CLI's own compaction.
- The context banner and auto handoff on the Gemini, DeepSeek (Pro/Fast) tiers, and in the
  dashboard chat widget. They do not use the seat windows. The chat page only.
- Copying finished transcripts into `~/.sam/chats/` (the audit's longer-term B-02 idea).
- Exempting `--relaunch-of` from the task-type ceiling. Carrying `--why` is the locked fix.
  Jobs dispatched before the fix have no stored why; they relaunch as today.
- The "merge waiters need a PASS" half of waiting item w_7cd6afda. That is A-19, out of scope.
  Only its relaunch half is fixed here.
- Rolling `runs.jsonl` monthly (the C-16 low row). Only the job-dir retention part of C-16.
- Staggering the closer's relaunch timer fire times. The dispatch-side lock and stagger serialise them.
- Builds on Fable. Every ticket runs on Opus or Sonnet.

## Constraints and locked decisions

Locked by Colin on 2026-10-19 after the grill (source: the brief for this spec job,
`~/.sam/briefs/` for job samui-audit-fixes-spec; the audit note above):

1. Builds run on Opus or Sonnet, never Fable. Opus for A-03 and B-01/B-03. Sonnet for the rest
   unless a ticket's risk says otherwise, with the reason given.
2. B-01/B-03: banner at 200k context tokens; at 400k SAM_ui starts the existing handoff by itself,
   at the start of the next turn, never mid-reply.
3. A-03: per-seat flock round read-and-launch in sam-dispatch; on main at most 2 Fable and at most
   4 other jobs at once (dispatched sam-job units only); a stagger between launches; a stale or
   missing reading no longer means "allowed" without the running-count check. No max2 cap work.
4. A-02/A-05: carry why, escalatedFrom and the folder override in closerCtx and pass them on
   relaunch (same fix as waiting item w_7cd6afda). A test fails on today's closer-relaunch.sh
   (fixture: closerCtx tier fable with a why, stub sam-dispatch recording argv).
5. Deploy: each SAM_ui ticket deploys through `./deploy.sh --reviewed <HEAD short sha>` as soon as
   it passes, after `npx npm@10 install` if node_modules is short (the check one-liner is in
   `[[SAM_ui_Dashboard]]`). One final ticket brings main up to date and pushes to origin.
6. A-06: review the two staged `.stage` closer fixes before any install; install only on a clean
   review. Delete stale `.next`/`.bak` copies of sam-dispatch and sam-job only after confirming no
   live path or test reads them; fix the six tests that prefer them first.
7. Every ticket has a fails-before, passes-after check naming its test file (CLAUDE.md: no change
   without enforcement). The audit's "Fails before, passes after" list is the starting point.
8. Harness tickets and SAM_ui tickets are separate. Harness fixes come first, in the order
   A-02/A-05, A-04, A-03, A-01, B-02.

Derived from these (not new decisions):

- The A-06 review of the two `.stage` files comes before A-02/A-05 and A-04. Both of those edit
  `closer_blocked.py` and `closer_message.py`, and installing a stage file after them would
  overwrite their fix. Reviewing first keeps decision 6 ("review before any install") and
  decision 8 (harness first) both true.
- A-01's fix lives in SAM_ui (`src/lib/server/jobs/manager.ts`), so its ticket is a SAM_ui ticket
  and deploys, but it keeps its place in the decision 8 order, after A-03 and before B-02.
- At 400k, the message Colin sent is carried into the new chat (must-do 10). Running it on the
  old chat first would put the handoff after the turn, not at its start, and dropping it would
  lose what he typed.

Must not break (audit protect rows): A-20 (ended-before-exitcode order, never-silent closer wrapper,
the sweep sparing running dirs), B-19 (stream-json result detection and the 300 ms stdin close),
B-20 (secret-read and chat-background guards), C-17 (atomic store writes, flocked runs.jsonl,
the vault real-path gate, loopback bind), D-20 (floor backdrop cache, overlay diffing, demand
frameloop when hidden, the floor tests).

## Done means

1. (Must 1) `~/.sam/tests/test-closer-relaunch-why.sh`: a fixture job with closerCtx tier fable and
   a why, `folderOverride` set, run through closer-relaunch.sh against a stub sam-dispatch that
   records argv. Before: argv lacks `--why`. After: argv carries `--why` and `--folder-override`
   with the stored values, and the same holds for `closer_blocked.dispatch` and the decision-job
   relaunch command. `test-closer-relaunch.sh` and `test-closer-blocked.sh` still pass.
2. (Must 2) `~/.sam/tests/test-closer-limit-death-message.sh`: closer.py on a fixture whose
   stdout.log ends "You've hit your session limit", with a notify stub. Before: messageSkipped is
   set and the stub is never called. After: the stub is called once with "seat limit" and
   "relaunch" in the body. `test-closer-quiet-pass.sh` is updated so a PASS is still quiet and
   UNKNOWN with a relaunch now messages; it passes.
3. (Must 3) `~/.sam/tests/test-dispatch-seat-lock.sh`, against a stub sam-job and a temp job store:
   a. With a main reading of 0.70 and two Fable sam-job units already running on main, a third
      Fable dispatch exits 4 naming both. Before: it launches.
   b. Two parallel `sam-dispatch --seat main` runs with the cap at one free slot: exactly one
      launches, the other exits 4 naming the running job. Before: both launch.
   c. With a stale reading and the cap full, the dispatch exits 4. Before: "stale, allowed".
   d. Two launches on one seat are at least the stagger apart (stub records launch times).
   e. Five non-Fable jobs: the fifth is refused; a Fable job is still allowed while fewer than 2
      Fable run. Chat-turn dirs (no unit) in the store are not counted.
   `test-dispatch-seat-guard.sh` and `test-dispatch-seat-default.sh` still pass.
4. (Must 3, last point) `~/.sam/tests/test-closer-relaunch-cap-retry.sh`: closer-relaunch.sh with a
   stub sam-dispatch that exits 4 once, then 0. Before: stops with "seat guard refused" and
   notifies. After: it waits one poll, dispatches, writes `relaunch-dispatched`, no notify.
5. (Must 4) `~/.sam/tests/test-seat-transcript-retention.sh`: reads both seats' settings.json.
   Before: FAIL (key absent). After: PASS, `cleanupPeriodDays` is 3650 on both. Plus, 2 days after
   install, `find ~/.claude/projects/-home-col-claude -name '*.jsonl' -mtime +31 | wc -l` is above 0.
6. (Must 5) A review note `implementation/audit-fixes-2026-10-19-stage-review.md` lists each of the
   two staged files' diffs against live, the verdict (clean or findings), and, if clean, the
   install output: `test-closer-t28-honest.sh` reports 0 failed and `test-closer-message.sh`,
   `test-closer-blocked.sh` pass on the installed files. Before install,
   `test-closer-t28-honest.sh` fails on the live files (it was written to fail first).
7. (Must 6) Before: with `SAM_TEST_STAGED` unset, the six tests resolve to the `.next` copy when one
   exists. After: a new test `src/lib/server/testing/stagedOrLive.test.ts` proves the helper picks
   live unless `SAM_TEST_STAGED=1`; the six tests pass with no `.next` present; and
   `ls ~/.local/bin/sam-dispatch.next ~/.local/bin/sam-job.next ~/.sam/sam-job/run.sh.next`
   prints nothing, with a grep over `~/.sam`, `~/.local/bin`, `~/.claude/hooks`, systemd user units
   and `src/` showing no reader of the deleted names left.
8. (Must 7) `src/lib/server/jobs/sweepRetention.test.ts`: under a temp HOME with 130 chat-turn dirs
   newer than one ended sam-job dir 2 days old, the sweep runs. Before: the sam-job dir is deleted.
   After: it survives; a sam-job dir 8 days old is deleted; only the newest 128 chat-turn dirs stay;
   a running sam-job dir older than 7 days but touched inside the window is kept.
9. (Must 8) `src/lib/server/chat/expiredHistory.test.ts`: a chat record whose transcript is on
   neither seat lists with `historyExpired: true`, one with a transcript lists false. Before: the
   field does not exist. After deploy, Colin sees "history expired" on an old September chat in
   the chat list on his phone.
10. (Must 9) `src/lib/server/chat/contextCeiling.test.ts`: a fake finished turn whose last model call
    reports 150k input plus cache tokens stores 150k and no banner; 210k stores 210k and the banner
    rule says show. Before: no stored context field. After deploy, a chat over 200k shows the
    banner at 390 px width on Colin's phone and the button opens the handoff picker.
11. (Must 10) `src/lib/server/chat/autoHandoff.test.ts`: startTurn on a Max chat with stored context
    410k starts a handoff (memo turn) instead of a normal turn, records the carried message, and the
    child chat's first prompt contains that message. A chat at 390k runs a normal turn. A running
    turn is never interrupted (the check is only at turn start). Before: a normal turn runs.
    One week after deploy: `tmp-B/turns.py` over seven days shows no chat above 450k at turn start.
12. (Must 11) `src/lib/server/vaultWrite.test.ts`: on a temp copy of Active Priorities, a test hook
    appends a line between the read and the write. Before: the appended line is gone. After: both
    the toggle and the appended line are present and a warning is logged on the retry. The same for
    Named Operations `setOperationVariables` and `recordRun`. No temp file is left behind.
13. (Must 12) `src/components/shell/ambientGate.test.ts`: with a fleet view registered, the gate
    renders no SamBackground; after it unregisters, it renders it. Before: SamBackground always
    mounts. After deploy, a browser check on `/` (desktop and 390 px): the vault-graph-visualiser
    canvas is absent while the fleet view is up, and present again on `/chat`.
14. (Must 13) `src/components/floor/floorPacing.test.ts`: with nothing in flight the pacing rule
    allows at most 12 draws in 1 s of 60 frames; with an effect in flight it allows all 60.
    `ringRender.test.ts` gains a case: 30 s of frames with unchanged jobs and geometry run
    `spreadOuter` at most once per change (before: once per frame). `floorGolden`, `figureHit`,
    `ringRender` and `floorRender` tests stay green.
15. (Must 14) `src/lib/server/vaultGraphBuild.test.ts`: the build on a generated temp vault of 900
    notes writes one node per note and reports at most 400 force-pass nodes. Before: all 900 are in
    the force pass. On the live vault, `python3 scripts/build_vault_graph.py --out /tmp/g.json`
    finishes under 60 s (before: about 659 s), and
    `curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' http://127.0.0.1:3000/api/vault/graph`
    with a session cookie shows `Content-Encoding: gzip`.
16. (Must 15) The coverage table in the tickets file maps every check above to a ticket, and every
    ticket names its test file and its before and after result.
17. (Must 16) `git rev-parse main` equals `git rev-parse claude/sam-core-dashboard-sf3639`, and
    `git rev-parse origin/main` equals both after the push. `npm test` passes on main.
18. (All SAM_ui must-dos) After each SAM_ui ticket, `./deploy.sh --reviewed <sha>` exits 0 and
    `/api/health` reports the new SHA.

## Robustness

- Data model: no new store. New fields only: the job's `closerCtx` gains `why`, `escalatedFrom` (already there) and `folderOverride` strings (identified by job id in `~/.sam/jobs/<id>/meta.json`); a `ChatRecord` gains `contextTokens` (number) and `contextAt` (ISO time), keyed by chat id in `~/.sam/samui-chats.json`; chat summaries gain a computed `historyExpired` flag (not stored); sam-dispatch gains one lock file and one last-launch stamp per seat under `~/.sam/locks/`.
- Backups and restore: `~/.sam` (job store, chat store, locks) is already synced to Drive nightly by `sam-backup.sh`, and the vault (Active Priorities, Named Operations) is in the vault's own backup; nothing new to back up. Restore is proven by the existing `test-restore-drill.sh`. The new fields are rebuilt by the next turn or dispatch if lost.
- Rollback: each harness ticket copies the files it edits to a dated `.bak-20261019-audit` copy first and records a one-paste rollback in its job output. Each SAM_ui ticket is one commit; rollback is `git revert <sha>` then `./deploy.sh --reviewed <new sha>`. The seat settings change is undone by removing the one key.
- Failures and timeouts: the per-seat lock is taken with `flock -w 120`; if it cannot be taken the dispatch exits 4 saying the seat lock is busy, never waits for ever. The stagger wait is bounded (default 60 s, at most the lock timeout). The relaunch's cap retry stays inside its existing `SAM_CLOSER_RELAUNCH_WAIT` window (default 7,200 s), then notifies Colin, so no loop. The auto handoff uses the existing chain: a failed memo or child start sets `handoffError`, which the chat page already shows. A vault write retries once, then logs and stops. The graph build has no outside calls.
- Monitoring and alerts: limit deaths now message Colin (must-do 2). A cap or lock refusal on a relaunch that runs out of wait notifies Colin through `notify-colin.sh` (existing path). A refused direct dispatch prints exit 4 to SAM, who reports it in chat. Vault write conflicts log a warning to the sam-ui journal. Expired chat history is visible in the list. The daily `/api/health` probes are unchanged.
- Auth and secrets: no new route and no new secret. The chat agent route keeps its step-up check, which also covers the auto handoff. The vault graph route keeps its session check. Seat settings files stay owned by col.
- Expected load: about 30 dispatched jobs and 100 chat turns a day now; sam-job dirs kept 7 days is about 210 dirs, 70 MB. Chat transcripts kept grow about 280 MB a week (disk is C-07, out of scope, flagged). Ten times the notes keeps the graph build bounded by the 400-node force pass. No scale work beyond that.

## Open questions

None. Every gap found while writing was settled by a locked decision above or derived from one
(listed under "Derived from these").

## Open for Colin

None.
