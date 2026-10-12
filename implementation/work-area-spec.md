# Work area in SAM_ui: spec

Status: LOCKED 2026-10-12 (Colin, ~8:55 PM: "Lock that shit")
Open questions answered by Colin 2026-10-12 ~8:10 PM and folded in below (Must 16, 28, 29, 31 to 35).
Grilled: 2026-10-12 ~7:25 PM with Colin, recorded in the "Exact next action" section of [[2026-10-12 LumiLounge, phone speech and work-area handoff]] and in [[2026-10-12]]. Option B chosen.
Touches: the Storage drive's `Vault raw media/` folder, SAM_ui (`WorkPanel.tsx`, `MessageBlocks.tsx`, the chat page, `speech.ts`, `turnPing.ts`, `sw.ts`, a new read-only vault file route), `~/.claude/hooks/chat-length-guard.sh`, `/home/col/claude/CLAUDE.md`, the two vault ignore files, `/home/col/bin/sam-backup.sh`.

## Goal

Diagrams, book excerpts, long write-ups, images and videos that SAM makes open inside SAM_ui as a proper work area, like claude.ai artifacts, on the phone and on the PC.
Each one is a file in the vault, in the folder of the project it belongs to, and opens from the chat message it came with or from a recent-items list.

## What exists today (read from the code, 2026-10-12)

- The work panel is one component, `src/components/chat/WorkPanel.tsx`, mounted twice by the chat page: a 320 to 380 px side panel on desktop and a bottom sheet 68% of the screen high on the phone (`src/app/(app)/chat/page.tsx:2345-2385`).
  It only ever shows one message's process blocks: thinking, tool calls, and the long version of a reply (`splitBlocks`, `MessageBlocks.tsx:254-281`). It opens from the "View work" button on a reply.
- Chat text and the work panel's text are plain `whitespace-pre-wrap` paragraphs (`AnswerBlocks` and `WorkBlocks` in `MessageBlocks.tsx`). There is no markdown renderer, no mermaid and no artifact code; `package.json` has none of those packages.
- A reply is the short spoken answer, then optionally a line `<!-- more -->` and the long version (`splitMore`, `src/types/chat.ts:189-199`). The long part goes to the work panel and is never spoken.
- What is spoken is cleaned in `splitForSpeech` (`src/lib/speech.ts:151`), tested in `src/lib/speechClean.test.ts`. There is no `src/lib/speechClean.ts`; the brief's name for it is the test file's. The cleaner drops paths and links but does not drop HTML comments other than by the `<!-- more -->` split.
- The "SAM replied" push notification body is built from the same spoken text (`answerFor` in `src/lib/server/chat/turnPing.ts:67-74`).
- `~/.claude/hooks/chat-length-guard.sh` counts the words before `<!-- more -->` (limit 80).
- Every API route is gated by `requireSession` (`src/lib/server/auth/guard.ts`): a 30-day `sam-session` cookie, `HttpOnly; Secure; SameSite=Lax` (`src/lib/server/auth/session.ts:129`), issued only after passkey enrolment by one-time token ([[SAM_ui_Passkey_Policy]], Policy B).
- The nearest existing path check is `resolveUploadPath` (`src/lib/server/uploads.ts`): it rejects anything outside the uploads folder by `path.relative`, but does not follow symlinks to their real location.
- The service worker caches every `/api/*` response, network first, in `sam-apis` (64 entries, 60 s) (`src/app/sw.ts:34-43`).
- The vault has two git repos. The root `.gitignore` ignores `*.mp4 *.mkv *.mov *.wav *.mp3 *.m4a` but not `*.webm`. `02 - Atwood Systems/` is its own repo and its `.gitignore` ignores no media at all. The nightly backup (`/home/col/bin/sam-backup.sh:166-173`, 04:15) leaves the same six extensions out of the Drive copy of the vault.

## Must do

### Marking an item in a reply

1. SAM marks an item with a line on its own: `<!-- work: <path or web address> -->`. The path is relative to the vault root (an absolute path inside `/home/col/ai-memory-vault` is accepted too). One line per item; a reply may carry several; a line may sit before or after `<!-- more -->`.
2. The chat bubble and the work panel never show a marker line. For each marker, the reply shows a card under the answer with the item's title and kind (document, page, image, video, website). The title is the first heading of a markdown file, the page title of an HTML file, else the file name.
3. Tapping an item card opens the work panel on that item: the side panel on desktop, the sheet on the phone. This works wherever the marker sat in the reply.
4. Voice never reads a marker or an item. Every `<!-- ... -->` comment, on one line or several, anywhere in the reply, is removed from the spoken text before it is split into sentences. The item's own content is never spoken. The replay button speaks the same cleaned text.
5. The "SAM replied" push notification body never contains a marker.
6. `chat-length-guard.sh` does not count marker lines towards its 80-word limit.
7. A marker that points at something SAM_ui will not show (missing file, outside the vault, a type not on the list in Must 22) gives a card reading "not available: <file name>" that opens nothing. Never a blank card, never an error page.

### The work panel

8. The work panel has two views. Work is today's view (thinking, tool calls, the long version), unchanged. Items shows the open item and the recent-items list. "View work" opens Work; an item card opens Items.
9. The recent-items list shows the 20 most recent items, newest first, one entry per file, each with its title, project folder, when it was made and the chat it came from. Tapping one opens it. A file that has since moved or been deleted shows "moved or deleted" and opens nothing. The list is reachable from the chat page without first picking a message. It covers all chats, each entry labelled with its chat (Colin, 2026-10-12).
10. Markdown items show formatted: headings, bold, italic, links, bulleted and numbered lists, quotes, code blocks, horizontal rules, tables, and task checklists (ticked and unticked, read-only).
11. Wide tables and code blocks scroll sideways inside themselves. The panel and the page never scroll sideways at 390 px.
12. Fenced `mermaid` blocks in a markdown item draw as diagrams. A block that fails to draw shows its source with a one-line "diagram could not be drawn" note, and the rest of the document still shows.
13. Images show inline in a markdown item, written either as `![](path)` or the Obsidian way `![[file]]`, with the path found next to the item first and then from the vault root. They fit the panel width and open full size on tap. An image on its own (png, jpg, jpeg, gif, webp, svg) opens the same way.
14. Videos (mp4, webm), on their own or inside a markdown item, play in the panel with controls, can be seeked, and never start playing with sound by themselves.
15. Raw HTML written inside a markdown file never runs in SAM_ui's page: scripts, event handlers, frames and `javascript:` links inside markdown do nothing.
16. HTML pages SAM makes (an `.html` file in the vault) show inside the panel in a locked-off frame with no same-origin access. From inside the frame a page cannot read SAM_ui's cookies or storage, cannot call SAM_ui's APIs as Colin, cannot change or cover the SAM_ui tab, and cannot open pop-ups. Scripts may run inside the frame (Colin, 2026-10-12); forms, pop-ups and top-level navigation stay blocked, and the frame never gets same-origin.
17. The same HTML page opened directly by its address in a browser tab is locked off the same way (it is sent with a sandbox policy), so its address cannot be used to run it with SAM_ui's access.
18. Outside websites (any http or https address, as a marker or a link inside an item) are never framed. They show as a link that opens in a new browser tab with no referrer and no handle back to SAM_ui.
19. If an item fails to load, or has not loaded after 15 seconds, the panel says "could not load" with a retry button. No endless spinner.
20. A markdown or HTML item bigger than 2 MB shows "too big to show here" and its vault path instead of loading.

### Serving vault files

21. SAM_ui serves a vault file only to a valid logged-in session (`sam-session`). Without one the answer is 401 and says nothing about the file.
22. A file is served only if its real location, after following any symlink, is inside `/home/col/ai-memory-vault`, and only if its type is one of: md, html, png, jpg, jpeg, gif, webp, svg, mp4, webm, pdf. Always refused: `..` in any form (plain, URL-encoded, double-encoded, backslash), absolute paths outside the vault, null bytes, symlinks that lead out, and any path with a part starting with a dot (`.git`, `.obsidian`, `.trash`, `.env` and the like). Nothing in `~/.sam`, and no env, key or credential file, can be reached by any path.
23. A refused request gets the same not-found answer whether or not the file exists, and adds one line to `~/.sam/audit.log` with the time, the path asked for and the reason. Never any file content.
24. The route is read-only. Nothing in this build writes, renames or deletes a vault file through SAM_ui.
25. Videos are served in byte ranges, so seeking works on the phone, and the SAM_ui server never holds a whole video in memory.
26. Work-area responses are never kept by the service worker or the browser cache: no Cache Storage entries, and every response says no-store.
27. SVG files are only ever shown as images, never as pages, so a script inside one never runs, including when the SVG's address is opened directly.

### Saving items and keeping media out of git

28. SAM's standing instructions (`/home/col/claude/CLAUDE.md`) gain the work-area rule: when an answer is a diagram, a long write-up, a book excerpt, a table-heavy document, an image or a video, SAM saves it as a file in the vault folder of the project it belongs to and adds the marker line from Must 1. Personal items go only under `03 - Personal/`, never `02 - Atwood Systems/`. A project that is a single note with no folder (e.g. `AI Receptionist Platform.md`) gets a new folder named after the note, beside it, and the folder index is updated in the same pass. The marker never sits inside a spoken sentence.
29. Videos (mp4, webm, mov) stay out of git in both vault repos: the root `.gitignore` gains `*.webm`; the `02 - Atwood Systems/` repo's own `.gitignore` gains `*.mp4`, `*.webm` and `*.mov`. The nightly backup's vault exclusions gain `*.webm` so they stay in step with the root `.gitignore`, as its comment requires. The `02 - Atwood Systems/` exclusion stays in `.git/info/exclude`, never the root `.gitignore` (VAULT-INDEX rule 5). Videos get their own copy on the Storage drive (Must 31).
30. SAM_ui keeps a recent-items record: one line per item per finished reply. Must 9 reads only this record.

### Decided after the draft (Colin, 2026-10-12)

31. Every video in the vault (mp4, webm, mov) is copied nightly to `/run/media/col/Storage/Vault raw media/`, under the same relative path it has in the vault. A copy is never deleted from the Storage drive because the vault file was deleted. If the Storage drive is not mounted, the copy step is skipped, the nightly backup still finishes, and the skip is written to the backup log and reported in the next morning brief.
32. PDFs show inside the panel, page by page, on the phone and the PC, with zoom and scroll. The phone's browser does not show PDFs by itself, so SAM_ui draws them. Scripts, forms and links that run actions inside a PDF never run; ordinary web links in a PDF open as in Must 18. A PDF over 50 MB shows "too big to show here" and its vault path.
33. The work area can go full screen on any device: one button in the panel makes the open item fill the whole screen on the phone and the PC, and the same button, the close button or the phone's back gesture returns to the normal panel without leaving the chat.
34. Links inside an item to other vault notes (`[[wikilinks]]` and relative links) open the linked file in the work area if it passes the same checks as Must 22. A link that fails the checks shows as plain text.
35. The long version of a reply (the text after `<!-- more -->` in the Work view) shows formatted with the same renderer as Must 10 to 15, with the same protections. The short answer in the chat bubble stays plain text.

## Won't do

- No claude.ai embed, and no framing of any outside website.
- No editing, commenting or annotating items in the panel. Items are read-only.
- No markdown rendering in the chat bubbles. Bubbles stay plain text, as today. (Not raised in the grill; raise it if wanted.)
- No vault browser. Only items SAM names in a reply, and the recent list, can be opened.
- Nothing outside the vault is served. No write route.
- No share links or public addresses. Nothing in the work area is reachable without Colin's login.
- No offline copies of items.
- No video conversion or compression. A video that the phone's browser cannot play shows the browser's own error.
- No new notification or Telegram message.
- No change to how `<!-- more -->` splits a reply, to the Work view's thinking and tool cards, or to the 80-word limit itself. (The long version does become formatted, Must 35.)
- SAM-made pages cannot load other vault files. This follows from the locked-off frame: with no same-origin access the page's own requests carry no session cookie (`SameSite=Lax`). Images a page needs must be inside the page itself.
- Other file types (Office documents, audio, mov) show "not available".

## Constraints and locked decisions

- Option B: SAM_ui renders the content itself. Not a claude.ai embed, because claude.ai sends CSP `frame-ancestors 'self'` (grill, handoff note above).
- It lives in the existing WorkPanel, desktop side panel and phone sheet (grill; `WorkPanel.tsx`).
- SAM-made pages are framed with no same-origin, because SAM_ui hosts the terminal page (`src/app/(app)/terminal`) and the phone controls. Outside websites open as a link, never framed (grill).
- Each item opens from its chat message, plus a recent-items list in the panel (grill).
- Items are vault files in the folder of the project they belong to. Personal items only in `03 - Personal/`, never in `02 - Atwood Systems/` (grill; `/home/col/claude/CLAUDE.md` line 58).
- Voice never reads a marker or an item (grill, hard rule). The `<!-- more -->` contract stays as it is: the long part is shown in the work panel and never spoken (`src/types/chat.ts:189-199`, `chat-length-guard.sh`).
- Every new route is behind `requireSession` like every other route; the vault graph route was gated for the same reason on 2026-09-20 (SAM_ui audit finding 6, `src/app/api/vault/graph/route.ts`). Enrolment stays Policy B ([[SAM_ui_Passkey_Policy]]).
- The vault path check must be stricter than `resolveUploadPath`: it follows symlinks to their real location before deciding.
- Media stays out of the vault's git; the backup's exclusion list is kept in step with the root `.gitignore` (`sam-backup.sh:164-165`). Never put the `02 - Atwood Systems/` line back in the root `.gitignore` (VAULT-INDEX rule 5).
- Memory: SAM_ui has an open memory-growth item ([[Active Priorities]], "SAM_ui memory and PC freezes"). Videos stream; text items are size-capped (Must 20, 25).
- Phone first: Colin reads on his Samsung A16. Checks run at 390x844 as well as 1440x900, and the final word on each view is Colin's on his phone.
- Never read a `.env` file or print any key. `backup-keys.env` in the repo root is off limits to every ticket.
- Commits, pushes, the `sam-ui.service` restart and the CLAUDE.md change each need Colin's explicit word.

## Done means

1. (M1, M2, M3, M7) Unit tests: a reply with two markers, one before and one after `<!-- more -->`, gives two cards and no marker text in the bubble or the Work view; a marker to a missing file gives "not available: <name>". Fails before, passes after.
2. (M4, M5) Unit tests in `src/lib/speechClean.test.ts` and `src/types/chat.test.ts`: the spoken text and the push body for replies with a one-line marker, a several-line comment, and markers in the short and long parts contain no `<!--`, no "work", no path and no file name. Fails before, passes after.
3. (M4) Colin confirms on his phone: a SAM reply carrying an item is read aloud with no marker, path, file name or item content.
4. (M6) `~/.sam/tests/test-chat-length-guard.sh` gains a case: a 78-word answer plus a marker line passes. Fails before, passes after.
5. (M3, M8) Browser check at 390x844 and 1440x900 on the live chat: "View work" opens the Work view looking as it does today; an item card opens the Items view on that item.
6. (M9, M30) Unit test: a record of 25 lines with repeats gives 20 entries, newest first, one per file; an entry whose file is gone shows "moved or deleted". Unit test: a finished reply with two markers adds two lines to the record. Browser check: the list opens from the chat page with no message picked.
7. (M10 to M14) A sample set is saved in the vault under `02 - Atwood Systems/00_SAM_Control/`: one markdown file with headings, bold, lists, a table wider than a phone, a checklist, a working and a broken mermaid block, an image by `![]()` and by `![[ ]]`, and a video; plus a standalone image, a standalone video, an HTML page and an outside link. Browser check at 390x844: everything shows, the broken diagram shows its source and the note, and `document.scrollingElement.scrollWidth` is at most 390.
8. (M10 to M14, M16, M18) Colin confirms on his phone: the sample set reads well. Headings, bold, lists, the table, the checklist, the diagram and the images show properly; the video plays and seeks; the HTML page shows in its frame; the outside link opens outside SAM_ui.
9. (M15) Unit test: markdown holding `<script>`, `<img onerror>`, `<iframe>` and a `javascript:` link renders with none of those running and none of those elements in the output.
10. (M16) Browser check: a hostile sample page tries to read the parent's cookie and storage, `fetch('/api/chats')`, change `window.top.location` and `window.open`. Every attempt fails, the page shows its own results, and the SAM_ui tab is unchanged.
11. (M17, M27) `curl -I` with a session cookie on the HTML page's address and on a sample SVG's address shows a sandbox Content-Security-Policy without `allow-same-origin`. A sample SVG with a script shows in the panel with the script not run.
12. (M18) Browser check: no frame in the page has an outside `src`; the outside link opens a new tab with no referrer and no opener.
13. (M21) `curl` with no cookie on an existing sample file returns 401.
14. (M22, M23) Unit tests against a temporary vault folder: `../x`, `%2e%2e/x`, `%252e%252e/x`, `..\x`, an absolute path outside, a null byte, `.git/config`, `.obsidian/app.json`, `x.env`, a dot-file, a symlink inside the vault pointing out, and a `.txt` file are all refused with the same answer and one audit line each; a normal md, png and mp4 are served. Live: three of those paths with a session cookie return not-found and `~/.sam/audit.log` grows by exactly three lines. No test fixture is a real key or env file.
15. (M24) `curl -X POST`, `PUT` and `DELETE` on the file route return 405, and the vault is unchanged (`git status` in both repos shows nothing new from the test).
16. (M25) `curl -H "Range: bytes=0-1023"` on the sample video returns 206 and 1024 bytes. While a video of 300 MB or more plays start to end on desktop with two seeks, the `sam-ui` process's memory (RSS by `ps`) rises by less than 50 MB.
17. (M26) After opening every sample item at 390x844, DevTools shows no work-area entries in Cache Storage, and the responses carry `Cache-Control: no-store`.
18. (M19, M20) Browser check: with the route slowed for the test, "could not load" and a retry button show after 15 seconds; a 3 MB markdown sample shows "too big to show here".
19. (M28) `grep -c "<!-- work:" /home/col/claude/CLAUDE.md` is at least 1. Colin asks SAM on his phone for a diagram about a business project and for a personal item: the first lands in that project's folder, the second under `03 - Personal/` (checked with `ls`), and both open from their cards.
20. (M29) `git check-ignore -v` on `test.mp4`, `test.webm` and `test.mov` names a rule in both vault repos; the vault filters in `sam-backup.sh` include `*.webm`; `grep -c "02 - Atwood" /home/col/ai-memory-vault/.gitignore` is 0.
21. (Backups) The day after the sample set is saved, `rclone ls` on the Drive copy of the vault lists the sample markdown and image, and not the video.
22. (M31) After the nightly run, the sample video exists under `/run/media/col/Storage/Vault raw media/` at the same relative path with the same size (`stat`). Deleting the vault copy and re-running leaves the Storage copy in place. A test run with the drive path absent finishes the backup, logs the skip, and the next morning brief mentions it. A test in `~/.sam/tests/` covers the copy and the skip; it fails before, passes after.
23. (M32) A sample PDF of several pages, and one holding a script and a form, are added to the sample set. Browser check at 390x844 and 1440x900: pages show in the panel, zoom and scroll work, nothing in the hostile PDF runs. A 60 MB PDF shows "too big to show here". Colin confirms on his phone that the sample PDF reads well.
24. (M33) Browser check at 390x844 and 1440x900: the full-screen button fills the screen with the item; the button, close and (on the phone) back each return to the panel with the chat still open. Colin confirms on his phone.
25. (M34) Unit test: a wikilink and a relative link to a sample note open it in the work area; a link to `../x` or a `.git` path shows as plain text and opens nothing.
26. (M35) Browser check: a reply whose long version has a heading, a table and a mermaid block shows them formatted in the Work view; its bubble is unchanged plain text; Done-means 2 still passes.
27. (all) `npx tsc --noEmit` exits 0, `npm run build` succeeds, and `npm test` shows 0 failures against a baseline the first ticket records before any change.

## Robustness

- Data model: items are plain files in the vault, identified by their path relative to the vault root; the marker line in the reply holds that path. The recent-items record holds one line per item per finished reply: time, vault path, chat id, message id, title. A record entry is identified by vault path plus message id; the list shows one entry per path.
- Backups and restore: markdown, HTML and images are in the vault's git (hourly checkpoints) and in the nightly 04:15 rclone sync to Drive (`sam-backup.sh`). Videos are in neither, by Must 29; they are copied nightly to the Storage drive's `Vault raw media/` (Must 31, Done-means 22). That is one local second copy, not off-site. The recent-items record is not backed up; losing it only empties the recent list. Restore is proven by Done-means 21 and by opening a restored file in the panel.
- Rollback: revert the build's commits in SAM_ui and restart `sam-ui.service` (Colin's word), and remove the work-area rule from CLAUDE.md so SAM stops writing markers. The speech change (Must 4, 5) ships as its own ticket and is kept on a rollback, so markers left in old chats are still never spoken. Item files stay in the vault untouched.
- Failures and timeouts: there is no outside call; everything reads local files. A load that fails or passes 15 seconds shows "could not load" with a retry that the user presses, never an automatic retry loop (Must 19). A diagram that fails to draw shows its source (Must 12). A missing file shows "not available" or "moved or deleted" (Must 7, 9). Video playback errors are shown by the browser's own player.
- Monitoring and alerts: the work area runs only while Colin is looking at it, so a failure shows on his screen. Refused file requests go to `~/.sam/audit.log` (Must 23). Server errors go to the `sam-ui` journal. No new push alert.
- Auth and secrets: only a session holding Colin's `sam-session` cookie, issued after passkey login (Policy B), can read any item. The route is read-only and serves only allowed types from inside the vault (Must 21 to 24). No keys or secrets are used, stored or added. SAM-made pages run with no same-origin access and no session cookie (Must 16, 17).
- Expected load: one user. Now a few items a day and a few dozen opens; in a year a few thousand item files and the same handful of opens a day. Text items are capped at 2 MB; one video stream at a time, up to a few hundred MB. No scaling work needed.

## Open questions

None open. Colin's answers, 2026-10-12 ~8:10 PM:

1. Work area size: DECIDED: it can go full screen on any device (Must 33). The normal panel sizes stay as today.
2. Recent list: DECIDED: all chats, each labelled with its chat (Must 9).
3. Scripts in SAM-made pages: DECIDED: yes, inside the locked-off frame (Must 16).
4. Video backup: DECIDED: copy to the Storage drive (Must 31).
5. Images in git: DECIDED: keep them in git (no change).
6. PDFs: DECIDED: show in the panel (Must 32).
7. Links to vault notes: DECIDED: open in the work area under the same checks (Must 34).
8. Projects with only a note: DECIDED: a new folder named after the note, beside it (Must 28).
9. Long version formatted: DECIDED: yes (Must 35).
