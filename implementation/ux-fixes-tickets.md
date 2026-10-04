# SAM_ui UX fixes, job summary and revoke fix: build tickets

Spec: [ux-fixes-spec.md](ux-fixes-spec.md) (Status: LOCKED 2026-10-03, amended 2026-10-03 18:55 for Must 31)
Written: 2026-10-03, from a read of SAM_ui-ux-fixes at `a06ceea` on `build/ux-fixes`, plus a live read of `/home/col/.local/bin/sam-dispatch`, `sam-job`, `sam-stage` on this box.
House precedent: `implementation/visual-upgrade-tickets.md` (same repo's last build; its "staged `.next` copy" pattern for live system files is reused here unchanged).

## Read before any ticket

- **Branch/worktree.** Build in `/home/col/SAM_ui-ux-fixes`, branch `build/ux-fixes`, cut from `a06ceea`. Never touch `/home/col/SAM_ui` (production, behind `sam-ui.service`). Never run `./deploy.sh`, `next dev` on port 3000, or restart any service.
- **Gates for every ticket.** `npm run typecheck`, `npm run lint` and `npm test` pass at the end of the ticket (install first with `npx -y npm@10 ci --include=dev` — this shell has `NODE_ENV=production`, which makes a plain `npm install` drop dev deps). Never commit, push, merge or deploy; that needs Colin's go.
- **SURPRISE, read this before T4/T5/T6 (found 2026-10-03 while readying these tickets).** The *previous* build (`visual-upgrade-tickets.md` T2–T4) staged `sam-dispatch.next`/`sam-job.next`/`sam-stage.next` and said they'd install only on Colin's go — but no `.next` siblings survive in `/home/col/.local/bin/` today; the General/Stages/`events.jsonl`/`sam-stage` work is already **live** (confirmed by reading the real files: `sam-dispatch:97-110,139`, `sam-job:54-73,140-177`, `sam-stage` all exist and work today). So: `General:`/`Stages:` brief validation, `meta.json`'s `general`/`stages`/`origin` fields, `events.jsonl`'s `dispatched`/`started`/`stage-start`/`stage-done`/`ended` events, and `sam-stage start/done` all already work — **do not re-build them.** What's still missing, confirmed by reading the exec line (`sam-dispatch:139-140`): no `tier` field is ever written to `meta.json` (only buried in `command`'s `--model` string and in `summary`), and no brief ever gets a "call `sam-stage`" instruction appended. T4 and T5 scope to exactly those two gaps.
- **This build follows the same live-system-file rule the spec restates**: any further change to `sam-dispatch`, `sam-job`, `sam-stage`, or either seat's `~/.claude/settings.json` ships as a `.next` copy (or, for settings.json, a snippet file) next to the live file, installed only on Colin's go. T4, T5, T6 stage as `.next`/`.next2` — never edit the live files in `/home/col/.local/bin/` or either `settings.json` directly. Each staged file needs a line in today's daily note naming it with `Enforced by: <test that fails before and passes after>`.
- **Tests never touch live state.** Every new test that reads/writes `~/.sam/jobs`, `~/.sam/auth`, or the credential store sets `HOME` to a fresh temp dir before importing the module under test (same pattern as `src/lib/server/fleet/samJobEvents.test.ts`'s header comment). CLI-script tests that need `systemd-run --user` to run a real job are box-only — guard with `src/lib/server/testing/boxOnly.ts`, same as `samJobEvents.test.ts`/`samStage.test.ts` did.
- **Local test server for browser checks** binds `127.0.0.1` on a port 4900–4999, and is killed before the ticket ends. Any browser check needing login uses the throwaway-passkey method in `/home/col/delivery/ux-audits/sam-ui-20261003/audit-loggedin.mjs` against that local server only — never the live site — and the passkey is revoked at the end of the run. Never print the enrolment token, a cookie, or a session value.
- **`verify()` is the one chokepoint.** `src/lib/server/auth/session.ts:162-174`'s `verify()` is called by both `verifySession` (line 215) and `verifyStepUp` (line 222) — fixing the revoke check once, there, covers both cookies and every route that calls `requireSession`/`requireStepUp` (`src/lib/server/auth/guard.ts`).
- **Won't-do reminders that bind every ticket below:** no redesign of any page's layout (contrast/labels/size/zoom/particle-backing changes only); no change to `sam-dispatch`'s model/tier routing or seat picking; no AI-written job summary or per-job progress bar/percentage beyond "Stage n of m"; no change to the 30-day session lifetime or step-up window lengths; no speed/Lighthouse or keyboard-nav pass.

---

## T1: Revoked credential fails every session check immediately
Status: DONE 2026-10-03 (session.test.ts's 3 cases pass; typecheck/lint/test/build all clean; also fixed 2 pre-existing test fixtures — streamOrphan.test.ts, notificationsRoute.test.ts — that needed a registered credential once verify() started checking the store)
Spec: must-do 18, 19; check 11
Depends on: none
Blocked by: none
Model: sonnet
Context: Today `verify()` (`src/lib/server/auth/session.ts:162-174`) only checks the JWT's signature and expiry — a session cookie whose credential has since been removed via Settings → Revoke (`CredentialStore.remove`, `store.ts:161-168`, called from `DELETE /api/auth/devices`, `src/app/api/auth/devices/route.ts:52`) keeps passing every check for up to 30 days (`SESSION_MAX_AGE`, session.ts:87). The JWT's `sub` claim *is* the credential's `credentialId` (session.ts:134-136, minted in `stepup/route.ts:103-107` and the initial-login verify route) — `getCredentialStore().findByCredentialId(credentialId)` (`store.ts:146-149`) already does exactly the lookup needed; this is a missing call, not new storage.
Files: src/lib/server/auth/session.ts (edit), src/lib/server/auth/session.test.ts (new file)
Steps:
1. In `verify()` (session.ts:162-174), after the `jwtVerify` call succeeds and before returning the payload, call `await getCredentialStore().findByCredentialId(payload.sub as string)`; if it returns `null`, return `null` from `verify()` (same fail-closed shape every other branch already uses). Import `getCredentialStore` from `./store`.
2. No other change: `verifySession`/`verifyStepUp`'s own logic (cookie extraction, presence-epoch check) is untouched — they both already funnel through `verify()`.
3. `session.test.ts`: set `HOME` to a fresh temp dir before importing `session.ts`/`store.ts` (so both the JWT key and the credential file land there, not in `~/.sam`). Add a credential via `getCredentialStore().add(...)` (any valid `StoredCredential` shape), mint a session + step-up cookie pair via `createSessionCookies({ sub: credentialId, device: 'test', iat: ... })`, and assert: (a) `verifySession`/`verifyStepUp` both return the payload while the credential exists; (b) after `getCredentialStore().remove(credentialId)`, both return `null` for the *same* still-unexpired cookie strings — this is the regression check (today, before this ticket's fix, assert this sub-case fails first against the unmodified file by running the test, recording the failure, then applying the fix and re-running).
Do not touch: `verifySession`/`verifyStepUp`'s signatures, the presence-epoch logic, `CredentialStore`, the 30-day/step-up `MAX_AGE` constants.
Proof: `session.test.ts` demonstrates the removed-credential case fails before the `verify()` edit and passes after. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T2: A job's output stream stops for a device revoked mid-stream
Status: DONE 2026-10-03 (new route.test.ts: revoke mid-stream emits event:closed/unauthorized and ends stream while job record stays running; common-case unaffected; typecheck/lint/test clean)
Spec: Open question 2 (resolved); check — new, "open job stream on the revoked device stops delivering within one poll interval while the job itself keeps running"
Depends on: T1
Blocked by: none
Model: sonnet
Context: `GET /api/jobs/[id]/stream` (`src/app/api/jobs/[id]/stream/route.ts`) checks `requireSession` once, at connect time (line 62), then polls job state every tick via `setInterval(serialTick(...))` (line 296) without ever re-checking auth — a credential revoked after the stream opens does not stop it today (confirmed 2026-10-03). The spec's resolution: the job itself keeps running server-side (not owned by any device's session); only this device's *view* of it must cut off. Add a re-check inside the existing poll loop, right after the `if (finished) return;` guard (line 300), using the same `requireSession(request)` the connect-time check already uses (it closes over `request` from the outer `GET` function, so no new plumbing is needed to reach it).
Files: src/app/api/jobs/[id]/stream/route.ts (edit), src/app/api/jobs/[id]/stream/route.test.ts (new file, or add cases to an existing stream test if one already exists — check first with `ls src/app/api/jobs/\[id\]/stream/*.test.ts`)
Steps:
1. Inside the `setInterval(serialTick(async () => { if (finished) return; ...`, immediately after that guard, add: `const stillValid = await requireSession(request); if (stillValid instanceof Response) { enqueue('event: closed\n'); enqueue(\`data: ${JSON.stringify({ status: 'unauthorized' })}\n\n\`); finish(); return; }`.
2. Confirm this does not change behaviour for a never-revoked session (the common case): `requireSession` returns the payload, not a `Response`, so the new branch never fires.
3. Test: with a temp `HOME`/credential store/job store, open the route handler's stream for a running fixture job with a valid session cookie, confirm it delivers output; then remove the credential from the store mid-stream (simulating revoke) and assert the next poll tick emits `event: closed` with `status: 'unauthorized'` and the stream ends, while the underlying job record (`manager.get(id)`) is untouched/still running.
Do not touch: the orphan/backpressure/output-replay logic in the same poll loop (lines 310-340+), the connect-time `requireSession` check (line 62), `JobManager`.
Proof: the new test shows the stream closing on revoke mid-stream without killing the job record. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T3: Revoked device shows "This device has been signed out" and drops to login
Status: DONE 2026-10-04 (reopened and fixed: the first build flipped to signed-out for visitors who were never signed in, blocking the logged-out app with the overlay; gate now arms only after a poll has reported authenticated, network errors/non-401 failures count as unknown; 8 useAuthGate tests incl. real-revoke wiring pass. Original proof: useAuthGate + SignedOutOverlay mounted in AppShell; pure nextGateState transition test plus real-revoke wiring test pass; typecheck/lint/test clean; browser full-pass deferred to T26)
Spec: Open question 1 (resolved); check — new, "message appears within one poll interval of the revoke"
Depends on: T1
Blocked by: none
Model: sonnet
Context: This app has no separate `/login` route — the whole shell renders regardless of auth state, and `LoginButton.tsx` (in the Sidebar) just shows "Login" when unauthenticated. Today, every poll/fetch that hits a 401 swallows it locally (confirmed 2026-10-03: `authService.checkSession` catches and returns `authenticated:false`, several API routes' own comments say "a 401 degrades rather than breaks") — nothing tells a revoked device it was signed out; it just goes stale. `GET /api/auth/session` (`src/app/api/auth/session/route.ts`) already returns 401 the instant `verifySession` fails (T1 makes that true for a revoked credential, not just an expired one). Add one small global poll, mounted once in `AppShell.tsx` (same place `SamBackground`/`BootSequence` are mounted), that notices this and blocks the app behind a message — this is new shared infrastructure, not a fetch-by-fetch rewrite of the ~10 existing services.
Files: src/lib/useAuthGate.ts (new file), src/components/shell/SignedOutOverlay.tsx (new file), src/components/shell/AppShell.tsx (edit), src/lib/useAuthGate.test.ts (new file, pure-logic test only)
Steps:
1. `useAuthGate.ts`: a hook with no args that polls `GET /api/auth/session` (`credentials: 'include'`) every 5 seconds via `setInterval`, starting once on mount. Returns `'ok' | 'signed-out'`. Transitions to `'signed-out'` the first time a poll gets HTTP 401 (or the JSON's `authenticated: false`); once `'signed-out'`, stop polling (no point retrying — the user must re-authenticate). Must not fire on first mount before the first poll resolves (default/initial state is `'ok'`, so a page load during normal auth never flashes the overlay).
2. `SignedOutOverlay.tsx`: a full-screen overlay (reuse `.glass-strong` from `globals.css` for its backing, same pattern as other solid panels) shown only when `useAuthGate()` returns `'signed-out'`. Text: "This device has been signed out." plus the existing `LoginButton`-style re-auth affordance (import and render `LoginButton`, or a minimal equivalent calling `authService.authenticate()`) so the person can sign back in without leaving the page. It sits above everything (`z-50`+) and blocks interaction with the content behind it (not just a toast).
3. `AppShell.tsx`: mount `<SignedOutOverlay />` once, alongside `SamBackground`/`BootSequence` (after line 40 is a reasonable spot) — it renders `null` unless signed out, so it changes nothing for an authenticated session.
4. `useAuthGate.test.ts`: cannot easily unit-test a real `setInterval` + `fetch` hook without a DOM test harness this repo may not have for hooks — if no React-hook test utility exists in this repo (check `package.json`/existing `.test.tsx` hook tests first), extract the *pure* state-transition function (`nextGateState(current: 'ok'|'signed-out', pollOk: boolean): 'ok'|'signed-out'`) into its own export and unit-test that in isolation instead (same "extract the pure part" pattern as `visual-upgrade-tickets.md` T11's `useDashboardLayout`).
Do not touch: `authService.ts`'s existing per-call 401 handling (leave each service's own local swallow-and-fallback behaviour exactly as it is — this overlay is additive, not a replacement), the Sidebar's `LoginButton` itself beyond reusing it.
Proof: with a real revoke (temp `HOME`, fixture credential + session cookie, then `getCredentialStore().remove(...)`), `useAuthGate`'s pure transition function returns `'signed-out'` on the next poll's 401. `npm run typecheck`/`npm run lint`/`npm test` pass. Manual/browser note in the ticket result (full pass in T26): revoking a real throwaway passkey against the local test server shows the overlay within ~5s.

## T4: `meta.json` gets an explicit `tier` field at dispatch time
Status: DONE 2026-10-03 (sam-dispatch.next/sam-job.next staged, diffed clean against spec; samDispatchTier.test.ts passes against .next; test-dispatch-routing.sh 20/20 against unmodified live sam-dispatch)
Spec: must-do 2 (tier half — title/General already resolve; see "Read before any ticket"); check 1 (tier half)
Depends on: none
Blocked by: none
Model: sonnet
Context: `sam-dispatch` already computes `MODEL` from `--tier` (`sam-dispatch:64-70`) but never passes the tier string itself to `sam-job` — only `$SUMMARY` (default `"$NAME ($TIER)"`, line 133) carries it, buried in text. `sam-job` already accepts `--general`/`--stages` the same way (`sam-job:54-73`) and writes them into `meta.json` via the inline Python heredoc (`sam-job:140-161`). This ticket adds one more pass-through flag, `--tier`, the same way.
Files: /home/col/.local/bin/sam-dispatch.next (new file: copy of the live sam-dispatch with the one-line addition), /home/col/.local/bin/sam-job.next (new file: copy of the live sam-job with the flag + meta.json field added), src/lib/server/fleet/samDispatchTier.test.ts (new file)
Steps:
1. Copy the live `sam-dispatch` to `sam-dispatch.next`, changing only line 139's exec call: add `--tier "$TIER"` to the args passed to `$JOB_BIN` (alongside the existing `--general "$GENERAL" --stages "$STAGES"`).
2. Copy the live `sam-job` to `sam-job.next`: add `--tier` to the `while` arg parser (sam-job.next:61-73, same shape as `--general`/`--stages`), thread it through to the Python heredoc call at line 140 (one more `sys.argv[N]`), and add `"tier": sys.argv[N] or None,` to the `meta` dict (sam-job.next:144-160).
3. `samDispatchTier.test.ts`: box-only (guard with `src/lib/server/testing/boxOnly.ts`, same pattern as `samJobEvents.test.ts`). Runs a real short job (`sam-job.next -- true`, or via `sam-dispatch.next` with a fixture brief containing `General:`/`Stages:`/`Task type:` lines) with `SAM_JOB_BIN_UNDER_TEST`/an env override pointing at the `.next` copies and a temp `SAM_JOB_STORE`; asserts the written `meta.json` has `"tier": "sonnet"` (or whichever tier the fixture used). Before/after proof: point the same test at the *live* `sam-job` first (no `.next`) and show `meta.json.tier` is absent/undefined there.
4. Daily note line: `sam-dispatch.next + sam-job.next staged (ux-fixes T4): explicit tier field in meta.json. Enforced by: SAM_ui npm test src/lib/server/fleet/samDispatchTier.test.ts`.
Do not touch: the live `sam-dispatch`/`sam-job`, the model-routing `case` statement (sam-dispatch:64-70), the `--model` guard in `sam-job` (lines 88-97), the already-shipped `--general`/`--stages`/`origin` plumbing.
Proof: the before-run (live files) shows no `tier` field; `npm test` passes against `.next`, including `samDispatchTier.test` (check 1, tier half). `npm run typecheck`/`npm run lint` pass. `~/.sam/tests/test-dispatch-routing.sh` still passes against the unmodified live `sam-dispatch`.

## T5: `sam-dispatch` appends the stage-call instruction to every brief
Status: DONE 2026-10-03 (sam-dispatch.next builds a WORKBRIEF temp copy with the sam-stage instruction appended, original brief untouched; samDispatchStageInstruction.test.ts fails against live, passes against .next; test-dispatch-routing.sh 20/20 against live)
Spec: must-do 4
Depends on: none
Blocked by: none
Model: sonnet
Context: Must 4 wants every brief dispatched through `sam-dispatch` to carry an instruction telling the worker to call `sam-stage start <stage>` / `sam-stage done <stage>` as it moves through its planned stages — today `sam-dispatch` only *validates* that a brief has `General:`/`Stages:` lines (sam-dispatch:102-110); it never adds anything to the brief text itself. The brief is currently passed straight through as `"\$(cat $(printf '%q' "$BRIEF"))"` inside the nested `bash -c` string (sam-dispatch:140) — appending text means building a working copy of the brief (original file untouched) and pointing the exec line at that instead.
Files: /home/col/.local/bin/sam-dispatch.next (edit — same file T4 staged; apply this ticket's change on top of it, in order, since both tickets touch this one file), src/lib/server/fleet/samDispatchStageInstruction.test.ts (new file)
Steps:
1. In `sam-dispatch.next`, after `STAGES` is parsed and validated (around line 110) and before the dispatch-log line (line 130), build a working copy: `WORKBRIEF=$(mktemp)`; `cp "$BRIEF" "$WORKBRIEF"`; then append an instruction naming the exact planned stages, e.g. `printf '\n\n---\nStage discipline: as you begin and finish each of your planned stages, call `sam-stage start "<stage>"` and `sam-stage done "<stage>"` with the stage name exactly as written. Your planned stages: %s\n' "$STAGES" >> "$WORKBRIEF"`.
2. Change the exec line (line 140 today, after T4's edit) to `cat $(printf '%q' "$WORKBRIEF")` instead of `cat $(printf '%q' "$BRIEF")` — everything else about the exec line (model, tools, cwd, config dir) is unchanged.
3. `samDispatchStageInstruction.test.ts`: box-only, same pattern as T4's test. Build a fixture brief with `Task type:`/`General:`/`Stages: Scan, Report` lines and a stub `SAM_JOB_BIN` (temp script recording its invocation's *resolved command string*, same stub approach `visual-upgrade-tickets.md` T2 used) so the test can inspect what `claude -p` would have been called with, without a real worker running. Assert the resolved brief text contains both stage names and the literal phrase `sam-stage start`/`sam-stage done`, and that the original `$BRIEF` file on disk is byte-for-byte unchanged (never mutated in place).
4. Daily note line: `sam-dispatch.next staged (ux-fixes T5): appends stage-call instruction to every brief. Enforced by: SAM_ui npm test src/lib/server/fleet/samDispatchStageInstruction.test.ts`.
Do not touch: the original `$BRIEF` file (read-only — a temp working copy carries the addition), T4's tier-flag edit on the same file, the `General:`/`Stages:`/`Task type:` validation logic.
Proof: the before-run (live `sam-dispatch`, no instruction) shows the brief passed through unchanged; `npm test` passes against `.next`, including `samDispatchStageInstruction.test`. `npm run typecheck`/`npm run lint` pass. `~/.sam/tests/test-dispatch-routing.sh` still passes against the live file.

## T6: `PostToolUse` hook logs one action line per tool call, gated to job workers only
Status: DONE 2026-10-03 (job-action-logger.next.sh staged, settings snippet documented — max2 confirmed to share the main seat's hooks dir; jobActionLogger.test.ts 3/3: no-op gate, description-only with planted-token absence, 120-char truncation; typecheck/lint/test clean)
Spec: must-do 5; check 4
Depends on: none
Blocked by: none
Model: sonnet
Context: Must 5's hook must be a no-op outside a job's own worker run (gated on `SAM_JOB_EVENTS`/`SAM_JOB_DIR` being set — never set in Colin's interactive sessions) and must never write the raw command text, only the tool call's own `description` field (Bash) or a derived one-liner (Edit/Write/Read/Glob/Grep), capped at 120 characters. The repo's existing `PostToolUse` hooks (`/home/col/.claude/settings.json`'s `hooks.PostToolUse`, e.g. `~/.claude/hooks/mirror-error-ledger.sh`) already read the tool-call JSON from stdin via `jq` — this hook follows that same shape, plus its own env-var gate. `~/.claude/hooks/block-chat-background.sh` already proves `tool_input.description` exists on Bash calls today. This ships as a staged `.next` script plus a settings.json snippet (never edited into the live `settings.json` on either seat) per the spec's constraint.
Files: /home/col/.claude/hooks/job-action-logger.next.sh (new file), /home/col/SAM_ui-ux-fixes/implementation/job-action-logger.settings-snippet.json (new file: the exact hooks.PostToolUse entry Colin pastes into both settings.json files), src/lib/server/fleet/jobActionLogger.test.ts (new file)
Steps:
1. `job-action-logger.next.sh`: `#!/usr/bin/env bash`. First line of logic: `[ -z "${SAM_JOB_EVENTS:-}${SAM_JOB_DIR:-}" ] && exit 0` — no-op immediately if neither env var is set (Colin's interactive sessions never set either). Otherwise read stdin (`payload="$(cat)"`), extract `tool_name` and `tool_input` via `jq` (same as `mirror-error-ledger.sh`). Build `description`: for `Bash`, `tool_input.description` verbatim; for `Edit`/`Write`, `"Edited <file_path>"`/`"Wrote <file_path>"`; for `Read`/`Glob`/`Grep`, `"Read <file_path>"`/`"Searched files"`; for anything else, the tool name alone. Truncate to 120 characters. Append `{"type":"action","at":"<ISO8601>","description":"<text>"}` as one line to `${SAM_JOB_EVENTS:-$SAM_JOB_DIR/events.jsonl}`. **Never include `tool_input.command` or any other raw command text** — only the fields named above.
2. `job-action-logger.settings-snippet.json`: the literal JSON object to paste into both `/home/col/.claude/settings.json` and `/home/col/.claude-max2/settings.json`'s `hooks.PostToolUse` array, e.g. `{ "matcher": "Bash|Edit|Write|Read|Glob|Grep", "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/job-action-logger.sh" }] }` (document in a comment-adjacent note in this file that Colin's install step is: copy `job-action-logger.next.sh` to `job-action-logger.sh` in both `~/.claude/hooks/` and `~/.claude-max2/hooks/` if it uses a seat-specific hooks dir — confirm the real path from the existing hook scripts' own location before writing this note).
3. `jobActionLogger.test.ts`: no box-only guard needed (pure bash script, no systemd). Three cases, each invoking the script directly via `child_process` with crafted stdin JSON: (a) neither env var set → script exits 0 and the target events file (if any) is untouched; (b) `SAM_JOB_DIR`/`SAM_JOB_EVENTS` set to a temp file, stdin is a `Bash` tool call whose `tool_input` has `description: "Run the acceptance suite"` and `command: "echo FAKE_TOKEN_abc123"` → the appended line's `description` is "Run the acceptance suite" and the events file **never contains the substring `FAKE_TOKEN_abc123`** (the planted-token proof the spec's check 4 asks for); (c) a `description` longer than 120 characters is truncated to 120.
4. Daily note line: `job-action-logger.next.sh staged (ux-fixes T6), with a settings.json snippet for both seats: new PostToolUse hook, action events only inside a job's own worker run. Enforced by: SAM_ui npm test src/lib/server/fleet/jobActionLogger.test.ts`.
Do not touch: either live `settings.json`, any existing hook script, the hooks' existing `matcher` entries.
Proof: `jobActionLogger.test` passes all three cases, including the planted-token absence check. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T7: `floorState.ts` reads `action` events into a `lastAction` field
Status: DONE 2026-10-03 (lastAction on FloorWorker, optional+nullable to avoid touching unrelated fixture files; floorState.test.ts: last-by-file-order wins, no-action-line gives null; typecheck/lint/test clean)
Spec: must-do 1, 6 (data half); check 3 (Last: line half)
Depends on: none
Blocked by: none
Model: sonnet
Context: `floorState.ts`'s `EventLine` type (lines 74-82) and its event-handling switch (lines 188-216) already parse `dispatched`/`started`/`ended`/`stage-start`/`stage-done` — there is no `action` type yet anywhere in this file (confirmed 2026-10-03), so this is additive. T6's hook writes `{"type":"action","at":...,"description":...}` lines; this ticket makes the reader side understand them, independent of whether T6's hook is actually installed yet (it can be tested against a hand-written fixture `events.jsonl`).
Files: src/lib/server/fleet/floorState.ts (edit), src/lib/server/fleet/floorState.test.ts (edit — add cases)
Steps:
1. Add `'action'` to the `EventLine` type's `type` union (lines 74-82), with an optional `description?: string`.
2. In `readFloorState`'s event-processing loop, track the most recent `action` event per job as it's encountered (events are read in file order, so "most recent" is just "last one seen"); add a `lastAction: { description: string; at: string } | null` field to `FloorWorker` (wherever that type is declared — likely `src/types/floor.ts`), defaulting to `null` when no `action` event exists for that job (never invent one — Must 6's "omitted, never shown as unknown").
3. Add test cases to `floorState.test.ts`: a job whose `events.jsonl` has one or more `action` lines exposes `lastAction` as the *last* one (by file order) with its `description` and `at` carried through unchanged; a job with no `action` lines at all has `lastAction: null`.
Do not touch: the existing `dispatched`/`started`/`ended`/`stage-start`/`stage-done` handling, `StageEventsModule.tsx`'s own `StageEventKind` union (unrelated, client-derived from polled diffs, not raw events).
Proof: `npm test` passes, including the new `floorState.test` cases. `npm run typecheck`/`npm run lint` pass.

## T8: Job detail shows real title/tier, "Stage n of m", and a "Last:" line
Status: DONE 2026-10-03 (ticket's Files list amended by the foreman to include floorState.ts/floor.ts — T7 added lastAction but never surfaced summary/tier from meta.json, a gap in the ticket's premise, not the spec; name/tier now resolve from worker.summary/worker.tier, "Stage n of m" wording, "Last:" line all proven in jobDetail.test.ts/floorState.test.ts; typecheck/lint/test clean. Note: GeneralDetailPanel.tsx's legacy meta-fallback for `fleet:`-convention jobs is now inert there too — intended consequence, not a bug, flagged for the record)
Spec: must-do 1, 2 (title/tier UI half), 6 (render half); check 1 (title/tier half), 3 (Stage n of m + Last: half)
Depends on: T4, T7
Blocked by: none
Model: sonnet
Context: `JobDetailModule.tsx` (`formatJobDetail`, lines 108-129) resolves `name`/`modelTier` via a `useEffect` (lines 168-198) that fetches `/api/fleet/jobs?persona=<general>` and regex-matches the legacy `fleet:<persona> (<model>) — <brief>` command convention (`briefFromCommand`, lines 64-67) — a job dispatched through `sam-dispatch` never produces that command shape, so `name`/`modelTier` fall through to `'unknown'` today. T4 adds an explicit `tier` field to `meta.json`, and `general`/`summary` already exist there live. This ticket switches the resolver to read those `FloorWorker`/`meta` fields directly instead of the legacy regex fetch, adds literal "Stage n of m" wording (today's `stagesLabel`, lines 112-116, reads `"${stagesDone} / ${planned.length}"` — change the format string, not the underlying computation), and renders T7's `lastAction` as a "Last: `<description>` · `<age>` ago" line, omitted entirely when `lastAction` is `null` (never "Last: unknown"). The phone job-in-flight panel reuses this same component directly (`FleetPhoneView.tsx:258`, no separate phone component exists) and `GeneralDetailPanel.tsx:273-275`'s job rows share `formatJobDetail` — both pick up the fix automatically; no edit needed there beyond confirming it in the proof.
Files: src/components/dashboard/fleet/JobDetailModule.tsx (edit)
Steps:
1. In `formatJobDetail` (lines 108-129): resolve `name` from the worker/job record's `summary` field (falling back to `'unknown'` only if `summary` is genuinely absent) and `modelTier` from its new `tier` field (T4), removing the dependency on the `/api/fleet/jobs` regex fetch (the `useEffect` at lines 168-198 — check whether anything else in the file still needs that fetch before deleting it outright; if nothing else does, remove it).
2. Change the stage label format at lines 112-116 from `"${stagesDone} / ${planned.length}"` to the literal wording `"Stage ${stagesDone} of ${planned.length}"` (still `'no stage data'` when `planned` is null/empty — unchanged).
3. Add a "Last:" line: when `worker.lastAction` (T7) is non-null, render `Last: ${lastAction.description} · ${age} ago` (compute `age` with the same relative-time approach `formatElapsed` already uses nearby, lines 90-98); when `lastAction` is `null`, render nothing for this line — no placeholder text.
4. Confirm (read, don't edit) that `GeneralDetailPanel.tsx:273-275` and `FleetPhoneView.tsx:258`'s `StageTimeline` (lines 300-330) read from the same `formatJobDetail`/`FloorWorker` data and therefore show the fix with no further changes — note this in the ticket result rather than touching those files.
Do not touch: `costFleetJob`, `/api/fleet/spend`, `/api/fleet/jobs` (Must 3 — cost resolution is unchanged), `GeneralDetailPanel.tsx`, `FleetPhoneView.tsx`.
Proof: a fixture job with `meta.summary`/`meta.tier`/`meta.general` set and a couple of `stage-start`/`stage-done`/`action` events in its `events.jsonl` renders a real title, tier, "Stage 1 of 2"-style text, and a "Last: ... ago" line when loaded through `JobDetailModule` (manual/unit check, whichever the existing test setup for this component supports — if no component-render test harness exists in this repo, a pure extraction of the formatting logic, same as `jobDetail.test.ts` did in the visual-upgrade build, is an acceptable substitute). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T9: Phone tab bar: Dash/Chat/Pings/Status + a "More" sheet
Status: DONE 2026-10-03 (TabBar cut to Dash/Chat/Pings/Status/More, MoreMenuSheet reuses BottomSheet unforked with the 5 plain-named links; pure-logic tabBar.test.ts substitute since no React-DOM harness exists in this repo; typecheck/lint/test clean. Full browser DOM-probe pass deferred to T25/T26)
Spec: must-do 7, 8, 9, 10; checks 5, 6
Depends on: none
Blocked by: none
Model: sonnet
Context: `TabBar.tsx` (`src/components/shell/TabBar.tsx:21-31`) renders 9 items today (Dash, Term, Chat, RP, Fleet, Status, Ops, Pings, Prefs), each measuring under 44px in both directions (9-way `flex-1` width ≈ 41.6px on a 375px phone; `items-center` height ≈ 40px — confirmed 2026-10-03). `GeneralDetailSheet.tsx` already exports a reusable `BottomSheet` shell (lines 50-138: scrim + tap-outside-close, slide-up/swipe-down via `.fs-sheet`, instant under `prefers-reduced-motion: reduce`, props `{ open, onClose, label, children }`) — its own comment (line 17) already anticipates reuse for "the phone view's Ask SAM chat too," i.e. this is the intended shared mechanism, not a new UI pattern.
Files: src/components/shell/TabBar.tsx (edit), src/components/shell/MoreMenuSheet.tsx (new file)
Steps:
1. `MoreMenuSheet.tsx`: `'use client'`, imports `BottomSheet` from `src/components/dashboard/fleet/GeneralDetailSheet.tsx`. Renders a simple list of 5 links using the Sidebar's own plain labels (`NAV_ITEMS`, `Sidebar.tsx:24-34`): Terminal (`/terminal`), Roleplay (`/practice`), Fleet (`/fleet`), Operations (`/operations`), Settings (`/settings`) — no abbreviations. Each row is a `<Link>` at least 44×44px (padding, not just text size).
2. `TabBar.tsx`: cut the `TABS` array (lines 21-31) to exactly 4 entries — Dash (`/`), Chat (`/chat`), Pings (`/notifications`), Status (`/status`) — plus a 5th non-link "More" button (opens `MoreMenuSheet`, local `useState` for open/closed). With 5 items instead of 9, each `flex-1` cell is roughly 75px wide on a 375px phone — comfortably over 44px; adjust the `py-1`/`items-center` sizing (line 42/51) if needed so the tappable height also clears 44px (e.g. `min-h-11` on each `Link`/button).
3. Wire the "More" button to the same active/inactive visual treatment the other 4 tabs use, so it doesn't look like a visual outlier.
Do not touch: `BottomSheet`'s internals in `GeneralDetailSheet.tsx` (import and reuse, don't fork it), the Sidebar's own nav items/order, the routes themselves.
Proof: at 412×915 and 390×844 (DOM probe or manual browser check, recorded in the ticket result), the tab bar shows exactly Dash/Chat/Pings/Status/More, each ≥44×44px; tapping More opens the sheet listing Terminal/Roleplay/Fleet/Operations/Settings by plain name; under forced `prefers-reduced-motion: reduce` the sheet opens/closes instantly (inherited from `BottomSheet`, confirm it still applies through the import). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T10: Boot screen: discoverable skip, full reduced-motion skip, no sub-12px text
Status: DONE 2026-10-03 (visible "TAP ANYWHERE TO SKIP" label; reduced-motion now short-circuits via the same already-booted onDone() pattern, no playthrough at all; all 4 sub-12px classes bumped to 12px incl. one the ticket didn't name; verified by code walkthrough, no live server started; typecheck/lint/test clean. Full browser DOM-probe pass deferred to T25/T26)
Spec: must-do 11, 12, 13, 14 (verification), 23 (boot-screen part); checks 7, 8, 9
Depends on: none
Blocked by: none
Model: sonnet
Context: `BootSequence.tsx` already skips on any tap/keydown (lines 296-305) and already checks `prefers-reduced-motion` once (lines 254-257) — but only to shorten the total duration (`REDUCED_BOOT_MS = 2600` vs `BOOT_MS = 6000`), not to skip the animation outright (Must 13 wants a full skip, straight to the dashboard, under reduced motion). There is no visible "tap to skip" label anywhere in the JSX (lines 313-485) — the skip mechanism exists but is undiscoverable (Must 12). The readout/footer text already renders below 12px (`text-[10px]`/`text-[8px]`, lines 392-402, 422, 478-479 — Must 23's boot-screen items). Separately (read, do not treat as a bug to "fix" beyond what's below): the full unmount already happens via a true conditional (`if (active !== true) return null`, line 307) — the ~7.3s audit-measured lingering is `BOOT_MS` (6000ms) + `HOLD_MS` (900ms) + `FADE_MS` (420ms) by design, which already clears comfortably before the spec's own 10-second check-9 probe; this ticket does not need to touch that timing math, only confirm check 9 still holds in the proof.
Files: src/components/shell/BootSequence.tsx (edit)
Steps:
1. Add a visible "tap to skip" label (exact wording is fine, e.g. "tap anywhere to skip") somewhere in the boot screen's JSX (near the footer, lines ~478-479, is a natural spot) — it must render at ≥12px per Must 23 (see step 3), and must be present for the full duration the boot screen is interactive (not just at the very end).
2. Under `prefers-reduced-motion: reduce` (the existing check around lines 254-257), instead of just substituting `REDUCED_BOOT_MS` for `BOOT_MS`, skip straight to calling `onDone()` (or the equivalent of `finish()`) with no visible playthrough at all — the dashboard must be interactive within 500ms of load in this mode (check 8).
3. Bump every sub-12px class this component owns to 12px or above: `text-[10px]` at lines 392-402 and 422 → `text-[12px]` (or `text-xs`, which is 12px in this repo's Tailwind config — confirm the resolved size matches 12px exactly, not 11.x), `text-[8px]` at lines 478-479 → `text-[12px]`. Adjust surrounding layout (line-height, spacing) only as much as needed to avoid visual overflow at these slightly larger sizes — no redesign of the boot screen's composition.
Do not touch: `BOOT_MS`/`HOLD_MS`/`FADE_MS`'s values for the full-motion path (Must 11 — "keeps running on cold start only, as today"), the `sessionStorage` once-per-session gate, the mesh-assembly/scan-line visual content itself (beyond the reduced-motion full-skip in step 2).
Proof: a DOM probe (recorded in the ticket result) at 412×915 with cleared `sessionStorage`: the boot screen plays once, shows the visible skip label, a tap during it skips to the dashboard (check 7); with `prefers-reduced-motion: reduce` forced and a fresh session, the boot screen does not play at all and the dashboard is interactive within 500ms (check 8); 10 seconds after a normal (non-reduced) cold load, no boot-readout text (`CORE SYSTEMS`, `VAULT GRAPH`, etc.) remains anywhere in the DOM (check 9). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T11: Chat tagline gets a solid backing against the particles
Status: DONE 2026-10-03 (tagline wrapped in a hugging .glass-strong panel; hand-computed worst-case contrast ~9.5:1/6.1:1 for dim-200/dim-400 against the panel, both well over 4.5:1; typecheck/lint/test clean. Live axe-core pass deferred to T25/T26)
Spec: must-do 15 (verify unchanged), 16 (this instance), 17; check 10 (this instance)
Depends on: none
Blocked by: none
Model: sonnet
Context: `SamBackground` (the particle field) is mounted once in `AppShell.tsx:40`, fixed at `z-0`, with content stacked above it at `z-10` (`AppShell.tsx:32-33,48`) — the particles themselves are unchanged by this ticket (Must 15). The Chat page's empty-state "SAM" / "IS EVERYWHERE" tagline (`chat/page.tsx:1968-1972`) sits inside the empty-chat-state div with no background class at all, so the particles show straight through it — measured at 1.2–1.9:1 contrast (audit). `globals.css`'s `.glass-strong` (lines 275-283: near-opaque dark gradient + blur, already used for solid-ish overlay panels like `ControlDeck.tsx:111` and `WidgetFrame.tsx:287`'s dropdown menus) is the closest existing reusable "solid dark panel" pattern — apply it here rather than inventing a new utility class.
Files: src/app/(app)/chat/page.tsx (edit)
Steps:
1. Wrap the tagline block (lines 1967-1973: the `Cpu` icon, "SAM" `h2`, "IS EVERYWHERE" `p`) in a container with the `.glass-strong` class (or an equivalent inline Tailwind composition matching its near-opaque gradient), sized to hug the content (not a full-bleed panel) so the surrounding empty-state layout is otherwise unchanged (Won't-do: no redesign).
2. Verify computed contrast of the "SAM"/"IS EVERYWHERE" text against the new backing reaches ≥4.5:1 (body) — adjust the panel's opacity/darkness within `.glass-strong`'s existing range if the default isn't dark enough against this specific text color; do not change the text colors themselves beyond what's needed to clear the bar (keeping `text-dim-200`/`text-dim-400` if they already clear it once backed).
Do not touch: `SamBackground.tsx`, any other page's text/particle interaction (Must 16 is the general principle; this ticket's concrete fix is scoped to the one audit-measured instance — the whole-spec axe/contrast sweep in T26 is where any other gap would surface).
Proof: axe-core/contrast check (recorded in the ticket result) on the Chat page's empty state shows the tagline at ≥4.5:1 against its backing, with the particle field still visible around the panel (not covering the whole page). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T12: Text inputs render at ≥16px (no iOS zoom-on-focus)
Status: DONE 2026-10-03 (all 5 named controls text-sm→text-base=16px, nothing else touched; typecheck/lint/test clean. Live getComputedStyle probe deferred to T25/T26)
Spec: must-do 20; check 12
Depends on: none
Blocked by: none
Model: sonnet
Context: Five controls are below 16px today (all `text-sm` = 14px, confirmed 2026-10-03): Chat composer textarea (`chat/page.tsx:2228-2231`), Fleet brief textarea (`fleet/page.tsx:340-342`), Terminal stdin input (`Terminal.tsx:271-279`), and both Settings voice `<select>`s (`settings/page.tsx:161-166` and `:192-197`).
Files: src/app/(app)/chat/page.tsx (edit), src/app/(app)/fleet/page.tsx (edit), src/components/terminal/Terminal.tsx (edit), src/app/(app)/settings/page.tsx (edit)
Steps:
1. In each of the five locations above, change the `text-sm` class to `text-base` (16px in this repo's Tailwind config — confirm the resolved computed size is exactly ≥16px, not a custom override) or an equivalent explicit `text-[16px]`.
2. Check each change visually doesn't break its container's layout (line-height/padding may need a small nudge to avoid overflow) — no other visual redesign.
Do not touch: any other text size on these pages/components, the controls' behaviour/handlers.
Proof: `getComputedStyle` on each of the five controls at 390×844 reports `font-size: 16px` or above (recorded in the ticket result). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T13: Inputs, selects and the Chat send button get real accessible labels
Status: DONE 2026-10-03 (5 named controls labelled: aria-label on chat composer/send/Fleet brief/Terminal stdin, htmlFor+id wiring on both Settings voice selects; typecheck/lint/test clean. Found a second unlabelled Terminal input not named by this ticket — flagged, not fixed, for triage. Live axe-core pass deferred to T25/T26)
Spec: must-do 21; check 13
Depends on: none
Blocked by: none
Model: sonnet
Context: None of these have a programmatically-associated label today (confirmed 2026-10-03): the Chat composer textarea (`chat/page.tsx:2210-2232`, placeholder only), the Fleet brief textarea (`fleet/page.tsx:330-343`, placeholder only), the Terminal stdin input (`Terminal.tsx:271-279`, placeholder only), both Settings voice `<select>`s (`settings/page.tsx:160-166` and `:189-197` — a `<label>` text node exists for each but is not wired via `htmlFor`/`id`), and the Chat composer's icon-only Send button (`chat/page.tsx:2233-2241`, no text/`aria-label`/`title` — the one axe's `button-name` scan flagged).
Files: src/app/(app)/chat/page.tsx (edit), src/app/(app)/fleet/page.tsx (edit), src/components/terminal/Terminal.tsx (edit), src/app/(app)/settings/page.tsx (edit)
Steps:
1. Chat composer textarea: add `aria-label="Message SAM"` (or similarly descriptive) — keep the existing placeholder too if useful, but the label must not depend on it.
2. Fleet brief textarea: add `aria-label="Brief"` (or similarly descriptive, matching its on-page context — read the surrounding heading text first so the label isn't redundant with a visible heading already serving this purpose, in which case `aria-labelledby` pointing at that heading is preferable to a duplicate `aria-label`).
3. Terminal stdin input: add `aria-label="Terminal command"` (or similar).
4. Settings voice selects: add `id` attributes to both `<select>`s (`settings/page.tsx:161`, `:192`) and `htmlFor` on their existing `<label>` text nodes (lines 160, 189-191) to wire the association that's currently missing — no visual change, just the attribute link.
5. Chat composer Send button (`chat/page.tsx:2233-2241`): add `aria-label="Send message"`.
Do not touch: placeholders themselves (fine to keep alongside the new labels), the visible label text already present for the voice selects (just wire it, don't reword it), any other button already carrying a `title`/visible text.
Proof: axe-core reports 0 `label`/`select-name`/`button-name` violations across the Chat, Fleet, Terminal and Settings pages (recorded in the ticket result; full cross-page sweep in T26). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T14: 44×44px targets — dashboard widgets and the Chat model-tier pill
Status: DONE 2026-10-03 (WidgetFrame refresh/options buttons min-w-11/min-h-11=44px, tier pill py-1→py-3.5≈46px tall; icon glyphs unchanged; typecheck/lint/test clean. Note: widget header row visibly grows taller as an explicit, expected consequence. Live DOM-probe pass deferred to T25/T26)
Spec: must-do 22 (part); check 14 (part)
Depends on: none
Blocked by: none
Model: sonnet
Context: Dashboard widget refresh icon (`WidgetFrame.tsx:253-260`, `p-1` button, 12px icon) and options/ellipsis icon (`WidgetFrame.tsx:265-277`, similarly small padding, 13px icon) both measure well under 44px. The Chat page's model-tier pill (`chat/page.tsx:1788-1842`, `w-20 px-2 py-1 text-xs` button) is 80px wide but short — height comes from `py-1` (4px) plus one line of 12px text, around 24px total.
Files: src/components/dashboard/WidgetFrame.tsx (edit), src/app/(app)/chat/page.tsx (edit)
Steps:
1. `WidgetFrame.tsx`: increase both the refresh button (lines 253-260) and the options button (lines 265-277) to a minimum 44×44px hit target — e.g. `min-w-11 min-h-11` (44px in this repo's Tailwind scale) or equivalent explicit sizing — without visually enlarging the icon glyph itself beyond what looks proportionate (padding carries the extra size, not a bigger icon).
2. `chat/page.tsx`: increase the tier pill's vertical padding (line 1792's `py-1`) so the button's total height reaches ≥44px — width (`w-20`, 80px) already clears 44px, so only height needs adjusting.
Do not touch: the refresh/options buttons' click handlers, the tier pill's tier-switching logic or its color-coding by tier.
Proof: a DOM probe (recorded in the ticket result) at 390×844 and 1920×1080 measures all three controls at ≥44×44px. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T15: 44×44px targets — Status, Operations, Terminal
Status: DONE 2026-10-03 (all 3 via min-h-11/min-w-11, same pattern as T14; Operations Fleet link now inline-flex in its paragraph — a visible but expected tradeoff, flag for T25/T26 visual check; kill button left nested for T23; typecheck/lint/test clean)
Spec: must-do 22 (part); check 14 (part)
Depends on: none
Blocked by: none
Model: sonnet
Context: Status page's "Refresh" button (`status/page.tsx:334-340`, `px-2.5 py-1 text-[10.5px]`), Operations page's "Fleet" link (`operations/page.tsx:530-532`, a plain inline `<Link>` with no padding, inheriting `text-[11px]` from its parent), and Terminal's "kill" button (`Terminal.tsx:417-425`, `px-2 py-0.5 text-xs`) all measure under 44px.
Files: src/app/(app)/status/page.tsx (edit), src/app/(app)/operations/page.tsx (edit), src/components/terminal/Terminal.tsx (edit)
Steps:
1. Status "Refresh" button: increase padding to reach ≥44×44px hit area (text size is handled separately in T17 — this ticket is sizing only).
2. Operations "Fleet" link: give it its own padding (it currently has none) so its tap target reaches ≥44×44px — wrap or restyle as needed without changing where it sits in the surrounding paragraph's flow.
3. Terminal "kill" button: increase padding to ≥44×44px. Note: this button is nested inside another button today (T23 restructures that) — size it here regardless; T23 handles the nesting separately on the same file (run T15 before T23, or re-check T23's diff doesn't regress this ticket's sizing).
Do not touch: these controls' click handlers or the surrounding page structure beyond the padding/sizing needed.
Proof: a DOM probe (recorded in the ticket result) at 390×844 and 1366×680 measures all three controls at ≥44×44px. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T16: 44×44px targets — chat-list handoff links and Settings buttons
Status: DONE 2026-10-03 (handoff links min-h-11, Revoke/sarcasm buttons min-h-11/min-w-11, same pattern as T14/T15; Settings colour-theme buttons also under 44px but not named by this ticket — flagged, not fixed; typecheck/lint/test clean)
Spec: must-do 22 (part); check 14 (part)
Depends on: none
Blocked by: none
Model: sonnet
Context: Chat-list handoff links (`ChatList.tsx:188-198` and `:199-209`, `text-[10px]`, no padding) and Settings' "Revoke" buttons (`settings/page.tsx:281-288`, `px-3 py-1 text-xs`) plus the Settings sarcasm buttons (`settings/page.tsx:71-83`, `px-3 py-1.5 rounded-lg border text-xs`) all measure under 44px.
Files: src/components/chat/ChatList.tsx (edit), src/app/(app)/settings/page.tsx (edit)
Steps:
1. Chat-list handoff links: add padding so each reaches ≥44×44px — these sit in a tight row inside each chat-list item, so check the surrounding row height can actually accommodate 44px before just adding padding blindly; if the row itself is shorter than 44px, increase the row's own min-height too (small, contained change — not a ChatList redesign).
2. Settings "Revoke" buttons: increase padding to ≥44×44px.
3. Settings sarcasm buttons (`ThemeSection`, lines 71-83): increase padding to ≥44×44px.
Do not touch: ChatList's collapse mechanism (T24 touches that, separately), the handoff links' navigation behaviour, the sarcasm buttons' theme-switching logic.
Proof: a DOM probe (recorded in the ticket result) at 390×844 measures all four control types at ≥44×44px. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T17: No text below 12px — nav chrome, page metadata, chat search toggle
Status: DONE 2026-10-03 (full regex sweep of all 7 files, 109 sub-12px sites bumped to text-[12px], not just the cited examples; two status-page tables widened to fit 12px labels; grep-verified zero sub-12px arbitrary classes remain; typecheck/lint/test clean, 0 fail)
Spec: must-do 23 (all remaining items — boot screen done in T10); check 15
Depends on: none
Blocked by: none
Model: sonnet
Context: Confirmed sub-12px today: phone nav labels (`TabBar.tsx:58`, `text-[10px]` — note T9 already rewrites this file's tab list; apply this ticket's size bump to whatever labels remain after T9, run T17 after T9), laptop sidebar captions (`Sidebar.tsx:50-52` "Core Dashboard", `:85-87` "Atwood Systems", both `text-[9px]`), Status metadata (`status/page.tsx:342` `text-[10px]`, `:441` `text-[9px]`, `:476` `text-[10.5px]`), Fleet metadata (`fleet/page.tsx:255` `text-[10px]`, `:256`/`:324` `text-[9px]`), Operations metadata (`operations/page.tsx:158,161,165,170` `text-[9px]`, `:297` `text-[10px]`), Notifications timestamps (`notifications/page.tsx:119` `text-[10px]`), and the Chat search box's Main/Archived toggle buttons (`ChatList.tsx:247`, `text-[11px]` — note the search input itself is already `text-xs`/12px with an `aria-label`, so leave it; only the adjacent toggle buttons need bumping).
Files: src/components/shell/TabBar.tsx (edit), src/components/shell/Sidebar.tsx (edit), src/app/(app)/status/page.tsx (edit), src/app/(app)/fleet/page.tsx (edit), src/app/(app)/operations/page.tsx (edit), src/app/(app)/notifications/page.tsx (edit), src/components/chat/ChatList.tsx (edit)
Steps:
1. In every file/line cited above, bump the class to `text-[12px]` (or `text-xs`, confirmed 12px in this repo) — mechanical, one class per site.
2. After each bump, glance at the immediate surrounding layout (these are dense metadata rows) for obvious overflow/wrapping breakage introduced by the ~2px size increase; nudge spacing only if something visibly breaks — no broader redesign.
Depends on: T9 (TabBar.tsx's tab list must already be cut to 4+More before this ticket resizes its labels, or the two diffs will conflict).
Do not touch: any text at or above 12px already, the components' non-text styling.
Proof: a DOM probe (recorded in the ticket result) across all seven files' pages at 390×844 finds no text node under 12px among the ones named above. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T18: Viewport allows pinch-zoom; document language is en-GB
Status: DONE 2026-10-03 (maximumScale/userScalable removed from viewport export, lang="en-GB"; root layout so applies to every page; typecheck/lint/test clean, 0 fail)
Spec: must-do 24, 26; check 16, 17 (lang half)
Depends on: none
Blocked by: none
Model: sonnet
Context: `src/app/layout.tsx:24-39`'s `viewport` export sets `maximumScale: 1` and `userScalable: false`, blocking pinch-zoom outright. The same file's `<html lang="en" ...>` (line 43) should be `en-GB`.
Files: src/app/layout.tsx (edit)
Steps:
1. Remove `maximumScale: 1` and `userScalable: false` from the `viewport` export (lines 24-39) — leave `width: 'device-width'`, `initialScale: 1`, `colorScheme`, `viewportFit`, `interactiveWidget` untouched.
2. Change `<html lang="en" ...>` (line 43) to `<html lang="en-GB" ...>`.
Do not touch: `themeColor`, `data-ambient`, `suppressHydrationWarning`, anything else on this element.
Proof: the rendered `<meta name="viewport">` contains no `user-scalable=no`/`maximum-scale=1` on any page; `document.documentElement.lang === 'en-GB'` on every page (DOM probe, recorded in the ticket result). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T19: Chat page gets a single H1 and a header landmark
Status: DONE 2026-10-03 (toolbar div→header, sr-only <h1>Chat</h1> added; grep confirms exactly one h1/header in the file; typecheck/lint/test clean)
Spec: must-do 25; check 17 (H1 half)
Depends on: none
Blocked by: none
Model: sonnet
Context: The Chat page (`src/app/(app)/chat/page.tsx`) has no `<h1>` and no `<header>` landmark today — the top of the screen is a non-semantic sticky `<div>` toolbar (line 1777); the only heading-like markup is an `<h2>`"SAM"` inside the empty-chat-state, shown only when `messages.length === 0` (line 1970). A persistent H1 is needed regardless of chat state, matching every other page's structure (read one other page, e.g. `status/page.tsx`, for the existing `<header>`/`<h1>` pattern to match it exactly).
Files: src/app/(app)/chat/page.tsx (edit)
Steps:
1. Change the sticky toolbar `<div>` (line 1777) to a semantic `<header>` element (same visual styling, just the tag) — confirm this doesn't collide with any other `<header>` already in the tree on this page (there shouldn't be one, per the Explore finding).
2. Add a visually-unobtrusive `<h1>` inside it naming the page ("Chat"), styled to match the toolbar's existing visual density (e.g. visually small/sr-friendly if a prominent heading would clash with the compact toolbar look) — Won't-do: no redesign, so this should read as "the toolbar now has correct semantics," not "the toolbar now looks different."
3. Leave the empty-state's own `<h2>`"SAM"` exactly as it is (that's a different, secondary heading inside the empty state, not the page's H1).
Do not touch: the toolbar's existing buttons/controls, the empty-state content beyond what T11 already touches (backing panel only).
Proof: axe-core / DOM probe (recorded in the ticket result) confirms the Chat page has exactly one `h1` and a `header` landmark, matching the structural pattern of other pages. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T20: General names never truncate on the floor cards
Status: DONE 2026-10-03 (doesn't reproduce: traced FleetStatusModule.tsx/GeneralDetailPanel.tsx/FleetDashboardShell.tsx's .fd-fx-name plus ActiveJobsModule.tsx and FloorCanvas.tsx's canvas fitText — none clip "Hephaestus"/"Prometheus" at 1366×680 or 1280×650 under realistic content; no speculative edit made, per the ticket's own step 3. Live DOM-probe recheck in T25/T26 is the backstop if this estimate is wrong)
Spec: must-do 27; check 18
Depends on: none
Blocked by: none
Model: sonnet
Context: No single `truncate`/ellipsis class sits directly on the name text in `GeneralDetailPanel.tsx:68` (confirmed 2026-10-03) — the likely culprits are fixed-width small-tile name spans elsewhere, e.g. `FleetStatusModule.tsx:114` and similar name renders in `JobDetailModule.tsx`/`FleetDashboardShell.tsx`'s `.fd-fx-name{font-size:22px}` CSS. This ticket needs a short visual-verification pass before editing: render the floor/Fleet-status cards at 1366×680 and 1280×650 with all five names ("Hermes", "Hephaestus", "Calliope", "Cerberus", "Prometheus" — the longest, "Hephaestus"/"Prometheus", are the ones to watch) and find exactly which container clips or ellipsizes the longest names.
Files: src/components/dashboard/fleet/FleetStatusModule.tsx (edit, if this is where the truncation is found), src/components/dashboard/fleet/GeneralDetailPanel.tsx (edit, if needed), src/components/dashboard/fleet/FleetDashboardShell.tsx (edit, if the `.fd-fx-name` CSS rule is the constraint)
Steps:
1. Render (or carefully trace, reading each candidate file) the name text for all five Generals at 1366×680 and 1280×650; identify the exact class/rule causing any clipping (a `truncate` class, a fixed `width`/`max-width` smaller than the longest name needs, or a `white-space: nowrap` without enough container width).
2. Remove or widen whichever constraint is found, letting the name wrap or the container grow rather than ellipsize — smallest change that stops truncation without otherwise altering the card's layout density.
3. If, after careful reading, no component actually truncates any of the five names at these two widths (i.e. the audit's finding doesn't reproduce in this codebase state), say so explicitly in the ticket result instead of making a speculative edit.
Do not touch: anything beyond the specific width/truncation rule found, the cards' other content.
Proof: at 1366×680 and 1280×650, all five names render in full with no `…` (DOM probe or visual check, recorded in the ticket result, including a note of exactly which file/rule was the cause — or the explicit "doesn't reproduce" finding from step 3). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T21: Mic button reads "Click" on non-touch, "Tap" on touch
Status: DONE 2026-10-03 (matchMedia('(pointer: coarse)') via useEffect, same SSR-safe pattern as FleetView.tsx; only the one string changed; typecheck/lint/test clean)
Spec: must-do 28; check 19
Depends on: none
Blocked by: none
Model: sonnet
Context: `VoiceRecordButton.tsx` always shows "Tap to enable mic" (line 393) regardless of input device — no `matchMedia('(pointer: coarse)')` or touch check exists anywhere in the file today (confirmed 2026-10-03).
Files: src/components/voice/VoiceRecordButton.tsx (edit)
Steps:
1. Add a check for `window.matchMedia('(pointer: coarse)').matches` (client-side only — guard for SSR the same way other client-only checks in this codebase do, e.g. compute it in a `useEffect`/`useState` pair rather than at module scope).
2. Where the component renders "Tap to enable mic" (line 393), use "Click to enable mic" when the coarse-pointer/touch check is false, keeping "Tap to enable mic" when true.
3. Leave "Hold to record" (and any other wording, lines 390-399) untouched — only the one string named in Must 28 changes.
Do not touch: the recording logic itself, any other button label in this component.
Proof: on a laptop (`pointer: coarse` false), the control reads "Click to enable mic"; forcing a coarse-pointer media query override (or testing on an actual touch device) shows "Tap to enable mic" (recorded in the ticket result). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T22: Status/dashboard module labels clear 4.5:1 contrast
Status: DONE 2026-10-03 (full sweep found 13 text-slate-600 sites, not just the 7 cited — all swapped to text-dim-500; hand-computed contrast ~6.5-6.9:1 against void-800/900/950, verified against globals.css's actual hex values; typecheck/lint/test clean. text-slate-600 used in 8 other files outside scope — flagged, not fixed. Live axe-core pass deferred to T25/T26)
Spec: must-do 29; check 20
Depends on: none
Blocked by: none
Model: sonnet
Context: No literal `#45556c` hex exists anywhere in the repo (confirmed 2026-10-03) — it's the rendered value of Tailwind's stock `slate-600` (`#475569`, not redefined in this repo's `globals.css` `@theme` block), used extensively for module/metadata labels: `WidgetFrame.tsx:380` (widget footer label) and throughout `status/page.tsx` (e.g. lines 342, 441, 476, 521, 536, 539). The audit measured this combination (label color over the particle-backed module background) at 2.69:1.
Files: src/components/dashboard/WidgetFrame.tsx (edit), src/app/(app)/status/page.tsx (edit)
Steps:
1. Replace `text-slate-600` with a higher-contrast existing token from this repo's own palette (`globals.css`'s `@theme` block defines `--color-dim-*`/`--color-void-*` scales — pick the lightest `dim-*` or similarly-toned class that reaches ≥4.5:1 against these labels' actual backgrounds, rather than inventing a new color) at every cited location in both files.
2. Re-measure contrast at each site after the swap (module backgrounds vary slightly; confirm the chosen replacement clears 4.5:1 everywhere it's used, not just the first instance).
Do not touch: any other color token, the labels' text content or layout.
Proof: axe-core contrast check (recorded in the ticket result) on Status at 390×844 and 1366×680 shows 0 contrast violations where `text-slate-600` previously measured 2.69:1. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T23: Terminal's job row no longer nests a button inside a button
Status: DONE 2026-10-03 (outer row now a plain div, attach and kill are sibling buttons not nested — same pattern as ChatList.tsx; T15's kill-button sizing preserved, stopPropagation removed as no longer needed; typecheck/lint/test clean. Live axe-core pass deferred to T25/T26)
Spec: must-do 30; check 21
Depends on: T15
Blocked by: none
Model: sonnet
Context: `Terminal.tsx:398-404` wraps each job row in a `<button onClick={() => attachToJob(j.id)}>`, which contains a second, nested `<button onClick={kill}>` at lines 417-425 — axe flags this as `nested-interactive`. `ChatList.tsx:186`'s own comment shows the team already avoided this exact pattern elsewhere, so treat that file's approach as the house pattern to follow here (read it first).
Files: src/components/terminal/Terminal.tsx (edit)
Steps:
1. Change the outer row element (lines 398-404) from a `<button>` to a `<div role="button" tabIndex={0} onClick={...} onKeyDown={...}>` only if full keyboard-activation parity is already expected elsewhere in this file for similar rows (check for precedent); otherwise, the simpler, lower-risk fix: keep the outer row as a non-interactive `<div>` with the click handler attached, and make only the "kill" button (lines 417-425) the row's one real interactive `<button>` plus a separate explicit `<button>` (not a wrapping element) for "attach to this job," placed side-by-side rather than nested. Pick whichever keeps existing keyboard/focus behaviour intact — read how `attachToJob`/`kill` are invoked elsewhere (keyboard shortcuts, etc.) before choosing, and note the choice and why in the ticket result.
2. Confirm visually the row still looks and behaves the same (click row to attach, click kill to kill) — this is a semantics-only fix, not a visual redesign.
Depends on: T15 (which already resized the kill button's padding on this same file — apply this ticket's structural change on top of that, not the other way round, to avoid re-deriving the sizing).
Do not touch: `attachToJob`/`kill`'s actual logic, any other row type in Terminal.
Proof: axe-core reports 0 `nested-interactive` violations on Terminal (recorded in the ticket result). `npm run typecheck`/`npm run lint`/`npm test` pass.

## T24: Desktop Sidebar collapses to an icon rail, remembered across reloads
Status: DONE 2026-10-04 (1440x900 probe: 224px to 72px rail and back, main grew 152px, 9 rail links + toggle all 44x44, label shows on hover and Tab focus, axe 0 link-name/button-name, state survives reload both ways, 390x844 unchanged; fixed 32px toggle and not-sr-only/absolute tooltip bug from the unverified run; added sidebarCollapse.test.ts; collapsed rail omits Install/Login footer by design, flagged. Also made 5 box-only tests use unique sam-job --name, since parallel files collided on the systemd unit name and made npm test flaky)
Spec: must-do 31; check 25
Depends on: none
Blocked by: none
Model: sonnet
Context: `Sidebar.tsx` (`src/components/shell/Sidebar.tsx:24-44`) is a fixed `w-56` (224px) `<aside>` with no collapse state today; `AppShell.tsx:49` offsets main content with a hardcoded `md:ml-56`. `ChatList.tsx`'s own collapse (committed `fd18c0a`, confirmed 2026-10-03) is the exact pattern to copy: `useState(false)` starting expanded, reading `localStorage` only after mount in a `useEffect` to dodge SSR hydration mismatch (`ChatList.tsx:311-318`, storage helper `src/lib/chatListCollapse.ts` — key `'sam-chatlist-collapsed'`, value `'1'` when collapsed, key removed when expanded), a toggle button, and a `w-11` (44px) icon-only rail when collapsed (`ChatList.tsx:432-455`) versus the full `w-64` expanded view (`:457-492`).
Files: src/lib/sidebarCollapse.ts (new file: storage helper, same shape as `chatListCollapse.ts` but its own key, e.g. `'sam-sidebar-collapsed'`), src/components/shell/Sidebar.tsx (edit), src/components/shell/AppShell.tsx (edit)
Steps:
1. `sidebarCollapse.ts`: `readSidebarCollapsed()`/`writeSidebarCollapsed(collapsed: boolean)`, same `localStorage` pattern as `chatListCollapse.ts` (own key, don't reuse the chat list's key).
2. `Sidebar.tsx`: add collapse state (starts expanded, reads storage post-mount, same hydration-safe pattern as `ChatList.tsx:311-324`). Add a toggle button. Collapsed: render each `NAV_ITEMS` entry as an icon-only link no wider than 72px total rail width, each icon still a real link with its existing accessible name (`aria-label`/visible text moved to a tooltip-on-hover/focus — e.g. a native `title` attribute plus a visually-hidden label text node satisfies both hover and keyboard-focus discoverability without new tooltip machinery), each ≥44×44px. Expanded: today's full `w-56` view, unchanged.
3. `AppShell.tsx`: the hardcoded `md:ml-56` (line 49) needs to respond to the Sidebar's own collapse state — either read the same `sidebarCollapse.ts` state here too (simplest: both components read the same localStorage-backed state, no new context needed, matching how `ChatList.tsx`'s own collapse doesn't need a context either since only one component reads it there — but here *two* components need to agree, so confirm both read via the same helper functions consistently) and switch the margin class between `md:ml-56` (expanded) and a narrow equivalent (collapsed, matching the rail's actual width, e.g. `md:ml-[72px]`).
4. Confirm phone layout (`TabBar`, not `Sidebar`) is entirely unaffected — this ticket touches no phone-only code path.
Do not touch: the Sidebar's `NAV_ITEMS` list/order, `ChatList.tsx`'s own collapse (separate state, separate key, don't merge them), the phone `TabBar`.
Proof: at 1440×900 (DOM probe/manual check, recorded in the ticket result): the toggle collapses the Sidebar to ≤72px wide and back; after a reload it's still in the state it was left in; collapsed, every rail item has an accessible name (axe 0 `link-name`/`button-name`), shows its label on hover and keyboard focus, and measures ≥44×44px; the main content's width grows by the Sidebar's freed width; at 390×844 nothing changes. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T25: Full accessibility sweep — logged out
Status: DONE 2026-10-04 (re-run after T27 to T31: axe serious/critical 0 on all 8 pages at 390x844 and 1920x1080 logged out; sub-12px text 0 and sub-16px inputs 0 everywhere; no alertdialog logged out; lang en-GB, no viewport zoom lock, 1 h1 per page; More sheet 5 links tappable at 390 and 412; sidebar collapse works with main visible. Not measurable logged out, so moved to T26: refresh/options icons, tier pill, sarcasm buttons, Terminal kill, handoff links, Revoke, floor-card names. Other, unnamed controls still under 44px are listed in the final report)
Spec: must-do 15, 16, 20, 21, 22, 23, 24, 26, 27, 29 (cross-page verification); checks 10 (logged-out half), 12, 13, 14, 15, 16
Depends on: T9 to T20, T22, T27 to T31 (re-run)
Blocked by: none
Model: sonnet
Context: This is the integration check — individual tickets above fixed specific files; this ticket proves the fixes hold together across every page, logged out, rather than trusting each ticket's narrow proof in isolation. Start the app on a local test server bound to `127.0.0.1` on a port in 4900–4999 (production build: `npm run build && npm start -- -p <port>`), killed at the end of this ticket regardless of outcome.
Files: none (verification only — if a genuine regression surfaces, stop and report it against the specific earlier ticket that owns the file, rather than patching here)
Steps:
1. Start the local server (port 4900–4999), confirm `/api/health` is ok.
2. Run an axe-core scan plus the DOM probes described in `/home/col/delivery/ux-audits/sam-ui-20261003/audit-loggedin.mjs` (the parts that don't require login — font-size, target-size, text-size, viewport, lang, landmark checks) across all 8 pages (Dashboard, Chat, Status, Fleet, Operations, Terminal, Settings, Notifications) at 390×844 and 1920×1080, logged out.
3. Record: serious/critical axe violation count per page, small-target count, sub-12px count, sub-16px-input count — next to the original audit's numbers for comparison.
4. Kill the local server.
Do not touch: any source file (this ticket only runs and reports; if something fails, name the earlier ticket responsible rather than fixing it inline).
Proof: 0 serious/critical axe violations across all 8 pages logged out at both viewport sizes; 0 small-target/sub-12px/sub-16px-input findings remaining from the ones named in Must 20-23. Any surviving finding is reported against the ticket that owns it, not silently patched here.

## T26: Full accessibility sweep + revoke check — logged in
Status: DONE 2026-10-04 (first run found 3 named failures plus T8 regressions, fixed by T32 to T35; final re-run on the finished tree: axe serious/critical 0 on all 8 pages at 390x844, 1440x900, 1920x1080 and 1366x680, sub-12px DOM text 0, sub-16px inputs 0, every Must 20-23/27/29/31 named control passes; revoke half: 200 then revoke then 401 at +27 ms for /api/auth/devices and +28 ms for a step-up-gated route, overlay 'This device has been signed out' at +1.07 s on a single sample (poll is 5 s), job stream closed 'unauthorized' 24 ms after revoke while the job stayed running; every throwaway passkey revoked, servers stopped. Harness and results in /tmp/ux-run/t26, t26final, t26b)
Spec: must-do 1-31 (whole-spec verification, logged-in half); checks 10 (logged-in half), 11, 17 (lang half), 18, 19, 21, 22
Depends on: T1 to T25 and T27 to T35
Blocked by: none
Model: sonnet
Context: Same local-server setup as T25, but logged in via the throwaway-passkey method in `audit-loggedin.mjs` — this is the one ticket allowed to enrol and use a passkey, and it must revoke it at the end regardless of outcome (hard limit from the job brief: never print the enrolment token, a cookie, or a session value).
Files: none (verification only)
Steps:
1. Start the local server (port 4900–4999), enrol a throwaway passkey per `audit-loggedin.mjs`'s method.
2. Run the full axe-core + DOM-probe sweep (same 8 pages, same two viewport sizes) logged in — this covers the label/target/text-size checks that only apply to authenticated views (Settings devices list, General names on floor cards, the mic button, Terminal's job rows).
3. Revoke check (Must 18, 19; check 11): with the session open (`sam-session` present), confirm `GET /api/auth/devices` returns 200; revoke the passkey from Settings; immediately re-request `GET /api/auth/devices` with the same cookie and confirm 401 (not 200); repeat with a live `sam-stepup` cookie against a step-up-gated route.
4. Confirm the signed-out overlay (T3) appears within one poll interval of the revoke, and that an open job stream (T2, if a fixture job is running) stops delivering within one poll interval while the job keeps running.
5. Revoke the throwaway passkey (if not already revoked by step 3) and kill the local server.
Do not touch: any source file (report findings against the owning ticket).
Proof: 0 serious/critical axe violations across all 8 pages logged in at both viewport sizes; the revoke sequence in step 3 shows 200 → revoke → 401 with no delay; the signed-out message and stream cutoff from step 4 both land within one poll interval. No enrolment token, cookie, or session value appears in the ticket's recorded output.

## T27: More sheet's last link is no longer covered by the phone tab bar
Status: DONE 2026-10-04 (nav gets bottom padding of tab bar height + safe area; at 390x844 and 412x915 all 5 links 44px tall, above the bar, elementFromPoint hits the link, taps navigate to the 5 routes; typecheck/lint/test clean, 0 fail)
Spec: must-do 8, 9; check 6 (found by the T25 sweep)
Depends on: T9
Blocked by: none
Model: sonnet
Context: At 390x844 the sheet's "Settings" link spans y 774-818 but the tab bar covers y 788-844, so a tap lands on Pings; at 412x915 it is entirely below the bar's top edge. `BottomSheet` (`GeneralDetailSheet.tsx`, reused unforked) renders at `z-20` under the tab bar's `z-50`, and `MoreMenuSheet.tsx` adds no bottom inset for the bar (bar height 56px + `env(safe-area-inset-bottom)`).
Files: src/components/shell/MoreMenuSheet.tsx (edit)
Steps:
1. Give the sheet's content a bottom padding of at least the tab bar height plus the safe-area inset (e.g. `pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]`, matching AppShell's own `<main>` padding) so all five links sit fully above the bar and the sheet scrolls if the viewport is short. Alternatively, if BottomSheet exposes no way to do this from the child, wrap the links in a container with that padding. Do not fork or edit `BottomSheet`.
Do not touch: `GeneralDetailSheet.tsx`, `TabBar.tsx`, z-index values elsewhere.
Proof: at 390x844 and 412x915, tapping the centre of each of the five More links (Playwright `elementFromPoint` at the centre returns the link itself, not a tab) navigates to its route; each link is >=44x44 and fully above the tab bar top. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T28: Dashboard text is never below 12px
Status: DONE 2026-10-04 (24 files in dashboard/**, ui/Gauge+Indicators, globals.css bumped to 12px, grep finds no sub-12px left there; probe: 0 sub-12px nodes on / at 390 and 1920, 0 on /status and /fleet at 390; phone header/status badge/desktop subtitle spacing nudged so nothing overflows; typecheck/lint/test clean, 0 fail. Pre-existing: Daily Tasks/Money In cards overlap the card above's footer, left alone)
Spec: must-do 23; check 15 (found by the T25 sweep: T17's file list never reached the dashboard)
Depends on: T17
Blocked by: none
Model: sonnet
Context: Logged out, the dashboard has 52 sub-12px text nodes at 390 and 55 at 1920: header "health" 9.5px, "layout saved" 9px, "UTC" 8.5px, "core dashboard" 8px; stat tiles 9.5px; the "updated" footers 9px; the General roster's role and status text 11px; the Retry button 10px; the "Chat with SAM" widget 10.5-11.5px. Same mechanical fix as T17 (bump to `text-[12px]`; also bump any sub-12px size set in `globals.css` or component CSS, e.g. `.label`'s 9.5px). Find every site by grepping `src/components/dashboard`, the other components the dashboard page renders, and `src/app/globals.css` for `text-[Npx]` / `font-size` values below 12 (including decimals like 9.5, 10.5, 11.5 and rem values such as `text-[0.6rem]`), and fix all of them in dashboard-rendered components.
Files: src/components/dashboard/** (edit as found), src/app/globals.css (edit if `.label` or similar sets <12px), any other component the dashboard renders that has a sub-12px size (list every file in the result)
Steps:
1. Sweep and bump every sub-12px size in what the dashboard renders. Skip nothing the grep finds in those components. Where 12px makes a dense row overflow, nudge spacing minimally; no redesign.
2. Do not touch sizes already >=12px; do not change colours (T29 owns `.label` contrast; coordinate by leaving colour untouched here).
Do not touch: the 3D/canvas-drawn text in FloorCanvas (canvas text is not a DOM text node), anything signed off.
Proof: Playwright probe at 390x844 and 1920x1080 on `/` (logged out, boot overlay gone, ~12s settle, then count DOM text nodes whose parent computed font-size <12px using the same logic as /tmp/ux-run/t25.mjs `measure`) reports 0. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T29: Dashboard label contrast and the "Ask SAM" control
Status: DONE 2026-10-04 (.label now opaque dim-500; .fp-ask was hidden under the fixed tab bar, now lifted 3.5rem on phones, 366x48 and elementFromPoint hits it; dashboard Ask SAM input 16px; also fixed 3 contrast fails that appeared once those cleared: TopBar layout-saved badge/UTC/subtitle and the fp-ask text colour; axe 0 serious/critical on / at 390 and 1920, /status /chat /fleet at 390 still 0; typecheck/lint/test clean. Note: axe leaves ~60-80 dashboard nodes as incomplete over the particle layer, so contrast there is not machine-proven; chat sheet input row clipped ~2px by the tab bar, not fixed)
Spec: must-do 16, 20, 22, 29; checks 10, 22 (found by the T25 sweep)
Depends on: T28
Blocked by: none
Model: sonnet
Context: At 390 `/` axe reports serious color-contrast x4 on `.label` elements (`#616869` on `#030c08`, 3.48:1; `.label` in `globals.css` is 9.5px at 42% alpha, which T22's `text-slate-600` sweep never touched) and serious target-size x1 on `.fp-ask` (the "Ask SAM" button: only 12.5px of usable height because it is partially obscured; the audit flagged the same). The dashboard "Ask SAM..." input is 12.5px at 1920, below the 16px floor in Must 20.
Files: src/app/globals.css (edit), the component(s) that render `.fp-ask` and the dashboard Ask SAM input (find with grep `fp-ask`; edit)
Steps:
1. Make `.label` text reach >=4.5:1 against its actual background (raise alpha/lightness using the repo's own palette; no new hues). Check every `.label` use site, not just the first.
2. Find why `.fp-ask` is partially obscured (an overlapping sibling/z-index/negative margin) and fix so the button's whole >=44x44 box is clickable and unobscured; no layout redesign.
3. Make the dashboard Ask SAM input >=16px (computed) without breaking its container.
Do not touch: sub-12px sizes (T28 owns), any other colour tokens, the particle layer.
Proof: Playwright + axe at 390x844 and 1920x1080 on `/` (logged out, after boot): 0 serious/critical axe violations (color-contrast and target-size included), `.fp-ask` measures >=44x44 and `document.elementFromPoint` at its centre returns it, the Ask SAM input computes >=16px. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T30: Console settings icon 44px and remaining inputs at 16px
Status: DONE 2026-10-04 (ControlDeck settings button 44x44 on / and /classic at 390 and 1920; Terminal quick-launcher and chat-list search inputs compute 16px, no overflow; typecheck/lint/test clean)
Spec: must-do 20, 22; checks 12, 14 (found by the T25 sweep: these were named or covered by Must but absent from T12/T14/T17)
Depends on: T12, T14
Blocked by: none
Model: sonnet
Context: Must 22 names the console settings icon (`ControlDeck.tsx:94`, measured 28x28; no ticket covered it). Must 20 says every input is >=16px: the Terminal quick-launcher input (`Terminal.tsx:~303`, still `text-sm`/14px; T12 fixed only the stdin input) and the Chat-list "Search titles" input (`ChatList.tsx`, 12px; T17 deliberately left it at 12px but Must 20 requires 16px for every input).
Files: src/components/dashboard/ControlDeck.tsx (edit; find the file with grep if the path differs), src/components/terminal/Terminal.tsx (edit), src/components/chat/ChatList.tsx (edit)
Steps:
1. ControlDeck settings icon: min 44x44 hit area via `min-w-11 min-h-11` (same pattern as T14); icon glyph size unchanged.
2. Terminal quick-launcher input and the Chat-list search input: `text-base` (16px); nudge padding only if the container visibly overflows.
Do not touch: the Chat-list's other classes, collapse logic, the stdin input T12 already fixed, any handler.
Proof: Playwright at 390x844: the console settings button >=44x44; Terminal quick-launcher input and the Chat-list search input compute font-size >=16px. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T31: Chat list empty state is valid list markup
Status: DONE 2026-10-04 (all three <p> messages in ListRows (loading, archived error, empty) are now <li>; axe at 1920 /chat reports 0 violations; typecheck/lint/test clean)
Spec: whole-spec check 22 (0 serious/critical axe on all pages; found by the T25 sweep)
Depends on: T30
Blocked by: none
Model: sonnet
Context: At 1920 `/chat` with no chats, axe reports a serious `list` violation: `ChatList.tsx:283-287` renders a `<p>` directly inside the `<ul>` that starts around line 480. Appears only with zero chats.
Files: src/components/chat/ChatList.tsx (edit)
Steps:
1. Make the empty-state message valid: wrap it in an `<li>` (or move it outside the `<ul>`), same visual result.
Do not touch: anything else in the file, the collapse logic.
Proof: axe at 1920x1080 on `/chat` (logged out, no chats) reports 0 `list` violations and 0 serious/critical overall. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T32: Floor-card General names are never truncated on the canvas
Status: DONE 2026-10-04 (FloorCanvas drawCard: name steps down to 12px then uses full inner width before ever ellipsizing; logged-in probe recorded the drawn strings at 1280x650, 1366x680, 1440x900, 1920x1080: all five complete, no overlap with the count. Tradeoff: at 1280 and 1366 the 'N today' count is dropped on the two busiest cards (Hephaestus, Calliope) when it cannot fit; role labels/state text that were already ellipsized left alone; typecheck/lint/test clean)
Spec: must-do 27; check 18 (found by the T26a logged-in sweep; T20 closed as "doesn't reproduce" because it traced only the DOM components)
Depends on: T20
Blocked by: none
Model: sonnet
Context: The laptop floor cards draw the General names on a `<canvas>` in `src/components/floor/FloorCanvas.tsx` (`drawCard`, name drawn via `fitText(ctx, c.name, inner - bustPad - cw - 6 * k)` around line 514; `fitText` at ~448 ellipsizes). Measured by recording the drawn strings: at 1366x680 and 1280x650 they read "Her…", "Hep…", "Cal…", "Cer…", "Pro…"; at 1440x900 "Her…", "Hep…", "Calli…", "Cerb…", "Pro…"; at 1920x1080 "Hepha…" and "Promet…" are still cut. At 1366 and 1280 the "0 today" count also overlaps the name. The DOM roster rows and /fleet are not clipped.
Files: src/components/floor/FloorCanvas.tsx (edit), plus a pure helper test if you extract one (new file, optional)
Steps:
1. Read `drawCard` and `fitText` and find which width budget (`inner`, `bustPad`, `cw` for the count text, scale `k`) leaves too little room for the name. Change the layout budget minimally so all five names ("Hermes", "Hephaestus", "Calliope", "Cerberus", "Prometheus") draw in full at 1280x650, 1366x680, 1440x900 and 1920x1080: e.g. let the name use the card's full inner width and move the "N today" count to its own line or right-align it only when it fits, or shrink the name font a step before ellipsizing (never below 12px). No layout redesign of the floor; keep the cards' sizes.
2. Keep ellipsis as the fallback for genuinely too-narrow cards (other widths), but not for these five names at those four sizes.
Do not touch: the busts, the floor's geometry, DOM roster components, spend/jobs data.
Proof: a Playwright probe logged in (harness in /tmp/ux-run/t26/: start26.sh, lib26.mjs, withSession) that records the strings passed to `ctx.fillText` for the card names (wrap `CanvasRenderingContext2D.prototype.fillText` via an init script) at the four sizes: the five names appear complete, with no "…" and no overlap with the "today" count (compare the drawn x ranges via measureText). Screenshots viewed. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T33: Status page contrast reaches 4.5:1 for the remaining greys
Status: DONE 2026-10-04 (#62748e was stock text-slate-500 in 11 places on status/page.tsx, all now text-dim-500; logged-in axe: 0 color-contrast and 0 violations of any impact on /status at 390x844, 1366x680, 1440x900, 1920x1080; axe leaves 67-133 nodes incomplete over the particle layer; typecheck/lint/test clean)
Spec: must-do 29; check 20 (found by the T26a logged-in sweep; T22 swapped `text-slate-600` only)
Depends on: T22
Blocked by: none
Model: sonnet
Context: Logged in, Status still has serious color-contrast violations: 11 nodes at 390x844 and 11 at 1366x680 (and 3 at 1440, 2 at 1920): `#62748e` on `#04040b` is 4.29:1, on `#020207` 4.34:1. The failing text is "WhatsApp lane", numeric cells, "total · 245", and the h2s "Watch", "Lead pipelines" and "Services". Check 20 needs 0 contrast violations on Status at 390x844 and 1366x680.
Files: src/app/(app)/status/page.tsx (edit), and any shared class/token it uses for these greys (find the class that renders `#62748e`, likely `text-slate-500`/`text-dim-*`; if it is a shared component class, fix it where defined and report every file)
Steps:
1. Find which classes produce `#62748e` on these nodes (computed colour, possibly a token at partial opacity) and replace them with the repo's own lighter token (`text-dim-500` / `--color-dim-500` #8b94b4 cleared >=6:1 in T22/T29) at every site on the Status page, not just the first.
Do not touch: other pages unless the shared class lives elsewhere (then report), colours that already pass, layout.
Proof: logged-in axe at 390x844 and 1366x680 (and 1440, 1920) on /status reports 0 color-contrast violations. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T34: Terminal command input has a label; remaining sub-12px text on Chat and Settings
Status: DONE 2026-10-04 (T13's label had gone on the job-view stdin input; the visible quick-launcher input now has aria-label 'Terminal command', stdin input relabelled 'Terminal stdin input', getByRole name match proven; 13 sub-12px sites in chat/page.tsx, 1 in settings, 1 in Terminal bumped to 12px; logged-in probe: 0 sub-12px on /chat and /settings at 390 and 1920, axe 0, no overflow; message-metadata items only render with live messages so covered by diff only; typecheck/lint/test clean)
Spec: must-do 21 (Terminal input), 23; checks 13, 15 (found by the T26a logged-in sweep)
Depends on: T13, T17
Blocked by: none
Model: sonnet
Context: (1) T13 put `aria-label="Terminal command"` on the xterm element, which is only visible when attached to a job; the visible command line (placeholder "Enter a command...", the quick-launcher input around `Terminal.tsx:303`) has no label, only the placeholder. (2) Sub-12px text remains logged in: `settings/page.tsx:~279` (the device id line) `text-[10px]`; `chat/page.tsx` toolbar items around lines 1853, 1863, 1867, 1873, 1884 at 11px (Handoff etc.); `chat/page.tsx:~2022-2037` `text-[10px]` (only renders with chats).
Files: src/components/terminal/Terminal.tsx (edit), src/app/(app)/chat/page.tsx (edit), src/app/(app)/settings/page.tsx (edit)
Steps:
1. Give the visible Terminal command input `aria-label="Terminal command"` (keep the xterm element's own label distinct, e.g. "Terminal output", so the two names do not clash).
2. Bump the sub-12px sizes named above to `text-[12px]` (grep both pages for any other `text-[Npx]` below 12 or `text-[0.xrem]` and fix them too). Nudge layout only where 12px visibly overflows (the chat toolbar is dense; check at 390).
Do not touch: sizes >=12px, handlers, anything else.
Proof: logged-in probe (harness /tmp/ux-run/t26/): the Terminal command input's computed accessible name is "Terminal command" (not placeholder-only); sub-12px count 0 on /chat (with the harness's 5 synthetic chats) and /settings at 390x844 and 1920x1080. Screenshots of /chat at 390 viewed for overflow. `npm run typecheck`/`npm run lint`/`npm test` pass.

## T35: Job detail keeps the legacy `fleet:` fallback and counts the current stage
Status: DONE 2026-10-04 (legacy fleet: resolution restored as a fallback behind meta summary/tier; Stage n counts the running stage like the floor label; Last: age reads '5 min ago'; jobDetail.test.ts 7 cases failed before, 15/15 pass after; logged-in probe: legacy fixture shows real name+tier, A reads 'Stage 2 of 3 ... Last: ... 5 min ago', A2 'Stage 1 of 2', B no Last: line, phone panel matches; finished jobs are not listed on the floor by design so finished-time/duration is unit-proven only; typecheck/lint/test clean, 330 pass)
Spec: must-do 1, 2; check 3 (found by the T26a logged-in sweep; T8 over-reached)
Depends on: T8
Blocked by: none
Model: sonnet
Context: Three defects in `src/components/dashboard/fleet/JobDetailModule.tsx` (and `jobDetail.test.ts`). (a) T8 deleted the `/api/fleet/jobs` + `briefFromCommand` fallback, but Must 2 says jobs from the older `fleet:<persona> (<model>) — <brief>` convention (the Fleet page's Dispatch button) "keep working as they do today": they now show "unknown" name and tier. Restore the legacy resolution as a FALLBACK used only when the worker has no `summary`/`tier` of its own (the new meta fields still win). (b) "Stage n of m": n currently counts COMPLETED stages, so a job that has just run `sam-stage start` on its first stage reads "Stage 0 of 2"; check 3 wants "Stage 1 of n" within 5 seconds of the first `sam-stage start`. Use current-stage numbering (the running stage's 1-based index; when no stage is running, the number done), the same way the floor canvas label does (floorRender.ts around line 540; find it with grep). (c) The "Last:" age renders as `05:06 ago` (mm:ss); render plain relative time, e.g. "5 min ago" / "40 s ago" / "2 h ago".
Files: src/components/dashboard/fleet/JobDetailModule.tsx (edit), src/components/dashboard/fleet/jobDetail.test.ts (edit)
Steps:
1. Restore the legacy fallback for name/tier (read `git show a06ceea:src/components/dashboard/fleet/JobDetailModule.tsx` for the original fetch/regex; reinstate only what is needed, behind "no meta summary/tier").
2. Change the stage label numbering and the age formatter as described; keep "no stage data" for null/empty planned stages and omit the Last: line when there is no action event.
3. Extend `jobDetail.test.ts`: legacy command + no summary resolves name/tier from the fallback input; summary/tier present wins over the fallback; first stage running reads "Stage 1 of 3"; all done reads "Stage 3 of 3"; age strings for 40 s, 5 min, 2 h.
Do not touch: cost resolution (`costFleetJob`, `/api/fleet/*`), GeneralDetailPanel.tsx, FleetPhoneView.tsx beyond what they already import.
Proof: the extended `jobDetail.test.ts` passes (the new cases fail before the edit), plus a logged-in probe with the harness's synthetic fixtures (t26-fix* jobs in /tmp/ux-run/t26/home/.sam/jobs; fixture D is the legacy `fleet:hermes (Sonnet) — brief` shape): D shows a real name and tier again; fixture A shows current-stage numbering and a "5 min ago"-style age. `npm run typecheck`/`npm run lint`/`npm test` pass.

---

## Coverage: spec check → ticket

| Check | Ticket(s) |
|---|---|
| 1 | T4, T8, T35 |
| 2 | T8 (unchanged — do-not-touch) |
| 3 | T6, T7, T8, T35 |
| 4 | T6 |
| 5 | T9 |
| 6 | T9, T27 |
| 7 | T10 |
| 8 | T10 |
| 9 | T10 |
| 10 | T25, T26 |
| 11 | T1, T26 |
| 12 | T12, T29, T30, T25 |
| 13 | T13, T34, T25 |
| 14 | T14, T15, T16, T30, T25 |
| 15 | T17, T28, T34, T25 |
| 16 | T18, T25 |
| 17 | T18, T19, T26 |
| 18 | T20, T32, T26 |
| 19 | T21, T26 |
| 20 | T22, T33, T26 |
| 21 | T23, T26 |
| 22 | T29, T31, T25, T26 |
| 23 | per-ticket typecheck/lint/test gates + foreman's final build gate (no dedicated ticket) |
| 24 | Colin's own on-device confirmation — **waits on Colin**, not a ticket |
| 25 | T24, T26 |
| Open Q1 (sign-out) | T3, T26 |
| Open Q2 (stream cutoff) | T2, T26 |
| Open Q3 (no raw command in events) | T6 |

**Blocked on nobody** — all three spec open questions are RESOLVED, so no ticket below is `Blocked by` an open question.

**Waits on Colin, not buildable by any ticket here:** installing the `.next` staged files (T4, T5, T6) into `/home/col/.local/bin/` and both seats' `settings.json`; any `./deploy.sh` or live restart; check 24's on-device confirmation.
