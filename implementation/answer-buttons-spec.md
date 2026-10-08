# Answer buttons on SAM's questions: spec

Status: LOCKED 2026-10-08 (Colin answered all six open questions, SAM's recommendations taken). Was: DRAFT. Not grilled: this is written from Colin's message of 2026-10-08 and the brief that followed it, so the open questions at the end are real.

Priorities entry: Job closer. Scope: business.

## 1. Goal

When SAM asks Colin a yes/no question, the notification on his Samsung A16 carries two buttons, Accept and Decline. He presses one from the lock screen or the shade and SAM acts on it, without opening the app. The same question and the same two buttons are in the Notifications tab as the fallback. Questions that are really SAM's own housekeeping stop being questions at all.

Colin's words: "the messages still say 'do you want me to deal with that' and 'yes or no' with no way to respond. A small accept or decline button in the noti itself (the ping tab if the phone home screen noti isnt doable)".

## 2. What exists today (read from the code)

- Every question is a plain string in `needsYou` in the job's `closer.json`. There is no id, no kind, no state. `compose` turns each line into text ending "Yes or no?" or "A, B or C?" (`/home/col/.sam/closer/closer_message.py:49-61`, `:91-126`). Nothing can answer it.
- The closer sends the text with `_notify` (`closer_message.py:129-137`), which runs `/home/col/.sam/notify-colin.sh`. That script sends Telegram, then `sam-push --title --body --tag alert`, then falls back to the OS bridge (`notify-colin.sh`, channels 1 and 2).
- `sam-push` (`/home/col/.local/bin/sam-push:91-100`) appends one line `{ id, ts, title, body, url, tag, chatId, jobId }` to `~/.sam/push-log.jsonl` before it sends, then sends the Web Push payload `{ title, body, url, tag, ts }` (`sam-push:124`). The payload has no `actions` field.
- The service worker source is `src/app/sw.ts`. The file the browser is served is `public/sw.js`, which does not exist in git: Serwist builds it from `sw.ts` (`next.config.mjs:56-57`) and it is gitignored (`.gitignore:45`). So the change goes in `sw.ts` and needs a rebuild and deploy. The `push` handler is `sw.ts:96-120` and calls `showNotification` with no `actions`. `notificationclick` is `sw.ts:122-160` and only focuses or opens a window; it ignores `event.action`.
- `sw.ts:33-40` caches GET `/api/` calls network first for at most 60 seconds. Question state must be fetched with `cache: 'no-store'`, as `src/app/(app)/notifications/page.tsx:54` already does.
- `GET /api/notifications` (`src/app/api/notifications/route.ts:23-38`) lists the push log with `requireSession`. The log shape is validated by `isNotificationEntry` (`src/lib/server/push/notifications.ts:82-95`). The page (`notifications/page.tsx:100-135`) renders each ping as one link and has no buttons.
- Auth: `requireSession` for reads, `requireStepUp` (biometric) for writes that run things (`src/lib/server/auth/guard.ts:14-49`). `POST /api/push` adds a same-origin check on `sec-fetch-site` (`src/app/api/push/route.ts:29-33`). There is no middleware; each route guards itself.
- The closer already has the machinery an Accept would use: `sam-dispatch --relaunch-of JOB_ID` (`~/.local/bin/sam-dispatch:15`, `:89`), the seat guard (exit 4) and folder guard (exit 5) (`closer_blocked.py:259-262`), and the T24 Opus decision job (`closer_blocked.py:347-367`, Job_Closer_Spec must-do 17).

## 3. Every needsYou source, and what it becomes

Today everything below reaches Colin as a "Yes or no?". The ruling for each is the point of this section.

Stays a question (a real decision for Colin):

| Source | Where | Becomes |
|---|---|---|
| Blocked job, needs Colin (category, or SAM could not clear it) | `closer_blocked.py:370-373`, `:396-403` | Question. Accept = run the T24 decision job with Colin's answer. Gated if the block is a must-do 6 category. |
| Opus decision says `colin` | `closer_blocked.py:292-293` | Question. Text is the Opus note. It sets `kind` and `gated` in `unblock.json`. |
| Stale file moved but relaunch did not start | `closer_blocked.py:440-442` | Question. Accept = relaunch again through `sam-dispatch --relaunch-of`. |
| Seat or weekly limit death, SAM did not relaunch ("Relaunch it yourself?") | `closer_relaunch.py` limit branches (the five "Relaunch it yourself" lines in `plan`) | Question. Accept = `sam-dispatch --relaunch-of` with the resume note (`closer_relaunch.py:169-193`). Seat and folder guards still apply. |
| A command or step the closer refused as a must-do 6 category ("Do you want me to X?") | `closer_refuse.py:107-109`, `:176`; `closer.py:168-169`; `closer_next.py:140-144` | Question, gated. |
| Follow-on dispatch refused or did not start ("Run it later?") | `closer_next.py:153`, `:160` | Question. Accept = T24-style decision job with the instruction "run it now". |
| Preview swap failed part way, or failed and rollback failed | `closer_preview.py:209-210`, `:219` | Question, gated (touches a running service). |

Stops being a question (SAM's own job; logged, not asked):

| Source | Where | Becomes |
|---|---|---|
| The daily note does not exist | `closer_vault.py:235-239` | SAM creates the note from the vault template, then writes the Job closed line. Only if creation itself fails is it logged as housekeeping. |
| The brief has no Priorities entry line | `closer_vault.py:407-409` | Housekeeping log: SAM's brief bug. |
| Priorities entry matched 0 or 2 entries | `closer_vault.py:322-324` | Housekeeping log: SAM's brief bug. |
| The brief has no Scope line, or not business or personal | `closer_vault.py:368-373` | Housekeeping log (the closer already defaults to personal). |
| Active Priorities.md not found | `closer_vault.py:309-311` | Housekeeping log. |
| Priorities drift check failed (restored) or drift already present | `closer_vault.py:349-354` | Housekeeping log. |
| Daily note, ledger or priorities write failed (OS error) | `closer_vault.py:388-389`, `:404-405`, `:416-417` | Housekeeping log. |
| Vault write, relaunch planning, blocked handling, follow-on steps, preview swap or output reading raised an exception | `closer.py:140`, `:148`, `:162`, `:173`, `:179`, `:189` | Housekeeping log. These are closer bugs; they also set `closerError` so the existing failure message rule (`closer_message.py:244`) is unchanged. |
| Follow-on "only dispatch steps are run", "chain too long", "brief file does not exist" | `closer_next.py:100`, `:151`, `:155` | Housekeeping log (a malformed brief). |
| "Checks did not pass, so X was not run" | `closer_next.py:149` | Information in the verdict line, no question. |
| Decision job named a folder outside the store, or ended without a valid `unblock.json` | `closer_blocked.py:277`, `:286-288` | Housekeeping log. SAM does not ask whether it may look at its own failure. |
| Swap rolled back because the preview did not serve the new build | `closer_preview.py:220` | Information. The rollback line already reaches Colin (`closer_message.py:246-247`). |

Housekeeping log means: an entry in a new `housekeeping` list in `closer.json` (text, source, time), plus one line appended to `~/.sam/logs/closer-housekeeping.log`. It never creates a question, never sets `needsYou`, and never causes a message on its own.

## 4. Must do

Questions and notifications

1. Every question to Colin is a record in the job's `closer.json` under `questions`, with: `id` (`q_` plus 8 random hex characters, unique across jobs), `kind` (`yesno`, `choice2` for exactly two options, or `open` for anything else), `text` (the sanitised question), `options` (for `choice2`, two labels of at most 20 characters; for `yesno`, "Accept" and "Decline"), `source` (which row of section 3), `gated` (true or false, see 10), `acceptAction` (what Accept does, see 8), `state` (`open`, `accepted`, `declined`, `failed`), `createdAt`, `answeredAt`, `answeredVia` (`push` or `tab`), and `result` (a one-line outcome). `needsYou` stays as the plain text list for the dashboard; each entry is derived from a question.
2. The closer's message carries at most one pinged question per notification. If a job has two real questions it sends two notifications (one `sam-push` call each), each with its own id. The body of the notification states the question once; the "Yes or no?" tail is dropped from push, because the buttons are the answer.
3. `sam-push` gains `--question <id>` and `--options "<a>|<b>"` (default Accept and Decline). It adds `questionId` to the push log line, and `actions: [{action, title}, ...]` (at most 2), `questionId` and `jobId` to the Web Push payload. The payload carries ids and labels only: no token, cookie, key or file path. `notify-colin.sh` passes them through to its `sam-push` call; its Telegram message is covered by 16.
4. The service worker `push` handler shows `actions` from the payload when present: at most 2, each `action` one of `a` or `b`, each title a string of at most 20 characters; anything else is dropped. The notification tag is `q-<id>` so a repeat replaces rather than stacks. Tapping the body opens the job's page (`/jobs/<jobId>`) as today.

Answering

5. Pressing Accept or Decline from the lock screen or shade does not open the app. `notificationclick` checks `event.action`; for `a` or `b` it closes the notification and sends one same-origin `POST /api/questions/answer` with `{ jobId, questionId, answer }` and the session cookie (`credentials: 'same-origin'`), inside `event.waitUntil`. On success it shows nothing new. A tap on the body (empty `event.action`) behaves exactly as `sw.ts:122-160` does today.
6. If the POST fails (401 because the session has expired, a network error, or a 5xx), the worker shows the same notification again with the same tag and no sound (`renotify` false), so the buttons are still there, and does not open the app. It does not post a new ping. A 4xx that means the question is already answered or unknown (409, 404) shows nothing.
7. `POST /api/questions/answer` requires a valid session (`requireSession`) and `sec-fetch-site` of `same-origin` (as `src/app/api/push/route.ts:29-33`); otherwise 401 or 403. For a `gated` question it requires `requireStepUp` instead (see 10). It accepts only: a `jobId` matching `^job_[A-Za-z0-9._-]+$` whose directory exists directly inside the job store (`~/.sam/jobs`, resolved with realpath, the same containment check as `closer_blocked.py:273-278`); a `questionId` that exists in that job's `closer.json`; and an `answer` of `a` or `b`. Anything else is 400 or 404 and changes nothing.
8. The answer is applied by a new `closer_answer.py` beside the other closer modules, called by the route with `execFile` and fixed arguments (no shell). It takes the job's lock, re-reads `closer.json`, applies the answer only if `state` is `open`, writes the file atomically (temp file and rename, as `closer_vault.py` does), then runs the action. It is the only code that changes a question's state. What Accept does depends on `acceptAction`:
   - `relaunch`: `sam-dispatch --relaunch-of <jobId>` with the existing resume note, through the `SAM_DISPATCH_BIN` seam. The seat guard (exit 4) and folder guard (exit 5) still apply and are never overridden.
   - `decision`: one T24 Opus decision job (`--tier opus --task judgement`, closer on), whose brief is the existing decision brief plus a line "Colin answered Accept to: <question text>". Colin's answer is the instruction. It runs under the same rules as any decision job (Job_Closer_Spec must-do 17): no deploy, delete, spend or contact without its gate.
   - `none`: records the answer only (for informational questions that arrive with a button).
9. Decline records `declined`, sets `answeredAt`, and does nothing else. It closes the question. It never dispatches anything.
10. A question is `gated` when its source is a must-do 6 category (deploy, merge, change to a running service, deletion, spending, a send to anyone except Colin, a push to a remote, or a brief gate): the sources marked gated in section 3, and any `colin` decision whose `unblock.json` does not say `"gated": false` (missing means gated). A gated notification carries one action, Open, not Accept and Decline. The Notifications tab and job page show Accept and Decline, and Accept requires the biometric step-up (`requireStepUp`, `guard.ts:35-49`). Nothing from must-do 6 can be approved from the lock screen.
11. The answer is idempotent. A second press, a press on the other device's copy, or an answer to a question whose `state` is not `open` returns 200 with `changed: false` and the recorded state, and runs nothing. Two simultaneous answers: exactly one wins (the lock in 8), the other gets `changed: false`.
12. If the Accept action fails (a dispatch exit other than 0, including 4 and 5), `state` becomes `failed`, `result` holds the reason in one line (for example "the seat guard refused it"), and Colin gets exactly one notification saying so, with no buttons. This is the only case where answering produces a new ping. A successful Accept produces none; the job's own closer message arrives later as it does today.

Housekeeping

13. Every "Stops being a question" row in section 3 is written to `housekeeping` and the log, never to `questions` or `needsYou`, and never creates a notification of its own. A job whose only findings are housekeeping, with a PASS verdict, sends nothing (`needs_message`, `closer_message.py:238-252`, keeps working: it already sends nothing for a quiet PASS).
14. When the daily note for the day does not exist, SAM creates it from the vault's daily note template (`/home/col/ai-memory-vault/01 - Daily Notes/Daily Note Template.md`, the one CLAUDE.md names; SAM corrected the path 2026-10-08) in the month folder `01 - Daily Notes/<MM> - <Month> <YYYY>/`, then writes the Job closed line as now. A brief with no Priorities entry line, or one that matches 0 or 2 entries, is logged to `housekeeping` with the job id and the line the author should fix.
15. Every `needsYou` line in the closer's code is classified by section 3. None is left unclassified: a line that is not a decision becomes housekeeping or information by default, and only a source listed as "Stays a question" can create a `questions` record.

The Notifications tab

16. The Notifications tab (`src/app/(app)/notifications/page.tsx`) joins each ping that has a `questionId` to its question (new `GET /api/questions`, session required, `cache: 'no-store'`). An open question shows its text with Accept and Decline buttons (Open for a gated one, then the buttons after step-up). An answered one shows "Accepted" or "Declined" with the time and `result`, and no buttons. A failed one shows the reason. Pressing a button here uses the same endpoint as 7 and updates the row without a reload. Pings without a question look and link as today.

Telegram, security, logging

17. Telegram: the closer's message to Telegram stays plain text with no buttons and no "Yes or no?" tail replaced by anything interactive; its last line says "Answer in the SAM notification." This is subject to open question 1.
18. Only Colin's session can answer: the cookie session, the same-origin check, the id checks in 7 and the step-up for gated questions are the only paths. No answer is accepted from `sam-push`, Telegram or any script. The service worker never stores or reads a secret: it relies on the browser sending the cookie.
19. No secret appears in any push payload, push log line, `closer.json` question, housekeeping log or API response. `closer_answer.py` runs its text through the closer's existing scrub (`core.scrub`) before writing, and the route returns only `{ questionId, state, changed, result }`.

## 5. Won't do

- Buttons on Telegram messages (inline keyboard), unless open question 1 is answered yes.
- More than two buttons, or free-text replies from the notification. A choice of three or more stays a text question (`kind: open`) answered in chat.
- Approving a gated (must-do 6) question from the lock screen.
- Changing the other pings (chat replies, schedule, job-done). Only closer questions get action buttons.
- Silently dismissing the notification copy on a second device when one device answers. The tab shows it as answered; the other copy's buttons then return `changed: false`.
- Expiring or auto-answering old questions.
- Any change to the closer's verdicts, relaunch cap logic, seat guard, folder guard or must-do 6.
- A new push channel, new VAPID keys, or any change to how subscriptions are stored.
- Native Android (TWA) action handling beyond what the installed PWA's Web Push gives.

## 6. Constraints and locked decisions

- Job_Closer_Spec is LOCKED 2026-10-07 (amended 2026-10-08): `/home/col/ai-memory-vault/02 - Atwood Systems/00_SAM_Control/Job_Closer_Spec.md`.
  - Must-do 6: the closer never deploys, deletes, spends, sends externally, pushes or changes a running service. Gated questions (10) exist so Accept cannot bypass this.
  - Must-do 16 and 17: blocks escalate to SAM first, then an Opus decision, and Colin only when he must decide. Colin hears nothing for a block SAM cleared. Unchanged; this spec only adds how his decision is taken.
  - Must-do 18: quiet passes (Colin 2026-10-08). Unchanged; 13 keeps it true.
- The seat guard (exit 4) and folder guard (exit 5) in `sam-dispatch` are never overridden by an answer (`closer_blocked.py:259-262`).
- Plain text rule for messages: no em or en dashes, no double asterisks, no backticks, at most 600 characters (`closer_message.py:1-7`, `:17`).
- Fewer pings (Colin 2026-10-08): an answer makes no new ping except a failure (12).
- The Notifications tab keeps its rule of no unread counts, badges or deleting (`notifications/page.tsx:12-13`).
- The served service worker is built, not edited: change `src/app/sw.ts`, rebuild and deploy; `public/sw.js` is generated (`next.config.mjs:56-57`, `.gitignore:45`).
- Write access to `~/.sam/jobs/*/closer.json` stays with the closer code; the web route reaches it only through `closer_answer.py` (8).
- Code that changes system files outside SAM_ui (`sam-push`, `notify-colin.sh`, the closer) is a system change: the build must follow the usual backup and `Enforced by:` rules, and the Job Closer's existing test suite (`~/.sam/tests/test-closer-all.sh`) must stay green.

## 7. Done means

Each check fails before the build and passes after it. Numbers in brackets map to the must-dos.

1. A question record exists. Run the closer on a fixture job that produces a blocked-needs-Colin line; `closer.json` contains `questions[0]` with `id`, `kind`, `state: "open"`, `acceptAction`, `gated`. Before: only `needsYou` text. (1, 2)
2. Push payload. Run `sam-push` with `--question q_test --options "Accept|Decline"` against a test subs file and log; the log line has `questionId`, and the payload sent to a stub has two `actions` and `questionId`, and contains no string matching the cookie, token or key patterns. Before: flag unknown, exit 2. (3, 19)
3. Browser check of the buttons. In Chromium (Playwright or the DevTools protocol) against the built app at 412 by 915 (Samsung A16 viewport), register the real service worker, deliver a push with two actions through `ServiceWorker.deliverPushMessage`, and read `registration.getNotifications()`: exactly one notification, tag `q-<id>`, `actions.length === 2`, titles Accept and Decline, `data.url` `/jobs/<jobId>`. A payload with three actions shows two; an action id outside `a` or `b` is dropped. Before: `actions` is empty. (4)
4. Click handler. A unit test imports the `notificationclick` logic with a fake event: `action: 'a'` closes the notification, makes one POST to `/api/questions/answer` with `{ jobId, questionId, answer: 'a' }`, opens no window, shows no notification on a 200. An empty action focuses or opens the job page as `sw.ts:122-160` does today. (5)
5. Failure path. The same test with the fetch returning 401 and then a thrown network error: the same tag is shown again, no window is opened, no second distinct tag is created. With a 409 nothing is shown. (6)
6. Endpoint auth and validation. Route tests: no cookie gives 401; a cross-site `sec-fetch-site` gives 403; `jobId` of `../x`, a job outside the store, an unknown `questionId`, and `answer` of `c` each give 400 or 404 and leave `closer.json` byte-identical; a gated question without step-up gives 401 with `stepUpRequired`. (7, 10, 18)
7. Idempotent. Answer the same open question twice, and twice in parallel: the first returns `changed: true`, the rest `changed: false`; the stub dispatcher is called exactly once and `closer.json` holds one `answeredAt`. Answering a `declined` question with Accept changes nothing. (8, 11)
8. Accept runs the machinery, behind the stubs. With `SAM_DISPATCH_BIN` stubbed: a `relaunch` question's Accept calls it once with `--relaunch-of <jobId>`; a `decision` question's Accept calls it once with `--tier opus --task judgement` and a brief containing "Colin answered Accept". A stub exiting 4 sets `state: "failed"`, `result` mentions the seat guard, and exactly one failure notification is sent (stub `sam-push` call count 1). (8, 12)
9. Decline does nothing else. Decline a `relaunch` question: `state: "declined"`, the dispatch stub is never called, no notification is sent. (9)
10. Gated. A refused-category question (for example "deploy the site") is created with `gated: true`; its notification payload has one action, Open; its Accept through the endpoint fails without step-up and succeeds with it (stubbed). A `colin` decision with no `gated` field in `unblock.json` is gated. (10)
11. Housekeeping is no longer a question. Fixture jobs for: no daily note, brief with no Priorities entry line, Priorities entry matching 2 entries, no Scope line. For each, `closer.json` has an empty `questions` and `needsYou` for that cause, a `housekeeping` entry, and the message stub is never called when the verdict is PASS. Before this build the same fixtures put the line in `needsYou` and send a message. (13, 15)
12. Daily note creation. With no note for the day in a temp vault, the closer creates it from the template in the right month folder and writes one Job closed line; running it again adds no second line. (14)
13. Classification is complete. A test greps the closer modules for every string added to a needs list and fails if any is not in the section 3 table (a checked-in list of expected sources), so a new needs line cannot slip in as a question. (15)
14. Notifications tab, in a browser at 412 by 915 against fixture data: an open question row shows its text, Accept and Decline; pressing Accept updates the row to "Accepted" without reload and the endpoint receives one POST; an answered row has no buttons; a failed row shows its reason; a ping with no question looks as before. (16)
15. Existing suites. `npm test` in SAM_ui and `~/.sam/tests/test-closer-all.sh` pass, including `test-closer-quiet-pass.sh`. (13, 19)
16. Secrets. A grep of the push log, `closer.json` and housekeeping log written during checks 1 to 14 finds no cookie value, VAPID key or token. (19)
17. Telegram. The text sent to the Telegram stub for a question has no `reply_markup`, no "Yes or no?" tail, and ends "Answer in the SAM notification." (17, subject to open question 1)
18. Colin confirms on his Samsung A16: a real question arrives as a home screen notification with Accept and Decline; pressing Decline from the lock screen opens nothing and the Notifications tab then shows it as Declined; pressing Accept on a relaunch question starts the job. (4, 5, 8, 9)

## 8. Open questions

1. ANSWERED 2026-10-08 (Colin: "agree", SAM's recommendation taken): Telegram buttons. Should the Telegram copy of a question get inline keyboard buttons? SAM recommends no: push only. Buttons on Telegram need a bot callback listener (a new always-on process and a second answer path to secure), and the aim is fewer pings, not more places to answer. Telegram stays the plain text record with "Answer in the SAM notification."
2. ANSWERED 2026-10-08 (Colin: "yes", SAM's recommendation taken): Step-up for non-gated Accept. A lock screen press uses the cookie session only, because biometric step-up cannot be asked from a notification. SAM recommends this for non-gated questions, since Accept only starts jobs through `sam-dispatch` and its seat and folder guards, and anything in must-do 6 is gated and needs the step-up in the app. The alternative is step-up for every Accept, which defeats the lock screen button.
3. ANSWERED 2026-10-08 (Colin: "yes", SAM's recommendation taken): Session expiry. If the session cookie has expired the lock screen press cannot answer (6 re-shows the notification). SAM recommends leaving the session lifetime as it is and checking on the phone how often this happens before changing anything.
4. ANSWERED 2026-10-08 (Colin: "yes", SAM's recommendation taken): Relaunch cap. Does Colin's Accept on a blocked-job question count towards the two-relaunch cap (Job_Closer_Spec must-do 16)? SAM recommends it does not, because it is Colin's explicit instruction, but each question can be accepted once so it cannot loop.
5. ANSWERED 2026-10-08 (Colin: "yes", SAM's recommendation taken): Gated default. Should a `colin` decision with no `gated` field be treated as gated (as 10 says)? SAM recommends yes, as the safe default. It means some harmless questions show Open instead of Accept and Decline until the decision brief is updated to set `gated: false`.
6. ANSWERED 2026-10-08 (Colin: "yes", SAM's recommendation taken): Information-only messages. Housekeeping and rollback notices no longer ask anything. SAM recommends they show on the dashboard's finished-jobs list only, with no ping (a ping only for failure, as must-do 18). Colin may prefer a once-a-day housekeeping digest instead.
