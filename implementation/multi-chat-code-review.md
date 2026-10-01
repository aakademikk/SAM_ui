# Multi-chat code review (pipeline step 5)

Date: 2026-10-01
Branch: `build/multi-chat` (worktree `/home/col/SAM_ui-multi-chat`), cut from `a0f6957`. All work for T1 to T20 is staged and not committed. `git diff` (unstaged) is empty.
Scope: the full output of `git diff --cached a0f6957` (55 files), plus the four staged system files diffed against their live copies.
Method: the `/code-review` skill at high effort, followed by a manual pass over the spec, the system files, the auth on every new route, and the T20 guards. I traced every finding below through its code path. CONFIRMED means I traced it end to end. PLAUSIBLE means the mechanism is real but I did not reproduce it in full.

## Gates (re-run during this review)

`npm run typecheck`:
```
> sam-ui@0.1.0 typecheck
> tsc --noEmit
```
(exit 0, no errors)

`npm test` (tail):
```
1..84
# tests 93
# suites 4
# pass 93
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 9509.595602
```

## Staged system files: no blocking findings

| Staged copy | Live file | Diff summary |
|---|---|---|
| `/home/col/.sam/sam-push/send.next.mjs` | `send.mjs` | Adds a log written before delivery, `--chat`/`--job`, a `SAM_CHAT_ID` fallback (UUID-checked), and `SAM_PUSH_SUBS`/`SAM_PUSH_LOG` test seams. An explicit `--url` still wins, so existing callers are unchanged. The 20:25 delegation check (no `--url`, no chat) now gets `/notifications?n=<id>` instead of `/`, which is intended (spec 19). Delivery code is unchanged. |
| `/home/col/.sam/sam-job/run.next.sh` | `run.sh` | Adds the `SAM_PUSH_BIN` seam and reads `chatId` from meta (UUID re-checked in Python) to build the link. Always adds `--job`. The script is `set -u` only, not `set -e`, so a failed `CHAT_ID=$(...)` cannot abort the script before the ping. `|| true` is kept. |
| `/home/col/.local/bin/sam-job.next` | `sam-job` | Adds the `SAM_JOB_RUN_SH`/`SAM_JOB_STORE` seams, records `chatId` (UUID only) in meta, and passes the push seams through with `--setenv` only when they are set. The `--model` guard block is untouched (the guard is outside the diff hunks). `"${_ENV[@]+"${_ENV[@]}"}"` is safe under `set -u`. |
| `/home/col/.local/bin/sam-dispatch.next` | `sam-dispatch` | One line: `exec ${SAM_JOB_BIN:-/home/col/.local/bin/sam-job}`. Unquoted, but the default has no spaces and the override is only used in tests. |

Notes, not blocking:
- `send.next.mjs` creates `~/.sam/push-log.jsonl` with the default umask (typically 0644). Ping titles and bodies are not secrets, but the other files in `~/.sam` are 0660 or tighter. Consider `appendFileSync(LOG, ..., { mode: 0o600 })`.
- When the log passes 1 MB, the trim does a read and a full rewrite. Two pings landing at the same moment could lose one line. This is a best-effort log, so the risk is acceptable.
- No `.next` copy exists for `digest.py`, and none is needed.

## Security: auth on the new routes

Every new route checks auth before it does any work. `GET /api/chats`, `GET /api/chats/[id]`, `POST /api/chats/focus` and `GET /api/notifications` call `requireSession`. PATCH/DELETE on `/api/chats/[id]`, `POST /api/chats/adopt` and `POST /api/chats/[id]/handoff` call `requireStepUp`. Ids only reach the filesystem through `transcriptPath`, and every caller checks first: `getChat` (store keys are server-minted UUIDs), `isSamuiSession`, or `validSessionId`. Attachments are still re-validated by `resolveAttachment`. No secret is logged: the handoff audit line stores only `sub.slice(0,12)`, the same as the existing route. There is one weakness, Finding 8.

---

## Findings (most severe first)

### 1. `/chat?c=<id>` deep links fail on any device that has never opened the chat, and often fail on the phone outright (CONFIRMED, blocking)
`src/app/(app)/chat/page.tsx:1060-1076`, `src/app/api/chats/adopt/route.ts:17`, `src/lib/server/chat/chatActions.ts:188-200`, `src/lib/server/auth/session.ts:110`

The `?c=` handler opens the chat directly only when `localChatIds(localStorage)` already contains it. Otherwise it first calls `adoptChat` (POST `/api/chats/adopt`), and that route requires step-up. A platform (phone) step-up lasts 10 minutes. Opening a chat is a read, and `GET /api/chats/[id]` needs only a session.

Failure scenarios:
- A chat is started on the PC. A job dispatched from it pings. Colin taps the ping on his phone more than 10 minutes after his last biometric. The adopt call returns step-up required, the page shows "Biometric unlock required", and `stripCParam` still runs. The link is consumed and the chat never opens. Tapping Unlock does not retry the open, because it only resends `PENDING_KEY`. This breaks spec 13, 15 and 16, and check 9.
- `adopt` refuses any id that is not in `samuiSessions` (`isSamuiSession` comes first). A valid store chat whose id has been trimmed from the 500-entry registry, such as an older imported chat, therefore 404s even though `openChat` would serve it.
- `adopt` un-archives the chat as a side effect (`chatActions.ts:195`). Tapping a link to an archived chat silently moves it back into the main list.

Suggested fix: for `?c=`, always call `openChatById(value)`, which is a session-only GET. Show a "not found" error only if that returns 404. Keep adopt solely for the one-time legacy migration in Finding 2.

### 2. The pre-upgrade chat adoption fails silently without a fresh step-up, so the device's current chat lands in Archived (CONFIRMED, blocking: spec 14 and checks 10/10a)
`src/app/(app)/chat/page.tsx:477-485`, `src/lib/chatLocal.ts:127-139`, `src/lib/server/chat/importRegistry.ts:111-143`

On first load after deploy, `migrateLegacy` copies the history into per-chat keys and **deletes the legacy keys**. `adoptChat(migratedId)` then runs fire-and-forget, and its failure is swallowed (`.catch(() => {})`). Adopt needs step-up, which most likely has expired on the phone (10 minutes) and possibly on the PC. Meanwhile the first `GET /api/chats` runs `importRegistryChats`, which imports every registry id that has no record, **archived**, and that includes this device's current chat. No retry ever happens, because the legacy keys are gone and nothing re-adopts.

Result: no history is lost. The local copy and the transcript are both intact, and I found no path that deletes either. But the device's current chat is missing from the main list (it sits in Archived). That fails spec 14 and the "except each device's current chat" clause of check 10a. Because `refreshChats` only matches against the main list, `chatInfo` stays null for that chat. That feeds into Finding 5: a non-Max chat then gets 409 on every send.

Suggested fix: keep a per-device "needs adopt" marker, such as `sam-chat-adopt-pending:<id>`, set by `migrateLegacy` and cleared only when adopt succeeds. Retry adopt after any successful step-up and on each mount. Alternatively, have `startTurn`'s pre-upgrade bridge and the import restore (un-archive) a chat when it is the device's current chat. Simplest of all: let adopt run at session level for an id that passes `isSamuiSession` and has a transcript, because it only creates or restores a record for a chat the app already owns.

### 3. A stale `runningJobId` after any sam-ui restart hides the last exchange and attaches every device to a dead job (CONFIRMED, blocking because T21's own deploy triggers it)
`src/lib/server/chat/chatActions.ts:117-121`, `src/lib/server/chat/startTurn.ts:378`, `src/lib/server/chat/chatStore.ts` (`setRunningJob`)

`runningJobId` is persisted in `~/.sam/samui-chats.json` and is cleared only in the job's `onExit`. When sam-ui restarts mid-turn (a deploy, a crash, or `systemctl restart`), `onExit` never runs and `reconcileOrphans` does not touch the chat store. From then on, `openChat` sees `runningJobId` set and drops the last user/assistant pair (`slice(0, -2)`), even though the transcript now holds that turn complete or truncated. It also returns the dead job id. The client then attaches, and the stream route marks the job `orphaned` and closes it as `killed`. The list's `running` flag reads the in-memory lock (false), so the list and the chat view disagree. The state heals only when the next turn in that chat overwrites the field. Until then the last exchange is invisible on every device.

Suggested fix: in `openChat`, treat `runningJobId` as running only when `isSessionLocked(id)` is true, and clear it otherwise (`setRunningJob(id, null)`). Or clear all `runningJobId` values when the store first loads after boot, because the lock map is empty at that point anyway.

### 4. A message held for step-up is resent into whichever chat is on screen, not the one it was written in (CONFIRMED, blocking: wrong chat, wrong context, possibly wrong tier)
`src/app/(app)/chat/page.tsx:1370` (save), `:1136-1150` (recovery on mount), `:2073-2075` (Unlock button)

`send()` stores the failed message under the single device-wide key `sam-agent-pending`. Both the recovery effect on mount and the Unlock button call `send(pending)`, which sends to `currentIdRef.current`. Scenario: Colin types "deploy X" in chat A and step-up has lapsed. He switches to chat B, or reloads while B is current, then unlocks. "deploy X" runs as a turn in chat B, with B's context and B's tier, and possibly in a different working project. `chatLocal.ts` already has `savePendingMessage`, `loadPendingMessage` and `clearPendingMessage` keyed per chat, but nothing calls them.

Suggested fix: store `{ chatId: startedFrom, message }` (or use the per-chat helpers). On Unlock or recovery, resend only if that chat is on screen. Otherwise leave the message for when that chat is opened.

### 5. `chatInfo` is never loaded for the current chat on mount, so sends fall back to tier `max` and get 409 on non-Max chats (CONFIRMED)
`src/app/(app)/chat/page.tsx:1285-1290`, `:501-523`, `:260-262`

On mount, `currentId` is restored from localStorage, but `openChatById` is never called for it. `chatInfo` is filled only when the main-list poll finds the id. It stays null in three cases: before the first poll lands, when the current chat is archived (including the case in Finding 2), and when it is a restored chat that is not yet in the list. With `chatInfo` null, `sendTier` is `'max'`, so startTurn (`startTurn.ts:276-280`) returns 409 "This chat is on Fast. Use Handoff to change tier." for any Fast, Pro, Gemini or Max2 chat. The tier button also shows Unknown. The history painted on reload is the stale local copy and is never refreshed from the server, so turns taken on the other device are missing until the chat is reopened. That breaks spec 5.

Suggested fix: call `openChatById(currentId)` once on mount when the id is not `'draft'`. Do it after `migrateLegacy`, and run the existing reattach logic from its result.

### 6. A handoff retry, or a second handoff, acts on the stale `handoffError` or `handedOffTo` of the previous attempt (CONFIRMED)
`src/lib/server/chat/handoff.ts:131-160` (no reset), `src/app/(app)/chat/page.tsx:1014-1023`

`startHandoff` never clears `handoffError` or `handedOffTo` on the old chat. The client's waiting effect fires as soon as `handoffWaitingFor` is set:
- First attempt fails because the memo was not written, so `handoffError` is set. Colin retries. The POST succeeds, but the effect sees the old `handoffError` and stops waiting. The new chat is created server-side, the screen never follows it, and "Handoff failed" stays visible.
- A chat that has already been handed off once and is handed off again (allowed by the spec, since only a running turn disables the button) jumps straight to the *old* `handedOffTo` before the new memo turn has even run.

Suggested fix: in `startHandoff`, after the guards, clear both fields (`update(id, r => { delete r.handoffError; delete r.handedOffTo; })`). Also have the client clear its `chatInfo` copies of those fields when it sets `handoffWaitingFor`.

### 7. Reattaching to a running turn hides that turn's user prompt, and may hide the previous finished turn instead (CONFIRMED for the first part, PLAUSIBLE for the second)
`src/lib/server/chat/chatActions.ts:117-119`, `src/app/(app)/chat/page.tsx:979-990`

While a turn runs, `openChat` drops the last two messages (user and assistant). The client adds back only an assistant placeholder, so on the second device Colin sees the answer streaming in with no question above it. The page stays like that until the chat is reopened after the turn ends. Separately, if the chat is opened in the first second or so after spawn, before the CLI has written the new prompt entry to the transcript, `slice(0,-2)` removes the *previous* completed Q&A instead.

Suggested fix: have the server drop only trailing entries newer than the turn's start time (`job.startedAt`), and return the in-flight prompt text (it is in the job's argv/label server-side) so the client can render a user bubble before the placeholder.

### 8. `/api/chats/__proto__` reaches `Object.prototype` through the chat store (CONFIRMED, low: needs step-up)
`src/lib/server/chat/chatStore.ts:170-174` (`getChat`), `:211-218` (`update`)

`load().chats[id]` with `id = "__proto__"` returns `Object.prototype`. `getChat` treats that as a live record, so `GET` returns `{}`. `PATCH {action:'archive'}` passes `guardNotRunning`, and `update` then runs `record.archived = true` **on `Object.prototype`**. That pollutes every object in the server process until restart, and `DELETE` sets `Object.prototype.deleted = true`. The attack needs a valid step-up, so only Colin's own devices can trigger it, but it is a real and cheap fix.

Suggested fix: guard `getChat` and `update` with `Object.prototype.hasOwnProperty.call(chats, id)` (as `hasChatRecord` already does), or reject non-UUID ids in the `[id]` routes with `validSessionId`.

### 9. Focus is keyed by device name only, so two tabs or windows on one device overwrite each other (CONFIRMED, minor)
`src/lib/server/chat/focus.ts:37`, `src/app/api/chats/focus/route.ts:28`

With chat X in one PC window and chat Y in another, each window's 20-second heartbeat replaces the other's entry. When X finishes, Colin may get pinged about a chat he is looking at, or miss a ping. The same happens when one window goes hidden and sends null.

Suggested fix: key focus by device plus a per-tab id generated in `sessionStorage`, and treat a chat as on screen when any live entry names it.

### 10. The one-time import is synchronous inside `GET /api/chats` and floods the title queue (CONFIRMED, minor)
`src/lib/server/chat/importRegistry.ts:111-143`, `src/lib/server/chat/titles.ts:234-250`

The first list poll after deploy reads about 178 transcripts three times each and calls `persist()` once per chat, rewriting the whole store each time. That blocks the event loop for that request. It then queues about 178 serial Haiku title calls on the same `queueTail` that live chats use, each with up to a 60-second timeout. A chat Colin starts straight after deploy keeps its fallback title until the import backlog drains, which could take tens of minutes.

Suggested fix: persist once at the end of the import. Put live chats ahead of imports in the queue, or give imports their own queue.

### 11. The job page closes a *running* sam-job as "killed" (CONFIRMED, minor, outside spec 20's "finished" scope)
`src/app/api/jobs/[id]/stream/route.ts:77`

A running sam-job is not live in this `JobManager`, so `orphaned` is true. The page shows the output so far and then reports "killed". Its meta has no `lastSeq`, so polling would never advance anyway. Spec 20 and check 13 only cover finished jobs, so this does not block. A note for a follow-up ticket: exclude sam-job meta (`unit` set) from the orphan rule, and poll by file size.

### 12. T20's `typeof window` guards give a server/client hydration mismatch on `/chat` (PLAUSIBLE, low, not a regression)
`src/app/(app)/chat/page.tsx:185-190`, `:253`, `:260-262`

The prerender renders `messages=[]` and `currentId='draft'`, while the first client render reads localStorage. React will report a hydration mismatch and client-render the tree. It still works, and the old flat-key `loadMessages` behaved the same way through its try/catch, so this is not new. If the console error matters, initialise to the empty state and load from localStorage in a mount effect.

### 13. `/notifications?n=<id>` cannot show an entry older than the newest 200 (CONFIRMED, minor)
`src/lib/server/push/notifications.ts:65-82`

`readNotifications(limit = 200)` truncates the list, while the log keeps up to 1,000 lines. An old ping's deep link then opens the list without its entry. Suggested fix: look the `n` id up across the whole file.

### 14. Duplicated logic that will drift (simplification, not a bug)
- `adoptPreUpgradeChat` (`startTurn.ts:152`) repeats `chatActions.adopt`.
- `firstUserText` and `firstUserMessage` are copied across `startTurn.ts`, `chatActions.ts` and `importRegistry.ts`.
- On the client, `filterChatTitles` copies `filterByTitle`, and the notifications page's `targetFor` copies `notificationTarget`.

Fixes for Findings 2 and 6 will need to land in each copy. Export one helper and call it everywhere.

---

## Spec coverage notes
- Chat leakage between chats: the per-chat localStorage keys, the `run.chatId !== currentIdRef.current` guards in `attachToRun`/finalise, and the late-response guard in `openChatById` all hold. The only leak found is Finding 4.
- Running turns lost on switch: none found. The run is saved per chat before streaming starts and reattached on open, apart from the display gap in Finding 7.
- Tier lock: enforced server-side (`startTurn.ts:276`). The client gaps are in Finding 5.
- Delete keeps the transcript: `deleteChat` only sets the flag. Verified.

VERDICT: FIX FIRST (blocking: 1, 2, 3, 4)

---

## Fixes applied (2026-10-01)

Scope: findings 1 to 5 only (the blocking four, plus 5 since it shares the mount path with 1). Findings 6 to 14 are untouched — Colin decides those separately. `npm run typecheck`, `npm run lint` and `npm test` (109/109) pass; `npx next build` exits 0 in the worktree.

### Finding 1 — `/chat?c=<id>` deep links
Files: `src/lib/chatOpen.ts` (new), `src/lib/chatOpen.test.ts` (new), `src/app/(app)/chat/page.tsx` (the `?c=` effect, `openChatById`).
`openChatById` now takes a `{ force?: boolean }` option (bypassing its "already on screen" short-circuit) and returns `Promise<boolean>` instead of swallowing its outcome silently. The `?c=` effect calls the new pure `handleChatLink(id, { open })` from `chatOpen.ts`, which only ever calls the session-only GET — adopt is never called from this path — and reports back whether the link was consumed; `c` is stripped from the URL only on success, so a failed open (404, lapsed step-up, or otherwise) leaves the link in place for a reload or a second tap to retry. Because adopt is never reached, an archived chat opened from a link stays archived, and a 404 shows "Chat not found."
Tests: `finding 1: an uncached chat link opens through the session GET, not adopt`, `a failed open does not consume the link`, `a successful open consumes the link`, `an archived chat opened via a link stays archived` — run first against a lifted, unchanged copy of the old page.tsx logic (3 of 4 failed), then against the fix (all pass).

### Finding 2 — pre-upgrade chat adoption
Files: `src/app/api/chats/adopt/route.ts`, `src/lib/server/chat/adoptAuth.test.ts` (new), `scripts/jose-cjs.d.ts` (new), `tsconfig.test.json`.
**Choice made: downgraded `POST /api/chats/adopt` from `requireStepUp` to `requireSession`** — the review's "simplest of all" suggestion. Why: `chatActions.adopt()` already refuses anything that isn't an id SAM_ui itself created (`isSamuiSession`) with a transcript still on disk, and it only ever creates or restores that one chat's own record — it can't resume a turn, touch an unrelated chat, or resurrect a deleted one. That makes it safe at read level, the same level `GET /api/chats/[id]` already uses. The alternative fixes (a "needs adopt" retry marker, or folding adopt into `startTurn`'s pre-upgrade bridge) would also work but add new state and new code paths for a route that, on inspection, was already as narrow as a read. Every other chat-write route (archive, restore, delete, handoff, a turn) is untouched and still demands step-up.
A route-level test needed a real signed session cookie, which meant importing `auth/session.ts` → `jose` (ESM-only) into the CJS test build — hence the `jose-cjs.d.ts` type shim and the `tsconfig.test.json` `paths` entry (test build only; `tsconfig.json` and `npm run typecheck`/the app build never see it).
Tests: `finding 2: adopt succeeds with a session only, putting the device chat in the main list`, `a session-only adopt also restores a chat the registry import already archived`, `session-level adopt still refuses an id SAM_ui does not own`, `with no session at all, adopt is refused`, `every other chat-write route still requires step-up` — run first against the old `requireStepUp` route (4 of 5 failed on a session-only cookie), then against the fix (all pass).

### Finding 3 — stale `runningJobId` after a restart
Files: `src/lib/server/chat/chatActions.ts` (`openChat`), `src/lib/server/chat/chatActions.test.ts`.
`openChat` now trusts a stored `runningJobId` only while `isSessionLocked(id)` is true; otherwise it clears the field (`setRunningJob(id, null)`) before deciding whether to hide the transcript's last turn. A restart drops the in-memory lock but not the persisted field, so without this a reopened chat kept hiding its last exchange and handing every device a dead job id until the next real turn overwrote the field.
Test: `finding 3: a runningJobId left over from a restart (no lock held) does not hide the last exchange or hand back a dead job id` — simulates the restart by writing a `runningJobId` back onto a finished chat with no lock behind it (the same state a restart mid-turn leaves). Failed before the fix (`runningJobId` came back as the dead id, and the finished turn's 2 messages were sliced to 0); passes after.

### Finding 4 — pending message sent to the wrong chat
Files: `src/lib/pendingSend.ts` (new), `src/lib/pendingSend.test.ts` (new), `src/app/(app)/chat/page.tsx` (save on step-up failure, the fresh-send supersede, the mount recovery effect, the Unlock button).
All three places that used to read/write the single global `sam-agent-pending` key now go through `pendingSend.ts`'s `holdPendingMessage` / `recoverPendingMessage` / `supersedePendingMessage`, which are thin wrappers over `chatLocal.ts`'s existing per-chat `sam-chat-pending:<id>` slots. A message is held under the chat it was written in (`startedFrom`); recovery (mount effect and Unlock button) only ever looks at the chat on screen right now (`currentId` / `currentIdRef.current`) — a message held for a different chat is left untouched, to be recovered when that chat is reopened.
Tests: `finding 4: a message held for chat A is not sent when chat B is on screen at unlock` (the required wrong-chat case), `reopening the chat it was written in recovers the message`, `a fresh send on chat A clears only A's own held message` — run first against a lifted copy of the old single-global-key behaviour (2 of 3 failed, including the wrong-chat case), then against the fix (all pass).

### Finding 5 — `chatInfo` never loaded on mount
Files: `src/lib/chatOpen.ts` (`mountOpenTarget`), `src/lib/chatOpen.test.ts`, `src/app/(app)/chat/page.tsx` (the migrate/mount effect).
After `migrateLegacy`, the mount effect now calls `mountOpenTarget(localStorage)` and, if it returns an id (not a draft, not unset), force-opens it via `openChatById(target, { force: true })` — the `force` flag added for finding 1 is what lets this bypass the "already on screen" short-circuit, since nothing has fetched this chat's record from the server yet. This populates `chatInfo` (tier, turns, handoff fields) before the first send, so sends use the chat's own tier instead of falling back to `max` and getting a 409 on a non-Max chat.
Tests: `finding 5: mount force-opens the chat already on screen, so chatInfo loads`, `a draft is never force-opened`, `no current id yet (a brand-new device) is never force-opened` — run first against a lifted copy that never requests anything on mount (the first case failed, returning null instead of the chat id), then against the fix (all pass).

### Finding 14 note
No duplicated helper from the review's list (`adoptPreUpgradeChat`/`chatActions.adopt`, `firstUserText`/`firstUserMessage`, `filterChatTitles`/`filterByTitle`, `targetFor`/`notificationTarget`) needed a change for findings 1 to 5, so none of those copies were touched.
