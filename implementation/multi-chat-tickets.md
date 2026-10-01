# SAM_ui multi-chat and notifications: build tickets

Spec: [multi-chat-spec.md](multi-chat-spec.md) (Status: LOCKED 2026-09-30)
Written: 2026-09-30, from a read of the code at `1e0e7cc`.

## Read before any ticket

- **Branch.** Build on a new branch `build/multi-chat`, cut from `claude/sam-core-dashboard-sf3639` at `1e0e7cc` (`main` `7922771` plus 6 auto-checkpoints; production is built from this tree). These tickets do not create the branch. Recommended: build in a worktree (`git worktree add ../SAM_ui-multi-chat -b build/multi-chat 1e0e7cc`, then `npx npm@10 install` in it), so `/home/col/SAM_ui` stays on the production branch under the live `sam-ui.service`. `implementation/` is untracked at `1e0e7cc`; copy this file and the spec across if you use a worktree.
- **Gates for every ticket.** `npm run typecheck`, `npm run lint` and `npm test` pass at the end of the ticket. Never run `next dev` while `sam-ui.service` is up. Never run `./deploy.sh`, push or merge; that needs Colin's go (T21).
- **Tests never touch live state.** Every new test sets `HOME` to a fresh temp dir *before* importing the module under test (use `await import()` after setting `process.env.HOME`, because paths such as `REGISTRY_FILE` in `samuiSessions.ts` and `JOBS_ROOT` in `manager.ts` are computed when the module loads). Tests set `SAM_PUSH_SUBS` to a temp file holding `[]`, so no test ever pings Colin's phone. Tests never read or print `.env.local` or any key file.
- **System files** (`/home/col/.local/bin/sam-job`, `/home/col/.local/bin/sam-dispatch`, `/home/col/.sam/sam-job/run.sh`, `/home/col/.sam/sam-push/send.mjs`, which `/home/col/.local/bin/sam-push` symlinks to) are live the moment they are written. The system-file tickets (T9, T11) therefore stage their changes as `.next` copies beside the live files, and T21 installs them on Colin's go. Every staged or installed change needs a line in today's daily note (`~/ai-memory-vault/01 - Daily Notes/<MM - Month YYYY>/<YYYY-MM-DD>.md`) naming the file, with `Enforced by: <mechanism>` (CLAUDE.md rule, 2026-09-30; the 20:25 delegation check pings on any changed helper without one). Keep the `sam-job` `--model` guard (the `claude -p` with no `--model` refusal, exit 3) exactly as it is.
- **Chat id.** A chat's id is its Claude CLI session id (the UUID the route assigns with `--session-id` on the first turn). Checked on 2026-09-30: a resumed session keeps writing to the same `<id>.jsonl` (transcript `401d1c52…`: 454 entries, one `sessionId`). Transcripts live at `<config dir>/projects/<cwd slug>/<id>.jsonl`, where the config dir is `~/.claude` (every tier except Max 2) or `max2ConfigDir()` (`~/.claude-max2`), and the cwd slug is `agentCwd()` with every character that is not a letter or digit replaced by `-` (`/home/col/claude` gives `-home-col-claude`).
- **Visual upgrade (added by SAM 2026-09-30).** A separate SAM_ui visual upgrade is in progress (vault note `SAM_ui Visual Upgrade`; Colin has not picked a concept yet). The UI tickets here (T13, T15, T16, T19) use the app's current styles and tokens, and keep each new piece in its own component (`ChatList.tsx`, the notifications page), so the visual upgrade can restyle them later without touching behaviour. Do not invent a new look here.
- **Haiku route for titles (proven 2026-09-30).** No Anthropic pay-per-use key is used. Titles come from a one-shot CLI call on the main seat: `claude -p <prompt> --model claude-haiku-4-5-20251001 --output-format json --max-turns 1 --tools "" --no-session-persistence`, run with `tierEnv('max')` plus `SAM_SKIP_SERVICE_LAUNCH=1`, cwd `os.tmpdir()`. Run on the main seat it returned `"Kitchen V3 Batch 4 Status"` in about 6 s (`is_error: false`, `modelUsage` showed only `claude-haiku-4-5-20251001`). The same call on Max 2 failed with a 429 because that seat was at its session limit, so a failed call must fall back cleanly (spec 2a).

---

## T1: `@/` imports and a fake Claude CLI for tests
Status: DONE 2026-09-30 (npm test 21 pass 0 fail incl. fakeClaude.test, @/ alias resolves tierInfo; typecheck clean, lint no errors)
Spec: foundation for check 14 (and every automated check below)
Depends on: none
Blocked by: none
Model: sonnet
Context: `npm test` compiles `src/**/*.test.ts` with `tsconfig.test.json` to `.test-build/` (CommonJS) and runs `node --test`. The server modules the new tests need import with `@/…`, which the emitted `require()` calls cannot resolve. The file's own comment says to add a resolver step rather than a bundler. Later tests also need a stand-in for the `claude` binary, because real turns cost quota and are slow.
Files: tsconfig.test.json (edit), package.json (edit `test` script only), scripts/test-alias.cjs (new file), src/lib/server/testing/fakeClaude.ts (new file), src/lib/server/testing/fakeClaude.test.ts (new file)
Steps:
1. Add `scripts/test-alias.cjs`: a `Module._resolveFilename` hook that maps a request starting `@/` to `<repo>/.test-build/<rest>`. Change `test` to `node --require ./scripts/test-alias.cjs --test ".test-build/**/*.test.js"`. Leave `pretest` alone. Update the `tsconfig.test.json` comment to say the resolver now exists.
2. Add `fakeClaude.ts`, exporting `writeFakeClaude(dir: string): string`. It writes an executable Node script (`#!/usr/bin/env node`) and returns its path. Tests point `SAM_CLAUDE_BIN` at that path; `claudeBin()` in `src/lib/server/claudeBin.ts` already honours it. The script must:
   - parse `-p <prompt>`, `--session-id <id>`, `--resume <id>` and `--model <m>`;
   - append one JSON line to `$FAKE_CLAUDE_LOG`, if set, holding argv, cwd, `CLAUDE_CONFIG_DIR` and `SAM_CHAT_ID`;
   - in title mode (the `--model` value contains `haiku`): print one JSON result `{"type":"result","is_error":false,"result":$FAKE_TITLE}`, or exit 1 when `FAKE_TITLE_FAIL=1`;
   - otherwise act as a turn: sleep `$FAKE_CLAUDE_DELAY_MS` (default 0); append a `user` entry and an `assistant` entry (content `[{type:'text',text:<reply>}]`, reply `$FAKE_CLAUDE_REPLY` or `echo: <prompt>`) to `<CLAUDE_CONFIG_DIR or $HOME/.claude>/projects/<cwd slug>/<id>.jsonl`, using the same entry shape as a real transcript (`type`, `message.role`, `message.content`, `sessionId`, `cwd`); print stream-json lines `system/init` (with `session_id`), then `assistant`, then `result`; exit 0;
   - when the prompt contains a line `Write the memo to: <path>`, also write a short Markdown memo to `<path>` (T18 uses this).
3. Add `fakeClaude.test.ts`. It imports one `@/` module (for example `tierInfo` from `@/lib/server/chat/tiers`) to prove the resolver works. It runs the fake as a turn and in title mode, and asserts the transcript file and the stdout lines.
Do not touch: `tsconfig.json`, `next.config.*`, the existing tests `serialTick.test.ts` and `osIntentRunner.test.ts` (they must still pass unchanged).
Proof: `npm test` passes, the output lists the two existing tests plus `fakeClaude.test`, and the `@/` import resolves. `npm run typecheck` and `npm run lint` pass.

## T2: Job page shows the output of `sam-job` jobs (failing test first)
Status: DONE 2026-09-30 (readFrames.test case 1 FAILS on old manager.ts (verified by swap), npm test 23 pass after; typecheck clean, lint no errors)
Spec: must-do 20, check 13
Depends on: T1
Blocked by: none
Model: sonnet
Context: `src/app/(app)/jobs/[id]/page.tsx` renders `<Terminal jobId>`. That component reads `/api/jobs/[id]/stream`, which calls `JobManager.getOutput()` and then `readFrames()` in `src/lib/server/jobs/manager.ts`. `readFrames` parses a binary-framed file (4-byte seq, 4-byte length, data). `sam-job`'s worker (`run.sh`) writes plain text to `stdout.log`, so the first 8 bytes of text are read as a huge length, the loop breaks, and the page shows `(no output)`. sam-job meta is recognisable: it has a `unit` string and no `lastSeq`, and its `status` can be `failed` or `stopped`, which `JobStatus` in `src/types/jobs.ts` does not list. Check 13 says this test must FAIL on the current code.
Files: src/lib/server/jobs/manager.ts (edit `readFrames`), src/lib/server/jobs/readFrames.test.ts (new file), src/app/api/jobs/[id]/stream/route.ts (edit the finished-status check), src/types/jobs.ts (edit `JobStatus`)
Steps:
1. Write `readFrames.test.ts` first. Set a temp `HOME`, then import `readFrames` (use it directly rather than `getJobManager()`, whose constructor reconciles orphans). Create `~/.sam/jobs/job_x_20260930-120000/meta.json` in the sam-job shape (`unit`, `status: "exited"`, `notify`, no `lastSeq`) and a plain-text `stdout.log` of three lines. Assert the joined frames equal the file text. Add a second case: a framed file written the manager's way still parses exactly as before.
2. Run `npm test` and save the FAIL output for the first case into the ticket's result.
3. Fix `readFrames`: when `meta.json` marks the job as a sam-job job (has `unit`, no `lastSeq`), return the file as plain text in chunks of 64 KB or less, with seq 1..n, still honouring `fromSeq`.
4. In the stream route, treat any status that is not `running` or `queued` as finished (so `failed` and `stopped` send `closed`). Add `'failed' | 'stopped'` to `JobStatus`, then fix whatever typecheck flags, for example the status badge colours in `src/components/terminal/Terminal.tsx`.
Do not touch: the binary frame writer (`OutputWriter`), trimming, `reconcileOrphans`, the sweep, the chat's use of the stream.
Proof: the step-2 run fails on the first case; after the fix, `npm test` passes, including both cases.

## T3: Server chat store
Status: DONE 2026-09-30 (npm test 30 pass incl. chatStore.test (7 cases, Parkfords-in-message matches nothing); typecheck clean, lint no errors)
Spec: must-do 2, 9a, 10, 11 (data layer); checks 7a and 8 (store part)
Depends on: T1
Blocked by: none
Model: sonnet
Context: Today the only server record of a chat is its id in `~/.sam/samui-sessions.json` (`src/lib/server/chat/samuiSessions.ts`, cap 500, oldest trimmed). The list, titles, tiers, archive and delete need a proper record. Titles and chat text stay in SAM_ui's own store under `~/.sam`, never in the vault's `02 - Atwood Systems/`.
Files: src/lib/server/chat/chatStore.ts (new file), src/lib/server/chat/chatStore.test.ts (new file), src/types/chat.ts (edit: add types)
Steps:
1. In `src/types/chat.ts`, add `ChatTier = TierId | 'unknown'`, `ChatAccount = 'main' | 'max2'`, and `ChatRecord`, holding: `id`, `title`, `titleSource: 'fallback' | 'haiku'`, `titleTries`, `tier: ChatTier`, `account`, `firstMessage` (first 500 chars), `createdAt`, `lastActiveAt`, `turns`, `archived`, `deleted`, `imported`, `runningJobId: string | null`, `handedOffTo?`, `handedOffFrom?`, `handoffError?`. Also add `ChatSummary`: the fields the list needs plus `running: boolean`.
2. `chatStore.ts` persists to `~/.sam/samui-chats.json`. Resolve the path from `os.homedir()` on every load, not at module load. Cache it on `globalThis` like `samuiSessions.ts` does, write atomically (tmp file, then rename), and export `__resetChatStoreForTests()`. Export `createChat`, `getChat` (returns null for deleted chats), `listChats({ archived, q })` (excludes deleted; newest `lastActiveAt` first), `touchChat`, `setTitle`, `setRunningJob`, `archiveChat`, `restoreChat`, `deleteChat`, `markHandedOff`, and the pure `filterByTitle(chats, q)`: case-insensitive substring on the title only.
3. `deleteChat` sets `deleted: true` and never touches any transcript file. SAM can recover a deleted chat by clearing the flag by hand.
4. Tests: create, list order, archive hides and restore returns, delete removes the chat from both lists and from `getChat`, and `filterByTitle` matches part of a title in the main list and in Archived. The last test gives a chat a title "Kitchen status" and a `firstMessage` containing "Parkfords"; searching "Parkfords" returns nothing.
Do not touch: `samuiSessions.ts` (it stays the resume allowlist), any file under `~/.claude*`.
Proof: `npm test` passes, including `chatStore.test`.

## T4: Transcript reader: find, parse and infer tier
Status: DONE 2026-09-30 (npm test 38 pass incl. transcripts.test (8 cases: 2-turn tool chat reads as 4 msgs, 3 tier cases, missing id null); typecheck clean, lint no errors)
Spec: must-do 4, 5, 14a (history from the server); feeds checks 3 and 10a
Depends on: T1
Blocked by: none
Model: sonnet
Context: History must load from the server (spec 4), and the server's copy is the CLI transcript. `AgentStreamParser` in `src/lib/agentStream.ts` already turns `assistant` and `user` (tool_result) events into `ChatBlock`s. Transcript entries have the same `message.content` shape, so reuse the parser rather than writing a second one. The 2026-09-30 registry has 178 ids: 141 transcripts under `~/.claude`, 37 under `~/.claude-max2`, none missing. Many old chats mixed tiers, because the tier used to be chosen per message.
Files: src/lib/server/chat/transcripts.ts (new file), src/lib/server/chat/transcripts.test.ts (new file), src/lib/server/chat/agentCwd.ts (new file: move `agentCwd()` out of `src/app/api/chat/agent/route.ts` and import it back there)
Steps:
1. `cwdSlug(dir)`, `transcriptPath(id)` → `{ path, account } | null`. Look in `<~/.claude>/projects/<slug>/<id>.jsonl` (account `main`), then `<max2ConfigDir()>/projects/<slug>/<id>.jsonl` (account `max2`).
2. `readHistory(id): ChatMessage[]`. Split the transcript into turns at each `user` entry whose content is a string or a text block (a real prompt, not a tool_result). Each turn becomes one user `ChatMessage` plus one assistant `ChatMessage`, built by feeding that turn's entries through a fresh `AgentStreamParser` (as JSON lines) and calling `finish(0)`. Every message is `done: true`. Skip `queue-operation`, `attachment`, `mode`, `last-prompt` and `system` entries.
3. `inferTier(id): { tier: ChatTier, account }`. Transcripts under Max 2 give `max2`. Under main, take the `message.model` values, ignoring `<synthetic>`. If they all map to one tier, return it (`deepseek*flash` → `fast`, `deepseek-v4-pro` → `pro`, `gemini*` → `gemini`, `claude-*` → `max`); otherwise `unknown`.
4. Tests use fixture transcripts written into a temp HOME: a two-turn chat with a tool call reads back as 4 messages with the tool result attached; each of the three tier cases infers correctly; a missing id returns null.
Do not touch: `AgentStreamParser` behaviour (the live chat depends on it), transcript files (read only).
Proof: `npm test` passes, including `transcripts.test`.

## T5: Chat-aware turns: every turn locked, tier fixed, chat id passed to the CLI
Status: DONE 2026-09-30 (npm test 44 pass incl. startTurn.test (check 4 two chats no 409, check 7 tier 409, SAM_CHAT_ID + --resume, Max 2 CLAUDE_CONFIG_DIR) via real systemd-run scope; typecheck exit 0, lint no errors)
Spec: must-do 6, 9, 13 (server), 14a (resume on the right account); checks 4 and 7 (server part)
Depends on: T3, T4
Blocked by: none
Model: opus
Context: `POST` in `src/app/api/chat/agent/route.ts` locks a session only when resuming (`acquireSessionLock` / `holdSessionLock` / `releaseSessionLock` in `sessionLock.ts`). A first turn is never locked, so "is this chat running?" cannot be answered. The 409 on a second turn in the same chat stays (spec section 4). Only app-created chats are resumable. The registry trims at 500, so imported chats (T8) must also be recognised through the chat store, which only ever holds app-created ids. SAM_CHAT_ID in the spawn env reaches the chat's Bash commands (proven), which is how jobs learn their chat (T11).
Files: src/lib/server/chat/startTurn.ts (new file), src/lib/server/chat/startTurn.test.ts (new file), src/app/api/chat/agent/route.ts (edit: becomes auth, then parse, then `startTurn`, then envelope), src/lib/server/chat/sessionLock.ts (edit: add `isSessionLocked(id)`), src/lib/chatAgentService.ts (edit: `chatId` in and out)
Steps:
1. Move the body of `POST` after auth and parsing into `startTurn({ message, attachments, tier, chatId?, device })`, returning `{ ok: true, jobId, chatId, tier } | { ok: false, status, error }`. The route keeps `requireStepUp`, `logCommand` and the envelope. It must not import telemetry or `next/server` into `startTurn.ts`, so the service stays testable.
2. No `chatId` means a new chat: `randomUUID()`, `registerSamuiSession`, `createChat` (tier, account, `firstMessage`, fallback title from T7's `fallbackTitle`, or a local 48-character cut until T7 lands), `--session-id`.
3. With a `chatId`: the chat must exist in the store and not be deleted, else 404. Resume is allowed when `isSamuiSession(id) || getChat(id)`. If the chat's tier is known and the request's tier differs, return 409 `This chat is on <label>. Use Handoff to change tier.` An `unknown`-tier chat ignores the requested tier and runs with `tierEnv('max')` on account `main`, or `tierEnv('max2')` on `max2`.
4. Take the lock on every turn, new or resumed, keyed by chat id, before spawning; 409 as today when it is held. Hold it with the job id and release it in `onExit` and on spawn failure, exactly as the current code does. Add `SAM_CHAT_ID: chatId` to the `createArgs` env next to `SAM_SKIP_SERVICE_LAUNCH`. Set `runningJobId` when the turn starts. In `onExit`, clear it, `touchChat`, increment `turns`, then keep `reportChatRun`. Export `onTurnExit` hooks (a simple array) so T7, T10 and T18 can attach without editing this flow.
5. `sessionLock.ts`: add `isSessionLocked(id): boolean` (true while a non-stale lock exists).
6. `chatAgentService.ts`: `startAgentTurn` takes `chatId?` instead of `resumeSessionId`, and `StartTurnResult` gains `chatId`. Keep the page compiling by passing `chatId: localStorage.getItem(SESSION_KEY) ?? undefined` for now; T14 replaces this.
7. Test (`startTurn.test.ts`, real `JobManager` through `systemd-run --user --scope`, fake CLI from T1 with `FAKE_CLAUDE_DELAY_MS=1500`, temp HOME and `SAM_AGENT_CWD`):
   - two new chats started together both finish with their own replies in their own transcripts, and neither gets a 409 (check 4);
   - a second turn on chat A while A runs returns 409;
   - a turn on chat A with a different tier after its first message returns 409 (check 7);
   - the fake's log shows `SAM_CHAT_ID` equal to the chat id and `--resume <id>` on the second turn;
   - a Max 2 chat runs with `CLAUDE_CONFIG_DIR` set to the Max 2 dir.
   If `systemd-run --user` is unavailable, the test must fail loudly, not skip.
Do not touch: the attachment validation (`resolveAttachment`), the tier availability checks and their 503s, `tierEnv`, the stdin/`/dev/null` choice in `createArgs`, and the stale-lock heartbeat logic.
Proof: `npm test` passes, including `startTurn.test` (checks 4 and 7, server side). `npm run typecheck` passes. The chat page still sends and resumes a turn when exercised by T20's build.

## T6: Chats API: list, open, archive, restore, delete, adopt
Status: DONE 2026-09-30 (npm test 49 pass incl. chatActions.test (check 3 two-device deep-equal, check 8 archive/restore/delete + transcript kept + 409 while running, check 7a title-only q); typecheck exit 0, lint 0 errors)
Spec: must-do 4, 5, 10, 11, 12, 13, 14; checks 3, 8 and 7a (API part)
Depends on: T5
Blocked by: none
Model: sonnet
Context: Phone and PC must see the same list and history (spec 5), so every read comes from the server and takes no device input. Chat stays behind auth. Reads use `requireSession`, the same level as `/api/jobs/[id]/stream`, which already serves chat output. Every change uses `requireStepUp`. Archive and delete are refused while a turn runs (spec 12).
Files: src/lib/server/chat/chatActions.ts (new file), src/lib/server/chat/chatActions.test.ts (new file), src/app/api/chats/route.ts (new file), src/app/api/chats/[id]/route.ts (new file), src/app/api/chats/adopt/route.ts (new file), src/lib/chatsService.ts (new file, client fetch helpers)
Steps:
1. `chatActions.ts` holds the logic. The routes stay thin (auth, then call, then `envelope`/`failure` from `src/lib/server/respond.ts`).
   - `listChatSummaries({ archived, q })`: `listChats` plus `running: isSessionLocked(id)`.
   - `openChat(id)`: `{ chat, messages: readHistory(id), runningJobId }`. When a turn is running, drop the transcript's last, unfinished turn, because the client replays it from the job stream.
   - `archive(id)`, `restore(id)`, `remove(id)`: each returns 409 `A turn is running in this chat.` while `isSessionLocked(id)`.
   - `adopt(id)`: for T14's migration of a device's current chat. Allowed only when `isSamuiSession(id)` and a transcript exists. It creates the record if missing (tier from `inferTier`, fallback title from the first user message) and always leaves the chat unarchived. Unknown ids get a 404, and nothing is resumed.
2. Routes: `GET /api/chats?archived=0|1&q=`, `GET /api/chats/[id]`, `PATCH /api/chats/[id]` with `{ action: 'archive' | 'restore' }`, `DELETE /api/chats/[id]`, `POST /api/chats/adopt` with `{ id }`.
3. `chatsService.ts`: typed client wrappers for these, in the style of `src/lib/chatAgentService.ts` (throw `StepUpRequiredError` on a 401 with `stepUpRequired`).
4. Tests (fake CLI, temp HOME):
   - **Check 3.** Start a chat with device "phone" through `startTurn`, wait for exit. Then call `listChatSummaries` and `openChat` once for the phone and once for the PC; the reads take no device input. Assert the two calls return deep-equal lists and deep-equal histories, and that the history holds the turn's user text and reply.
   - **Check 8.** Archive hides the chat and restore returns it. Delete removes it from both lists, `openChat` returns 404, and the transcript file still exists on disk. With the fake's delay, archive and delete return 409 while the turn runs.
   - **Check 7a.** `?q=` filters the main list and Archived by title only.
Do not touch: `/api/chat/agent` behaviour beyond what T5 did, and the auth guards themselves.
Proof: `npm test` passes, including `chatActions.test` (checks 3, 8 and the API half of 7a).

## T7: Haiku titles with a first-message fallback
Status: DONE 2026-09-30 (npm test 57 pass incl. titles.test (haiku title <=8 words, 20-word cut to 8, FAKE_TITLE_FAIL keeps fallback + titleTries++); typecheck exit 0, lint 0 errors. Scope note: foreman made startTurn.test.ts readLog() count turn spawns only (excludes --no-session-persistence title calls), since T7's background title call otherwise lands in T5's raw spawn count; chatActions.ts now imports fallbackTitle)
Spec: must-do 2a; check 1a
Depends on: T5
Blocked by: none
Model: sonnet
Context: The route is proven as described in "Read before any ticket" above (main seat, about 6 s). Max 2 was at its session limit on 2026-09-30, so do not use it for titles; the fallback covers any failure. A title call is not a user job, so spawn it directly and do not put it in the job list. Imported chats (T8) get titles the same way.
Files: src/lib/server/chat/titles.ts (new file), src/lib/server/chat/titles.test.ts (new file), src/lib/server/chat/startTurn.ts (edit: register an exit hook)
Steps:
1. `fallbackTitle(firstMessage)`: whitespace collapsed, cut at a word boundary to 48 chars or fewer, with `…` added when cut. An empty message gives "New chat".
2. `generateTitle(firstMessage, firstReply, { bin = claudeBin(), timeoutMs = 60_000 })`: `child_process.spawn` with the args and env from the proven route; the prompt asks for a 3 to 6 word title and gives both texts, each truncated to 600 chars. Parse the JSON; throw on `is_error`, a non-zero exit or a timeout. Clean the result: strip quotes and a trailing full stop, keep at most 8 words.
3. `queueTitle(chatId)`: a single in-process queue, one call at a time. It fetches the first user message and first reply from `readHistory`, then `setTitle(id, title, 'haiku')`. On failure it records the try (`titleTries++`) and leaves the fallback in place. Register an exit hook in `startTurn`: after a turn ends, if `titleSource !== 'haiku' && titleTries < 3`, call `queueTitle`.
4. Tests, using the fake CLI's title mode: `FAKE_TITLE="Kitchen v3 B4 status"` gives a title of 8 words or fewer and `titleSource: 'haiku'`; a 20-word `FAKE_TITLE` is cut to 8 words; `FAKE_TITLE_FAIL=1` leaves the fallback title (the cut-short first message) and increments `titleTries`.
Do not touch: `tierEnv` and the chat turn's own args.
Proof: `npm test` passes, including `titles.test` (check 1a).

## T8: Import the registry's chats into Archived
Status: DONE 2026-09-30 (npm test 63 pass incl. importRegistry.test (3 of 4 ids archived, none in main; max2 and unknown/main tiers; adopt returns one to main; restore+startTurn resumes with right CLAUDE_CONFIG_DIR; second import adds nothing); typecheck exit 0, lint 0 errors)
Spec: must-do 14a; check 10a
Depends on: T6, T7
Blocked by: none
Model: sonnet
Context: `~/.sam/samui-sessions.json` held 178 ids on 2026-09-30, every one with a transcript (141 main, 37 Max 2). They arrive archived. Only each device's current chat returns to the main list, through `adopt` in T14. Titles start as fallbacks, and Haiku titles are queued one at a time in the background (T7), so 178 calls never block a request.
Files: src/lib/server/chat/importRegistry.ts (new file), src/lib/server/chat/importRegistry.test.ts (new file), src/lib/server/chat/chatActions.ts (edit: run the import once before the first list)
Steps:
1. `importRegistryChats()`: for each id in the registry file that has a transcript (`transcriptPath`) and no store record, create `{ archived: true, imported: true, tier and account from inferTier, title: fallbackTitle(first user message), createdAt and lastActiveAt from the transcript's first and last timestamps }`. Then queue its title. Record `importedAt` in the store so the import runs once. The import is idempotent; a second run adds nothing.
2. Call it from `listChatSummaries` when `importedAt` is unset.
3. Test (temp HOME, fake CLI): write a registry of 4 ids, 3 with transcripts (1 on Max 2, 1 mixed-model on main) and 1 with none.
   - After the import, exactly the 3 are in Archived and none are in the main list.
   - The Max 2 one has tier `max2`; the mixed one has tier `unknown` and account `main`.
   - After `adopt(id)` on one, that chat alone is in the main list.
   - `restore` on another, then `startTurn` on it, spawns with `--resume <id>` and the right `CLAUDE_CONFIG_DIR` (none for main, the Max 2 dir for Max 2).
   - A second import adds nothing.
Do not touch: the registry file (read only here) and the transcripts.
Proof: `npm test` passes, including `importRegistry.test` (check 10a).

## T9: `sam-push` logs every ping and links it to its chat or its entry (staged)
Status: DONE 2026-09-30 (npm test 69 pass incl. samPush.test (6 cases: chat link, /notifications?n=<own id>, --url kept, one line per call); live send.mjs sha256 unchanged, symlink unchanged; daily note line written (Session 7); typecheck exit 0, lint 0 errors)
Spec: must-do 15, 17, 19; checks 11 and 12 (link part)
Depends on: T1
Blocked by: none
Model: sonnet
Context: `/home/col/.local/bin/sam-push` is a symlink to `/home/col/.sam/sam-push/send.mjs`, a system file. It sends `{ title, body, url, tag, ts }` with `url` defaulting to `/`. The Notifications section needs a record of every ping. A ping raised from inside a chat (its Bash has `SAM_CHAT_ID`) must open that chat. A ping with no chat (for example the 20:25 `delegation-check.sh`, which sends `--tag fleet` and no `--url`) must open its own Notifications entry. Delivery itself does not change (spec: won't do). The change is staged, not live, until T21, because an early link to `/notifications` would 404 in production.
Files: /home/col/.sam/sam-push/send.next.mjs (new file: a copy of `send.mjs` with the changes; it sits in the same dir so `web-push` resolves), src/lib/server/push/samPush.test.ts (new file), today's daily note (edit: one line)
Steps:
1. Copy `send.mjs` to `send.next.mjs` and change only the copy:
   - Accept `--chat <uuid>` and `--job <id>`. Read the chat from `--chat`, else from `SAM_CHAT_ID` in the env; accept it only if it is a UUID.
   - Generate an entry id (`n_<base36 time>_<4 random hex>`).
   - URL rule: an explicit `--url` wins. With no `--url`, use `/chat?c=<chat>` when there is a chat, else `/notifications?n=<entry id>`.
   - Before loading the VAPID keys or subscribers, append one JSON line `{ id, ts, title, body, url, tag, chatId, jobId }` to `SAM_PUSH_LOG`, default `~/.sam/push-log.jsonl`. When the file passes 1 MB, rewrite it to its newest 1000 lines.
   - Read subscribers from `SAM_PUSH_SUBS` when set (a test seam), default unchanged.
   - Everything else (sending, stale-subscription pruning, exit codes) stays byte-for-byte as it is.
2. `samPush.test.ts` runs `send.next.mjs` if it exists, else the live `sam-push` (so the test still holds after T21 installs it), with `SAM_PUSH_SUBS` pointing at a temp `[]` file and `SAM_PUSH_LOG` at a temp path. It asserts:
   - with `SAM_CHAT_ID=<uuid>` and no `--url`, the logged url is `/chat?c=<uuid>`;
   - with no chat and no `--url`, the url is `/notifications?n=<the logged id>`;
   - `--url /jobs/x` is kept as given;
   - one line is logged per call.
3. Daily note line: `send.next.mjs staged (multi-chat T9): ping log and chat/notification links. Enforced by: SAM_ui npm test src/lib/server/push/samPush.test.ts`.
Do not touch: the live `send.mjs`, the symlink, `~/.sam/push-subs.json`, `~/.sam/push-vapid.json`, `package.json` in `~/.sam/sam-push`.
Proof: `npm test` passes, including `samPush.test`. `ls -l /home/col/.local/bin/sam-push` still points at `send.mjs`, and `sha256sum /home/col/.sam/sam-push/send.mjs` is the same before and after the ticket.

## T10: Ping when an off-screen chat finishes a turn
Status: DONE 2026-09-30 (npm test 71 pass incl. turnPing.test (check 5a: A focused by pc, B not; push log holds exactly one entry /chat?c=<B>; internal turn never pings); typecheck exit 0, lint 0 errors)
Spec: must-do 7a, 15; check 5a
Depends on: T5, T9
Blocked by: none
Model: sonnet
Context: Colin gets a ping that opens the chat when a chat that is not on screen finishes a turn, and no ping when it is on screen. The server cannot see screens, so each device reports the chat it has on screen while the page is visible (the client side is wired in T17). "On screen" means any device reported that chat within the last 45 s.
Files: src/lib/server/chat/focus.ts (new file), src/app/api/chats/focus/route.ts (new file), src/lib/server/chat/turnPing.ts (new file), src/lib/server/chat/turnPing.test.ts (new file), src/lib/server/chat/startTurn.ts (edit: register the exit hook)
Steps:
1. `focus.ts`: an in-memory map (on `globalThis`) from device to `{ chatId | null, at }`, with `setFocus(device, chatId | null)` and `isOnScreen(chatId, now)`, using a 45 s TTL. `POST /api/chats/focus` with `{ chatId: string | null }`, `requireSession`, and the device taken from the session payload.
2. `turnPing.ts`: an exit hook. If `!isOnScreen(chatId)`, spawn `process.env.SAM_PUSH_BIN ?? '/home/col/.local/bin/sam-push'` with `--title "SAM replied" --body "<chat title>: <first 100 chars of the answer>" --url /chat?c=<id> --chat <id> --tag chat-<id>`, detached, errors swallowed. Get the answer from the job output with `readFrames` and a fresh `AgentStreamParser`, then `spokenText`; use the title alone if that fails. Skip the ping for turns that T18 marks as internal (the handoff memo turn); its continuation chat pings instead.
3. Test: `SAM_PUSH_BIN` points at `send.next.mjs` or the live `sam-push` (same rule as T9), with temp `SAM_PUSH_SUBS` (`[]`) and `SAM_PUSH_LOG`. Run two turns with the fake CLI, with chat A focused by device "pc" and chat B not focused. When both have exited, the log holds exactly one entry, with url `/chat?c=<B>`.
Do not touch: `sam-push` itself (T9), the service worker.
Proof: `npm test` passes, including `turnPing.test` (check 5a).

## T11: A job dispatched from a chat pings that chat (staged)
Status: DONE 2026-09-30 (npm test 72 pass incl. dispatchPing.test (check 11: real Haiku job via sam-dispatch.next, meta.chatId = uuid, one ping /chat?c=<uuid> with jobId, temp store/subs/log); guard sed-range diff empty; 4 live sha256 unchanged; 3 daily note lines written; typecheck exit 0, lint 0 errors)
Spec: must-do 16; check 11
Depends on: T9
Blocked by: none
Model: opus
Context: `sam-dispatch` execs `/home/col/.local/bin/sam-job --notify …`. `sam-job` starts `run.sh` with `systemd-run --user` as a service unit, which does NOT inherit the caller's env. So `SAM_CHAT_ID`, although present in the chat's Bash, never reaches `run.sh`. `run.sh` pings with `--url "/jobs/$ID"`. The fix: `sam-job` records the chat id in `meta.json` at launch (it runs in the chat's shell, so it can see `SAM_CHAT_ID`), and `run.sh` uses it for the link. `sam-dispatch` needs only a test seam. All three are system files: stage them, keep the `--model` guard intact, and write a daily-note line for each.
Files: /home/col/.local/bin/sam-job.next (new file), /home/col/.sam/sam-job/run.next.sh (new file), /home/col/.local/bin/sam-dispatch.next (new file), src/lib/server/push/dispatchPing.test.ts (new file), today's daily note (edit: three lines)
Steps:
1. `sam-job.next`, a copy of `sam-job` with these changes:
   - write `"chatId"` into `meta.json` from `$SAM_CHAT_ID` when it is a UUID, else null;
   - add the seams `STORE=${SAM_JOB_STORE:-/home/col/.sam/jobs}` and `RUN_SH=${SAM_JOB_RUN_SH:-/home/col/.sam/sam-job/run.sh}`;
   - pass `--setenv=` for each of `SAM_PUSH_BIN`, `SAM_PUSH_SUBS` and `SAM_PUSH_LOG` to `systemd-run` when set.
   The `--model` guard block stays byte-for-byte.
2. `run.next.sh`, a copy of `run.sh`: `PUSH=${SAM_PUSH_BIN:-/home/col/.local/bin/sam-push}`. Read `chatId` from meta; when it is set, ping with `--url "/chat?c=<chatId>" --chat <chatId>`, else `--url "/jobs/$ID"` as today. Always add `--job "$ID"`. The summary and digest logic stay unchanged.
3. `sam-dispatch.next`, a copy of `sam-dispatch` whose only change is `exec ${SAM_JOB_BIN:-/home/col/.local/bin/sam-job}`.
4. `dispatchPing.test.ts`: uses the `.next` files if they exist, else the live ones (so it survives T21). It sets `SAM_CHAT_ID=<uuid>`, temp `SAM_JOB_STORE`, `SAM_JOB_BIN` and `SAM_JOB_RUN_SH` pointing at the staged copies, `SAM_PUSH_BIN` at T9's `send.next.mjs` (else the live `sam-push`), temp `SAM_PUSH_SUBS` (`[]`) and `SAM_PUSH_LOG`. It runs `sam-dispatch --tier haiku --brief <temp file: "Reply with the single word OK."> --cwd <temp> --name mc-ping-test` and polls the temp job's `meta.json` until the status is `exited` or `failed` (timeout 180 s). It asserts `meta.chatId === <uuid>` and that the log holds one entry with url `/chat?c=<uuid>` and `jobId` equal to the job id. This makes one real Haiku call per `npm test`. If the seat is at its limit, the job fails fast, the ping still fires with the failure title, and the link assertion still holds.
5. Daily note lines, one per file: `<file> staged (multi-chat T11): chat id carried from dispatch to ping. Enforced by: SAM_ui npm test src/lib/server/push/dispatchPing.test.ts`. State that the `--model` guard is unchanged.
Do not touch: the live `sam-job`, `run.sh`, `sam-dispatch`, `digest.py`, the tier-to-model table in `sam-dispatch`, `~/.sam/jobs` (the test uses a temp store).
Proof: `npm test` passes, including `dispatchPing.test` (check 11). `diff <(sed -n '/Model routing guard/,/^fi$/p' /home/col/.local/bin/sam-job) <(sed -n '/Model routing guard/,/^fi$/p' /home/col/.local/bin/sam-job.next)` prints nothing. The live files' `sha256sum` values are unchanged.

## T12: A notification tap opens the exact link, query included
Status: DONE 2026-09-30 (sw.ts notificationclick now compares pathname+search for focus and navigate (diff read, only that handler); npm test 72 pass, typecheck exit 0, lint 0 errors; browser check deferred to T21)
Spec: must-do 15, 16, 18, 19 (so that `/chat?c=` and `/notifications?n=` land); check 12 (browser part, run in T21)
Depends on: none
Blocked by: none
Model: sonnet
Context: The `notificationclick` handler in `src/app/sw.ts` compares `pathname` only. With the app already open on `/chat` (chat A), a ping for `/chat?c=B` just focuses the window and never opens B. The same happens for `/notifications?n=…`. This is about where a ping's link points, which the spec allows; push delivery and subscriptions stay as they are.
Files: src/app/sw.ts (edit `notificationclick` only)
Steps:
1. Compare `pathname + search`. If a window is already on the exact URL, focus it. Otherwise focus the first window and `navigate(url)` whenever the full URL differs. With no window open, `openWindow(url)` as today. Keep the same-origin check.
Do not touch: the `push` handler, the caching rules, `PushNotifications.tsx`, `/api/push`.
Proof: `npm run typecheck`, `npm run lint` and `npm test` pass. The behaviour is checked in the browser in T21 (check 12).

## T13: Notifications section
Status: DONE 2026-09-30 (npm test 78 pass incl. notifications.test (3 target cases, newest first, corrupt line skipped); nav entries added in Sidebar and TabBar (Pings), TabBar tabs now flex-1 px-1 to fit 9 tabs at 390px (to confirm in browser, T21); typecheck exit 0, lint 0 errors)
Spec: must-do 17, 18, 19; check 12
Depends on: T9
Blocked by: none
Model: sonnet
Context: The section lists every ping from the log T9 writes (`~/.sam/push-log.jsonl`, or `SAM_PUSH_LOG`), newest first, with title, body and time. Tapping an entry opens its chat if it has one, else its job output, else the entry itself. `/notifications?n=<id>` scrolls to and highlights that entry. There are no unread counts, badges or deleting (won't do).
Files: src/lib/server/push/notifications.ts (new file), src/lib/server/push/notifications.test.ts (new file), src/app/api/notifications/route.ts (new file), src/app/(app)/notifications/page.tsx (new file), src/components/shell/Sidebar.tsx (edit the nav list), src/components/shell/TabBar.tsx (edit the tabs list)
Steps:
1. `notifications.ts`: `readNotifications(limit = 200)`, which reads the log, skips bad lines, and returns newest first. `notificationTarget(entry)`: `/chat?c=<chatId>` if `chatId`, else `/jobs/<jobId>` if `jobId`, else `/notifications?n=<id>`.
2. `GET /api/notifications` with `requireSession` returns `readNotifications()`.
3. The page lists the entries (title, body, local time). Each entry is a link to `notificationTarget(entry)`. On load, `?n=` scrolls to that entry and highlights it.
4. Nav: add `{ id: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell }` to `Sidebar.tsx`. In `TabBar.tsx`, use a label as short as its neighbours (`Pings`). Check at 390 px that the tab bar still fits without clipping.
5. Tests: `notificationTarget` covers all three cases; `readNotifications` returns newest first and skips a corrupt line. Together with T9's no-chat link test, this covers the automated half of check 12.
Do not touch: `sam-push`, `sw.ts` (T12), existing nav entries and their order.
Proof: `npm test` passes, including `notifications.test` (check 12, automated part). The browser half runs in T21.

## T14: Chats kept per id on the device; New never wipes; pre-upgrade chat adopted (failing test first)
Status: DONE 2026-10-01 (check 2 FAILED on lifted-out old New (saved run), npm test 82 pass incl. chatLocal.test (check 2, migration, reload-after-New no re-migrate); retry 1 removed page writes of sam-agent-session that re-triggered migrate+adopt on every reload; typecheck exit 0, lint exit 0)
Spec: must-do 3, 14; check 2 (and it makes check 10 possible)
Depends on: T6
Blocked by: none
Model: sonnet
Context: `newConversation` in `src/app/(app)/chat/page.tsx` (line 1103) removes `SESSION_KEY`, `MESSAGES_KEY`, `ACTIVE_KEY` and `PENDING_KEY` (`sam-agent-session`, `sam-agent-messages`, `sam-agent-active`, `sam-agent-pending`) and clears the messages, so the previous chat is gone from the device. Check 2 must FAIL on this code and PASS after. The page has no testable seam today, so the first step lifts the current New behaviour out unchanged, making the failing test exercise the real current logic.
Files: src/lib/chatLocal.ts (new file), src/lib/chatLocal.test.ts (new file), src/app/(app)/chat/page.tsx (edit: `newConversation`, `loadMessages`, the persistence effect, `ActiveRun` storage, `send`)
Steps:
1. Create `chatLocal.ts` exporting the four legacy key names and `resetConversation(storage: Storage)`, which does exactly what `newConversation` does to storage today. Call it from `newConversation`. Behaviour stays unchanged.
2. Write `chatLocal.test.ts` using an in-memory `Storage` stub. Seed chat A (`sam-agent-session` = A, `sam-agent-messages` = 3 messages), call New through the module's public New function, then assert that A is still in `localChatIds(storage)` and that `loadChatMessages(storage, A)` returns all 3 messages. Stub the missing functions so the file compiles. Run `npm test` and save the FAIL output.
3. Implement per-chat storage:
   - `sam-chat-messages:<id>` (cap 40, as `MAX_STORED`), `sam-chat-active:<id>` (the `ActiveRun`), `sam-chat-pending:<id>`, and `sam-chat-current` (the id on screen, or `draft`);
   - `startDraft(storage)`, which sets current to `draft` and touches no other key;
   - `localChatIds`, `loadChatMessages` and `saveChatMessages`;
   - `migrateLegacy(storage)`: if `sam-agent-session` is set, copy `sam-agent-messages` to `sam-chat-messages:<id>`, set current to that id, remove the legacy keys, and return the id so the page can call `chatsService.adopt(id)` (T6).
4. Page: on mount, run `migrateLegacy`, then `adopt`. `send` passes `chatId` (the current id; undefined for a draft) and switches current to the returned `chatId`. `newConversation` calls `startDraft` and clears only in-memory state for the screen. The per-chat `ActiveRun` replaces `ACTIVE_KEY`.
5. Run `npm test` again; the test now passes. Add a migration test: the legacy keys are migrated, the history is kept, and the legacy keys are gone.
Do not touch: `TIER_KEY` (T19 replaces the tier behaviour), the attach/reconnect/watchdog logic in `attachToRun`, speech, `sam-muted` and `sam-tts-voice`.
Proof: the step-2 run fails; after the fix `npm test` passes, including `chatLocal.test` (check 2). `npm run typecheck` and `npm run lint` pass.

## T15: Chat list (drawer on the phone, sidebar on desktop), opening from the server, `/chat?c=`
Status: DONE 2026-10-01 (ChatList.tsx sidebar md+/drawer phone, 5 s poll + focus, openChatById server history + reattach, ?c= handled once then stripped from URL (retry 1 fixed snap-back to X and a stale-open race); typecheck exit 0, lint exit 0, npm test 82 pass; browser checks 1, 9 in T21)
Spec: must-do 1, 2, 4, 5, 13; checks 1, 3 (UI) and 9 (browser checks in T21)
Depends on: T14
Blocked by: none
Model: sonnet
Context: The page is one 1610-line component. The list goes in its own component. The page already switches layout at `(max-width: 767px)` (`isNarrow`, `isNarrowScreen`); use the same breakpoint. Each entry shows its title, tier, last-active time (relative) and a running marker (`ChatSummary.running`). Opening a chat loads its history from `GET /api/chats/[id]`, so the phone and PC match; the local cache only paints first. If the chat has `runningJobId`, the page reattaches with `attachToRun` (full replay from 0).
Files: src/components/chat/ChatList.tsx (new file), src/app/(app)/chat/page.tsx (edit: layout, open handler, `?c=` param, list polling)
Steps:
1. `ChatList` props: `chats`, `currentId`, `onOpen`, `onNew`, `open` (for the drawer), `onClose`. On desktop it is a left sidebar next to the chat column. On the phone it is an overlay drawer opened by a list button in the status bar, closed by a tap outside or by Escape. New stays reachable from the list and the status bar.
2. Poll `GET /api/chats` every 5 s while the page is visible, and on focus.
3. Opening a chat: close the current stream (`streamRef.current?.close()`, and reset `parserRef` and `lastSeqRef` as `newConversation` does), set `sam-chat-current`, fetch history, render it, and reattach if `runningJobId` is set.
4. `/chat?c=<id>`: on mount, and whenever the query changes, open that chat, adopting it through `chatsService.adopt` if it is not in this device's cache. Keep the existing `?wake=1&os_port=` handling (the effect around line 1042) working alongside it.
Do not touch: the work panel, `MessageBlocks`, the composer and uploads, and the wake-word effects (T17 decides what they send to).
Proof: `npm run typecheck`, `npm run lint` and `npm test` pass. Checks 1 and 9 (browser) run in T21.

## T16: Title search, Archived view, and archive, restore and delete in the list
Status: DONE 2026-10-01 (npm test 85 pass incl. chatListFilter.test (3 cases: title part in main and Archived, message-only word matches nothing); ChatList search + Main/Archived + per-row Archive/Restore/Delete with confirm, disabled while running, 409 shown inline; page wiring onChanged/onCurrentRemoved (2 props, outside Files, reported); typecheck exit 0, lint exit 0)
Spec: must-do 9a, 10, 11, 12; checks 7a and 8 (UI)
Depends on: T15
Blocked by: none
Model: sonnet
Context: Search matches titles only, in both the main list and Archived. Delete asks for confirmation first, removes the chat from every list, and leaves its transcript on the server. Archive and delete are disabled while that chat's turn runs, and the server refuses them too (T6). There is no renaming, folders or pinning (won't do).
Files: src/components/chat/ChatList.tsx (edit), src/lib/chatListFilter.ts (new file), src/lib/chatListFilter.test.ts (new file)
Steps:
1. Add a search box at the top of the list and a Main/Archived switch; Archived fetches with `archived=1`. Filter on the client with `filterChatTitles(chats, q)` (substring, case-insensitive, title only), the same rule as the server's `filterByTitle`.
2. Per-entry menu: Archive (main list) or Restore (Archived), and Delete. Delete opens a confirm dialog ("Delete from the app? The transcript stays on the server."). Disable all three when `running`. On a 409, show the server's message.
3. If the chat on screen is archived or deleted, go to a new draft.
4. Test `chatListFilter.test.ts`: matching part of a title in either list, and a word that appears only in a message matching nothing.
Do not touch: server rules (T6), the Notifications section.
Proof: `npm test` passes, including `chatListFilter.test` (check 7a, UI rule). Check 8 is already covered on the server by T6. `npm run lint` passes.

## T17: Switching chats: running turns keep going, speech stops, voice goes to the chat on screen
Status: DONE 2026-10-01 (diff read: switch (open and New) stops speech first, clears reconnect timer; finalise/stream/drain guarded by run.chatId vs currentIdRef; send reads currentIdRef and never yanks the screen after a switch; focus heartbeat id on open + 20 s, null only on hide/unmount (retry 1 fixed a null-then-id race); typecheck exit 0, lint exit 0, npm test 85 pass; browser checks 5, 6 in T21)
Spec: must-do 6, 7, 8, 7a (client half); checks 5 and 6 (browser checks in T21)
Depends on: T15, T10
Blocked by: none
Model: sonnet
Context: A turn runs server-side as a job. Switching away only closes this page's stream; the job goes on. Coming back reattaches through `runningJobId`, or shows the finished answer from the server history. Speech must stop within 0.5 s of switching. `stopAllSpeech()` in `src/lib/speech.ts` reaches the spoken ack too, as the mute button (around line 1266) already relies on. The wake word (`?wake=1`, the effect around line 1042; the desktop wake poll, around line 1064) and the hands-free loop (`onHandsFreeTranscribe`, line 887, which calls `send`) must always send to the chat on screen.
Files: src/app/(app)/chat/page.tsx (edit: the open/switch handler, `finalise` inside `attachToRun`, `send`, the visibility effect, and a focus heartbeat), src/lib/chatsService.ts (edit: `sendFocus`)
Steps:
1. On switch:
   - `stopAllSpeech()`, `speechRef.current = null`, `setSpeaking(null)`, and report speech off (`reportSpeech`/`setSamActivity`);
   - close the stream and clear the reconnect timer (`reconnectRef`) so a late `finalise` for the old chat cannot patch the new chat's messages or speak;
   - reset `running`, `phase` and `serverPhase` from the new chat's own state.
2. Guard `finalise` and the stream callback with the chat id they were attached for, and drop any event whose chat is no longer on screen.
3. `send` reads the current chat id from a ref at call time, not from a render closure, so a hands-free or wake transcript that arrives after a switch goes to the chat on screen.
4. The visibility effect (around line 620) and the mount reattach (around line 652) read the current chat's `sam-chat-active:<id>`, not the old global key.
5. Focus heartbeat: `POST /api/chats/focus` with the current id when a chat opens, every 20 s while `document.visibilityState === 'visible'`, and with `null` when the page is hidden or unmounted.
Do not touch: `STUCK_WARN_MS`/`STUCK_KILL_MS` and the watchdog, the ack phrases, `HandsFreeMic` and `VoiceRecordButton` themselves.
Proof: `npm run typecheck`, `npm run lint` and `npm test` pass. Checks 5 and 6 run in the browser in T21.

## T18: Handoff on the server
Status: DONE 2026-10-01 (npm test 88 pass incl. handoff.test (check 7b: one memo in temp 06 - Handoffs, new chat tier max2 with memo path, Max 2 CLAUDE_CONFIG_DIR, handedOffTo set, memo turn never pings; 409 while running/pending, 404 unknown/deleted; missing memo sets handoffError, no new chat); fakeClaude.ts gained FAKE_SKIP_MEMO=1 (allowed); typecheck exit 0, lint exit 0)
Spec: must-do 9b; check 7b
Depends on: T5, T6
Blocked by: none
Model: opus
Context: Handoff is the only way to change tier (spec section 4). SAM, in the old chat, writes a memo to the vault's `06 - Handoffs/` naming the next action and the open decisions. A new chat then opens on the picked tier (the same tier is allowed), with that memo as its first message. The old chat stays in the list, marked as handed off, with a link to the new one. Handoff is refused while a turn runs. The two turns are chained: the memo turn must finish and the file must exist before the new chat starts. Existing memo files are named `YYYY-MM-DD <topic>.md`. Nothing is written to `02 - Atwood Systems/`.
Files: src/lib/server/chat/handoff.ts (new file), src/lib/server/chat/handoff.test.ts (new file), src/app/api/chats/[id]/handoff/route.ts (new file, `requireStepUp`), src/lib/chatsService.ts (edit: `handoff(id, tier)`)
Steps:
1. `startHandoff(chatId, tier, device)`:
   - 404 for an unknown or deleted chat, and 409 while `isSessionLocked(chatId)` or while a handoff is already pending for it;
   - memo path: `<SAM_VAULT_DIR ?? ~/ai-memory-vault>/06 - Handoffs/<YYYY-MM-DD> <chat title, with / \ : * ? " < > | stripped> handoff.md`, adding ` (2)` and so on if the file exists;
   - start a turn in the old chat (its own tier) through `startTurn`, marked internal so T10 does not ping. The prompt asks for a handoff memo naming the next action and open decisions, and contains the exact line `Write the memo to: <path>`, plus the instruction to write nowhere else and to reply with the path.
2. In that turn's exit hook: if the file exists, `startTurn` a new chat on the picked tier with the first message `Continue from the handoff memo at <path>. Read it first.`, then `markHandedOff(old, new)` (sets `handedOffTo` and `handedOffFrom`). If the file is missing (for example the old chat's seat hit its limit), set `handoffError` on the old chat and start nothing.
3. Return `{ ok: true, memoJobId }` at once. The client follows the old chat's turn and then opens `handedOffTo`.
4. Test (fake CLI, which writes the memo when it sees the `Write the memo to:` line; temp HOME; `SAM_VAULT_DIR` pointing at a temp dir): on a finished chat, handoff with tier `max2` produces exactly one new file in `06 - Handoffs/`, and a new chat record with tier `max2` whose `firstMessage` contains that file's path. The fake's log shows `CLAUDE_CONFIG_DIR` set to the Max 2 dir for the new chat's turn, and the old chat has `handedOffTo` equal to the new id. With the fake's delay, a handoff while a turn is running returns 409. A second test covers the missing-memo case: `handoffError` is set and no new chat is created.
Do not touch: `06 - Handoffs.md` (the folder's index note), `02 - Atwood Systems/`, T5's lock rules.
Proof: `npm test` passes, including `handoff.test` (check 7b, server).

## T19: Tier fixed after the first message; Handoff button
Status: DONE 2026-10-01 (npm test 93 pass incl. chatTier.test (5 cases: draft unlocked, first message locks, Unknown for unknown tier); diff read: tier button disabled={tierLocked} with the fixed-tier title, send uses the chat's own tier, Handoff picker (5 tiers) + memo wait + opens handedOffTo + handoffError shown, ChatList handed-off and back links; typecheck exit 0, lint 0 errors (no warnings in touched files); finished a partial run left by the dead session)
Spec: must-do 9, 9b (UI); checks 7 and 7b (UI part)
Depends on: T17, T18
Blocked by: none
Model: sonnet
Context: The tier button (`toggleTier`, line 1097, cycling `NEXT_TIER`; rendered around line 1198) sets a global tier stored in `TIER_KEY`. After this ticket, a draft chooses its tier freely (the last choice is remembered in `TIER_KEY`), and a chat with a first message shows its own tier with the control disabled. A chat's tier is then changed only by a handoff.
Files: src/lib/chatTier.ts (new file), src/lib/chatTier.test.ts (new file), src/app/(app)/chat/page.tsx (edit: tier button, Handoff button), src/components/chat/ChatList.tsx (edit: handed-off marker and link)
Steps:
1. `chatTier.ts`: `tierLocked(chat | null)`, which is true when the chat has a server record with `turns > 0` or has sent its first message; and `displayTier(chat, draftTier)`, which gives the chat's tier, or "Unknown" for imported unknown-tier chats.
2. The tier button is `disabled={tierLocked(current)}`, with the title "Tier is fixed for this chat. Use Handoff to move." `send` always sends the chat's own tier for an existing chat.
3. Handoff button in the status bar, disabled while `running`: it opens a tier picker with all five tiers (same tier allowed), calls `chatsService.handoff(id, tier)`, shows "Writing handoff memo…", and opens `handedOffTo` when the old chat's record gains it. It shows `handoffError` if one is set.
4. In the list, a handed-off chat shows a "Handed off" marker with a link to the new chat, and the new chat links back.
5. Tests: `tierLocked` is false for a draft and true after the first message; `displayTier` returns "Unknown" for an unknown-tier chat.
Do not touch: the tier colours and icons, the tier availability errors from the server.
Proof: `npm test` passes, including `chatTier.test` (check 7, UI rule; T5 covers the server refusal). `npm run lint` passes.

## T20: Full gates and a production build off the live tree
Status: DONE 2026-10-01 (npx -y npm@10 ci --include=dev exit 0 (lockfile unchanged; plain npm install drops dev deps under NODE_ENV=production), typecheck exit 0, lint exit 0, npm test 93 pass 0 fail with all 16 new test files compiled and run, npx next build exit 0 in the worktree (/chat and /notifications static). Retry 1: first build FAILED prerendering /chat (localStorage is not defined): T14's loadMessages and the currentId initialiser read localStorage at render; fixed with typeof window guards in page.tsx (fix-up to T14's code))
Spec: check 14
Depends on: T1–T19
Blocked by: none
Model: sonnet
Context: This proves the branch builds and every new test runs in `npm test` before Colin is asked to deploy. Building inside `/home/col/SAM_ui` would overwrite the live `.next` that `sam-ui.service` serves, so build only in the worktree.
Files: none changed (fix-ups go back to the ticket that owns the file)
Steps:
1. In the `build/multi-chat` worktree, run `npx npm@10 install`, `npm run typecheck`, `npm run lint` and `npm test`. Confirm the `npm test` output lists every new test file: `fakeClaude`, `readFrames`, `chatStore`, `transcripts`, `startTurn`, `chatActions`, `titles`, `importRegistry`, `samPush`, `turnPing`, `dispatchPing`, `notifications`, `chatLocal`, `chatListFilter`, `handoff`, `chatTier`.
2. Run `npx next build` in the worktree only (never `./deploy.sh`, never in `/home/col/SAM_ui`).
Do not touch: `sam-ui.service`, `/home/col/SAM_ui/.next`, the live system files.
Proof: all four commands exit 0, and the test list is complete (check 14).

## T21: Colin's go: install, deploy, browser checks, confirmation
Status: TODO
Spec: checks 1, 5, 6, 9, 10, 12 (browser part), 15
Depends on: T20
Blocked by: Colin's go to merge and deploy (spec section 4: no push, merge or deploy without it)
Model: sonnet (run by SAM with Colin)
Context: The browser checks need the deployed build and a passkey sign-in, which an agent cannot do alone. The staged system files (T9, T11) go live in the same window as the app, so a link to `/notifications` or `/chat?c=` never reaches a build that cannot open it.
Files: /home/col/.sam/sam-push/send.mjs, /home/col/.local/bin/sam-job, /home/col/.sam/sam-job/run.sh, /home/col/.local/bin/sam-dispatch (each replaced by its `.next` copy after a dated `.bak-YYYYMMDD` backup), today's daily note
Steps:
1. On Colin's go, merge or deploy as he directs: `npx npm@10 install`, then `./deploy.sh` from the tree that `sam-ui.service` serves.
2. Install the staged system files: back up each live file, then move each `.next` over its live file. Write a daily-note line for each: `Enforced by: SAM_ui npm test (samPush.test, dispatchPing.test)`. Re-run `npm test` to confirm the tests now pass against the live files.
3. Browser checks, at 390x844 (phone) and 1440x900 (desktop):
   - **(1)** The list is a drawer on the phone and a sidebar on the desktop. Each entry shows its title, tier, last-active time and running marker.
   - **(5)** Start a turn, switch to another chat, come back: the finished answer is there.
   - **(6)** With speech on, switching away stops audio within 0.5 s, and a hands-free message goes to the chat on screen.
   - **(9)** `/chat?c=<id>` opens that chat on a fresh profile after sign-in.
   - **(10)** A profile that held a pre-upgrade chat in localStorage shows it in the list, with its history, after the upgrade. Colin's phone and PC are the real case: check both before anything else.
   - **(12)** A ping with no chat (for example `sam-push --title test --body test`) is listed in Notifications, and tapping it opens that entry. A chat ping opens its chat; a job ping opens its job output.
4. **(15)** Colin confirms on his phone and PC: two chats side by side, a ping opens the right place, and nothing he had is lost.
Do not touch: anything not on this list without a fresh go.
Proof: every browser check above passes and is recorded in the daily note, and Colin confirms check 15.

---

## Order

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20 → T21.
T2, T9 and T12 depend only on T1 or nothing, so they can move earlier. Every ticket leaves the app building and working: the chat keeps its current single-chat behaviour until T14 to T17 change the page.

## Coverage

| Spec check | Must-do | Ticket(s) whose Proof covers it |
|---|---|---|
| 1 | 1, 2 | T21 (browser); built in T15 |
| 1a | 2a | T7 |
| 2 (must fail first) | 3, 14 | T14 (failing test written and run first) |
| 3 | 4, 5 | T6; UI in T15 |
| 4 | 6 | T5 |
| 5 | 6 | T21 (browser); built in T17 |
| 5a | 7a | T10 |
| 6 | 7, 8 | T21 (browser); built in T17 |
| 7 | 9 | T5 (server refusal), T19 (control disabled) |
| 7a | 9a | T3, T6 (server), T16 (list) |
| 7b | 9b | T18 (server), T19 (button) |
| 8 | 10, 11, 12 | T6; UI in T16 |
| 9 | 13 | T21 (browser); built in T15, T12 |
| 10 | 14 | T21 (browser); built in T14 |
| 10a | 14a | T8 |
| 11 | 15, 16 | T11 (with T9) |
| 12 | 17, 18, 19 | T9, T13 (automated), T21 (browser); T12 for the tap |
| 13 (must fail first) | 20 | T2 (failing test written and run first) |
| 14 | all | T20 |
| 15 | all | T21 (Colin) |

## Blocked

- T21 is blocked on Colin's go to merge and deploy. No spec question is open: the only one (the branch) was resolved on 2026-09-30.
- Not blocked, but noted: Haiku titles use the main seat (proven 2026-09-30). The Max 2 seat was at its session limit that day. T11's test makes one real Haiku call per `npm test`.
