# Answer buttons on SAM's questions: tickets

Spec: `implementation/answer-buttons-spec.md` (Status: LOCKED 2026-10-08, all six open questions answered, so no ticket is blocked by an OPEN question).
Priorities entry: Job closer: spec LOCKED. Scope: business. Branch: `spec/answer-buttons`, worktree `/home/col/SAM_ui-answer-buttons-spec`.

23 tickets. Order: closer side first (T1 to T14), then SAM_ui (T15 to T19), then the whole-system proof (T20), the install line (T21), and the two gates (T22 SAM installs and deploys, T23 Colin's check on the A16).

## Common rules (every worker reads this first)

1. Live system files are never edited in place. These are live: `/home/col/.local/bin/sam-push` (a symlink to `/home/col/.sam/sam-push/send.mjs`, so its staged copy is `/home/col/.sam/sam-push/send.mjs.next`, because `web-push` resolves from that folder), `/home/col/.sam/notify-colin.sh`, every module in `/home/col/.sam/closer/` that the live closer runs (`closer.py`, `closer_core.py`, `closer_blocked.py`, `closer_message.py`, `closer_next.py`, `closer_preview.py`, `closer_proof.py`, `closer_refuse.py`, `closer_relaunch.py`, `closer_vault.py`, `run-closer.sh`, `unblock-brief.md`, `brief-template.md`), and the existing files in `/home/col/.sam/tests/`. Change one by editing its `<file>.next` sibling. For the closer files `closer.py.next`, `closer_blocked.py.next` and `brief-template.md.next` already exist and equal the live file: edit them. For the others, create `<file>.next` as a copy first (`cp -p`). Never touch the live file, never write a `.bak`, never run an install. New files are created as `<name>.next` too when they would run in the live closer (for example `closer_questions.py.next`). New test files go straight into `/home/col/.sam/tests/` (they are not run by anything live until their name matches `test-closer-*.sh`, and they must pass both before and after install, see rule 2).
2. Tests take a seam to run against the `.next` copy. Closer tests build an overlay folder: copy the live `/home/col/.sam/closer/*.py`, then copy each `*.py.next` over it under its real name, then point `CLOSER_DIR` at the overlay (the pattern in `/home/col/.sam/tests/test-closer-quiet-pass.sh:7-14`). T1 writes the shared helper `/home/col/.sam/tests/closer-overlay.sh`; later tickets source it. Overlay folders live under `$HOME/.cache/closer-tests/` (the `closer-fixtures.sh` root), removed at exit. Tests use the existing seams (`SAM_JOB_STORE`, `SAM_VAULT_ROOT`, `SAM_CLOSER_HOME`, `SAM_NOTIFY_BIN`, `SAM_DISPATCH_BIN`, `SAM_CLOSER_TEST=1`) and the stubs in `/home/col/.sam/tests/closer-fixtures.sh`. Never the real job store, vault, push log, subscriptions or Telegram.
3. Where an existing test would fail because the behaviour deliberately changed, copy it to `<test>.sh.next`, edit the copy, and prove the copy. Do not edit the live test. T21 installs the copies.
4. No output under `/tmp`. Use `$HOME/.cache/...` (closer tests) or the SAM_ui `tempDir` helper (`src/lib/server/testing/tempDir.ts`, which `npm test` checks for leaks).
5. Never read or print env files, keys, VAPID keys (`~/.sam/push-vapid.json`), cookies, tokens or `~/.sam/os-bridge-*token` files. A test may assert a pattern is absent from output; it never prints a secret.
6. SAM_ui changes are committed on `spec/answer-buttons` only. No merge, no push, no `deploy.sh`, no restart of `sam-ui.service`, no `npm run build` into the live `.next` folder (`check-*` scripts that need a build use `NEXT_DIST_DIR`-style isolation or a copy, see T15).
7. The worktree has no `node_modules`. Make it with `ln -s /home/col/SAM_ui/node_modules node_modules` (it is gitignored) before `npm test` or `npm run typecheck`.
8. Plain text rule for anything that reaches Colin: no em or en dashes, no double asterisks, no backticks, at most 600 characters (`closer_message.py:1-7`, `:17`).
9. If you are stuck, end your report with exactly one line: `BLOCKED: <reason>; unblock: <what>`.
10. Existing closer suite: `bash /home/col/.sam/tests/test-closer-all.sh | tail -1` must keep ending with `0 failed` after each closer ticket (it runs against live files, so it only proves you touched nothing live; the overlay test proves the change).

## T1: question records, housekeeping log and test helper (new module)
Status: DONE 2026-10-08 (test-closer-questions.sh 8 passed 0 failed, fails 1/0 without module; test-closer-all 91/0)
Spec: must-do #1, #15, #19; check #1 (module half)
Depends on: none
Blocked by: none
Context: Today a question is a bare string in `needsYou` (`closer_core.py:146-150` `new_record`). Later tickets register questions and housekeeping through one new module so existing function signatures (which return `(actions, needs)`) do not change. `closer.py` drains the module at the end (T4). `core.scrub` is `closer_core.py:45`.
Files: `/home/col/.sam/closer/closer_questions.py.next` (new), `/home/col/.sam/tests/closer-overlay.sh` (new), `/home/col/.sam/tests/test-closer-questions.sh` (new)
Steps:
1. In `closer_questions.py.next` write: `new_id()` returning `q_` plus 8 random hex characters; module-level collectors `QUESTIONS` and `HOUSEKEEPING` with `reset()`; `ask(text, source, kind="yesno", options=None, gated=True, accept_action="none", plus any extra keyword fields)` that scrubs and sanitises the text (use `closer_message.sanitise` logic, but do not import `closer_message`, to avoid a cycle: copy the small rules), builds the record with every field in must-do 1 (`id, kind, text, options, source, gated, acceptAction, state:"open", createdAt, answeredAt:null, answeredVia:null, result:null`), appends it, and returns the text so callers can still put it in `needsYou`. `kind` is `yesno` (options Accept and Decline), `choice2` (two labels of at most 20 characters, else downgrade to `open`) or `open`. Default `gated=True` (the safe default, spec open question 5).
2. `housekeeping(text, source)`: scrub, append `{text, source, time}` to `HOUSEKEEPING`, and append one line to the file named by `SAM_HOUSEKEEPING_LOG` (default `~/.sam/logs/closer-housekeeping.log`). It never raises (an OSError is swallowed). It never touches `QUESTIONS`.
3. `closer-overlay.sh`: a sourced function `overlay_make` that creates the overlay folder described in Common rule 2 and exports `CLOSER_DIR`.
4. `test-closer-questions.sh` (sources `closer-fixtures.sh` and the overlay helper; first assertion is that `closer_questions.py.next` exists): record has every field; two ids differ; a 25-character choice2 label downgrades to `open`; secret-looking text (`sk-abcdefghijkl1234`) is scrubbed; `housekeeping()` writes the log line only to the seam path and does not change `QUESTIONS`.
Do not touch: any live closer file, `closer-fixtures.sh`, `~/.sam/logs/` (the test points `SAM_HOUSEKEEPING_LOG` into its fixture root).
Proof: `bash /home/col/.sam/tests/test-closer-questions.sh | tail -1` prints `N passed, 0 failed`. Before the ticket it prints `FAIL  closer_questions.py.next does not exist` and exits 1.

## T2: vault problems become housekeeping
Status: DONE 2026-10-08 (test-closer-housekeeping.sh 12/0, fails 1/11 on live vault; test-closer-all 93/0)
Spec: must-do #13, #15; check #11 (vault fixtures)
Depends on: T1
Blocked by: none
Context: Spec section 3, "Stops being a question". `closer_vault.py` appends these as needs lines today. Do not change what the vault writes on success, the lock, or the drift restore itself. The no-daily-note row is T3, not here.
Files: `/home/col/.sam/closer/closer_vault.py.next` (copy of live, edit), `/home/col/.sam/tests/test-closer-housekeeping.sh` (new)
Steps:
1. In `closer_vault.py.next` import `closer_questions as questions` and replace each of these `need.append(...)` calls with `questions.housekeeping(<same text>, "<source>")` and nothing in `need`: brief has no Priorities entry line (`:407-409`), entry matched 0 or 2 entries (`:322-324`), no Scope line or not business or personal (`:368-373`), active Priorities.md not found (`:309-311`), drift check failed or drift already present (`:349-354`), daily note, ledger or priorities write failed (`:388-389`, `:404-405`, `:416-417`). The text for the two Priorities brief bugs must include the job id and the line the author should fix (must-do 14).
2. Keep the actions returned as they are. `write_vault` still returns `(actions, needs)` with the needs list now empty for these causes.
3. `test-closer-housekeeping.sh` (vault half): run `closer.py.next`-overlay on fixture jobs for: no Priorities entry line, entry matching 2 entries, no Scope line, Priorities.md missing. For each assert `needsYou` has no line for that cause and the housekeeping log seam file has one line for it. (T4 and T5 extend the same test file for the other rows.)
Do not touch: `write_ledger`, `atomic_write`, the vault lock, the daily note creation (T3).
Proof: `bash /home/col/.sam/tests/test-closer-housekeeping.sh | tail -1` prints `0 failed`. Before: the same fixtures give a non-empty `needsYou` and the test fails.

## T3: SAM creates the missing daily note
Status: DONE 2026-10-08 (test-closer-dailynote.sh 14/0, fails 6/8 without change; housekeeping 12/0; test-closer-all 95/0)
Spec: must-do #14; check #12
Depends on: T2
Blocked by: none
Context: `write_daily` (`closer_vault.py:235-239`) refuses when the note for the day is missing. The template is `/home/col/ai-memory-vault/01 - Daily Notes/Daily Note Template.md` (the vault root is `SAM_VAULT_ROOT` in tests, so the test carries its own template file at the same relative path). Month folder is `01 - Daily Notes/<MM> - <Month> <YYYY>/` as `write_daily` already builds. Running twice must not add a second Job closed line.
Files: `/home/col/.sam/closer/closer_vault.py.next` (edit), `/home/col/.sam/tests/test-closer-dailynote.sh` (new)
Steps:
1. In `write_daily`, when the note is absent: create the month folder if needed, copy the template to the day's path with `atomic_write` (temp file and rename, under the existing vault lock), then continue with the existing Job closed append. If the template is missing or creation raises OSError, call `questions.housekeeping(...)` with source `daily-note-create` and return False (only then is it logged).
2. Replace the "SAM creates it" placeholder wording in the removed need line; nothing about this goes to `needsYou`.
3. `test-closer-dailynote.sh`: temp vault with the template and no note: run the closer overlay; assert the note exists in the right month folder, equals the template plus exactly one `Job closed` line; run the closer on the same job again (and a second job id): the first job's line is not duplicated. Also: no template present gives a housekeeping line and no crash.
Do not touch: the real vault, the daily note for any real date, `write_ledger`, `write_priorities`.
Proof: `bash /home/col/.sam/tests/test-closer-dailynote.sh | tail -1` prints `0 failed`. Before: the fixture ends with no note and a needs line.

## T4: closer.py drains the collectors and its exceptions become housekeeping
Status: DONE 2026-10-08 (test-closer-housekeeping.sh 24/0, fails 12/12 on live closer.py; outside-store.sh.next 5/0; live test-closer-all red 3 by design until T21 (staged closer.py differs from stage.sums and from live outside-store test))
Spec: must-do #1, #13, #15; check #11 (exception rows)
Depends on: T1
Blocked by: none
Context: `closer.py:140`, `:148`, `:162`, `:173`, `:179`, `:189` put "x failed: ExceptionName" lines in `needsYou`. They are closer bugs: they become housekeeping and still set `closerError` so `closer_message.py:244` is unchanged. This ticket also adds the single place where collected questions and housekeeping reach `closer.json`. Existing behaviour for lines no module has registered stays as it is until T9.
Files: `/home/col/.sam/closer/closer.py.next` (edit), `/home/col/.sam/tests/test-closer-housekeeping.sh` (edit)
Steps:
1. At the start of `main` call `questions.reset()`. After all stages and before `core.write_record(job_dir, rec)`: set `rec["questions"] = questions.QUESTIONS`, `rec["housekeeping"] = questions.HOUSEKEEPING`, and for every question make sure its `text` is in `rec["needsYou"]` (append if absent; keep order; keep unregistered lines for now).
2. Replace the six `except Exception` fallbacks with `questions.housekeeping("<stage> raised <type>", "closer-exception")`, no needs line, and set `rec["closerError"] = "<stage> failed: <type>"` (first one wins).
3. The early return for a job outside the store and the `status: closed` idempotent return are unchanged.
4. Extend the test: force each of the six stages to raise (monkeypatch the module function in a small python harness that calls `closer.main`), assert `needsYou` has no such line, `housekeeping` has one, `closerError` is set, and the message stub still fires (a closer error is still reported by `needs_message`).
Do not touch: verdict logic, `core.new_record` (keys are added in `closer.py`), the message module.
Proof: `bash /home/col/.sam/tests/test-closer-housekeeping.sh | tail -1` prints `0 failed`. Before: the six lines are in `needsYou`.

## T5: remaining housekeeping and information rows
Status: TODO
Spec: must-do #13, #15; check #11 (follow-on, decision, preview rows)
Depends on: T4
Blocked by: none
Context: Section 3 rows: follow-on "only dispatch steps are run", "chain too long", "brief file does not exist" (`closer_next.py:100`, `:151`, `:155`) are housekeeping; "Checks did not pass, so X was not run" (`:149`) is information in the verdict line; the decision job naming a folder outside the store or ending without a valid `unblock.json` (`closer_blocked.py:277`, `:286-288`) is housekeeping; a swap rolled back because the preview did not serve the new build (`closer_preview.py:220`) is information (the rollback line already reaches Colin, `closer_message.py:246-247`); the incomplete Preview swap section (`closer_preview.py:167`) is a malformed brief, so housekeeping.
Files: `/home/col/.sam/closer/closer_next.py.next` (copy, edit), `/home/col/.sam/closer/closer_blocked.py.next` (edit), `/home/col/.sam/closer/closer_preview.py.next` (copy, edit), `/home/col/.sam/tests/test-closer-housekeeping.sh` (edit)
Steps:
1. Convert each row as above with `questions.housekeeping(text, source)`. For the information rows return the text through the existing verdict or `rollback` channel instead of `needsYou` (for `:149` add it to the `actions` list so it shows in the done text; for `:220` set no needs line, the swap record and rollback already carry it).
2. Keep the bodies of the two decision-refused cases in `closer_blocked.py` (`:286-288` also stops saying "Do you want me to look at that block myself?").
3. Extend the test with a fixture per row (follow-on with a non-dispatch step, a brief file that does not exist, a decision job closing with no `unblock.json`, a decision job naming a folder outside the store, a failed-checks follow-on, a rolled-back swap with the preview seams from `test-closer-preview.sh`). Assert no `needsYou` line and no `questions` record for each, and a `housekeeping` entry (or action text for the information rows). For a PASS verdict with only housekeeping assert `notify` stub call count 0 (this is check 11's "message stub is never called").
Do not touch: the swap and rollback mechanics, the Opus decision flow, `MAX_UNBLOCKS`.
Proof: `bash /home/col/.sam/tests/test-closer-housekeeping.sh | tail -1` prints `0 failed`; and `bash /home/col/.sam/tests/test-closer-all.sh | tail -1` ends `0 failed`.

## T6: blocked-job questions with kind, gated and accept action
Status: TODO
Spec: must-do #1, #10; check #1, check #10 (creation half)
Depends on: T4
Blocked by: none
Context: Spec section 3, first rows. Sources are `closer_blocked.py:370-373` (a must-do 6 category), `:396-403` (SAM could not clear it), `:292-293` (the Opus decision says `colin`) and `:440-442` (stale file moved, relaunch did not start). The decision brief (`unblock-brief.md`) must tell Opus about the `gated` field. Do not change relaunch caps or the guards.
Files: `/home/col/.sam/closer/closer_blocked.py.next` (edit), `/home/col/.sam/closer/unblock-brief.md.next` (new copy of `unblock-brief.md`, edit), `/home/col/.sam/tests/test-closer-ask-blocked.sh` (new)
Steps:
1. Replace each of the four needs lines with `questions.ask(text, source, gated=..., accept_action=...)`, still returning the text. Category block (`:370-373`): `gated=True`, `acceptAction="decision"`. Could-not-clear (`stop(...)` paths): `gated=True` for category stops, `gated=False` for the mechanical reasons (capped, folder busy, move failed, record lacks what a relaunch needs), `acceptAction="decision"`, except the stale-file relaunch failure (`:440-442`): `gated=False`, `acceptAction="relaunch"`. Decision `colin` (`:292-293`): `gated` is read from `unblock.json` (`"gated": false` makes it False; missing or anything else is True), `acceptAction="decision"`, text is the Opus note. Record the job id the question belongs to in an extra field `jobId`.
2. In `unblock-brief.md.next` add, to the `colin` option and the Record section, an optional `"gated": false` field with the rule: set false only when Accept would do nothing in the must-do 6 list; omit when unsure.
3. `test-closer-ask-blocked.sh`: fixture job blocked on a token line needing Colin: `closer.json` has `questions[0]` with `id` (matches `^q_[0-9a-f]{8}$`), `kind: yesno`, `state: "open"`, `acceptAction`, `gated`; `needsYou` text equals the question text. A category block is `gated: true`. A decision job closing with `{"decision":"colin","note":"..."}` and no `gated` field gives `gated: true`; with `"gated": false` gives false. The stale-file relaunch failure gives `acceptAction: "relaunch"`.
Do not touch: `MAX_UNBLOCKS`, `category()`, the seat and folder guard handling, `closer_answer` (T13).
Proof: `bash /home/col/.sam/tests/test-closer-ask-blocked.sh | tail -1` prints `0 failed`. Before: `closer.json` has no `questions` key and the test fails on its first assertion.

## T7: relaunch and refused-step questions
Status: TODO
Spec: must-do #1, #10; check #1 (other sources), check #10 (refused category gated)
Depends on: T6
Blocked by: none
Context: Section 3 rows: seat or weekly limit death with no relaunch (the five "Relaunch it yourself" lines in `closer_relaunch.plan`, `:219`, `:222`, `:229`, `:232`, `:244`) is a non-gated question, Accept = `relaunch`; a command or step refused as a must-do 6 category (`closer_refuse.py:107-109` `needs_line`, `:176`; callers `closer.py:168-169`, `closer_next.py:140-144`) is gated.
Files: `/home/col/.sam/closer/closer_relaunch.py.next` (copy, edit), `/home/col/.sam/closer/closer_refuse.py.next` (copy, edit), `/home/col/.sam/tests/test-closer-ask-others.sh` (new)
Steps:
1. In `closer_relaunch.py.next` wrap each of the five lines in `questions.ask(..., source="limit-death", gated=False, accept_action="relaunch")`. The wording "Relaunch it yourself?" stays (T12 drops the tail for push).
2. In `closer_refuse.py.next` make `needs_line` call `questions.ask(text, "refused-step", gated=True, accept_action="decision")` and return the text, so every caller registers a gated question.
3. `test-closer-ask-others.sh`: a seat-limit death with reset more than 12 hours away gives one question with `acceptAction: "relaunch"`, `gated: false`; a brief `run: deploy the site` proof line (refused category) gives a question with `gated: true`.
Do not touch: the 12 hour rule, the relaunch cap, `classify`, the refusal categories.
Proof: `bash /home/col/.sam/tests/test-closer-ask-others.sh | tail -1` prints `0 failed`; `bash /home/col/.sam/tests/test-closer-relaunch.sh | tail -1` and `bash /home/col/.sam/tests/test-closer-refuse.sh | tail -1` still end `0 failed` (live copies, unchanged).

## T8: follow-on and preview questions
Status: TODO
Spec: must-do #1, #10; check #1 (other sources), check #10
Depends on: T7
Blocked by: none
Context: Section 3 rows: follow-on dispatch refused or did not start ("Run it later?", `closer_next.py:153`, `:160`): non-gated, Accept = `decision` with the instruction "run it now"; preview swap failed part way or failed and the rollback failed (`closer_preview.py:209-210`, `:219`): gated. Spec gap to resolve here: `closer_preview.py:168` and `:170` ("Swap X to Y?", "swap anyway?") are not in the section 3 table. Decision for this ticket: they are gated questions with `acceptAction: "none"` (the closer never swaps on an answer, it only records Colin's yes), and the worker lists them as `swap-offer` in T9's source list and says so in its report so SAM can confirm with Colin.
Files: `/home/col/.sam/closer/closer_next.py.next` (edit), `/home/col/.sam/closer/closer_preview.py.next` (edit), `/home/col/.sam/tests/test-closer-ask-others.sh` (edit)
Steps:
1. `closer_next.py.next`: `:153` and `:160` become `questions.ask(..., source="followon-refused", gated=False, accept_action="decision")`. Line `:144` already goes through `needs_line` (T7).
2. `closer_preview.py.next`: `:209-210` and `:219` become gated questions, source `swap-failed`, `acceptAction: "none"`; `:168`, `:170` as decided above.
3. Extend the test with a follow-on step whose dispatch exits non-zero, and a swap that fails part way (seams as in `test-closer-preview.sh`), asserting kind, gated and acceptAction.
Do not touch: swap and rollback mechanics, the approved previews list.
Proof: `bash /home/col/.sam/tests/test-closer-ask-others.sh | tail -1` prints `0 failed`.

## T9: classification is complete
Status: TODO
Spec: must-do #15; check #13
Depends on: T5, T6, T7, T8
Blocked by: none
Context: Must-do 15: no needs line is left unclassified; an unregistered line becomes housekeeping by default, and only a listed source creates a question. Check 13: a test greps the closer modules for every string added to a needs list and fails if it is not in a checked-in list of expected sources.
Files: `/home/col/.sam/closer/closer.py.next` (edit), `/home/col/.sam/closer/closer-sources.txt.next` (new), `/home/col/.sam/tests/test-closer-classify.sh` (new)
Steps:
1. `closer-sources.txt.next`: one line per source: `<module>:<function or line text anchor> <question|housekeeping|information> <gated|open|->`. It must list every row of spec section 3 plus `swap-offer` (T8). Build it by reading the modules, not by copying the spec.
2. In `closer.py.next`, after the drain from T4: any `needsYou` line that is not the text of a registered question is moved to housekeeping (source `unclassified`) and removed from `needsYou`. Questions' texts stay.
3. `test-closer-classify.sh`: (a) python walks the overlay `closer*.py` files with `ast`, finds every `.append(`, `.extend(` and list literal that feeds a variable named `need`, `needs`, `lneed`, `bneed` or `needsYou` and every `return` of a needs list, and fails if a string constant there is not matched by an entry in the sources list or is not inside a `questions.ask` or `questions.housekeeping` call; (b) a fixture that appends a made-up needs line in a harness ends up in `housekeeping` with source `unclassified` and creates no question and no message for a PASS.
Do not touch: the sources themselves (T2 to T8), the message module.
Proof: `bash /home/col/.sam/tests/test-closer-classify.sh | tail -1` prints `0 failed`. Before: there is no list and no test; the made-up line stays in `needsYou`.

## T10: sam-push takes --question and --options
Status: TODO
Spec: must-do #3, #19; check #2
Depends on: none
Blocked by: none
Context: Live `sam-push` is `/home/col/.local/bin/sam-push`, a symlink to `/home/col/.sam/sam-push/send.mjs` (read it: log append at `:91-100`, payload at `:124`). Stage the copy as `/home/col/.sam/sam-push/send.mjs.next` (node cannot run a `.mjs.next` file directly, so the test copies it to a temp folder under `$HOME/.cache/` as `send.mjs` and symlinks that folder's `node_modules` to `/home/col/.sam/sam-push/node_modules`). Today the flag is unknown and the script does not use it.
Files: `/home/col/.sam/sam-push/send.mjs.next` (copy, edit), `/home/col/.sam/tests/test-sam-push-question.sh` (new)
Steps:
1. Add `--question <id>` (must match `^q_[0-9a-f]{8}$`, else exit 2) and `--options "<a>|<b>"` (default `Accept|Decline`; a single label such as `Open` gives one action; each label trimmed to 20 characters, at most 2). The `usage` line lists them.
2. Add `questionId` (string or null) to the push log line, and `actions: [{action:"a",title},{action:"b",title}]`, `questionId` and `jobId` to the Web Push payload only when `--question` is given. Payload and log carry ids and labels only.
3. Test seams (new, default off): `SAM_PUSH_VAPID` (path, default the real one) and `SAM_PUSH_SINK` (a file path: when set, the payload JSON is appended to it instead of calling `webpush.sendNotification`, and the subscriber count is read from `SAM_PUSH_SUBS` as now). With neither set the behaviour is byte for byte today's.
4. Test: temp HOME, a fake `SAM_PUSH_VAPID` file made by `web-push generate-vapid-keys`-style random values written by the test itself under the fixture root (never the real keys), one fake subscription in `SAM_PUSH_SUBS`, `SAM_PUSH_SINK` and `SAM_PUSH_LOG` in the fixture root. Assert: the log line has `questionId`; the sink payload has two `actions` (`a`, `b`) and `questionId`; `--options "Open"` gives one; no string in log or payload matches cookie, `sk-`, `Bearer`, `p256dh`, `auth` key value or the fake VAPID values; a bad question id exits 2; a call without `--question` produces a payload with no `actions`.
Do not touch: the live `send.mjs`, `~/.sam/push-subs.json`, `~/.sam/push-vapid.json`, the log trim logic.
Proof: `bash /home/col/.sam/tests/test-sam-push-question.sh | tail -1` prints `0 failed`. Before: `sam-push --question` exits 2 (unknown flag usage) and the test fails.

## T11: notify-colin.sh passes the question through and gains test seams
Status: TODO
Spec: must-do #3, #17; check #17 (script half)
Depends on: T10
Blocked by: none
Context: `/home/col/.sam/notify-colin.sh` takes `<title> <body> [--dry]` (the third positional is `--dry`), sends Telegram with an inline node call, then calls the hard-coded `/home/col/.local/bin/sam-push ... --tag alert`, then the OS bridge. It has no test seams, which is why nothing tests it today. Telegram stays plain text.
Files: `/home/col/.sam/notify-colin.sh.next` (copy, edit), `/home/col/.sam/tests/test-notify-colin-question.sh` (new)
Steps:
1. Parse optional flags after the two positionals without moving `--dry`: `--question <id>`, `--options "<a>|<b>"`. Pass them to the `sam-push` call; when `--question` is given use `--tag q-<id>` instead of `alert`.
2. Telegram text: when `--question` is given, append nothing interactive (no inline keyboard, no `reply_markup`); the closer composes the text (T12).
3. Seams, default off: `SAM_PUSH_BIN` (default the live sam-push path), `SAM_TG_SEND_BIN` (when set it is run with the text as its one argument instead of the inline node Telegram call), `SAM_NOTIFY_NO_BRIDGE=1` (skip the phone and desktop bridge branches, which read token files), `SAM_NOTIFY_LOG` (default the live log). With none set, behaviour is unchanged. Do not print or read any token file in the new code paths.
4. Test: stubs record argv. Assert `--question q_ab12cd34 --options "Accept|Decline"` reaches the sam-push stub as `--question q_ab12cd34 --options Accept|Decline --tag q-q_ab12cd34`; the Telegram stub gets the text with no JSON `reply_markup`; with no flags the sam-push stub gets exactly `--title T --body B --tag alert`; `--dry` still prints and sends nothing.
Do not touch: the live script, the bridge token handling, the log format.
Proof: `bash /home/col/.sam/tests/test-notify-colin-question.sh | tail -1` prints `0 failed`. Before: the script ignores the flags and has no seam, so the test fails.

## T12: the closer's message sends one pinged question per notification
Status: TODO
Spec: must-do #2, #10, #17; check #2 (payload action count for gated), check #10 (one Open action), check #17, check #11 (message half)
Depends on: T9, T11
Blocked by: none
Context: `closer_message.py` turns each needs line into text ending "Yes or no?" (`need_question`, `:49-61`) and sends one message with all questions (`compose`, `:91-126`; `_notify` `:129-137` runs `notify-colin.sh title body` through `SAM_NOTIFY_BIN`; `send_once` `:255-278`). New rule: one notification per question; push body states the question once and drops the "Yes or no?" tail; Telegram stays plain text and its last line is "Answer in the SAM notification."; a gated question's notification carries one action, Open. A `kind: open` question (A, B or C?) has no buttons and is sent as a plain ping with no `--question`. Quiet-pass rules (`needs_message`) must keep working.
Files: `/home/col/.sam/closer/closer_message.py.next` (edit), `/home/col/.sam/tests/test-closer-message.sh.next` (copy, edit), `/home/col/.sam/tests/test-closer-message-questions.sh` (new)
Steps:
1. `send_once`: first send the job's verdict message (verdict, done text, rollback, with no questions inline); then, for each open question in `record["questions"]` (in order), call `_notify(title, text, question_id=..., options=...)` once. `_notify` adds `--question <id>` and `--options "<a>|<b>"` to the `SAM_NOTIFY_BIN` argv for `yesno` and `choice2` (`Open` for gated). The retry-once rule stays per call. Set `record["messageSentAt"]` when the verdict message is sent and `q["notifiedAt"]` per question; a re-run sends nothing already sent.
2. If the verdict message would be empty and the only content is the questions, still send the questions (each carries its own text). If a job has no questions the one message is unchanged.
3. The Telegram text for a question is `text` plus " Answer in the SAM notification." with no "Yes or no?" tail. For the plain-text rule (Common rule 8) reuse `sanitise`.
4. `test-closer-message-questions.sh`: with `_notify` stubbed (as `test-closer-quiet-pass.sh` does): two questions give two notify calls with distinct `--question` ids; the body has no "Yes or no"; a gated one gets `Open`; an `open` kind gets no `--question`; sending twice sends nothing new; a PASS with housekeeping only sends nothing. A second case through the real `notify-colin.sh.next` with the T11 seams asserts the Telegram stub text ends "Answer in the SAM notification." and contains no `reply_markup` (check 17).
5. Edit the `.next` copy of `test-closer-message.sh` and any other existing test whose expectation of the "Yes or no?" tail or single message changes (find them with `grep -l "Yes or no" /home/col/.sam/tests/test-closer-*.sh`), prove the copies against the overlay.
Do not touch: `needs_message` rules, `send_images`, the 600 character cap.
Proof: `bash /home/col/.sam/tests/test-closer-message-questions.sh | tail -1` prints `0 failed`. Before: one combined message, "Yes or no?" present, no `--question`.

## T13: closer_answer.py records an answer, once, under a lock
Status: TODO
Spec: must-do #8 (record and none), #9, #11, #19; check #7, check #9
Depends on: T1
Blocked by: none
Context: New module, the only code that changes a question's state. The web route calls it with `execFile` and fixed arguments (T18). Atomic write and lock follow `closer_vault.py:181-226` (`atomic_write`, the lock class). `closer.json` is written by `closer_core.write_record` (`:156`); keep every other field intact. Job store is `SAM_JOB_STORE` (default `~/.sam/jobs`); resolve with realpath and require the job dir to be directly inside it, as `closer_blocked.py:273-278` does.
Files: `/home/col/.sam/closer/closer_answer.py.next` (new), `/home/col/.sam/tests/test-closer-answer.sh` (new)
Steps:
1. CLI: `closer_answer.py <jobId> <questionId> <a|b> <via>` (`via` is `push` or `tab`). Prints exactly one JSON line `{"questionId","state","changed","result"}` and exits 0; exits 2 with `{"error":...}` for a bad id, a job outside the store or an unknown question. No shell, no use of `answer` in a path.
2. Take an exclusive `flock` on a lock file in the job dir (not on `closer.json`), re-read `closer.json`, and only if the question `state` is `open` set `state` (`a` is accepted, `b` is declined, `choice2`: `a` and `b` choose the option and both count as `accepted`, with `result` naming the label), `answeredAt`, `answeredVia`; write temp file and `os.replace`. Otherwise return `changed:false` with the recorded state and run nothing.
3. Decline: record only, `result` "Declined", no dispatch, no notification. `acceptAction: none` Accept: record only, `result` "Accepted".
4. Run `result` and any text through `core.scrub` before writing. The function that runs accept actions is a stub that T14 fills in; this ticket's Accept for `relaunch` and `decision` calls `run_action(q, job_dir, job)` which for now raises NotImplementedError and is caught as `failed` with result "not built" (T14 replaces it).
5. Test: Accept twice sequentially and twice in parallel (`&` and `wait`) on a `none` question: first `changed:true`, rest `changed:false`, `closer.json` has one `answeredAt`; Decline then Accept leaves `declined`; bad job id `../x`, a symlinked job dir pointing outside the store, an unknown question id and answer `c` each exit 2 and leave `closer.json` byte identical (cmp).
Do not touch: `closer.json` fields other than the question state fields, the other closer modules, any web code.
Proof: `bash /home/col/.sam/tests/test-closer-answer.sh | tail -1` prints `0 failed`. Before: no module, test fails at once.

## T14: Accept runs the machinery, failure sends one ping
Status: TODO
Spec: must-do #8 (relaunch and decision), #12; check #7 (dispatcher called once), check #8
Depends on: T13, T6
Blocked by: none
Context: Replace T13's stub `run_action`. Relaunch: `sam-dispatch --relaunch-of <jobId>` with the existing resume note, built the way `closer_blocked.dispatch` does (`:244-262`: tier, brief, cwd, name, `--task/--seat/--summary` from `meta.closerCtx`), through `SAM_DISPATCH_BIN`; the resume note is `rec["relaunch"]`/`unblock.resumeBrief` or, if absent, written with `closer_relaunch.write_resume` (`:170-193`). Decision: reuse `closer_blocked.write_decision_brief` and `dispatch_decision` (`:316-366`: `--tier opus --task judgement`, closer on), with the line "Colin answered Accept to: <question text>" appended to the brief file. Seat guard (exit 4) and folder guard (exit 5) are never overridden: no `--seat-override` or `--folder-override` ever. Spec open question 4: Colin's Accept does not count towards the two-relaunch cap, but a question can be accepted once (T13 enforces that).
Files: `/home/col/.sam/closer/closer_answer.py.next` (edit), `/home/col/.sam/tests/test-closer-answer.sh` (edit)
Steps:
1. Implement `run_action`; capture the dispatch exit code. 0 means state `accepted`. Any other code means state `failed` and `result` is one line: 4 "the seat guard refused it", 5 "the folder guard refused it", other "sam-dispatch exited N".
2. On `failed` send exactly one notification: `SAM_PUSH_BIN` (default `/home/col/.local/bin/sam-push`) with `--title`, `--body` (plain text, 600 characters or fewer, no buttons) and `--tag alert`. Success sends nothing. Decline sends nothing.
3. Extend the test with `SAM_DISPATCH_BIN` and `SAM_PUSH_BIN` stubs from the fixtures: `relaunch` Accept calls the dispatch stub once with `--relaunch-of <jobId>`; `decision` Accept calls it once with `--tier opus --task judgement` and the brief file contains "Colin answered Accept"; a stub exiting 4 gives `state: failed`, result mentioning the seat guard, push stub call count exactly 1; a stub exiting 5 likewise; Decline on a `relaunch` question never calls the dispatch stub and the push stub count is 0; parallel double Accept calls the dispatch stub once.
Do not touch: `sam-dispatch`, the guards, `--seat-override`, `--folder-override`, `closer_blocked.py` (import its functions; if they cannot be imported without side effects, copy the minimum into `closer_answer.py.next` and say so).
Proof: `bash /home/col/.sam/tests/test-closer-answer.sh | tail -1` prints `0 failed`. Before: Accept reports `failed` with result "not built".

## T15: the service worker shows the buttons
Status: TODO
Spec: must-do #4; check #3
Depends on: none
Blocked by: none
Context: `src/app/sw.ts:96-120` calls `showNotification` with no `actions`; the served `public/sw.js` is built from it by Serwist (`next.config.mjs:56-57`, gitignored `.gitignore:45`), so a rebuild is needed to see it. `sw.ts` cannot be imported by a unit test (it needs `self` and Serwist), so put the payload logic in a new pure module and call it from `sw.ts`. Tag becomes `q-<id>` when a question id is present. Tap on the body still opens the job page: `data.url` is `/jobs/<jobId>`.
Files: `src/lib/swPush.ts` (new), `src/lib/swPush.test.ts` (new), `src/app/sw.ts` (edit), `scripts/check-push-actions.cjs` (new)
Steps:
1. `swPush.ts`: `buildNotification(payload)` returning `{title, options}`: at most 2 actions, each with `action` exactly `a` or `b` and a string title of at most 20 characters (longer is cut; anything else is dropped); `tag` is `q-<questionId>` when `questionId` matches `^q_[0-9a-f]{8}$`, else the payload tag as today; `data` has `url` (the payload url, or `/jobs/<jobId>` when a question payload has a `jobId` and no url), `questionId`, `jobId`, `ts`. Unit test it, including three actions giving two and an action id `c` dropped.
2. `sw.ts` `push` handler uses it. The click handler is T16, do not change it here.
3. `scripts/check-push-actions.cjs`: build the app into a copy so the live `.next` is untouched (`rsync` the worktree minus `node_modules`/`.next` into `$HOME/.cache/answer-buttons-build/`, symlink `node_modules`, run `npm run build` there, serve with `next start -p 3999`), launch Chromium (`require('/home/col/3d-render/node_modules/playwright-core')`, executable `/home/col/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, viewport 412 by 915), register the real service worker, send `ServiceWorker.deliverPushMessage` through the DevTools protocol with a two-action payload, a three-action payload and a payload with action `c`, and read `registration.getNotifications()`. Needs the login cookie only if the page requires it for the worker registration: if it does, mint nothing and print `BLOCKED: <reason>; unblock: <what>`. Never read env files or keys. Stop the server and remove the build copy at the end. Port 3999, not 3000.
Do not touch: `notificationclick` (T16), the Serwist caching rules, `public/sw.js`, the live `.next`.
Proof: `npm test 2>&1 | tail -5` shows 0 failing including `swPush`; `node scripts/check-push-actions.cjs` prints `PASS` for: one notification, tag `q-<id>`, `actions.length === 2`, titles Accept and Decline, `data.url` `/jobs/<jobId>`, three actions show two, action id `c` dropped. Before: `actions` is empty and it prints `FAIL`.

## T16: the click handler answers from the lock screen
Status: TODO
Spec: must-do #5, #6; check #4, check #5
Depends on: T15
Blocked by: none
Context: `sw.ts:122-160` closes the notification and focuses or opens a window; it ignores `event.action`. New: for `a` or `b`, close it, send one same-origin `POST /api/questions/answer` with `{ jobId, questionId, answer }` and `credentials: 'same-origin'` inside `event.waitUntil`, open no window, show nothing on 2xx. On 401, a thrown network error or a 5xx, show the same notification again with the same tag, no sound (`renotify` false), do not open the app, create no second tag. On 404 or 409 show nothing. An empty `event.action` keeps today's focus or open behaviour exactly. The worker stores no secret; the browser sends the cookie.
Files: `src/lib/swAnswer.ts` (new), `src/lib/swAnswer.test.ts` (new), `src/app/sw.ts` (edit)
Steps:
1. `swAnswer.ts`: `handleClick(event, deps)` where `deps` supplies `fetch`, `showNotification`, `matchAll`, `openWindow`, `origin`; the existing window logic moves here unchanged for the empty-action path. `sw.ts` calls it with the real globals.
2. The re-show uses the data kept on the notification (`title`, `body`, `tag`, `data`, `actions`); read them from `event.notification` before closing.
3. Tests with a fake event: `action: 'a'` closes, makes exactly one POST with `{jobId, questionId, answer:'a'}`, opens no window, shows nothing on 200; 401, then a thrown error: same tag shown again each time, `renotify` false, no window; 409 and 404 show nothing; empty action behaves like today (focus matching window, navigate another, else open).
Do not touch: the push handler logic (T15), caching rules, `public/sw.js`.
Proof: `npm test 2>&1 | grep -E "swAnswer|# (pass|fail)"` shows 0 failing. Before: no handler logic for `event.action` and the new tests do not exist.

## T17: question state API and the push log carries questionId
Status: TODO
Spec: must-do #16 (data half), #19; check #14 (data half)
Depends on: T1
Blocked by: none
Context: `src/lib/server/push/notifications.ts:82-95` `isNotificationEntry` validates the log line; it must accept an optional `questionId` (string or missing or null) without rejecting old lines. `GET /api/notifications` is `src/app/api/notifications/route.ts`. Questions live in `~/.sam/jobs/<jobId>/closer.json`; the web side only reads them. Job store path follows the existing `SAM_JOB_STORE` handling (look at `src/lib/server/jobRunMetrics.ts` and `fleet/floorState.ts` for the pattern). The read response must not echo file paths or secrets.
Files: `src/lib/server/push/notifications.ts` (edit), `src/lib/server/questions/questions.ts` (new), `src/lib/server/questions/questions.test.ts` (new), `src/app/api/questions/route.ts` (new), `src/lib/server/push/notifications.test.ts` (edit)
Steps:
1. `NotificationEntry` gains `questionId: string | null` (default null when absent); `isNotificationEntry` stays tolerant.
2. `questions.ts`: `readQuestions(jobIds?)` scans job dirs under the store (realpath containment, `^job_[A-Za-z0-9._-]+$`), reads each `closer.json` `questions` array, and returns per question only `{questionId, jobId, kind, text, options, gated, state, answeredAt, answeredVia, result}`. Bounded: newest 200 jobs.
3. `GET /api/questions`: `requireSession`, `export const dynamic = 'force-dynamic'`, uses `envelope` like `/api/notifications`.
4. Tests: old log lines still parse; a line with `questionId` parses; the reader skips a malformed `closer.json`, a symlinked dir outside the store, and returns no `acceptAction` or path fields; the route returns 401 with no cookie (follow `notificationsRoute.test.ts`).
Do not touch: the notifications page (T19), `POST` answer route (T18).
Proof: `npm test 2>&1 | grep -E "questions|notifications|# (pass|fail)"` shows 0 failing; `npm run typecheck` passes.

## T18: POST /api/questions/answer
Status: TODO
Spec: must-do #7, #10, #18, #19; check #6, check #7 (route half), check #10 (step-up half)
Depends on: T17, T13
Blocked by: none
Context: Auth: `requireSession` for ordinary questions, `requireStepUp` for a `gated` one (`src/lib/server/auth/guard.ts:14-49`; the 401 body carries `stepUpRequired`). Same-origin check on `sec-fetch-site` copied from `src/app/api/push/route.ts:29-33` (cross-site gives 403). No middleware exists; the route guards itself. The route reaches `closer.json` only by running `closer_answer.py` with `execFile` and fixed arguments, no shell. The route returns only `{questionId, state, changed, result}`. Gated status is read from the question record, never from the request.
Files: `src/app/api/questions/answer/route.ts` (new), `src/app/api/questions/answer/route.test.ts` (new), `src/lib/server/questions/answer.ts` (new)
Steps:
1. `answer.ts`: validate `jobId` (`^job_[A-Za-z0-9._-]+$`, directory directly inside the job store by realpath), `questionId` (`^q_[0-9a-f]{8}$`, present in that job's `closer.json`), `answer` (`a` or `b`); then `execFile(python3, [closerAnswerPath, jobId, questionId, answer, via])`. `closerAnswerPath` comes from `SAM_CLOSER_ANSWER_PY` (test seam) else `/home/col/.sam/closer/closer_answer.py`. `via` is `tab` unless the request header `x-answer-via: push` is sent by the service worker (add that header in the T16 code only if it is not already there; if T16 is merged without it, add it as a one-line edit and note it).
2. Route order: same-origin (403), session (401), parse and validate (400 or 404, nothing changed), gated check then step-up (401 `stepUpRequired`), run, return 200 with the four fields.
3. Tests with `SAM_JOB_STORE` and `SAM_CLOSER_ANSWER_PY` pointed at fixtures (the test uses the real `closer_answer.py.next` through the seam so the route and module are proven together; a dispatch stub via `SAM_DISPATCH_BIN` env on the child): no cookie 401; cross-site 403; `jobId` `../x`, a job outside the store, unknown `questionId`, `answer` `c` each 400 or 404 and `closer.json` byte identical; a gated question without step-up 401 with `stepUpRequired`, with step-up 200; ordinary question with session only 200; double answer gives `changed:false` second; response has exactly the four keys.
Do not touch: `guard.ts`, `session.ts`, any other route, `closer.json` directly (never written from TypeScript).
Proof: `npm test 2>&1 | grep -E "answer|# (pass|fail)"` shows 0 failing; `npm run typecheck` passes. Before: the route does not exist (404).

## T19: Notifications tab buttons
Status: TODO
Spec: must-do #16; check #14
Depends on: T17, T18, T16
Blocked by: none
Context: `src/app/(app)/notifications/page.tsx:40-135` fetches `/api/notifications` with `cache: 'no-store'` and renders each ping as one link; no buttons. Keep its rule: no unread counts, no badges, no deleting (`:12-13`). The service worker caches `/api/` GETs up to 60 seconds, so the questions fetch uses `cache: 'no-store'`. A gated open question shows Open; Open reveals the Accept and Decline buttons after the biometric step-up (look at how other pages trigger `/api/auth/stepup`). Pings without a `questionId` look and link exactly as today.
Files: `src/app/(app)/notifications/page.tsx` (edit), `src/app/(app)/notifications/QuestionRow.tsx` (new), `src/lib/questionView.ts` (new), `src/lib/questionView.test.ts` (new), `scripts/check-answer-tab.cjs` (new)
Steps:
1. `questionView.ts` (pure): joins entries to questions and decides the row state (`open`, `gated-open`, `accepted`, `declined`, `failed`, `none`) and its label; unit-tested.
2. `QuestionRow.tsx`: open: text with Accept and Decline (tap targets 44 px or more); answered: "Accepted" or "Declined" with the time and `result`, no buttons; failed: the reason. A press POSTs `/api/questions/answer` with `{jobId, questionId, answer}` and updates the row from the response without a reload.
3. `check-answer-tab.cjs`: same build-copy and Chromium method as T15 (port 3998), 412 by 915, fixture data via `SAM_PUSH_LOG` and `SAM_JOB_STORE` pointing at the fixture, `SAM_CLOSER_ANSWER_PY` pointing at the staged module with a dispatch stub, session cookie minted only through the app's own test path (if none exists, print `BLOCKED: <reason>; unblock: <what>`). Assert: open row shows text, Accept and Decline; pressing Accept updates to "Accepted" with no page reload and the endpoint received exactly one POST; an answered row has no buttons; a failed row shows its reason; a ping with no question is unchanged (same link target as `notificationTarget`).
Do not touch: `notificationTarget`, the push log writer, unread counts or deleting.
Proof: `npm test 2>&1 | grep -E "questionView|# (pass|fail)"` shows 0 failing; `node scripts/check-answer-tab.cjs` prints `PASS` for each assertion above. Before: no buttons exist in the page and it prints `FAIL`.

## T20: whole-system proof on the staged copies
Status: TODO
Spec: must-do #13, #19; check #15, check #16
Depends on: T12, T14, T19, T9
Blocked by: none
Context: Everything so far was proven piece by piece. This ticket proves the staged set together, still without installing anything: the secrets sweep (check 16) and the existing suites (check 15). It writes one new test script and nothing else.
Files: `/home/col/.sam/tests/test-answer-buttons-secrets.sh` (new)
Steps:
1. The script runs, against the overlay and the `.next` sam-push and notify copies, checks 1 to 14's closer-side fixtures (call the test scripts from T2 to T14 in sequence with their fixture roots kept until the end by an env flag `KEEP_FIXTURES=1` that you add to the new script only, not to `closer-fixtures.sh`; if keeping needs a fixture change, copy the fixture helper into the new script), then greps the push log, every `closer.json` and the housekeeping log they wrote for: cookie-like values (`sam_session=`, `Cookie:`), `sk-` followed by 8 or more characters, `Bearer `, VAPID key shaped strings (43 or more URL-safe base64 characters on a `privateKey` key), and the fixture's own fake secrets. None may be found. It prints counts only, never matched text.
2. Run `npm test` and `npm run typecheck` in the worktree, `bash /home/col/.sam/tests/test-closer-all.sh | tail -1`, and (with the overlay via `CLOSER_DIR`) `bash /home/col/.sam/tests/test-closer-quiet-pass.sh | tail -1`. Report every number.
Do not touch: any other file; if something fails, fix it in the ticket that owns it by reopening that ticket's `.next` file and say which ticket in the report.
Proof: `bash /home/col/.sam/tests/test-answer-buttons-secrets.sh | tail -1` prints `0 failed`; `npm test` exits 0; `test-closer-all.sh` ends `0 failed`; `test-closer-quiet-pass.sh` ends `0 failed`.

## T21: write the one install line
Status: TODO
Spec: must-do #13, #19; check #15 (after install), plan for check #16
Depends on: T20
Blocked by: none
Context: Colin has approved the build; SAM installs it in T22, so this ticket only stages `MANIFEST.next`, the test-all update and writes the instructions. Follow the format of `/home/col/.sam/closer/INSTALL-T24.txt` (one install line that stops at the first failure, a rollback line, a note of what is not touched). It must not run any step of the line.
Files: `/home/col/.sam/logs/answer-buttons-INSTALL.txt` (new), `/home/col/.sam/closer/MANIFEST.next` (new copy, edit), `/home/col/.sam/tests/test-closer-all.sh.next` (new copy, edit)
Steps:
1. `MANIFEST.next`: the live MANIFEST plus `closer_questions.py`, `closer_answer.py`, `closer-sources.txt`, `unblock-brief.md` stays as now. `test-closer-all.sh.next`: `NEXTS` gains every closer `.next` file in this build; the manifest check accepts the two new module names; nothing else changes. Prove the `.next` test-all copy ends `0 failed` with `bash /home/col/.sam/tests/test-closer-all.sh.next | tail -1` (it runs with live files as they are).
2. The install line (single line, `&&` chained) does, in order: back up each live file to `<file>.bak-20261008-answer-buttons` (or the date SAM runs it, use `date +%Y%m%d`) with `cp -p`: `closer.py`, `closer_blocked.py`, `closer_message.py`, `closer_next.py`, `closer_preview.py`, `closer_refuse.py`, `closer_relaunch.py`, `closer_vault.py`, `unblock-brief.md`, `MANIFEST`, `/home/col/.sam/notify-colin.sh`, `/home/col/.sam/sam-push/send.mjs`, `/home/col/.sam/tests/test-closer-all.sh` and each existing test that has a `.next` copy; then for each file `cp -p <file>.next .tmp-install-<name>` and `mv -f .tmp-install-<name> <file>` (temp file in the same folder, then `mv`, so no half-written live file; `send.mjs` keeps its symlink at `/home/col/.local/bin/sam-push`); new modules (`closer_questions.py`, `closer_answer.py`, `closer-sources.txt`) the same way with no backup; then the tests on live: `bash test-closer-all.sh | tail -1`, `bash test-closer-questions.sh | tail -1`, `bash test-closer-answer.sh | tail -1`, `bash test-sam-push-question.sh | tail -1`, `bash test-notify-colin-question.sh | tail -1`, `bash test-answer-buttons-secrets.sh | tail -1`, each of which must print `0 failed` (the line stops at the first failure through `&&`; use a `grep -q " 0 failed"` guard so a failure exits non-zero).
3. A rollback line restores every backup the same temp-file-and-`mv` way. A closing note says what is not touched: `sam-dispatch`, `sam-job`, `run.sh`, units, timers, job dirs, the real push log, `sam-ui.service`.
4. After install the live files equal their `.next` copies, which `test-closer-all.sh` counts as installed (`:70-71`); say so.
Do not touch: any live file, `stage.sums` (the install makes live equal `.next`, which the test accepts).
Proof: `test -s /home/col/.sam/logs/answer-buttons-INSTALL.txt && grep -c "&&" /home/col/.sam/logs/answer-buttons-INSTALL.txt` and `bash /home/col/.sam/tests/test-closer-all.sh.next | tail -1` ends `0 failed`; and run `for f in /home/col/.sam/closer/closer.py /home/col/.sam/notify-colin.sh /home/col/.sam/sam-push/send.mjs; do sha256sum "$f"; done` before and after the ticket and show they are unchanged.

## T22: GATE: SAM installs and deploys
Status: TODO
Spec: must-do #4, #5, #8, #12 (deployed behaviour); check #15 (on live)
Depends on: T21
Blocked by: SAM's own go-ahead after checking the proof of T1 to T21 (Colin has approved the build)
Context: A worker does not do this ticket. SAM does it, after checking each earlier ticket's proof line itself (not the workers' reports): run the Proof commands of T1 to T21 and confirm each result. If any proof fails, stop and send that ticket back; do not install.
Files: the install line in `/home/col/.sam/logs/answer-buttons-INSTALL.txt` (run as written); `/home/col/SAM_ui-answer-buttons-spec` branch `spec/answer-buttons`; `deploy.sh`
Steps:
1. Run the install line. It stops at the first failure; if it does, run the rollback line and report.
2. Merge `spec/answer-buttons` into `main` in SAM_ui, then use `deploy.sh` (build, test, restart `sam-ui.service`, wait for health). Do not use `--force` without reporting why.
3. Confirm `https://super-awesome-machine.tail2eadff.ts.net/sw.js` serves the new worker (contains `questionId`) and that `GET /api/questions` answers 401 without a cookie.
4. Send the closer a fixture question (a test job in the real store marked as a test, or one real job) and confirm one push with two buttons reaches the phone; report. Then hand to T23.
Do not touch: `sam-dispatch` guards, any must-do 6 action beyond the deploy and install this ticket is.
Proof: `bash /home/col/.sam/tests/test-closer-all.sh | tail -1` ends `0 failed` on live; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/questions` prints `401`; `systemctl --user is-active sam-ui` (or the unit's real scope) prints `active`.

## T23: GATE: Colin checks it on the Samsung A16
Status: TODO
Spec: must-do #4, #5, #8, #9; check #18
Depends on: T22
Blocked by: Colin
Context: Only Colin can do this. SAM sends him a real question (or one he asks for) and waits for his answer. Nothing is merged or changed in this ticket.
Files: none
Steps:
1. A real question arrives as a home screen notification with Accept and Decline.
2. Pressing Decline from the lock screen opens nothing; the Notifications tab then shows it as Declined.
3. Pressing Accept on a relaunch question starts the job.
4. Colin tells SAM yes or no. If anything differs, SAM opens a ticket for it; if the session cookie has expired the press re-shows the notification (spec open question 3: SAM checks how often before changing anything).
Do not touch: anything.
Proof: Colin's confirmation for each of the three steps, recorded in the daily note by SAM.

## Coverage

Every must-do 1 to 19 and every check 1 to 18 maps to at least one ticket. A ticket marked (part) proves one half and is completed by the other.

| Spec must-do | Tickets |
|---|---|
| 1 question record | T1, T4, T6, T7, T8 |
| 2 one pinged question per notification | T12 |
| 3 sam-push flags, notify passes through | T10, T11 |
| 4 service worker shows actions | T15 |
| 5 lock screen press posts the answer | T16, T22, T23 |
| 6 failure re-shows the notification | T16 |
| 7 answer endpoint auth and validation | T18, T13 |
| 8 closer_answer applies the answer | T13, T14, T22, T23 |
| 9 Decline does nothing else | T13, T14, T23 |
| 10 gated questions | T6, T7, T8, T12, T18 |
| 11 idempotent | T13, T18 |
| 12 failure sends one ping | T14, T22 |
| 13 housekeeping rows | T2, T4, T5, T20, T21 |
| 14 daily note creation, brief-bug logging | T2, T3 |
| 15 every needs line classified | T1, T9 |
| 16 Notifications tab | T17, T19 |
| 17 Telegram plain text | T11, T12 |
| 18 only Colin's session answers | T10, T18, T22, T23 |
| 19 no secret anywhere | T1, T10, T13, T17, T18, T20, T21 |

| Spec check | Ticket |
|---|---|
| 1 question record exists | T6 (T7 and T8 for the other sources) |
| 2 push payload | T10 |
| 3 browser check of the buttons | T15 |
| 4 click handler | T16 |
| 5 failure path | T16 |
| 6 endpoint auth and validation | T18 |
| 7 idempotent | T13 (module), T18 (route), T14 (dispatcher called once) |
| 8 Accept runs the machinery behind the stubs | T14 |
| 9 Decline does nothing else | T13, T14 |
| 10 gated | T6 and T7 (created gated), T12 (one Open action), T18 (step-up) |
| 11 housekeeping is no longer a question | T2, T4, T5 (T12 for the message half) |
| 12 daily note creation | T3 |
| 13 classification is complete | T9 |
| 14 Notifications tab | T19 (T17 for the data) |
| 15 existing suites | T20, T21, T22 |
| 16 secrets | T20 |
| 17 Telegram | T12 (T11 for the script) |
| 18 Colin confirms on the A16 | T23 |

Notes for SAM:
- Spec gap: `closer_preview.py:168` and `:170` (the "Swap X to Y?" asks) are not in section 3. T8 treats them as gated questions with `acceptAction: none` and T9 lists them as `swap-offer`. Confirm with Colin or change the ticket.
- Spec open question 1 was answered (no Telegram buttons), so check 17 is not conditional.
- Accept failure notices (T14) go by `sam-push` only, not Telegram, to keep check 8's "sam-push call count 1" literal and to avoid the real Telegram call in tests.
