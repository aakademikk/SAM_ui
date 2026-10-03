# SAM_ui: UX fixes, job summary and revoke fix

Grilled: 2026-10-03, SAM with Colin, against the findings in `02 - Atwood Systems/00_SAM_Control/SAM_ui_UX_Audit_2026-10-03.md` and the bar in `02 - Atwood Systems/30_Playbooks/UX_Design_Standards.md` §6. Colin's answers to the open points are recorded in that session and carried into this spec as locked decisions (§4).

## 1. Goal

SAM_ui passes the accessibility and mobile-ergonomics floor its own audit just failed — contrast, tap targets, labels, zoom, text size and page structure — on every page, logged in and out. Clicking a job tells Colin something true (its name, General, tier, stage and a live "last thing it did"), instead of three "unknown"s and a wrong stage count. The phone nav stops being nine icons of which four are jargon, and the boot screen stops hiding the dashboard underneath it. And a revoked passkey logs that device out immediately, not up to 30 days later.

## 2. Must do

**Job summary and stage events (Colin, 2026-10-03)**

1. Clicking a job — on the Dashboard floor's Job detail module, the phone's job-in-flight panel, or anywhere else job detail is already shown — displays: the brief's title; General; model tier; elapsed time while running, or finished time and duration once ended; "Stage n of m"; and a "Last:" line naming the worker's most recent action and its age (e.g. "Last: Run the acceptance suite against the bad fixture · 2 min ago"). No AI-written summary. No per-job progress bar or percentage beyond "Stage n of m".
2. The brief's title, General and model tier are written into the job's own `meta.json` directly at dispatch time (by `sam-dispatch`/`sam-job`), not resolved afterwards by pattern-matching the command string against the `fleet:<persona> (<model>) — <brief>` convention. A job launched through `sam-dispatch`'s General/Stages convention resolves its name and tier correctly; jobs launched through the older `fleet:` convention keep working as they do today. This fixes today's "unknown" name and tier.
3. Cost keeps resolving exactly as it does today (`costFleetJob`, keyed by job id, shared with `/api/fleet/spend` and `/api/fleet/jobs`) — this spec does not touch it. A job still running legitimately shows "unknown" cost until it has a result event; that is correct, not the bug the audit found.
4. Every brief dispatched through `sam-dispatch` gets a standard instruction appended to its text (by `sam-dispatch`, so it survives regardless of which model or tool runs the brief) telling the worker to call `sam-stage start <stage>` / `sam-stage done <stage>` as it moves through its planned stages. This fixes jobs sitting at "Stage 0 of n" long after real work has started (the audit's example: 16 tickets in, still 0/2).
5. A new `PostToolUse` hook, active only when `SAM_JOB_EVENTS` or `SAM_JOB_DIR` is set in the process environment (i.e. only inside a job's own worker run — never in Colin's interactive sessions, which never set either variable), appends one line to that job's `events.jsonl`: `{"type":"action","at":<timestamp>,"description":<string>}`. The description is the worker's own one-line `description` that every Bash call already carries (e.g. "Run the acceptance suite against the bad fixture"); for Edit/Write it is "Edited <file path>" / "Wrote <file path>"; for Read/Glob/Grep, "Read <file path>" / "Searched files". **The raw command text is never written** (SAM, 2026-10-03, correcting the first draft to the design Colin was shown and agreed: he was shown the description, not the command). The hook adds no model call of its own, and caps the description at 120 characters.
6. The "Last:" line shows the most recent `action` event's description and its age. With no `action` event yet for that job, the line is omitted — never shown as "Last: unknown".

**Phone tab bar (Colin, 2026-10-03)**

7. The phone bottom tab bar shows four items: Dash, Chat, Pings, Status.
8. A fifth "More" item opens a menu listing Terminal, Roleplay, Fleet, Operations, Settings — each by its plain name (the Sidebar's own labels: no RP, Ops, Prefs or Term).
9. The More menu reuses the existing phone bottom-sheet mechanism (`BottomSheet`/`GeneralDetailSheet`'s shell: scrim, slide-up, swipe-down-to-close, tap-outside-to-close, instant under reduced motion) rather than a new UI pattern.
10. Every tab bar item, including "More", is at least 44×44px (UX_Design_Standards A3).

**Boot screen (Colin, 2026-10-03)**

11. The boot screen keeps running on cold start only, as today (once per browser session, via `sessionStorage`).
12. A visible "tap to skip" label (or equivalent wording) is shown on screen during the boot sequence, so the existing any-tap/any-key skip is discoverable rather than hidden knowledge.
13. Under `prefers-reduced-motion: reduce`, the boot screen skips in full — straight to the dashboard, not a shortened 2.6-second playthrough.
14. The boot readout (the "CORE SYSTEMS / VAULT GRAPH / TELEMETRY / PROJECTS / TASK QUEUE / UPLINK" status list and progress line) never stays drawn over the dashboard once the boot screen has finished — on the phone dashboard specifically (where the audit caught it sitting over the Generals' names and states seven seconds after load) and everywhere else the same overlay runs.

**Particles and legibility (Colin, 2026-10-03)**

15. The particle background keeps running on every page, unchanged in principle.
16. Anything carrying text — any card, panel, label, button, bar or widget, on every page — sits on a solid dark panel so particles are visible around it but never show through the text, and text contrast stays at or above the §6A floor (A1: 4.5:1 body, 3:1 large text) with the particles running behind it.
17. The Chat page's "SAM" / "IS EVERYWHERE" tagline gets the same solid backing as every other piece of text (today 1.2–1.9:1 against the particles; needs ≥4.5:1).

**Revoke (Colin, 2026-10-03 — security finding from the audit's login test)**

18. Every session check (`verifySession` and `verifyStepUp`, `src/lib/server/auth/session.ts`) confirms the session's credential (the JWT's `sub`) is still present in the credential store (`getCredentialStore()`), in addition to the existing signature and expiry checks. A credential removed from the store — Settings → Revoke already calls through to `CredentialStore.remove` — fails every session check from that point on.
19. This applies identically to the long-lived `sam-session` cookie and the short-lived `sam-stepup` cookie: both are rejected once their credential is gone, not just new logins.

**Standard fixes (no decision needed — UX_Design_Standards §6A, Colin's "cheap wins" list)**

20. Every text input (Chat composer, Fleet brief box, Terminal command line, both Settings `<select>`s, and any other input/select/textarea in the app) renders at ≥16px font-size, so iOS never zooms the page on focus.
21. Every input and select gets a real, visible, programmatically-associated label, never a placeholder standing in for one — named explicitly: the Chat composer, the Fleet brief box, the Terminal command line, both Settings dropdowns (voice pickers), and the unnamed Chat button the audit's axe scan flagged.
22. Every interactive control is at least 44×44px, named explicitly: the dashboard widget refresh/options icons, the console settings icon, the model tier pill, the Settings sarcasm buttons, Status "Refresh", the Operations "Fleet" link, Terminal's "kill" button, the chat-list handoff links, and Settings' "Revoke" buttons (in addition to the tab bar, Must 10).
23. No text anywhere renders below 12px, named explicitly: the phone nav labels, Status/Fleet/Operations metadata, Notifications timestamps, the laptop sidebar captions ("Core Dashboard" / "Atwood Systems"), the boot screen's labels and footer, and the chat search box.
24. Pinch-to-zoom is restored everywhere: `userScalable`/`maximumScale` are removed from `src/app/layout.tsx`'s `viewport` export.
25. The Chat page gets a single H1 and a `header` landmark, matching every other page.
26. The document language is `lang="en-GB"` (`src/app/layout.tsx`), not `en`.
27. General names on the laptop floor cards are never truncated — "Hermes", "Hephaestus", "Calliope", "Cerberus" and "Prometheus" show in full.
28. "Tap to enable mic" (`VoiceRecordButton.tsx`) reads "Click to enable mic" on a device with no touch input, keeping "Tap" on a touch device.
29. Status page and dashboard module labels meet 4.5:1 contrast against their background, including where the particle field sits behind them (the Status-page bright-blob case the audit measured at 2.69:1 is covered by Must 16).
30. Terminal's nested-interactive card (an interactive element inside another interactive element, flagged by axe) is restructured so neither reads as nested to assistive tech.

## 3. Won't do

- No redesign of any page's layout — Status, Fleet, Operations, Terminal and Settings keep their current structure. Only contrast, labels, target size, text size, zoom and the particle backing change.
- No change to `sam-dispatch`'s model/tier routing, ceiling rules or seat picking (the visual-upgrade spec's "Won't do" on this stands).
- No AI-generated job summary text, and no per-job progress bar or percentage beyond "Stage n of m" (Must 1).
- No new nav structure beyond the tab bar / More split (Must 7, 8) — the desktop Sidebar is untouched.
- No change to the 30-day session lifetime or the step-up window lengths (10 min platform / 12 h cross-platform) — only the revoke check added on top (Must 18, 19).
- No speed/Lighthouse pass (UX_Design_Standards A9) — the audit itself notes every page's 3D particle canvas needs a real-phone run, not a headless one; out of scope here.
- No keyboard-navigation pass (A7) or non-text contrast pass (A2) — the audit did not measure either; not in scope here.
- No B-judged items from UX_Design_Standards §6B beyond what the measured audit (Part A) already flagged.
- No change to how jobs are dispatched, cancelled or retried from the UI (the visual-upgrade spec's "no control of jobs from the view" stands).

## 4. Constraints and locked decisions

- Job summary design — Must 1 to 6 — LOCKED by Colin, 2026-10-03, recorded in the brief for this build. Source: `SAM_ui_UX_Audit_2026-10-03.md` ("Clicking a job tells you nothing") plus Colin's session answers carried into this spec.
- Phone tab bar split — Must 7 to 10 — LOCKED by Colin, 2026-10-03. Source: audit Part B ("Nine tabs on the phone bar, four of them jargon").
- Boot screen — Must 11 to 14 — LOCKED by Colin, 2026-10-03. Source: audit A8 and Part B ("Six seconds of boot screen", "does not go away on the phone dashboard").
- Particles stay everywhere; text gets a solid backing — Must 15 to 17 — LOCKED by Colin, 2026-10-03. Source: audit A1 (tagline 1.2–1.9:1) and Part B.
- Revoke fix — Must 18, 19 — LOCKED by Colin, 2026-10-03. Source: audit "Security finding from the login test".
- Standard fixes — Must 20 to 30 — no decision needed; they are the audit's measured A-column failures (A1, A3, A4, A5, A6, A10, A14, and the `user-scalable=no` extra finding) plus the named Part-B/logged-in items. Source: `SAM_ui_UX_Audit_2026-10-03.md`.
- `sam-dispatch`, `sam-job` and `sam-stage` are live fleet tooling on both seats (`/home/col/.claude/settings.json` on the main seat, `/home/col/.claude-max2` on the other). Any change to them — the General/Stages-in-brief instruction (Must 4), the title/General/tier fields written to `meta.json` (Must 2), and the new `PostToolUse` hook (Must 5) — ships as `.next` copies installed only on Colin's go, exactly as the visual-upgrade build staged its own tool changes. Each ships with an `Enforced by:` mechanism and a test that fails before the change and passes after.
- The `PostToolUse` hook (Must 5) is added to the `hooks` block in both seats' `settings.json` (`/home/col/.claude/settings.json` and `/home/col/.claude-max2/settings.json`), matching the existing hook pattern already there (`PreToolUse`/`PostToolUse` entries with a `matcher` and a `command` script). It must be a no-op — not merely harmless, but skipped outright — whenever neither `SAM_JOB_EVENTS` nor `SAM_JOB_DIR` is set, so it never touches Colin's own interactive sessions.
- The existing `sam-dispatch` tests (`~/.sam/tests/test-dispatch-routing.sh`), the 20:25 delegation check (`~/.sam/delegation-check.sh`) and the job lifecycle ordering test (`tests/test-run-end-order.sh`) keep passing; the dispatch log format and `events.jsonl`'s existing event shapes (`dispatched`, `started`, `stage-start`, `stage-done`, `ended`) are not broken — the new `action` event type (Must 5) is additive.
- Deploy only on Colin's go, as every `./deploy.sh` or `sam-ui` restart kills his in-flight chat turn (carried over from the visual-upgrade spec). Build in a worktree, never in `/home/col/SAM_ui` directly.
- Done-means checks that claim a measured pass (§5, items 1–3, 9, 18) re-run the audit's own method: axe-core (serious/critical = 0) and the DOM probe described in `/home/col/delivery/ux-audits/sam-ui-20261003/audit-loggedin.mjs`, logged in with a throwaway passkey that is revoked immediately after the run.
- `CredentialStore.findByCredentialId` (Must 18) already exists and already does exactly the lookup the fix needs — this is a missing call, not new storage.

## 5. Done means

1. (Must 1, 2) A job dispatched through `sam-dispatch` with a title, General and tier, clicked in Job detail: shows that title (not "unknown"), the right General, the right tier, and — once it has run long enough to finish — the right elapsed/duration.
2. (Must 1, 3) The same test job's cost, once it has a result event, matches `/api/fleet/spend` and `/api/fleet/jobs` for that job id. While still running, cost reads "unknown" and that is not flagged as a defect.
3. (Must 1, 4, 6) The same test job, dispatched with two or more planned stages, shows "Stage 1 of n" within 5 seconds of its worker calling `sam-stage start`, "Stage 2 of n" within 5 seconds of the next call, and a "Last:" line that changes within 5 seconds of each tool the worker runs, with a plausible age.
4. (Must 5) A fixture run with `SAM_JOB_EVENTS` set shows the hook appending a well-formed `{"type":"action",...}` line per tool call to that job's `events.jsonl`, whose description equals the Bash call's `description` and never contains the command text (a fixture command carrying a planted fake token proves the token string is absent from `events.jsonl`); a fixture run with neither `SAM_JOB_EVENTS` nor `SAM_JOB_DIR` set (an ordinary interactive session) appends nothing.
5. (Must 7, 8, 10) At 412×915 and 390×844, the tab bar shows exactly Dash, Chat, Pings, Status and More; tapping More opens a sheet listing Terminal, Roleplay, Fleet, Operations, Settings by their plain names; every item measures ≥44×44px.
6. (Must 9) The More sheet opens with a slide-up, closes on a tap outside or a swipe down, and is instant (no slide) under `prefers-reduced-motion: reduce`.
7. (Must 11, 12) On a fresh session (cleared `sessionStorage`) at 412×915, the boot screen plays once, shows a visible skip label, and a tap during it skips straight to the dashboard.
8. (Must 13) With `prefers-reduced-motion: reduce` forced and a fresh session, the boot screen does not play at all — the dashboard is interactive within 500ms of load.
9. (Must 14) At 412×915, 10 seconds after a cold load, a DOM probe finds no boot-readout text ("CORE SYSTEMS", "VAULT GRAPH", "TELEMETRY", "PROJECTS", "TASK QUEUE", "UPLINK") anywhere in the rendered page.
10. (Must 15, 16, 17) An axe-core + contrast scan across Dashboard, Chat (including the empty-state tagline), Status, Fleet, Operations, Terminal, Settings and Notifications, logged in and out, at 390×844 and 1920×1080: 0 instances of text contrast below 4.5:1 body / 3:1 large text.
11. (Must 18, 19) Enrol a throwaway passkey, open a session (`sam-session` present), confirm `GET /api/auth/devices` returns 200. Revoke that passkey from Settings. The same cookie's next `GET /api/auth/devices` (and a parallel check with a live `sam-stepup` cookie against a step-up-gated route) returns 401, not 200 — checked immediately, not after any delay.
12. (Must 20) Chat composer, Fleet brief box, Terminal command line and both Settings selects all compute to ≥16px via `getComputedStyle`, at 390×844.
13. (Must 21) axe-core reports 0 `label`/`select-name`/`button-name` violations across every page, logged in.
14. (Must 22) Every control named in Must 22, measured via the DOM probe, is ≥44×44px at 390×844.
15. (Must 23) No text node across every page, logged in, computes to a font-size below 12px at 390×844.
16. (Must 24) The rendered `<meta name="viewport">` contains no `user-scalable=no` and no `maximum-scale=1` on any page; a manual pinch-zoom gesture on a real phone scales the page.
17. (Must 25, 26) Chat has exactly one `h1` and a `header` landmark; `document.documentElement.lang === 'en-GB'` on every page.
18. (Must 27) At 1366×680 and 1280×650, the floor cards show "Hermes", "Hephaestus", "Calliope", "Cerberus" and "Prometheus" in full, with no `…` truncation.
19. (Must 28) On a laptop (no touch, `matchMedia('(pointer: coarse)')` false) the mic control reads "Click to enable mic"; on a phone it reads "Tap to enable mic".
20. (Must 29) The axe-core contrast failures the audit measured on Status (28 on phone, 12 on laptop, `#45556c` at 2.69:1) are gone: 0 contrast violations on Status at 390×844 and 1366×680.
21. (Must 30) axe-core reports 0 `nested-interactive` violations on Terminal.
22. (Whole spec) `axe-core` reports 0 serious/critical violations across all 8 pages, logged in and out, at 390×844 — the audit's own A14 bar, now passing where it failed on 2026-10-03.
23. (Whole spec) Typecheck, lint, the full test suite and `next build` pass; every existing page still loads after deploy; `/api/health` is ok; the existing `sam-dispatch`/delegation/run-end-order tests listed in §4 still pass.
24. (Whole spec) Colin confirms on his phone and laptop: the tab bar reads right, the boot screen behaves, a real dispatch's job summary reads right including a live "Last:" line, and revoking a device on one of his own machines logs it out while he's watching.

## 6. Open questions

1. OPEN: when a device is revoked mid-session, should it get an explicit sign-out — a redirect to the login screen with a message — or is it acceptable that its background polling (several of today's fetches already swallow a failed poll and silently keep the last good state) just stops updating until the person next does something that surfaces a 401? Must 18/19 make the revoke take effect at once either way; this only decides what that device's screen shows.
2. OPEN: should an in-flight job or chat stream started from a now-revoked device be killed the moment it's revoked, or is it acceptable for it to run to completion server-side (new requests from that device fail immediately; the job itself isn't owned by any one device's session)?
3. RESOLVED (SAM, 2026-10-03): the hook writes the Bash call's own `description` and file paths, never the raw command text (Must 5), so command lines (where a secret could appear) never reach `events.jsonl`. Capped at 120 characters.
