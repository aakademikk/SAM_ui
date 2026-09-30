# SAM_ui: multiple chats and a notifications section

Status: LOCKED 2026-09-30
Grilled: 2026-09-30, checkpoint in vault note `02 - Atwood Systems/00_SAM_Control/SAM_ui_Dashboard.md` (rows "Multiple chats (asked 2026-09-27...)" and "Multiple chats: grill 2026-09-30").

## 1. Goal

Colin can run several separate SAM conversations in the app, on phone and PC, and move between them without losing any.
Every ping opens the thing it is about: its chat, its job output, or a notifications list, never a blank page.

## 2. Must do

Chats
1. The chat page has a chat list: a drawer on the phone, a sidebar on desktop.
2. Each entry shows its title, its tier, when it was last active, and whether a turn is running.
2a. Titles: after a chat's first reply, Haiku writes a short title (about 3 to 6 words, e.g. "Kitchen v3 B4 status"). Until then, or if that fails, the title is the first message cut short. Imported chats (14a) get Haiku titles the same way. (Colin, 2026-09-30.)
3. New starts a fresh chat and adds it to the list. It never clears, deletes or overwrites any other chat.
4. Opening a chat from the list shows its full history, loaded from the server.
5. Phone and PC show the same list and the same history for each chat.
6. A chat with a running turn keeps running when Colin switches to another chat. Coming back shows its progress or its finished answer.
7. Switching away from a chat stops that chat's speech at once.
7a. When a chat that is not on screen finishes a turn, Colin gets a ping that opens that chat. No ping when it is the chat on screen. (Colin, 2026-09-30.)
8. The wake word and the hands-free loop always send to the chat on screen.
9. A chat's tier is fixed by its first message. After that the tier control cannot change it. Moving to another tier means a handoff into a new chat.
9a. A search box filters the list by title, in both the main list and Archived. Titles only, not message text. (Colin, 2026-09-30: "title search only, see how we go".)
9b. Handoff button on each chat: Colin picks a tier (the same tier is allowed, for a fresh context). SAM, in the old chat, writes a handoff memo to the vault's `06 - Handoffs/` naming the next action and open decisions; then a new chat opens on the picked tier with that memo as its first message. The old chat stays in the list, marked as handed off, with a link to the new one. Disabled while a turn is running. (Colin, 2026-09-30: button.)
10. Archive: a chat can be archived. It leaves the main list and stays viewable in an Archived view, from which it can be restored.
11. Delete: a chat can be deleted after a confirm step. It leaves every list in the app for good; its transcript stays on the server untouched, so SAM can recover it on request. (Colin, 2026-09-30: app only.)
12. A chat with a running turn cannot be archived or deleted until the turn ends.
13. The link `/chat?c=<id>` opens that chat on any signed-in device.
14. The chat currently stored on each device when this ships appears in the list and keeps its history.
14a. Every chat already in the registry (178 on 2026-09-30) whose transcript still exists is imported into Archived, with its title and history, and can be restored. Tier is shown where it can be told, else "unknown"; an unknown-tier chat resumes on the account that holds its transcript. (Colin, 2026-09-30.)

Pings and notifications
15. A ping raised by a chat turn opens that chat.
16. A ping from a headless job that was dispatched from a chat opens that chat.
17. There is a Notifications section in the app's navigation. It lists every ping, newest first, with title, body and time.
18. Tapping an entry opens its chat if it has one, else its job output if it has one, else the entry itself.
19. A ping with no chat behind it (for example the 20:25 delegation check) opens the Notifications section on that entry.
20. The job output page shows the output of jobs started with `sam-job` (plain text), which it shows as blank today.

## 3. Won't do

- Desk Claude Code sessions in the list. Colin runs everything through the app (verified 2026-09-30: this session is in `~/.sam/samui-sessions.json`).
- Roleplay (`/practice`) sessions in the chat list.
- Renaming chats, folders, pinning, sharing.
- Full-text search inside chats (Colin, 2026-09-30: title search first, see how it goes).
- Moving an existing chat to another tier.
- Unread counts, badges, per-chat notification settings, deleting notifications.
- Two turns at once in the SAME chat (the per-chat lock stays).
- Any change to how push delivery itself works (sam-push, the service worker, subscriptions), beyond what a ping's link points at.

## 4. Constraints and locked decisions

- The per-session lock stays: a second turn on the same chat is refused with 409 (`src/app/api/chat/agent/route.ts`). Source: race fix, `SAM_ui_Dashboard.md` (terminal-session bug, the registry "ownership layer").
- Only chats the app created are resumable (`src/lib/server/chat/samuiSessions.ts` registry, cap 500). Unknown ids are never resumed.
- Chat stays behind step-up auth (`SAM_ui_Dashboard.md`, Auth row; `SAM_ui_Passkey_Policy.md`).
- Tier locked per chat, handoff to change: Colin, grill 2026-09-30.
- Max and Max2 chats live on different accounts (`~/.claude`, `~/.claude-max2`); a chat must always resume on the account it started on (`src/lib/server/chat/tiers.ts`).
- Ping wording: every `sam-job --notify` names the task via `--summary` (`Fleet_Job_Dispatch.md`, Colin 2026-09-23).
- No change without enforcement (CLAUDE.md, 2026-09-30): every must-do below has an automated check where one is possible, and each fix has a check that fails before it.
- Never run `next dev` in `/home/col/SAM_ui` while `sam-ui.service` is up (`SAM_ui_Dashboard.md`).
- Build uses `npx npm@10 install`, then `./deploy.sh` (`SAM_ui_Dashboard.md`, audit row).
- No push, merge or deploy without Colin's go.
- Business and personal stay separate: chat titles and notification text stay in SAM_ui's own store and are never written into the vault's `02 - Atwood Systems/`.

## 5. Done means

1. (1, 2) Browser check at 390x844 and 1440x900: the list is a drawer on the phone and a sidebar on desktop, and each entry shows its title, tier, last active time and running state.
1a. (2a) Automated test: a new chat gets a Haiku title of 8 words or fewer after its first reply; with the title call forced to fail, the entry keeps the cut-short first message.
2. (3, 14) Automated test: with a chat holding history, pressing New leaves that chat and its full history intact and listed. Must FAIL on the current code (New wipes it) and PASS after.
3. (4, 5) Automated test: a chat created on one browser profile lists and loads with identical history on a second profile.
4. (6) Automated test: two chats run turns at the same time; both complete with their own answers and no 409.
5. (6) Browser check: switch away from a running chat and back; the finished answer is there.
5a. (7a) Automated test: a turn finishing in a chat that is not on screen sends one ping linked to that chat; a turn finishing in the on-screen chat sends none.
6. (7, 8) Browser check with speech on: switching away stops audio within 0.5 s; a hands-free message goes to the chat on screen.
7. (9) Automated test: after a chat's first message, a turn sent to it with a different tier is refused, and the tier control is disabled in the UI.
7a. (9a) Automated test: typing part of a title shows only chats whose titles contain it, in the main list and in Archived; a word that appears only inside a message matches nothing.
7b. (9b) Automated test: pressing Handoff with tier Max2 on a finished chat writes one new file in `06 - Handoffs/`, opens a new chat on Max2 whose first message references that file, and marks the old chat with a link to the new one; the button is refused while a turn runs.
8. (10, 11, 12) Automated tests: archive hides and restore returns a chat; delete removes it from all lists and its transcript file still exists on disk afterwards; archive and delete are refused while a turn runs.
9. (13) Browser check: `/chat?c=<id>` opens that chat on a fresh profile after sign-in.
10a. (14a) Automated test: after import, every registry id with a transcript on disk is in Archived, none is in the main list except each device's current chat, and a restored one resumes.
10. (14) Browser check: a profile holding a pre-upgrade chat in localStorage shows it in the list with its history after the upgrade.
11. (15, 16) Automated test: a job dispatched from inside chat X (through `sam-dispatch`) ends with a ping whose link is `/chat?c=X`.
12. (17, 18, 19) Automated test plus browser check: a ping with no chat is listed in Notifications and its link opens the Notifications entry; entries with a chat or job open those.
13. (20) Automated test: the job page for a finished `sam-job` job shows its plain-text output. Must FAIL on the current code and PASS after.
14. (all) `npm run typecheck`, `npm run lint` and `npm test` pass; the new tests run in `npm test`.
15. (all) Colin confirms on his phone and PC: two chats side by side, a ping opens the right place, and nothing he had is lost.

## 6. Open questions

- RESOLVED 2026-09-30 (SAM, from git): build on a new branch `build/multi-chat` cut from `claude/sam-core-dashboard-sf3639` at `1e0e7cc`, which is `main` (`7922771`) plus 6 auto-checkpoints and is what production is built from.
