# Work area in SAM_ui: tickets

Spec: `/home/col/SAM_ui/implementation/work-area-spec.md` (LOCKED 2026-10-12, Colin ~8:55 PM). Read it in full before any ticket.
Tickets written 2026-10-12 from the locked spec and a read of the code named in each ticket. `check-spec-robustness.py` passes on the spec. No open questions remain (spec, Open questions), so no ticket is blocked by one.
Consumer: SAM, running `/implement` on Colin's go, then Colin.
35 tickets. Order: T1 to T22 (SAM_ui code), T23 to T27 (staged system changes, each behind a Colin gate), T28 to T32 (samples, proofs, whole-build gate), T33 to T35 (Colin gates: install and deploy, phone checks, next-day backup checks).

## Shared facts (the foreman repeats these in every brief)

Where things live:
- Live tree `/home/col/SAM_ui` (branch `claude/sam-core-dashboard-sf3639`): read-only for the build. The only file the build edits there is THIS tickets file (Status lines, and the Baseline line in T1).
- Build worktree `/home/col/SAM_ui-work-area`, branch `build/work-area`, cut from the live branch's HEAD in T1. All SAM_ui code goes there, by absolute path. No merge, no deploy, no restart of `sam-ui.service`, no use of port 3000.
- No `git commit`, `push`, `merge`, `stash`, `reset` anywhere. The foreman checkpoints the worktree with `git add -A`. Any commit to a repo other than SAM_ui (the vault's two repos, anything under `~/.sam`, `~/bin`) needs Colin's explicit word.
- The worktree gets its OWN `node_modules` (T1), because this build adds packages; never symlink the live tree's `node_modules`, and never run any package command in `/home/col/SAM_ui`.
- npm warning (vault, `02 - Atwood Systems/00_SAM_Control/SAM_ui_Dashboard.md`, section "NEVER run npm install from a SAM_ui chat session without NODE_ENV=development"): the shell may carry `NODE_ENV=production` from the `sam-ui` unit, and then npm silently prunes devDependencies while saying "up to date". Every install in this build is `env NODE_ENV=development npm install --include=dev ...` (or `env NODE_ENV=development npm ci --include=dev`), run inside the worktree, followed by the dashboard note's "all present" one-liner. Build with `env NODE_ENV=production npm run build`.
- Never read a `.env` file or print any key, cookie, session value or enrolment token. `backup-keys.env` in the repo root (and its copy in the worktree) is off limits to every ticket: never open, copy, list the contents of, or `git add` it.

Tests:
- `npm test` runs `pretest` (`rm -rf .test-build && tsc -p tsconfig.test.json`) then `scripts/run-tests.cjs` over every `*.test.js` under `.test-build`. Test files are `*.test.ts` beside the code (only `*.test.ts` is in `tsconfig.test.json`'s include; they may import `.tsx` components, `jsx` is `react-jsx`), using `node:test` and `node:assert/strict`, importing with `@/` or `./x.js`. One file: `npm run pretest && node scripts/run-tests.cjs .test-build/<path under src>.test.js` (rootDir is `src`, so `src/lib/x.test.ts` becomes `.test-build/lib/x.test.js`).
- A test that makes a temp dir uses `tempDir` from `@/lib/server/testing/tempDir` and removes it (the runner fails on any leaked temp entry). Set `process.env.HOME` (and `SAM_VAULT_DIR`) BEFORE importing the module under test.
- `react-markdown` and `remark-gfm` are ESM only. The test build emits CommonJS; Node 22.22 loads ESM through `require`, so a plain import should work. If it does not, load them in the test with `await import(...)` and say so in the Status line. Do not add a test runner or loader.
- Live-file rule: any reader or writer of a live file resolves its path per call through `src/lib/server/livePaths.ts` (`samStateDir()`, `vaultDir()`), never a module-level constant. `vaultDir()` honours `SAM_VAULT_DIR`.

Staged system changes (the Colin gates):
- These are never edited in place: `/home/col/claude/CLAUDE.md`, `~/.claude/hooks/chat-length-guard.sh`, `/home/col/bin/sam-backup.sh`, `~/.sam/morning-brief/extract.py`, the vault's root `.gitignore`, `02 - Atwood Systems/.gitignore`. A ticket that changes one writes `<file>.next` beside it (for scripts and CLAUDE.md) and proves the `.next` against a copy or a temp `HOME`. The install is T33, on Colin's word, with a dated `.bak-20261012-workarea` (use the real date) of each live file first.
- Exception, the two vault ignore files: the vault and the Atwood sub-vault auto-commit hourly, so a `.next` beside them would be committed into the vault's git. They are staged as patch files in `/home/col/.sam/staged/work-area/` instead (new folder), never inside the vault.
- `/home/col/bin/sam-backup.sh.next` ALREADY EXISTS (8 Oct, byte-identical to live when these tickets were written). Before building on it, `cmp` it with the live file. Identical: build on it. Different: stop with `BLOCKED: sam-backup.sh.next differs from live (other staged work); unblock: Colin says which to build on`.
- New shell tests live in `/home/col/.sam/tests/`. Existing tests are edited only where a ticket says so, with a `.bak-<date>-workarea` copy first. A test takes a seam (an env var naming the script under test, as `SB_SCRIPT` does in `test-sam-backup.sh`) so it runs against the `.next` copy.
- The `sam-ui.service` restart is Colin's word only (T33).

Proof harness:
- `/home/col/delivery/ux-audits/samui-local-harness/`: `SAMUI_WORKTREE=/home/col/SAM_ui-work-area bash start.sh` serves the worktree's production build (build it first) on 127.0.0.1:4950 behind TLS on 127.0.0.1:4951, with an isolated `HOME` (`<harness>/home`) and `SAM_PUSH_BIN=/bin/true`. Pass `SAM_VAULT_DIR=<fixture vault>` in the environment so the server reads the fixture vault (T28), never the real one, during proofs. One server at a time: `ss -ltn | grep -E ':495[01]'` first, and leave another session's servers alone. Always `bash stop.sh` before finishing.
- `lib.mjs` there has `launch()`, `enrol(browser, viewport)` and `revoke(browser, state)`; it never prints the token or cookies. For `curl`, write the context's cookies to a mode-600 jar file under the proofs folder, pass it with `-b`, never echo it, and delete it at the end. Never `curl -v`.
- This build's proof scripts and results live in `/home/col/delivery/ux-audits/work-area-proofs/` (new, built by T29), never in the repo. The floor-fixes and usage-pyramid proofs (`common.mjs`, `run-proof.sh`) are the model.
- Viewports: 390x844 (phone) and 1440x900 (desktop).

Shared definitions (every ticket uses these exactly):
- Marker line: a line matching `^[ \t]*<!--[ \t]*work:[ \t]*(.+?)[ \t]*-->[ \t]*$` (multiline). Group 1 is the target. A target starting `http://` or `https://` is a website; anything else is a vault path, relative to the vault root, or absolute and inside `vaultDir()` (then made relative).
- Allowed file types (Must 22), lower-cased extension: `md, html, png, jpg, jpeg, gif, webp, svg, mp4, webm, pdf`. Kind: `md`, `pdf` are `document`; `html` is `page`; `png jpg jpeg gif webp svg` are `image`; `mp4 webm` are `video`; a web address is `website`. Anything else is not available.
- Size caps: markdown and HTML 2 MB (2,097,152 bytes); PDF 50 MB (52,428,800 bytes).
- Load timeout: 15,000 ms, then "could not load" and a Retry button; no automatic retry.
- Routes (all new, all GET only, all behind `requireSession`): `/api/vault/file?path=<p>[&from=<item path>]` (the bytes), `/api/vault/meta?path=<p>[&path=<p2>...][&from=<item path>]` (title, kind, size, available), `/api/vault/recent` (the recent list). The existing `/api/vault/graph` is not touched.
- Refusal answer: status 404, body `{"error":"Not found"}`, identical whatever the reason. Unauthenticated: the existing 401 from `requireSession`, before any path work.
- Audit line for a refusal: one JSON line appended to `~/.sam/audit.log` (path from `samStateDir()` per call): `{"event":"vault-refused","path":"<as asked, truncated to 300 chars>","reason":"<reason code>","timestamp":"<ISO>"}`. Reason codes: `dotdot`, `encoded`, `backslash`, `nul`, `absolute-outside`, `dot-part`, `type`, `missing`, `symlink-outside`, `not-file`. Never any file content.
- Recent-items record: `~/.sam/work-area/recent.jsonl` (via a new `recentItemsPath()` in `livePaths.ts`). One JSON line per item per finished reply: `{"at":"<ISO>","path":"<vault-relative path or web address>","chatId":"...","messageId":"<the turn's jobId>","title":"..."}`. The message id is the turn's job id: the client's `a_<ms>` ids live only for one page load. Readers read at most the last 262,144 bytes.
- Response headers on every work-area response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. HTML files add `Content-Security-Policy: sandbox allow-scripts; frame-ancestors 'self'`. SVG files add `Content-Security-Policy: sandbox; script-src 'none'; frame-ancestors 'self'`. PDF files add `Content-Disposition: attachment` (so a direct open never hands it to the browser's own viewer, which can run PDF scripts; SAM_ui's own viewer fetches the bytes, so it is unaffected).

---

## T1: Worktree, its own node_modules, and the baseline
Status: DONE 2026-10-13 (worktree build/work-area at e87b624, own node_modules, Baseline line recorded: tsc 0, build ok, 685 tests 683 pass 0 fail)
Spec: check #27
Depends on: none
Blocked by: none
Context: Done-means 27 compares against a baseline recorded before any change. The worktree needs its own `node_modules` because later tickets add packages. Nothing in the live tree changes except the Baseline line below.
Files: /home/col/SAM_ui-work-area (new, via git); /home/col/SAM_ui/implementation/work-area-tickets.md (edit: the Baseline line below only)
Steps:
1. `git -C /home/col/SAM_ui worktree add -b build/work-area /home/col/SAM_ui-work-area HEAD`. Record `git -C /home/col/SAM_ui-work-area log -1 --format=%h`.
2. In the worktree: `env NODE_ENV=development npm ci --include=dev`, then the "all present" one-liner from the dashboard note. It must print `all present`.
3. In the worktree run, in order, recording the raw result of each: `npx tsc --noEmit` (exit code), `env NODE_ENV=production npm run build` (success or the first error line), `npm test` (tests, pass, fail, skipped, and the names of any failures). If `sideMessage.test` "review 3" fails, re-run once before counting it (known race).
4. Replace the placeholder line at the end of this ticket with: `Baseline: <commit> tsc exit <n>; build <ok|failed: ...>; npm test <tests> tests, <pass> pass, <fail> fail, <skipped> skipped (<names of failures, or none>)`.
5. `git -C /home/col/SAM_ui-work-area status --short` must be clean apart from build output that `.gitignore` covers.
Do not touch: the live tree's code and `node_modules`, `backup-keys.env`, any other worktree, `sam-ui.service`.
Proof: `grep -c '^Baseline: ' /home/col/SAM_ui/implementation/work-area-tickets.md` prints 1 (0 before); `git -C /home/col/SAM_ui-work-area rev-parse --abbrev-ref HEAD` prints `build/work-area`; `test -d /home/col/SAM_ui-work-area/node_modules -a ! -L /home/col/SAM_ui-work-area/node_modules && echo own` prints `own`.
Baseline: e87b624 tsc exit 0; build ok; npm test 685 tests, 683 pass, 0 fail, 2 skipped (none)

## T2: Voice and the push body never carry an HTML comment (speech, kept on a rollback)
Status: DONE 2026-10-13 (speechClean + chat tests 19 pass 0 fail, 7 new failed before; tsc 0)
Spec: must-do #4, #5, check #2
Depends on: T1
Blocked by: none
Context: This is the speech change and it ships alone so a rollback of the rest keeps it (spec, Robustness: Rollback): markers left in old chats must never be spoken. It must not import anything this build adds later. Today `splitForSpeech` (`src/lib/speech.ts:151`) and `spokenText` (`src/types/chat.ts:202`) only cut at `<!-- more -->`; a marker before that line, or any other comment, is read aloud. `spokenText` is what auto-speak (`chat/page.tsx:828`), Replay (`page.tsx:2088`, via `speak` and `speakChunked`) and the push body (`answerFor`, `turnPing.ts:67-74`) all use, so fixing it there fixes all three. The `<!-- more -->` split itself must not change (spec, Won't do).
Files: /home/col/SAM_ui-work-area/src/types/chat.ts (edit), src/lib/speech.ts (edit), src/types/chat.test.ts (edit), src/lib/speechClean.test.ts (edit)
Steps:
1. In `chat.ts` add and export `stripComments(text: string): string`: removes every `<!--` ... `-->` span, on one line or several, anywhere, EXCEPT a line matching the existing `MORE_LINE`; an unterminated `<!--` removes everything after it. A removed whole line leaves no blank line behind.
2. `spokenText`: apply `stripComments` to each text block before `splitMore`, so the more line still splits and every other comment (markers before or after it) is gone. Keep the rest exactly as it is.
3. `splitForSpeech`: `const cleaned = splitMore(stripComments(text)).short ...` (the cleaning chain stays). Comment both changes with one dated line each.
4. Tests (they fail before the change): in `speechClean.test.ts`, replies with a one-line marker `<!-- work: 02 - Atwood Systems/x/Plan Diagram.md -->` before the more line, a several-line comment, a marker after the more line, and an unterminated `<!--`; assert the spoken text holds no `<!--`, no `work`, no `/`, no `Plan Diagram`, no `.md`, and keeps the real sentences. In `chat.test.ts`, the same cases through `spokenText` (the push body's source), plus `spokenText(...).slice(0, 100)` for a reply whose marker sits in the first 100 characters.
5. Keep every existing test in both files passing unchanged.
Do not touch: `MORE_LINE`, `splitMore`'s behaviour, `turnPing.ts`, `MessageBlocks.tsx`, any marker parsing (T3 owns that).
Proof: `cd /home/col/SAM_ui-work-area && npm run pretest && node scripts/run-tests.cjs .test-build/lib/speechClean.test.js .test-build/types/chat.test.js` shows 0 failures and the new tests among the passes; the new tests, written and run before steps 1 to 3, fail (record that run). `npx tsc --noEmit` exits 0.

## T3: Marker parsing, hidden from the bubble and the Work view, and card labels
Status: DONE 2026-10-13 (workItems + MessageBlocks tests 13 pass 0 fail; new case failed before; tsc 0)
Spec: must-do #1, #2, #7, check #1
Depends on: T2
Blocked by: none
Context: Markers may sit before or after `<!-- more -->` and a reply may carry several. `splitBlocks` (`src/components/chat/MessageBlocks.tsx:263-284`) decides what the bubble and the Work view show; it must drop marker lines from both and hand the markers to the chat page. Card text comes from a pure function so Done-means 1 can be unit tested without a browser. Pure client-safe code: no `node:` imports in `workItems.ts`.
Files: /home/col/SAM_ui-work-area/src/lib/workItems.ts (new), src/lib/workItems.test.ts (new), src/components/chat/MessageBlocks.tsx (edit `splitBlocks`), src/components/chat/MessageBlocks.test.ts (edit)
Steps:
1. `workItems.ts` exports: `ALLOWED_TYPES` (the shared list), `type ItemKind = 'document' | 'page' | 'image' | 'video' | 'website'`, `interface WorkMarker { target: string; isWeb: boolean }`, `parseMarkers(text): { text: string; markers: WorkMarker[] }` (removes marker lines, using the shared regex), `kindFor(target): ItemKind | null`, `fileName(target)`, `interface ItemMeta { path: string; available: boolean; kind: ItemKind | null; title: string | null; size: number | null }` (T8 serves this shape), and `cardFor(marker, meta: ItemMeta | null): { label: string; kind: ItemKind | null; openable: boolean }`. Rules: a website is openable with label = the address's host; `meta.available === false` or `kindFor` null gives label `not available: <file name>`, openable false; meta null (not loaded yet) gives the file name, openable false; else `meta.title ?? fileName`.
2. `splitBlocks` runs `parseMarkers` on each text block before `splitMore` and on the long part after it, drops marker lines from both `answer` and `work`, and returns `{ answer, work, items: WorkMarker[] }` in reply order (before-more markers first, as written). A text block that was only markers adds no empty block. Existing callers keep working (the new field is extra).
3. Tests: `workItems.test.ts` covers `parseMarkers` (several markers, absolute path inside the vault made relative, web address, a non-marker comment left alone), `kindFor` for every allowed type plus `.txt`, `.mov`, `.docx` (null), and `cardFor` for a missing file giving `not available: Plan.md`. `MessageBlocks.test.ts` adds the Done-means 1 case: one marker before and one after `<!-- more -->` gives two `items`, and no `answer` or `work` text contains `<!--` or `work:`.
Do not touch: `AnswerBlocks`, `WorkBlocks`, the chat page, `chat.ts`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/workItems.test.js .test-build/components/chat/MessageBlocks.test.js` shows 0 failures; the new files do not exist before, and the new `MessageBlocks` case fails before step 2. `npx tsc --noEmit` exits 0.

## T4: Vault path resolver and the refusal audit line
Status: DONE 2026-10-13 (vaultFiles tests 21 pass 0 fail incl. all refusals; foreman added from-relative dotdot fix; tsc 0)
Spec: must-do #21 (server half), #22, #23, check #14
Depends on: T3
Blocked by: none
Context: The one gate every vault read passes. It must be stricter than `resolveUploadPath` (`src/lib/server/uploads.ts:141`), which compares `path.relative` but never follows symlinks: this one compares REAL paths (`fs.promises.realpath`) of both the vault root and the file. The path arrives once-decoded from `URLSearchParams`; anything still percent-encoded is decoded again for checking only (double encoding). `logCommand` in `src/lib/server/auth/auditLog.ts` uses a module-level `AUDIT_PATH`; the new writer resolves per call (live-file rule) and leaves the existing functions alone.
Files: /home/col/SAM_ui-work-area/src/lib/server/vaultFiles.ts (new), src/lib/server/vaultFiles.test.ts (new), src/lib/server/auth/auditLog.ts (edit: add one function)
Steps:
1. `auditLog.ts`: add `logVaultRefusal(requested: string, reason: string): Promise<void>` writing the shared audit line to `path.join(samStateDir(), 'audit.log')`, swallowing write errors like its neighbours.
2. `vaultFiles.ts` exports `resolveVaultFile(requested: unknown, opts?: { from?: string }): Promise<{ ok: true; abs: string; rel: string; ext: string; size: number } | { ok: false; reason: string }>` and `refuse(requested, reason)` (calls `logVaultRefusal`). Order of checks: not a non-empty string, or contains NUL (`nul`); contains `\` (`backslash`); repeatedly percent-decode up to 3 times, refusing if any form contains a `..` path part (`dotdot` if plain, `encoded` if only after decoding) or NUL; absolute path: accepted only if inside `vaultDir()` (else `absolute-outside`), then made relative; any path part starting with `.` (`dot-part`); extension not in `ALLOWED_TYPES` (`type`); `realpath` fails (`missing`); real path not inside `realpath(vaultDir())` (`symlink-outside`); not a regular file (`not-file`).
3. `from` (an item's own vault path, itself checked the same way): try `dirname(from)/requested` first, then `requested` from the vault root; succeed on the first that passes; when neither passes, the reason is the vault-root attempt's. Callers audit once per request, never per candidate.
4. Tests build a temp vault (`tempDir`), set `SAM_VAULT_DIR` and `HOME` to temp dirs before importing. Refused, each with the same `{ ok: false }` shape and exactly one audit line when the test calls `refuse`: `../x`, `%2e%2e/x`, `%252e%252e/x`, `..\x`, an absolute path outside the vault, `a\u0000.md`, `.git/config`, `.obsidian/app.json`, `x.env`, `.hidden.md`, `notes/.secret/a.md`, a symlink inside the vault pointing to a file outside it, `note.txt`. Served: a normal `.md`, `.png`, `.mp4`, and a `from`-relative image. No fixture is a real key or env file: `x.env` holds the text `fixture`.
Do not touch: `resolveUploadPath`, `logCommand`, `logEnrolment`, `readAuditLog`, the real `~/.sam/audit.log`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/vaultFiles.test.js` shows 0 failures and at least 15 passing assertions across the cases; the file does not exist before. `npx tsc --noEmit` exits 0.

## T5: The file route: session gate, refusals, headers
Status: DONE 2026-10-13 (vaultServe tests 8 pass 0 fail; route GET only, headers and CSP checked; tsc 0)
Spec: must-do #16 (headers), #17, #21, #23, #24, #26 (headers), #27, check #11, #13, #14, #15
Depends on: T4
Blocked by: none
Context: Every route here is behind `requireSession` (`src/lib/server/auth/guard.ts`) like `/api/vault/graph` (`src/app/api/vault/graph/route.ts`, gated 2026-09-20). Only `GET` is exported, so Next answers other methods with 405 by itself (check #15). `next.config.mjs` already adds `Cache-Control: no-store, max-age=0` to `/api/:path*`; the route still sets its own headers so they hold whatever the config does. This ticket serves whole files only for non-video types; T6 adds byte ranges.
Files: /home/col/SAM_ui-work-area/src/app/api/vault/file/route.ts (new), src/lib/server/vaultServe.ts (new: header and content-type helpers), src/lib/server/vaultServe.test.ts (new)
Steps:
1. `vaultServe.ts`: `contentTypeFor(ext)` (`text/markdown; charset=utf-8`, `text/html; charset=utf-8`, `image/svg+xml`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `video/mp4`, `video/webm`, `application/pdf`) and `headersFor(ext, size)` giving the shared work-area headers.
2. `route.ts`: `export const dynamic = 'force-dynamic'`; `GET` calls `requireSession` first and returns its 401 untouched; reads `path` and `from` from the query; on refusal calls `refuse` and returns the shared 404; on success streams the file with `fs.createReadStream` wrapped in a web stream (never `readFile`), `Content-Length` set. Markdown and HTML over 2 MB are still served (the client decides from meta, T8); the route never buffers a whole file.
3. Tests call the exported `GET` with a `Request` against a temp vault and a temp `HOME` holding a session made with `createSessionCookies` (see how existing route tests build one; `grep -rl createSessionCookies src --include=*.test.ts`): no cookie gives 401 with no file name in the body; refused paths give identical 404 bodies; an `.html` response carries the sandbox CSP without `allow-same-origin`, `allow-popups`, `allow-forms` or `allow-top-navigation`; an `.svg` carries `sandbox` with no `allow-scripts`; every response says `no-store`; the route module exports no `POST`, `PUT`, `PATCH` or `DELETE`.
Do not touch: `next.config.mjs`, `/api/vault/graph`, `guard.ts`, `session.ts`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/vaultServe.test.js` shows 0 failures; the file does not exist before. `npx tsc --noEmit` exits 0. Live curl checks for 11, 13, 14, 15 are T29 and T33.

## T6: Byte ranges for video and PDF
Status: DONE 2026-10-13 (vaultServe tests 12 pass 0 fail incl. 4 range cases that failed before; tsc 0)
Spec: must-do #25, check #16 (range half)
Depends on: T5
Blocked by: none
Context: Phone seeking needs `206 Partial Content`. The server must never hold a whole video in memory (open memory item in Active Priorities, "SAM_ui memory and PC freezes"). PDF gets ranges too so pdf.js can fetch pages lazily.
Files: /home/col/SAM_ui-work-area/src/app/api/vault/file/route.ts (edit), src/lib/server/vaultServe.ts (edit: `parseRange`), src/lib/server/vaultServe.test.ts (edit)
Steps:
1. `parseRange(header, size)`: one range only (`bytes=a-b`, `bytes=a-`, `bytes=-n`); anything else, or unsatisfiable, gives `null` or `416` with `Content-Range: bytes */<size>`.
2. For `mp4`, `webm`, `pdf`: always send `Accept-Ranges: bytes`; with a valid Range, `206`, `Content-Range`, `Content-Length` of the slice, body `fs.createReadStream(abs, { start, end })`. Without one, `200` streamed as in T5.
3. Tests: `bytes=0-1023` on a temp 5,000-byte `.mp4` gives 206 and exactly 1,024 bytes equal to the file's first 1,024; `bytes=-100` gives the last 100; `bytes=9999-` gives 416; a multi-range header is answered 200 with the whole file.
Do not touch: the refusal and header logic from T5 beyond adding the range headers.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/vaultServe.test.js` shows 0 failures including the 4 new cases (they fail before). `npx tsc --noEmit` exits 0. The live 300 MB memory check is T31.

## T7: Service worker never stores work-area responses
Status: DONE 2026-10-13 (swRoutes tests 2 pass 0 fail; tsc 0; build ok, sw.js holds api/vault/file x1)
Spec: must-do #26, check #17 (code half)
Depends on: T5
Blocked by: none
Context: `src/app/sw.ts:34-43` sends every `/api/*` request through `NetworkFirst` into the `sam-apis` cache (64 entries, 60 s). Work-area items must never land in Cache Storage (spec: no offline copies). Serwist matches runtime caching rules in order, so a `NetworkOnly` rule placed before the `/api/` rule wins. `NetworkOnly` is already imported.
Files: /home/col/SAM_ui-work-area/src/app/sw.ts (edit), src/app/swRoutes.test.ts (new) (or, if `sw.ts` cannot be imported under node, a new pure `src/lib/swWorkArea.ts` exporting the matcher, used by `sw.ts` and tested)
Steps:
1. Add, as the FIRST runtime caching entry, `{ matcher: ({ url }) => isWorkAreaPath(url.pathname), handler: new NetworkOnly() }` where `isWorkAreaPath` is true for `/api/vault/file`, `/api/vault/meta`, `/api/vault/recent`. Comment it with one dated line.
2. Test `isWorkAreaPath`: true for the three, false for `/api/vault/graph` and `/api/chats`.
Do not touch: any other caching rule, push or click handlers in `sw.ts`.
Proof: the new test passes (0 failures; file absent before); `npx tsc --noEmit` exits 0; after `env NODE_ENV=production npm run build`, `grep -c "api/vault/file" public/sw.js` in the worktree is at least 1. The Cache Storage check in a browser is T30.

## T8: Meta route: title, kind, size and availability for cards
Status: DONE 2026-10-13 (vaultMeta tests 4 pass 0 fail; meta route session-gated, 20 path cap; tsc 0)
Spec: must-do #2, #7, #20 (size), #32 (size), check #1 (served half)
Depends on: T5
Blocked by: none
Context: Cards need a title and availability without loading the item. The title is the first markdown heading, else the HTML `<title>`, else the file name (Must 2). Read at most the first 65,536 bytes of a text file for this. Refusals go through the same `refuse` (one audit line each) and come back as `available: false`, never an error page. The client asks once per path per page load (T19 keeps a map), so a stale marker does not flood the audit log.
Files: /home/col/SAM_ui-work-area/src/app/api/vault/meta/route.ts (new), src/lib/server/vaultMeta.ts (new), src/lib/server/vaultMeta.test.ts (new)
Steps:
1. `vaultMeta.ts`: `metaFor(requested, from?): Promise<ItemMeta>` (the `ItemMeta` type from `src/lib/workItems.ts`), using `resolveVaultFile`, `kindFor` and a title reader for `md` (first `^#{1,6}\s+(.+)$`, markdown emphasis stripped) and `html` (`<title>`, entities decoded for `&amp; &lt; &gt; &quot; &#39;` only).
2. `route.ts`: `GET`, `requireSession` first, up to 20 `path` params, returns `{ items: ItemMeta[] }` in the order asked, with the shared work-area headers.
3. Tests against a temp vault: md title from a heading, html title, a png falls back to its file name, a missing path and a `.git/config` path both give `available: false` (and one audit line each), `size` is the byte size.
Do not touch: the file route.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/vaultMeta.test.js` shows 0 failures; file absent before. `npx tsc --noEmit` exits 0.

## T9: Recent-items record, written at the end of every turn
Status: DONE 2026-10-13 (recent tests 5 pass 0 fail; hook adds exactly two lines for two markers; hook registered before the usage hook so usageCollect test still passes; tsc 0)
Spec: must-do #30, #9 (data half), check #6 (unit half)
Depends on: T3, T4
Blocked by: none
Context: One line per item per finished reply (shared definition). The hook point is `onTurnExit` in `src/lib/server/chat/startTurn.ts:78`, where the title, ping and usage hooks already sit; each hook runs in its own try/catch. Re-read the finished turn the way `answerFor` does in `turnPing.ts:67-74` (`readFrames` from `@/lib/server/jobs/manager` plus `AgentStreamParser`), but in the new module: do not edit `turnPing.ts` (T2's rollback boundary). Markers come from every text block, before and after `<!-- more -->` (use `parseMarkers` from T3). A marker that fails `resolveVaultFile` is still recorded (the list shows it as moved or deleted) but never audited here.
Files: /home/col/SAM_ui-work-area/src/lib/server/livePaths.ts (edit: `recentItemsPath()`), src/lib/server/workArea/recent.ts (new), src/lib/server/workArea/recent.test.ts (new), src/lib/server/chat/startTurn.ts (edit: one `onTurnExit.push`)
Steps:
1. `recentItemsPath()` returns `path.join(samStateDir(), 'work-area', 'recent.jsonl')`.
2. `recent.ts` exports `recordTurnItems(event: TurnExitEvent)` (parse markers, title via `metaFor` for vault paths, the host for websites; append one line each; create the folder mode 700; swallow errors) and `readRecent(limit = 20)` (read the last 262,144 bytes, drop a partial first line, newest first, one entry per path keeping the newest, each with `chatId`, `messageId`, `at`, `title`, and `missing: boolean` from `resolveVaultFile` without auditing; websites never missing).
3. `startTurn.ts`: `onTurnExit.push((event) => { void recordTurnItems(event); });` with a short comment in the style of the neighbours.
4. Tests (temp `HOME`, temp vault): a record of 25 lines over 18 distinct paths with repeats gives 18 entries newest first, one per path; 25 lines over 25 paths gives 20; an entry whose file was deleted shows `missing: true`; `recordTurnItems` on a temp job (write `~/.sam/jobs/<id>/` the way `manager.ts` lays out frames, read `readFrames` to match) whose text has two markers adds exactly two lines.
Do not touch: `turnPing.ts`, the other exit hooks, `JobManager`.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/lib/server/workArea/recent.test.js` shows 0 failures; file absent before. `npx tsc --noEmit` exits 0.

## T10: Recent route with chat labels
Status: DONE 2026-10-13 (recent tests 6 pass 0 fail incl. labelRecent; labelRecent lives in recent.ts as Next rejects extra route exports; tsc 0)
Spec: must-do #9 (served half)
Depends on: T9
Blocked by: none
Context: The list covers all chats, each entry labelled with its chat (Colin, 2026-10-12). Chat titles come from `getChat(id)` in `src/lib/server/chat/chatStore.ts:199` at read time; a deleted or missing chat is labelled `Chat`.
Files: /home/col/SAM_ui-work-area/src/app/api/vault/recent/route.ts (new), src/lib/server/workArea/recent.test.ts (edit)
Steps:
1. `GET`, `requireSession` first, returns `{ items: Array<RecentEntry & { chatTitle: string; project: string }> }` where `project` is the first one or two path parts of the vault path (`02 - Atwood Systems/<folder>` or `03 - Personal/<folder>`, else the first part), with the shared headers.
2. Add a test calling the route's builder (export a pure `labelRecent(entries, getTitle)`) for the chat label and project rules.
Do not touch: `chatStore.ts`.
Proof: the recent test file shows 0 failures including the new case; `npx tsc --noEmit` exits 0.

## T11: Markdown renderer with the HTML locked out
Status: DONE 2026-10-13 (MarkdownView tests 4 pass 0 fail; react-markdown 10.1.0 + remark-gfm 4.0.1 in worktree, all present; tsc 0; build ok; onerror check reworded as raw HTML shows as escaped text)
Spec: must-do #10, #11, #15, #18 (links inside items), check #9
Depends on: T3
Blocked by: none
Context: Packages to add, exact versions, both MIT licence: `react-markdown@10.1.0`, `remark-gfm@4.0.1`. Install in the worktree only: `env NODE_ENV=development npm install --include=dev --save-exact react-markdown@10.1.0 remark-gfm@4.0.1`, then the "all present" one-liner. Do NOT add `rehype-raw`: with no raw plugin react-markdown shows raw HTML as text, which is what Must 15 needs. Its default `urlTransform` drops `javascript:` links; keep it. Phone first: nothing may scroll the page sideways at 390 px.
Files: /home/col/SAM_ui-work-area/package.json, package-lock.json (edit, by npm), src/components/work/MarkdownView.tsx (new), src/components/work/MarkdownView.test.ts (new)
Steps:
1. `MarkdownView({ source, itemPath, onOpenItem })` renders with `remarkGfm`; component overrides: tables inside a `div` with `overflow-x-auto max-w-full`; `pre` with `overflow-x-auto`; task-list checkboxes `disabled` and read-only; outside `http(s)` links as `<a target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">`; any other link is rendered as plain text for now (T13 adds vault links); `code` with language `mermaid` is handed to a placeholder that T12 replaces (render the source in a `pre` for now). Styling in the existing dim/void Tailwind palette, text no smaller than 12 px.
2. Tests with `renderToStaticMarkup` from `react-dom/server`: markdown holding `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<iframe src="https://example.com"></iframe>` and `[x](javascript:alert(1))` produces output with no `<script`, no `onerror=`, no `<iframe`, no `javascript:`; headings, bold, a GFM table, a checklist (two `disabled` checkboxes, one checked) and a horizontal rule are present; an outside link has `target="_blank"` and `noreferrer`.
Do not touch: `AnswerBlocks` (bubbles stay plain text), `WorkBlocks` (T21).
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/work/MarkdownView.test.js` shows 0 failures; file absent before. `npx tsc --noEmit` exits 0; `env NODE_ENV=production npm run build` succeeds; `grep -c '"react-markdown": "10.1.0"' package.json` prints 1.

## T12: Mermaid diagrams, with a fallback that never breaks the document
Status: DONE 2026-10-13 (mermaid 12.1.0, fallback tests pass, tsc 0, build ok; after T21 wired MarkdownView: 23 chunks hold mermaid, chat page entry chunk 0)
Spec: must-do #12
Depends on: T11
Blocked by: none
Context: Package to add: `mermaid@12.1.0`, MIT licence (its own dependencies include DOMPurify, MPL-2.0 or Apache-2.0 dual licence, and d3, ISC). Install: `env NODE_ENV=development npm install --include=dev --save-exact mermaid@12.1.0`, then the "all present" one-liner. It is large: load it only in the browser, only when a mermaid block is on screen, with a dynamic `import('mermaid')`, so it never lands in the main chat bundle. Use `securityLevel: 'strict'`, `startOnLoad: false`, the dark theme.
Files: /home/col/SAM_ui-work-area/package.json, package-lock.json (edit, by npm), src/components/work/MermaidBlock.tsx (new), src/components/work/MarkdownView.tsx (edit: use it), src/components/work/mermaidFallback.test.ts (new)
Steps:
1. `MermaidBlock({ source })`: on mount, import mermaid, `initialize` once, `render(uniqueId, source)`, insert the returned SVG into a container with `overflow-x-auto`. On any thrown error or a 15 s timeout, show the source in a `pre` with the one-line note `diagram could not be drawn`. One failing block never throws past itself (wrap in an error boundary so the rest of the document still shows).
2. Export a pure `fallbackFor(source, error)` used by the component, and test it (note text, source kept verbatim).
3. `MarkdownView`: language `mermaid` code renders `MermaidBlock`.
Do not touch: other code blocks' rendering.
Proof: the new test passes (0 failures; file absent before); `npx tsc --noEmit` exits 0; `env NODE_ENV=production npm run build` succeeds and `grep -l "mermaid" .next/static/chunks/*.js | wc -l` is at least 1 while `grep -c mermaid` on the chat page's own entry chunk (`.next/static/chunks/app/(app)/chat/page-*.js`) is 0 (lazy loaded). Drawing in a browser is T30.

## T13: Vault links, wikilinks and embeds inside items
Status: DONE 2026-10-13 (wikilinks + MarkdownView tests 10 pass 0 fail; ../x and dot paths plain text; tsc 0; build ok)
Spec: must-do #13 (paths), #14 (inside markdown), #34, check #25
Depends on: T11, T8
Blocked by: none
Context: Obsidian notes use `[[note]]`, `[[note|label]]`, `![[file.png]]` and relative links. A link opens the linked file in the work area only if it passes the same checks as Must 22; else it shows as plain text. The client pre-checks the obvious refusals (`..`, a part starting with a dot, a type not allowed) so they never become a button, then asks `/api/vault/meta` with `from=<this item>` for the rest; unavailable results become plain text. Paths are found next to the item first, then from the vault root (T4's `from` rule). No new package: write a small remark plugin.
Files: /home/col/SAM_ui-work-area/src/components/work/wikilinks.ts (new: remark plugin and `linkTarget(raw, itemPath)`), src/components/work/wikilinks.test.ts (new), src/components/work/MarkdownView.tsx (edit)
Steps:
1. Plugin: in text nodes, `![[x]]` becomes an image node (or a video node for `mp4`/`webm`), `[[x]]` and `[[x|label]]` become link nodes with a `vault:` marker in `data`; a bare `x` with no extension gets `.md`. Skip code and inline code.
2. `linkTarget(raw, itemPath)` returns `{ kind: 'vault'; path } | { kind: 'web'; href } | { kind: 'plain' }`; `..`, dot parts, `javascript:` and disallowed types are `plain`.
3. `MarkdownView`: vault links render as buttons calling `onOpenItem(path, from)` once meta says available, plain text otherwise; vault images use `/api/vault/file?path=<p>&from=<item>`; vault videos render a placeholder that T14's media component fills.
4. Tests (Done-means 25): `[[Sample Note]]` and `[sample](./Sample%20Note.md)` give `vault` targets; `[x](../x.md)` and `[[.git/config]]` give `plain`, and `renderToStaticMarkup` shows them as text with no button and no link; `![[pic.png]]` renders an `img` whose `src` holds `from=`.
Do not touch: the server resolver (T4).
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/work/wikilinks.test.js` shows 0 failures; file absent before. `npx tsc --noEmit` exits 0.

## T14: Images and videos, standalone and inline
Status: DONE 2026-10-13 (MediaView tests 3 pass 0 fail, 13 across work tests; svg only as img, video no autoplay; tsc 0; build ok)
Spec: must-do #13 (display), #14
Depends on: T13
Blocked by: none
Context: Images fit the panel width and open full size on tap; videos play with controls, can be seeked, and never start with sound by themselves. SVG is only ever an `<img>` (Must 27), never an `<object>`, `<embed>` or frame.
Files: /home/col/SAM_ui-work-area/src/components/work/MediaView.tsx (new), src/components/work/MarkdownView.tsx (edit: use it for inline media), src/components/work/MediaView.test.ts (new)
Steps:
1. `ImageItem({ src, alt })`: `<img>` with `max-w-full h-auto`, a button wrapper (at least 44x44 px tap target) opening a full-size overlay that closes on tap, Escape or close button.
2. `VideoItem({ src })`: `<video controls preload="metadata" playsInline>` with no `autoPlay`, `max-w-full`.
3. Test with `renderToStaticMarkup`: an SVG source renders as `<img`, never `<object`, `<embed>` or `<iframe`; the video has `controls` and no `autoplay`.
Do not touch: PDF and HTML rendering.
Proof: the new test passes (0 failures; file absent before); `npx tsc --noEmit` exits 0. Seeking and sound are checked in the browser (T30) and by Colin (T34).

## T15: SAM-made HTML pages in a locked-off frame; outside websites as links
Status: DONE 2026-10-13 (HtmlFrame tests 3 pass 0 fail; sandbox exactly allow-scripts, website link http(s) only; tsc 0)
Spec: must-do #16, #18
Depends on: T5
Blocked by: none
Context: SAM_ui hosts the terminal page (`src/app/(app)/terminal`) and the phone controls, so a SAM-made page must never get same-origin. `sandbox="allow-scripts"` and nothing else: no `allow-same-origin`, `allow-popups`, `allow-forms`, `allow-top-navigation`, `allow-modals`. The frame's own document request is made by SAM_ui's page, so it carries the session cookie; requests the page itself makes come from an opaque origin and carry none (`SameSite=Lax`). Outside websites are never framed.
Files: /home/col/SAM_ui-work-area/src/components/work/HtmlFrame.tsx (new), src/components/work/WebsiteLink.tsx (new), src/components/work/HtmlFrame.test.ts (new)
Steps:
1. `HtmlFrame({ path })`: `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" src="/api/vault/file?path=...">`, full panel width and height, a title attribute naming the file.
2. `WebsiteLink({ href })`: a card with the host and a button-styled `<a target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">`.
3. Test: the rendered iframe's `sandbox` is exactly `allow-scripts`; its `src` starts with `/api/vault/file`; `WebsiteLink` renders no iframe and has `noopener` and `noreferrer`.
Do not touch: the route's CSP (T5).
Proof: the new test passes (0 failures; file absent before); `npx tsc --noEmit` exits 0. The hostile-page browser check is T31.

## T16: PDFs drawn by SAM_ui, page by page
Status: DONE 2026-10-13 (pdfLinks tests 4 pass 0 fail; pdfjs-dist 6.4.299 added, worker bundled by webpack, scripting/XFA off; tsc 0; build ok)
Spec: must-do #32, check #23 (code half)
Depends on: T6
Blocked by: none
Context: The phone's browser does not show PDFs, so SAM_ui draws them. Package to add: `pdfjs-dist@6.4.299`, Apache-2.0 licence (engines: Node 22.13 or later; the box has 22.22.1). Install: `env NODE_ENV=development npm install --include=dev --save-exact pdfjs-dist@6.4.299`, then the "all present" one-liner. Load it only in the browser by dynamic import. Use `isEvalSupported: false`, no scripting (`enableScripting` off, never load the pdf.js scripting sandbox), no XFA, no form layer. Draw pages to canvas; from annotations take only link annotations with an `http:` or `https:` URL and render them as T15's outside-link anchors; ignore every action annotation. Serve the worker from the package via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`; if Next's webpack cannot, copy it to `public/` at build time and say so. Over 50 MB shows "too big to show here" and the vault path (from meta, T8, before any fetch).
Files: /home/col/SAM_ui-work-area/package.json, package-lock.json (edit, by npm), src/components/work/PdfView.tsx (new), src/components/work/pdfLinks.ts (new: pure link filter), src/components/work/pdfLinks.test.ts (new)
Steps:
1. `PdfView({ path, size })`: pages rendered lazily as they scroll into view, at the panel's width; zoom out and zoom in buttons (44x44 px), the page scrolls inside the panel both ways when zoomed; a page counter.
2. `pdfLinks.ts`: `safePdfLinks(annotations)` keeps only `Link` annotations with an `http(s)` `url`; drops `javascript:`, `unsafeUrl` with other schemes, named, launch and submit actions. Test it with hand-made annotation objects.
Do not touch: other renderers.
Proof: `pdfLinks.test` passes (0 failures; file absent before); `npx tsc --noEmit` exits 0; `env NODE_ENV=production npm run build` succeeds. Browser and phone checks are T31 and T34.

## T17: Item view: loading, timeout, retry, too big, not available
Status: DONE 2026-10-13 (itemState tests 7 pass 0 fail incl. both cap edges and 15000 ms timeout; tsc 0; build ok; ItemView component itself is browser-proved in T30)
Spec: must-do #7 (panel), #19, #20, #32 (cap)
Depends on: T12, T14, T15, T16, T8
Blocked by: none
Context: One component turns an item path into the right renderer, with no endless spinner: 15 s then "could not load" and a Retry the user presses (never an automatic loop). Size caps come from meta before any fetch of the body. Markdown is fetched as text from the file route; HTML, images, video and PDF load by URL.
Files: /home/col/SAM_ui-work-area/src/components/work/ItemView.tsx (new), src/components/work/itemState.ts (new: pure state rules), src/components/work/itemState.test.ts (new)
Steps:
1. `itemState.ts`: `decide(meta)` gives `unavailable` (label `not available: <name>`), `too-big` (md or html over 2 MB, pdf over 50 MB; shows "too big to show here" and the vault path), or `load` with the renderer kind; `withTimeout(promise, 15000)`.
2. `ItemView({ path, from? })`: fetch meta, apply `decide`, then load. Markdown: `fetch` with an `AbortController` aborted at 15 s. Image, video, HTML, PDF: a 15 s timer cleared by the element's `load`, `loadedmetadata` or pdf.js's first page; on error or timeout, "could not load" plus a Retry button (44x44 px) that restarts from meta. A website shows `WebsiteLink`.
3. Tests for `decide` (each cap at the edge: 2,097,152 bytes loads, one more is too big; 52,428,800 likewise for PDF) and `withTimeout` (fake timers, rejects at 15,000 ms, not before).
Do not touch: the renderers' internals.
Proof: `npm run pretest && node scripts/run-tests.cjs .test-build/components/work/itemState.test.js` shows 0 failures; file absent before. `npx tsc --noEmit` exits 0.

## T18: Work panel with two views and the recent list
Status: DONE 2026-10-13 (recentView tests 3 pass 0 fail; tabs aria-selected 44px, Work body unchanged in diff; new props optional; tsc 0; build ok)
Spec: must-do #8, #9 (display)
Depends on: T17, T10
Blocked by: none
Context: `src/components/chat/WorkPanel.tsx` today shows one message's process blocks. It gains two views: Work (today's view, unchanged) and Items (the open item, then the recent list). It must still work in both mounts (desktop aside, phone sheet; `chat/page.tsx:2345-2385`). Work is unavailable when no message is picked (opened from the recent-list button).
Files: /home/col/SAM_ui-work-area/src/components/chat/WorkPanel.tsx (edit), src/components/work/RecentItems.tsx (new), src/components/work/recentView.ts (new: pure formatting), src/components/work/recentView.test.ts (new)
Steps:
1. `WorkPanel` props gain `view: 'work' | 'items'`, `onViewChange`, `openItem: { path: string; from?: string } | null`, `onOpenItem`, `hasWork: boolean`. Header gets two tabs (Work, Items; 44 px tall tap targets, `aria-selected`); Work disabled when `hasWork` is false. The Work body is exactly today's body.
2. Items body: `ItemView` for `openItem` when set, then a `RecentItems` list (fetched from `/api/vault/recent` each time the Items view opens): title, project folder, "made <relative time>", chat title; tapping opens it; a `missing` entry shows "moved or deleted" and is not a button.
3. `recentView.ts`: `entryLabel(entry, now)` and test it (relative time words, moved-or-deleted label).
Do not touch: `WorkBlocks` (T21), the chat page (T19).
Proof: the new test passes (0 failures; file absent before); `npx tsc --noEmit` exits 0; `env NODE_ENV=production npm run build` succeeds.

## T19: Chat page: item cards, opening items, the recent-list button
Status: DONE 2026-10-13 (tsc 0; npm test 779 tests 777 pass 0 fail 2 skipped vs Baseline 0 fail; build ok; cards, Items button and both panel mounts in diff; browser checks are T30)
Spec: must-do #2, #3, #7, #8, #9 (reachable without a message)
Depends on: T18
Blocked by: none
Context: Today the panel renders only when `workOpen && workMessage` (`chat/page.tsx:2345`, `2363`), and `openWork(id)` (`page.tsx:1745`) is the only way in. Items must open from a card wherever the marker sat, and the recent list must open with no message picked. Cards sit under the answer in the bubble (`page.tsx:2053-2080`), using `splitBlocks(...).items` from T3 and `cardFor` with meta fetched once per path per page load (a `Map` in a ref).
Files: /home/col/SAM_ui-work-area/src/app/(app)/chat/page.tsx (edit), src/components/work/ItemCards.tsx (new)
Steps:
1. `ItemCards({ items, metaFor, onOpen })`: one card per marker with icon by kind, label and kind word (document, page, image, video, website); 44 px tall; an unopenable card is not a button and reads `not available: <file name>`. A website card opens the address in a new tab (T15's link), never the panel.
2. Page state: `workView` (`'work' | 'items'`) and `openItem`. `openWork(id)` sets view `work` (unchanged otherwise). New `openItemFrom(msgId, path)` sets the message, view `items`, the item, and opens the panel. A header button "Items" (icon plus label, 44 px) opens the panel on the Items view with no item and no message.
3. Render the panel when `workOpen && (workMessage || workView === 'items')`, in both mounts, passing the new props. Escape and the close button behave as today.
Do not touch: the speech calls, `spokenText` use, `AnswerBlocks`, the bubble's plain text.
Proof: `npx tsc --noEmit` exits 0; `npm test` shows no new failures against the Baseline line; `env NODE_ENV=production npm run build` succeeds. The browser checks are T30.

## T20: Full screen, with back to return
Status: DONE 2026-10-13 (fullScreen tests 3 pass 0 fail; tsc 0; build ok; foreman fix: close and Escape in full screen return to the normal panel per Must 33; browser check T31)
Spec: must-do #33
Depends on: T19
Blocked by: none
Context: One button in the panel makes the open item fill the screen on phone and PC; the same button, the close button or the phone's back gesture returns to the normal panel without leaving the chat. Back is handled with `history.pushState` on entering full screen and a `popstate` listener that only leaves full screen; leaving by the button calls `history.back()` so no stray entry is left. The sheet is portaled to `document.body` today (`page.tsx:2363-2385`); full screen uses the same portal at `fixed inset-0` above the tab bar.
Files: /home/col/SAM_ui-work-area/src/components/chat/WorkPanel.tsx (edit), src/app/(app)/chat/page.tsx (edit), src/components/work/fullScreen.ts (new: pure history helper), src/components/work/fullScreen.test.ts (new)
Steps:
1. `fullScreen.ts`: `enterFull(history)` and `onPop(state)` logic with a marker in `history.state` (`{ samWorkFull: true }`), tested with a fake history object (enter pushes once; pop of the marker leaves full screen and keeps the chat; leaving by button pops once).
2. Panel header: a full-screen toggle (Maximize2 or Minimize2 icon, `aria-label`, 44 px) shown in the Items view when an item is open. Close while full screen leaves full screen first, then closes as today.
Do not touch: the chat route and its `?c=` handling.
Proof: the new test passes (0 failures; file absent before); `npx tsc --noEmit` exits 0. Browser check is T31.

## T21: The long version in the Work view is formatted
Status: DONE 2026-10-13 (MessageBlocks tests 7 pass 0 fail incl. h2/table/no script; npm test 781 pass 0 fail; tsc 0; build ok; WorkPanel.tsx one-prop pass-through)
Spec: must-do #35, check #26 (code half)
Depends on: T12, T13
Blocked by: none
Context: After T3, the Work view's text blocks are only the long version (`splitBlocks` puts every other text in the answer). They render with `MarkdownView` and its protections; thinking and tool cards stay exactly as today. The bubble stays plain text.
Files: /home/col/SAM_ui-work-area/src/components/chat/MessageBlocks.tsx (edit `WorkBlocks` only), src/components/chat/MessageBlocks.test.ts (edit)
Steps:
1. In `WorkBlocks`, case `text` renders `<MarkdownView source={block.text} itemPath={null} onOpenItem={...} />` (vault links need an `onOpenItem` prop passed down from `WorkPanel`; with no item path, links resolve from the vault root).
2. Test with `renderToStaticMarkup`: a long version with a heading, a GFM table and `<script>` gives an `h2` or `h3`, a `table`, and no `<script`; `AnswerBlocks` on the same text still gives a plain `whitespace-pre-wrap` paragraph.
Do not touch: `ThinkingCard`, `ToolCard`, `AnswerBlocks`, `splitBlocks`.
Proof: the `MessageBlocks` test file shows 0 failures including the new case (fails before); `npx tsc --noEmit` exits 0.

## T22: Card and panel polish at 390 px
Status: DONE 2026-10-13 (grep for text under 12px in src/components/work prints nothing; tsc 0; build ok; npm test 783 tests 781 pass 0 fail)
Spec: must-do #11, #2
Depends on: T19, T20, T21
Blocked by: none
Context: Phone first (Samsung A16). Before the browser proofs, make sure nothing new can push the page sideways and every new control meets the UX floor: tap targets at least 44x44 px, no text under 12 px, contrast 4.5:1 body and 3:1 large or non-text.
Files: /home/col/SAM_ui-work-area/src/components/work/*.tsx, src/components/chat/WorkPanel.tsx (edit, styles only)
Steps:
1. Read every new component at a 390 px mental width: long titles truncate (`truncate` or `break-words`), tables and code scroll inside themselves, images and videos `max-w-full`, the iframe `w-full`, PDF canvases scale to width.
2. Fix any text class under 12 px in new code (the existing Work header's `text-[10px]` items are today's view and stay).
Do not touch: logic; existing components' text sizes outside the new code.
Proof: `grep -rnE "text-\[(8|9|10|11)px\]" src/components/work` prints nothing; `npx tsc --noEmit` exits 0; `env NODE_ENV=production npm run build` succeeds. Measured checks are T30.

## T23: chat-length-guard does not count marker lines (staged)
Status: DONE 2026-10-13 (live hook: new marker case FAILS 14 pass 1 fail; .next: 15 pass 0 fail; diff is one comment line and one regex line; live hook untouched)
Colin gate: the change to `~/.claude/hooks/chat-length-guard.sh` is applied only on Colin's explicit word, in T33. This ticket writes `chat-length-guard.sh.next` beside it and proves the `.next`; it never edits the live hook.
Spec: must-do #6, check #4
Depends on: T1
Blocked by: none
Context: The hook (both seats) counts words before `<!-- more -->` (line 90) after dropping fenced code (line 91). A marker line before the more line adds about four words today. The test `~/.sam/tests/test-chat-length-guard.sh` hard-codes `HOOK="$HOME/.claude/hooks/chat-length-guard.sh"`; it gains a seam so it can run the `.next`.
Files: /home/col/.claude/hooks/chat-length-guard.sh.next (new, a copy of the live hook with the change); /home/col/.sam/tests/test-chat-length-guard.sh (edit, after `cp -p` to `test-chat-length-guard.sh.bak-<date>-workarea`)
Steps:
1. `cp -p ~/.claude/hooks/chat-length-guard.sh ~/.claude/hooks/chat-length-guard.sh.next`.
2. In the `.next` Python block, after the `spoken = ...` line, drop marker lines: `spoken = re.sub(r"^[ \t]*<!--[ \t]*work:.*?-->[ \t]*$", " ", spoken, flags=re.M)`. Add one dated line to the header comment. Nothing else changes (the 80-word limit stays).
3. Test: `HOOK="${CHAT_LENGTH_HOOK:-$HOME/.claude/hooks/chat-length-guard.sh}"`; add a case: a 78-word answer plus a marker line `<!-- work: 02 - Atwood Systems/x/A Long Plan Name.md -->` is not logged as an overrun and leaves no pending warning; and a control case: an 81-word answer with a marker still is.
Do not touch: the live hook, `~/.claude/settings.json`, the 80-word limit, the `--prompt` mode.
Proof: `bash ~/.sam/tests/test-chat-length-guard.sh` (live hook) FAILS the new marker case; `CHAT_LENGTH_HOOK=$HOME/.claude/hooks/chat-length-guard.sh.next bash ~/.sam/tests/test-chat-length-guard.sh` passes every case; `diff ~/.claude/hooks/chat-length-guard.sh ~/.claude/hooks/chat-length-guard.sh.next` shows only the new line and the comment line.

## T24: The work-area rule in CLAUDE.md (staged)
Status: DONE 2026-10-13 (CLAUDE.md.next has 1 marker line vs 0 live; diff shows added lines only; live CLAUDE.md untouched)
Colin gate: the change to `/home/col/claude/CLAUDE.md` is applied only on Colin's explicit word, in T33. This ticket writes `/home/col/claude/CLAUDE.md.next` and never edits the live file.
Spec: must-do #28, check #19 (grep half)
Depends on: T1
Blocked by: none
Context: SAM must know when to save an item and how to mark it. Place the rule inside "Voice: terse by default", right after the "Short chat, visuals for the rest" paragraph (line 64), where the `<!-- more -->` rule already lives. It must respect line 58 (personal only in `03 - Personal/`, never `02 - Atwood Systems/`) and VAULT-INDEX rule 5. Write it in the file's own style (one paragraph, dated, plain). CLAUDE.md is a file's contents, so markdown bold is allowed there, but keep the paragraph's lead the same style as its neighbours.
Files: /home/col/claude/CLAUDE.md.next (new, a copy with one added paragraph)
Steps:
1. `cp -p /home/col/claude/CLAUDE.md /home/col/claude/CLAUDE.md.next`.
2. Add one paragraph saying: when an answer is a diagram, a long write-up, a book excerpt, a table-heavy document, an image or a video, SAM saves it as a file in the vault folder of the project it belongs to and adds a line on its own `<!-- work: <vault path> -->` to the reply; personal items only under `03 - Personal/`; a project that is a single note with no folder gets a new folder named after the note, beside it, and the folder index is updated in the same pass; the marker never sits inside a spoken sentence; SAM_ui shows the item in the work panel and never reads it aloud; allowed types are the shared list; videos stay out of git (copied nightly to the Storage drive).
Do not touch: `/home/col/claude/CLAUDE.md`, any other paragraph.
Proof: `grep -c "<!-- work:" /home/col/claude/CLAUDE.md.next` is at least 1 and `grep -c "<!-- work:" /home/col/claude/CLAUDE.md` is 0; `diff /home/col/claude/CLAUDE.md /home/col/claude/CLAUDE.md.next` shows only added lines.

## T25: Videos out of both vault repos (staged as patches)
Status: DONE 2026-10-13 (patches applied on Colin's go: check-ignore names a rule for test.mp4/webm/mov in both vault repos; root .gitignore has no ignore rule line for 02 - Atwood Systems, only the existing comment, SAM's ruling; .bak files moved to ~/.sam/staged/work-area/)
Colin gate: the vault `.gitignore` changes are applied only on Colin's explicit word, in T33. This ticket writes patch files in `/home/col/.sam/staged/work-area/` and proves them on copies; it never edits a vault file and never commits.
Spec: must-do #29 (git half), check #20 (git half)
Depends on: T1
Blocked by: none
Context: The root vault `.gitignore` ignores `*.mp4 *.mkv *.mov *.wav *.mp3 *.m4a` but not `*.webm`. `02 - Atwood Systems/` is its own repo, excluded from the root through `.git/info/exclude` (never the root `.gitignore`, VAULT-INDEX rule 5), and its own `.gitignore` ignores no media. The root `.gitignore`'s media comment says its list stays in step with `sam-backup.sh` (T26 adds `*.webm` there).
Files: /home/col/.sam/staged/work-area/vault-root-gitignore.patch (new), /home/col/.sam/staged/work-area/atwood-gitignore.patch (new), /home/col/.sam/staged/work-area/README.md (new: what each patch is and how T33 applies it)
Steps:
1. Copy both ignore files to a temp dir, edit the copies: root gains `*.webm` in the "Raw source media" block; Atwood's gains a short dated block with `*.mp4`, `*.webm`, `*.mov`. Write `diff -u` patches with paths relative to each repo root.
2. Prove on throwaway repos: for each, `git init` a temp dir, apply the patch to a copy of the ignore file with `patch`, touch `test.mp4 test.webm test.mov`, and run `git check-ignore -v` on all three.
3. Remove the temp dirs.
Do not touch: anything under `/home/col/ai-memory-vault`, either repo's `.git/info/exclude`.
Proof: in the temp repos, `git check-ignore -v test.mp4 test.webm test.mov` names a rule for all three files in both; `grep -c "02 - Atwood" ` on the patched root copy prints 0; `git -C /home/col/ai-memory-vault status --short -- .gitignore` and `git -C "/home/col/ai-memory-vault/02 - Atwood Systems" status --short -- .gitignore` print nothing (untouched).

## T26: Nightly backup: webm filter and the Storage copy of vault videos (staged)
Status: DONE 2026-10-13 (copy test PASS on .next, FAILS on live path; sam-backup test PASS on .next, live fails only the new webm case; webm filter count 1; Storage listing hash unchanged; live script untouched)
Colin gate: the `sam-backup.sh` change and the new copy script are installed only on Colin's explicit word, in T33. This ticket works in `/home/col/bin/sam-backup.sh.next` and a new `/home/col/bin/sam-raw-media-copy.sh.next`; it never edits the live script.
Spec: must-do #29 (backup half), #31, check #20 (backup half), #22 (test half)
Depends on: T1
Blocked by: none (but see the shared fact on the existing `.next`)
Context: The vault sync (`sam-backup.sh:159-173`) filters out `*.wav *.mp3 *.m4a *.mp4 *.mkv *.mov` and must gain `*.webm`. Every vault video (mp4, webm, mov) is copied nightly to `/run/media/col/Storage/Vault raw media/` at the same relative path; a copy is never deleted because the vault file was. If Storage is not mounted, the copy is skipped, the backup still finishes, and the skip is logged. The script runs `set -euo pipefail` and re-invokes itself in measure-only mode (`SB_PREFLIGHT=1`) and has a verify mode (`SB_VERIFY=1`); the copy must run in neither. `~/.sam/jobs-watch.d/offbox-backup.sh` alerts on any line containing `ERROR` in `last-run.log`, so the skip line must say `SKIP`, never `ERROR` (spec: no new push alert). Use `rsync` (`/usr/bin/rsync`), never with `--delete`; the test's fake `rclone` does not cover it, so the copy script takes test-only path overrides refused outside `/tmp`, like `SB_REMOTE`.
Files: /home/col/bin/sam-backup.sh.next (edit; check with `cmp` first), /home/col/bin/sam-raw-media-copy.sh.next (new), /home/col/.sam/tests/test-raw-media-copy.sh (new), /home/col/.sam/tests/test-sam-backup.sh (edit, after a `.bak-<date>-workarea` copy: one grep case for the webm filter)
Steps:
1. `cmp /home/col/bin/sam-backup.sh /home/col/bin/sam-backup.sh.next` (see shared facts).
2. `sam-raw-media-copy.sh.next`: `SRC=${RMC_SRC:-/home/col/ai-memory-vault}`, `DEST=${RMC_DEST:-/run/media/col/Storage/Vault raw media}`, each override refused (exit 2, message on stderr) unless under `/tmp` with no `..`. If `mountpoint -q` fails for the Storage mount (or, under test, `RMC_DEST`'s parent is missing), print `SKIP raw-media-copy: Storage drive not mounted (<time>)` and exit 0. Else `rsync -a --prune-empty-dirs --include='*/' --include='*.mp4' --include='*.webm' --include='*.mov' --exclude='*' "$SRC/" "$DEST/"` (no `--delete`), excluding any path part starting with a dot, then print `raw-media-copy ok: <n> files`. Any rsync failure prints `SKIP raw-media-copy: rsync exit <n>` and exits 0.
3. `sam-backup.sh.next`: add `--filter "- *.webm"` to the vault sync; after the vault block, unless `SB_PREFLIGHT=1` or `SB_VERIFY=1`, `echo "--- vault raw media to Storage ---"` and `bash /home/col/bin/sam-raw-media-copy.sh || true` (the install renames the `.next`; until then the test points at the `.next` by `RMC_SCRIPT`). Update the media comment in one dated line.
4. `test-raw-media-copy.sh` (Done-means 22 test): a temp vault with `a/b/clip.mp4`, `c.webm`, `d.mov`, `note.md`, `.obsidian/x.mp4`; copies the three videos at the same relative paths and same sizes (`stat -c %s`), not the note, not the dot path; deleting the vault `clip.mp4` and re-running leaves the copy; a missing destination parent prints the SKIP line and exits 0; an override outside `/tmp` is refused; the script never contains `--delete` and never prints `ERROR`. It takes `RMC_SCRIPT` (default the live path) so it FAILS before install and passes against the `.next`.
5. `test-sam-backup.sh`: one case asserting the script under test has a `- *.webm` vault filter.
Do not touch: `/home/col/bin/sam-backup.sh`, `sam-backup.timer`, the Drive remotes, the real Storage folder, `offbox-backup.sh`.
Proof: `RMC_SCRIPT=/home/col/bin/sam-raw-media-copy.sh.next bash ~/.sam/tests/test-raw-media-copy.sh` passes every case and `bash ~/.sam/tests/test-raw-media-copy.sh` fails (no live script); `SB_SCRIPT=/home/col/bin/sam-backup.sh.next bash ~/.sam/tests/test-sam-backup.sh` passes with the new case, and against live it fails only the new case; `grep -c -- '- \*.webm' /home/col/bin/sam-backup.sh.next` prints 1; `ls "/run/media/col/Storage/Vault raw media/"` is unchanged from before the ticket.

## T27: The morning brief mentions a skipped Storage copy (staged)
Status: DONE 2026-10-13 (extract test PASS on .next, live fails the SKIP case; stale log and .. path cases pass; live extract.py untouched)
Colin gate: part of the Storage copy change; `extract.py` is installed only on Colin's explicit word, in T33. This ticket writes `/home/col/.sam/morning-brief/extract.py.next` and never edits the live file.
Spec: must-do #31 (report half), check #22 (brief half)
Depends on: T26
Blocked by: none
Context: The 06:00 sweep runs `extract.py` (`~/.sam/morning-brief/sweep.sh`), which boils the last 24 hours into `sweep-input.md`; the 07:30 brief reads the sweep. Nothing reads the backup log today. Add one small section so a `SKIP raw-media-copy` line in `~/.local/state/sam-backup/last-run.log` from the last 24 hours reaches the brief. `extract.py` writes its output path from `sys.argv[1]` (line 180 writes `OUT`).
Files: /home/col/.sam/morning-brief/extract.py.next (new, a copy with the change), /home/col/.sam/tests/test-morning-extract-backup.sh (new)
Steps:
1. `cp -p` the live file to `.next`. Add `def backup_notes()`: read the log (path overridable by env `MB_BACKUP_LOG`, honoured only under `/tmp`), and if a `SKIP raw-media-copy` line is present and the file changed in the last 24 hours, add a section `## Backup` with `- Vault videos were NOT copied to the Storage drive last night: <the line>.` Nothing when all is well.
2. Test: a temp log with the SKIP line gives the section in a temp output; a log without it gives no `## Backup` section; the live file lacks the section (fails before).
Do not touch: `sweep.sh`, `brief.sh`, the prompts, the live `extract.py`, today's data folder.
Proof: `MB_EXTRACT=/home/col/.sam/morning-brief/extract.py.next bash ~/.sam/tests/test-morning-extract-backup.sh` passes; with the live file it fails the SKIP case.

## T28: Sample set and the fixture vault
Status: DONE 2026-10-13 (8 sample files copied to 02 - Atwood Systems/00_SAM_Control/work-area-samples/ after T25 applied; git ls-files --others in the Atwood repo shows 0 videos; fixture vault unchanged)
Spec: check #7, #10, #11, #18, #23, #25 (samples)
Depends on: T22
Blocked by: Colin applying T25 (the Atwood repo's video ignore rule), for the two video samples only
Context: Done-means 7 wants the sample set saved in the vault under `02 - Atwood Systems/00_SAM_Control/`. That sub-vault auto-commits hourly and its `.gitignore` ignores no media until T25 is applied, so a video saved there today would be committed into its git. Hostile and oversized samples (hostile HTML, scripted SVG, hostile PDF, 3 MB markdown, 60 MB PDF, 300 MB video, the outward symlink) never go in the real vault: they live only in a fixture vault on disk, which the harness serves via `SAM_VAULT_DIR`. The fixture vault holds a copy of the sample set too.
Files: /home/col/ai-memory-vault/02 - Atwood Systems/00_SAM_Control/work-area-samples/ (new folder: `Work Area Sample.md`, `diagram-ok.png` or a small png, `standalone.png`, `sample-page.html`, `sample-multipage.pdf`, `Sample Note.md`, and once T25 is applied `sample-clip.mp4`, `standalone.webm`); /home/col/delivery/ux-audits/work-area-proofs/build-fixture-vault.sh (new); /home/col/delivery/ux-audits/work-area-proofs/fixture-vault/ (new, generated)
Steps:
1. `Work Area Sample.md`: headings, bold, italic, bulleted and numbered lists, a quote, a code block, a horizontal rule, a table with 9 columns of long words (wider than a phone), a checklist (one ticked, one not), a working `mermaid` flowchart and a broken one, an image by `![](diagram-ok.png)` and by `![[standalone.png]]`, a video by `![[sample-clip.mp4]]`, a `[[Sample Note]]` wikilink, a relative link `[sample](./Sample%20Note.md)`, a `[x](../x.md)` link, and an outside link `https://example.com`. Business content only (no personal content in `02 - Atwood Systems/`).
2. `sample-page.html`: a small benign page with a script that writes "script ran inside the frame". `sample-multipage.pdf`: four pages, made with the proof rig's Chromium (`page.pdf()`), no reportlab on this box.
3. Videos: `ffmpeg` makes a 10 s `sample-clip.mp4` (H.264, AAC, with a tone so sound is testable) and `standalone.webm`. Before saving them in the vault, `git -C "/home/col/ai-memory-vault/02 - Atwood Systems" check-ignore -q sample-clip.mp4 standalone.webm`; if not ignored, save them only in the fixture vault and set Status `PARTLY DONE (videos wait for T25 applied)`.
4. `build-fixture-vault.sh` makes `fixture-vault/` mirroring `02 - Atwood Systems/00_SAM_Control/work-area-samples/` (copied) plus: `hostile.html` (tries `document.cookie`, `localStorage`, `parent.document`, `fetch('/api/chats')`, `window.top.location = 'about:blank'`, `window.open`, and prints each result on its own page), `scripted.svg` (an inline `<script>` that would change the title), `hostile.pdf` (hand-written PDF objects with an `/OpenAction` JavaScript action, an AcroForm field and a `javascript:` link), `big.md` (3 MB), `big.pdf` (60 MB), `long-video.mp4` (at least 300 MB, made by ffmpeg), `outward-link.md` as a symlink to a file outside the fixture vault, `.git/config`, `note.txt`. Never a real key or env file.
5. No `git add` or commit in the vault: the vault's own hourly checkpoint picks up the new files.
Do not touch: anything else in the vault; `03 - Personal/`; any `.gitignore`.
Proof: `ls "/home/col/ai-memory-vault/02 - Atwood Systems/00_SAM_Control/work-area-samples/"` lists the files above; `git -C "/home/col/ai-memory-vault/02 - Atwood Systems" ls-files --others --exclude-standard 00_SAM_Control/work-area-samples | grep -cE '\.(mp4|webm|mov)$'` prints 0; `du -sh /home/col/delivery/ux-audits/work-area-proofs/fixture-vault` shows at least 360M; `stat -c %s` of `big.md` is over 2,097,152 and of `big.pdf` over 52,428,800.

## T29: Proof rig and the curl checks on the harness
Status: DONE 2026-10-13 (run-proof.sh t29 prints PASS for checks 13, 11, 14, 16, 15 with 401, CSP sandbox, 404 x3 and audit +3, 206 with 1024 bytes, 405 x3; re-run by foreman; no listener left)
Spec: check #11 (headers), #13, #14 (harness), #15 (harness), #16 (range)
Depends on: T28
Blocked by: none
Context: Builds the rig the browser proofs share and runs the checks that need no browser beyond logging in. Serves the worktree build with `SAM_VAULT_DIR` set to the fixture vault and the harness's own `HOME`, so audit lines land in `<harness>/home/.sam/audit.log`, never the real one.
Files: /home/col/delivery/ux-audits/work-area-proofs/common.mjs (new), run-proof.sh (new), t29-curl.sh (new), results/ (new)
Steps:
1. `common.mjs`: start-up check that 4950 and 4951 are free, `enrol` via the harness `lib.mjs`, a helper that seeds a chat whose assistant reply carries markers (read `src/lib/server/chat/transcripts.test.ts` and `chatStore.ts` for the transcript and record shape; write them under the harness `HOME` only), the cookie-jar writer (mode 600, deleted at exit), and `revoke` at the end.
2. `t29-curl.sh` (against https://127.0.0.1:4951 with `-k`, never `-v`): no cookie on `sample-page.html` gives 401 (13); `curl -I` with the jar on `sample-page.html` and `scripted.svg` shows a `Content-Security-Policy` with `sandbox` and without `allow-same-origin` (11); `../x`, `%252e%252e/x` and `.git/config` with the jar give 404 and the harness audit log grows by exactly 3 lines (count before and after) (14); `-X POST`, `-X PUT`, `-X DELETE` give 405 and `git status --short` in the fixture source and both vault repos shows nothing new from the test (15); `-H "Range: bytes=0-1023"` on `sample-clip.mp4` gives 206 and exactly 1,024 bytes (16).
3. Save raw outputs (headers only, no cookies) to `results/t29-*.txt`; `bash stop.sh`.
Do not touch: the live service, the real audit log, port 3000.
Proof: `bash /home/col/delivery/ux-audits/work-area-proofs/run-proof.sh t29` prints PASS for each of the five checks with the raw status codes; `ss -ltn | grep -cE ':495[01]'` prints 0 afterwards.

## T30: Browser proofs, part one (views, samples, links, cache, timeouts)
Status: DONE 2026-10-13 (run-proof.sh t30 re-run by foreman prints PASS for checks 5, 6, 7, 12, 17, 18 at 390x844 and 1440x900; screenshots in results/; no listener left)
Spec: check #5, #6 (browser), #7, #12, #17, #18
Depends on: T29
Blocked by: none
Context: Uses the T29 rig at 390x844 and 1440x900. To test the 15 s timeout, slow the file route for the test only with Playwright's `page.route` (delay the fulfilment past 15 s); do not add a delay switch to the app.
Files: /home/col/delivery/ux-audits/work-area-proofs/t30-views.mjs (new), results/ (screenshots and JSON)
Steps:
1. (5) On the seeded chat: "View work" opens the Work view showing the same blocks as before the build (compare against a screenshot from the Baseline commit served the same way, or the element list); an item card opens the Items view on that item; both viewports.
2. (6) With no message picked, the header "Items" button opens the recent list.
3. (7) Open `Work Area Sample.md` at 390x844: headings, bold, list items, the table, the checklist, a drawn mermaid SVG, the broken block's source plus "diagram could not be drawn", both images, the video element, the standalone image, standalone video, HTML page frame and outside link all present; `document.scrollingElement.scrollWidth <= 390`.
4. (12) No `iframe` in the page has a `src` that is not `/api/vault/file...`; clicking the outside link opens a new page whose `document.referrer` is empty and `window.opener` is null.
5. (17) After opening every sample item at 390x844, `caches.keys()` and every cache's `keys()` contain no `/api/vault/` URL, and every work-area response seen had `cache-control` containing `no-store`.
6. (18) With the route delayed, "could not load" and a Retry button appear at 15 s (not before 14 s); `big.md` shows "too big to show here" and its vault path.
Do not touch: the live service.
Proof: `bash run-proof.sh t30` prints PASS for checks 5, 6, 7, 12, 17 and 18 with screenshots saved in `results/`; stop.sh run; no listener left.

## T31: Browser proofs, part two (hostile content, PDF, full screen, Work view, memory)
Status: DONE 2026-10-13 (run-proof.sh t31 re-run by foreman prints PASS for checks 10, 11, 16, 23, 24, 26; RSS rise 34.8 MB under 50 MB, series in results/t31-16-rss.txt; one real bug fixed in PdfView.tsx, last page counter; no listener left)
Spec: check #10, #11 (panel half), #16 (memory), #23 (browser), #24, #26
Depends on: T30
Blocked by: none
Context: Same rig. For memory, read the harness `next start` process's RSS with `ps -o rss= -p <pid>` (the stand-in for `sam-ui`; the live figure is T33's).
Files: /home/col/delivery/ux-audits/work-area-proofs/t31-hostile.mjs (new), results/
Steps:
1. (10) Open `hostile.html` in the panel: the page's own text shows each attempt failed (no cookie, no storage, no parent access, the fetch rejected or 401, top location unchanged, `window.open` null); the SAM_ui tab's URL, title and DOM are unchanged; no new page opened.
2. (11) `scripted.svg` shows in the panel as an image and its script did not run (title unchanged, no console message from it).
3. (23) `sample-multipage.pdf` shows pages at both viewports, zoom in and out change the canvas width, scrolling reaches page 4; `hostile.pdf` shows with no dialog, no navigation, no form field, and no console sign of its script; `big.pdf` shows "too big to show here".
4. (24) Full screen at both viewports fills the viewport with the item; the button, the close button and (390x844) `page.goBack()` each return to the panel with the chat URL unchanged.
5. (26) Seed a reply whose long version has a heading, a table and a mermaid block: the Work view shows `h2`/`h3`, `table`, a mermaid `svg`; the bubble's text is a plain paragraph.
6. (16) Play `long-video.mp4` on desktop start to end at 4x playback rate with two seeks; sample RSS every second; the rise over the starting figure stays under 50 MB.
Do not touch: the live service.
Proof: `bash run-proof.sh t31` prints PASS for 10, 11, 16, 23, 24 and 26 with the RSS series saved; stop.sh run; no listener left.

## T32: Whole-build gate
Status: DONE 2026-10-13 (tsc 0; build ok; npm test 783 tests 781 pass 0 fail 2 skipped vs Baseline 685/683/0/2; T2 tests 19 pass 0 fail; lint 0 errors; all present; added react-markdown 10.1.0, remark-gfm 4.0.1, mermaid 12.1.0, pdfjs-dist 6.4.299)
Spec: check #27, #2 (re-run), #26 (Done-means 2 still passes)
Depends on: T31
Blocked by: none
Context: The build is done only when it is no worse than the Baseline line in T1.
Files: none changed (read and run only)
Steps:
1. In the worktree: `npx tsc --noEmit`, `env NODE_ENV=production npm run build`, `npm test`, `npm run lint`.
2. Re-run T2's two test files on their own (Done-means 2 still passes after every later ticket).
3. Re-run the "all present" one-liner, and list the three added packages with versions from `package.json`.
4. Write a Status line with the counts.
Do not touch: anything.
Proof: `npx tsc --noEmit` exits 0; the build succeeds; `npm test` shows 0 failures (or exactly the Baseline's named failures and no new ones), with more passing tests than the Baseline; the T2 tests pass.

## T33: GATE: install the staged changes and deploy (Colin's word)
Status: PARTLY DONE 2026-10-13: work area deployed. Merged (a467216 + Merge branch build/work-area), installed with .bak-20261013-workarea and no stale copies: CLAUDE.md, chat-length-guard.sh, sam-backup.sh, sam-raw-media-copy.sh (700), extract.py; their tests pass on the live paths; both vault ignore patches applied; live tree got npm install for the 4 new packages; deploy.sh ran, sam-ui.service active. Live checks: 13 PASS (401 without cookie on file, meta, recent), 19 PASS (1), 20 PASS (check-ignore in both repos, webm filter count 1). NOT RUN: 14 (three refusals and audit lines) and 15 (405s) against the live service, because they need a signed-in session and a guard hook blocked the enrolment script; both pass on the harness (T29). Optional live RSS check not run
Colin gate: every step here needs Colin's explicit word first: the merge of `build/work-area`, the `sam-ui.service` restart, installing the CLAUDE.md change, the `chat-length-guard.sh` change, the `sam-backup.sh` change and the new copy script, the `extract.py` change, applying the two vault `.gitignore` patches, and any commit in a repo other than SAM_ui. Ask once with the list; do only what he approves.
Spec: must-do #6, #28, #29, #31 (installed), check #13, #14, #15, #19 (grep), #20 (live)
Depends on: T32, T23, T24, T25, T26, T27
Blocked by: Colin's go
Context: Install order keeps the speech change first so a later rollback keeps it (spec, Rollback). Each live file gets a dated `.bak-<date>-workarea` copy before it is replaced. Deploy with the dashboard note's commands (`env NODE_ENV=production npm run build && ~/bin/sam-ui-restart-verify`) once the branch is in the live tree, by whatever route Colin approves.
Files: the live files named in the gate line (replaced from their `.next` or patched), the live SAM_ui tree (merge, on approval)
Steps:
1. Show Colin the list, the diffs (`diff live .next`, the two patches) and the T32 result. Wait for his word on each item.
2. Install each approved item with its `.bak` first: `mv` each `.next` over its live file (for the copy script, `sam-raw-media-copy.sh.next` becomes `sam-raw-media-copy.sh`, mode 700); `patch` each vault ignore file. Re-run each item's own test against the live path (T23, T26, T27 tests without seams).
3. On approval, merge, build and restart as above.
4. Live checks against the real service with a real session (the same cookie-jar rule): (13) no cookie on a sample file gives 401; (14) three refused paths give 404 and `~/.sam/audit.log` grows by exactly three lines; (15) `POST`, `PUT`, `DELETE` give 405 and `git status --short` in both vault repos shows nothing from the test; (19) `grep -c "<!-- work:" /home/col/claude/CLAUDE.md` is at least 1; (20) `git check-ignore -v test.mp4 test.webm test.mov` names a rule in both vault repos (run from each repo root, files need not exist), `grep -c -- '- \*.webm' /home/col/bin/sam-backup.sh` is 1, `grep -c "02 - Atwood" /home/col/ai-memory-vault/.gitignore` is 0. Then the RSS check of T31 step 6 on the live `sam-ui` process with the sample clip if Colin wants the live figure.
Do not touch: anything Colin did not approve.
Proof: each approved item's test passes against the live path; the five live checks print the expected results; `systemctl --user is-active sam-ui` prints `active`. Unapproved items stay staged and are listed in the Status line.

## T34: GATE: Colin confirms on his phone
Status: TODO
Colin gate: Colin's own confirmation on his Samsung A16; no command stands in for it.
Spec: check #3, #8, #19 (phone half), #23 (phone), #24 (phone)
Depends on: T33
Blocked by: Colin
Context: The final word on each view is Colin's, on his phone (spec, Constraints).
Files: this tickets file (Status line only)
Steps:
1. Tell Colin, in a few short lines, what to look at: (3) a reply carrying an item is read aloud with no marker, path, file name or item content; (8) open `Work Area Sample.md` and the other samples: headings, bold, lists, table, checklist, diagram, images read well, the video plays and seeks, the HTML page shows in its frame, the outside link opens outside SAM_ui; (19) ask SAM for a diagram about a business project and for a personal item, then check with `ls` that the first landed in that project's folder and the second under `03 - Personal/`, and both open from their cards; (23) the sample PDF reads well; (24) full screen and back work.
2. Record each answer in this ticket's Status line.
Do not touch: anything.
Proof: Colin's explicit confirmation of 3, 8, 19, 23 and 24, recorded with the time; the two `ls` results for 19.

## T35: GATE: next-day backup checks
Status: TODO
Colin gate: runs only after T33 installed the backup changes on Colin's word; the "drive absent" run uses the test seam, never by unmounting Colin's Storage drive unless he says so.
Spec: check #21, #22 (live)
Depends on: T33
Blocked by: the first 04:15 nightly run after T33
Context: Drive is the off-site copy for text and images; the Storage drive is the only second copy of videos.
Files: none changed
Steps:
1. (21) `rclone ls "sam-crypt:vault/02 - Atwood Systems/00_SAM_Control/work-area-samples"` (or the remote `sam-backup.sh` actually used, read from its `REMOTE` line) lists the sample markdown and image and no `.mp4` or `.webm`. Print names only.
2. (22) `stat -c %s` of `sample-clip.mp4` in the vault and under `/run/media/col/Storage/Vault raw media/02 - Atwood Systems/00_SAM_Control/work-area-samples/` match; then, with Colin's word, move the vault copy aside to a temp place, run `bash /home/col/bin/sam-raw-media-copy.sh` and confirm the Storage copy remains, and put the vault copy back.
3. (22) The drive-absent case: `RMC_DEST=/tmp/no-such-mount/x bash /home/col/bin/sam-raw-media-copy.sh` prints the SKIP line and exits 0; then, with Colin's word, run the full backup with that override (or wait for a night the drive is absent) and confirm `last-run.log` holds the SKIP line, the run ended with `=== SAM backup done`, and the next morning's `sweep-input.md` holds the `## Backup` section.
Do not touch: the Drive copy (read only), the Storage copy beyond step 2.
Proof: the outputs of steps 1 to 3 saved in the Status line (names and sizes only).

---

## Coverage

Every Done-means check 1 to 27 maps to at least one ticket's Proof. A gap here is a bug in the tickets. Every must-do 1 to 35 has a ticket too (listed after the checks).

| Spec check | Ticket(s) |
|---|---|
| 1 two markers give two cards, no marker text, missing file "not available" | T3 (unit), T8 (served meta), T30 (cards in browser) |
| 2 spoken text and push body hold no marker | T2, T32 (re-run) |
| 3 Colin hears no marker on his phone | T34 |
| 4 chat-length-guard test, 78 words plus a marker passes | T23, T33 (installed) |
| 5 View work unchanged, card opens Items, 390 and 1440 | T30 |
| 6 record of 25 gives 20, moved or deleted, two markers add two lines, list without a message | T9 (unit), T30 (browser) |
| 7 sample set in the vault, everything shows, scrollWidth at most 390 | T28 (samples), T30 |
| 8 Colin confirms the sample set on his phone | T34 |
| 9 script, onerror, iframe, javascript: inert in markdown | T11 |
| 10 hostile page fails every attempt | T15 (frame), T31 |
| 11 sandbox CSP on HTML and SVG, scripted SVG inert in the panel | T5 (unit), T29 (curl), T31 (panel) |
| 12 no outside frame, outside link has no referrer or opener | T15 (unit), T30 |
| 13 no cookie gives 401 | T5 (unit), T29 (harness), T33 (live) |
| 14 refusal set refused, one audit line each, live three lines | T4 (unit), T29 (harness), T33 (live) |
| 15 POST, PUT, DELETE give 405, vault unchanged | T5 (unit), T29 (harness), T33 (live) |
| 16 range gives 206 and 1024 bytes, 300 MB video under 50 MB RSS rise | T6 (unit), T29 (curl), T31 (memory) |
| 17 nothing in Cache Storage, no-store on every response | T7 (code), T30 |
| 18 could not load and Retry at 15 s, 3 MB markdown too big | T17 (unit), T30 |
| 19 CLAUDE.md has the marker rule, Colin's diagram and personal item land right | T24 (staged), T33 (live grep), T34 |
| 20 check-ignore in both repos, webm in backup filters, no Atwood line in root | T25, T26, T33 (live) |
| 21 Drive has sample md and image, not the video | T35 |
| 22 Storage copy same size, survives delete, skip logged and in the brief, test | T26 (test), T27 (brief test), T35 (live) |
| 23 PDFs show, zoom, scroll, hostile PDF inert, 60 MB too big, Colin confirms | T16 (unit), T28 (samples), T31, T34 |
| 24 full screen and back at 390 and 1440, Colin confirms | T20 (unit), T31, T34 |
| 25 wikilink and relative link open, ../x and .git plain text | T13 |
| 26 long version formatted in Work view, bubble plain, check 2 still passes | T21 (unit), T31, T32 |
| 27 tsc, build, npm test against the baseline | T1 (baseline), T32 |

| Spec must-do | Ticket(s) |
|---|---|
| 1 marker line | T3 |
| 2 cards, no marker shown, titles | T3, T8, T19, T22 |
| 3 card opens the item in either mount | T19 |
| 4 voice never reads a marker or item | T2 |
| 5 push body has no marker | T2 |
| 6 guard ignores marker lines | T23 |
| 7 not available card | T3, T8, T17, T19 |
| 8 Work and Items views | T18, T19 |
| 9 recent list, 20, all chats, labelled | T9, T10, T18, T19 |
| 10 markdown formatting | T11 |
| 11 sideways scroll inside only | T11, T22 |
| 12 mermaid with fallback | T12 |
| 13 images inline and standalone | T13, T14 |
| 14 videos | T13, T14 |
| 15 raw HTML never runs | T11 |
| 16 locked-off frame | T5, T15 |
| 17 sandbox header on direct open | T5 |
| 18 outside websites as links | T11, T15 |
| 19 could not load, retry, 15 s | T17 |
| 20 2 MB cap | T8, T17 |
| 21 session only, 401 | T4, T5 |
| 22 real path inside vault, allowed types, refusals | T4 |
| 23 same not-found, audit line | T4, T5 |
| 24 read-only route | T5 |
| 25 byte ranges, streamed | T6 |
| 26 no-store, no Cache Storage | T5, T7 |
| 27 SVG only as an image | T5, T14 |
| 28 CLAUDE.md work-area rule | T24, T33 |
| 29 videos out of git, webm in backup filters | T25, T26, T33 |
| 30 recent-items record | T9 |
| 31 Storage copy, skip reported | T26, T27, T33, T35 |
| 32 PDFs in the panel | T6, T16, T17 |
| 33 full screen | T20 |
| 34 vault links in items | T13 |
| 35 long version formatted | T21 |

Robustness items that need building: the backup copy (T26), the skip report (T27), the 15 s timeout and retry (T17), the audit line (T4), the size caps (T8, T17), streaming (T6), and the rollback boundary (T2 kept separate).
