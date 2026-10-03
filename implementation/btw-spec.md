# SAM_ui: side messages during a running turn ("/btw")

Status: DRAFT (awaiting Colin's "lock it")
Grilled: 2026-10-03, recorded in the vault daily note `01 - Daily Notes/10 - October 2026/2026-10-03.md` ("/grill-me: SAM_ui /btw") and in Active Priorities.

## 1. Goal

Colin can tell SAM something while SAM is still working, without stopping the turn.
SAM picks it up at its next step and uses it in the same answer.

## 2. Must do

1. On a Max or Max 2 chat, the send box stays live while a turn is running.
2. Sending while a turn runs delivers a side message into that turn. It does not stop, restart or replace the turn.
3. SAM sees the side message at its next step in the same turn (when the current tool call finishes) and can act on it in that turn's answer.
4. A side message shows in the chat where it was sent, in a pale amber box: the colours of the "Tap to enable mic" button (`bg-amber-900/30`, `border-amber-500/30`, `text-amber-400`, `src/components/voice/VoiceRecordButton.tsx`). Normal messages keep their current look.
5. After a reload, or on another device, the side message is still in the same place and still amber.
6. If the running turn can no longer take side messages (for example sam-ui restarted mid-turn), a side message sent then shows as failed, with its text kept on screen. The turn itself carries on and finishes.
7. A side message that arrives as the turn is finishing is answered straight after it, in the same chat, without Colin resending it.
8. On Fast, Pro and Gemini chats nothing changes: the send box is disabled while a turn runs, as today.
9. Starting a turn is no slower than today.
10. Every turn's process ends once its answer is complete. None is left waiting for more side messages.
11. A second normal turn on a chat with a turn running is still refused (409), as today.
12. Side messages from more than one device into the same running turn all go in, in the order the server receives them. (Colin, 2026-10-03.)
13. A hands-free or wake-word message spoken while a turn runs on the chat on screen is a side message, exactly like a typed one. (Colin, 2026-10-03.)

## 3. Won't do

- Side messages on the DeepSeek (Fast, Pro) or Gemini tiers.
- Interrupting a tool call part-way. A side message waits for the current step to finish.
- Side messages from the Dashboard chat widget. Chat page only in this version.
- Editing, retracting or resending a side message from the chat history.
- Side messages into headless fleet jobs (`sam-dispatch` / `sam-job`).
- Any change to the Stop button, handoff, archive or delete.

## 4. Constraints and locked decisions

- Multi-chat spec (`implementation/multi-chat-spec.md`, LOCKED 2026-09-30) still holds in full. In particular: the per-chat 409 lock (a side message is input to the running turn, not a second turn); a chat always resumes on its own account; the tier is fixed per chat; chat stays behind step-up auth, which applies to side messages too.
- Claude tiers only: Max and Max 2 (`src/lib/server/chat/tiers.ts`; Colin, grill 2026-10-03).
- Failed, not queued, when the channel is down (Colin, grill 2026-10-03).
- Chat turns run in their own `systemd-run --scope` so a sam-ui restart does not kill them (`src/lib/server/jobs/manager.ts`). That must stay true.
- Chat turns today run with stdin closed, because an open stdin pipe the CLI never hears from cost ~2.9 s a turn (`manager.ts` `createArgs`). Measured 2026-10-03, Haiku, 3 runs each: streaming the prompt in (`--input-format stream-json`) gave first text after 2.1 to 3.6 s, against 4.1 to 4.3 s today. Must-do 9 holds this.
- Proven on CLI 2.1.280 (2026-10-03, `/tmp/btw-probe.py`): a message written to a running `claude -p --input-format stream-json` turn 8 s into a 25 s tool call reached that same turn's answer. Closing the input mid-turn did not kill the turn. A message that arrived after the turn's last step was answered as a second result from the same process.
- Tests that make a real paid model call are opt-in behind an environment flag, never part of a plain `npm test` (precedent: `dispatchPing.test.ts`, `SAM_LIVE_DISPATCH_PING=1`, 2026-10-03).
- No change without enforcement (CLAUDE.md): every must-do has a check, and each fix has a check that fails before it.
- Never run `next dev` in `/home/col/SAM_ui` while `sam-ui.service` is up. Deploy only with `./deploy.sh`, and only on Colin's go; a deploy kills the in-flight chat turn's stream.

## 5. Done means

1. (1, 8) Automated test: while a turn runs, the send box is enabled on a Max and a Max 2 chat and disabled on Fast, Pro and Gemini chats.
2. (2, 3) Opt-in live test (Haiku, behind an env flag): a side message holding a codeword, sent while a 25 s tool call runs, appears in that same turn's answer, and the turn is not restarted (one turn, one job id).
3. (2, 3) Automated test with a stand-in CLI: a side message sent to a running turn is written to that turn's input, once, unchanged.
4. (4) Browser check at 390x844 and 1440x900: a side message shows in amber with the mic button's colours; a normal message does not.
5. (5) Automated test: a chat history rebuilt from the server places the side message between the parts of the turn it was sent into, marked as a side message; a browser check on a second profile shows it amber in the same place.
6. (6) Automated test: with the turn's input channel gone (stand-in for a sam-ui restart), a side message is reported failed, its text is kept, and the turn still finishes with its answer.
7. (7) Automated test with a stand-in CLI: a side message arriving after the turn's last step gets its own answer straight after, in the same chat.
8. (9) Measurement: median time to first text over 3 runs on Haiku is no worse than today's median on the same machine.
9. (10) Automated test: after a turn with and without side messages, no process from that turn is still running; `~/.sam/orphan-scope-check.sh` reports nothing for it.
10. (11) Automated test: a second normal turn on a chat with a running turn still gets 409.
11. (all) `npm run typecheck`, `npm run lint` and `npm test` pass; the new tests run in `npm test` (the live one only behind its flag).
12. (12) Automated test with a stand-in CLI: side messages from two devices into one running turn reach its input in the order the server received them, none lost or doubled.
13. (13) Automated test: a hands-free message arriving while a Max turn runs is sent as a side message (amber, into the running turn), not refused and not started as a new turn.
14. (all) Colin confirms on his phone and laptop: a side message sent mid-turn changes what SAM does in that turn, and it shows in amber.

## 6. Open questions

- RESOLVED 2026-10-03 (Colin): two devices at once, in the order they arrive (must-do 12).
- RESOLVED 2026-10-03 (Colin): a hands-free message during a turn is a side message (must-do 13).
- OPEN: build branch. SAM's advice: a new branch `build/btw` cut from production (`claude/sam-core-dashboard-sf3639`, `520ae3e` on 2026-10-03), in its own worktree `/home/col/SAM_ui-btw`, so the live checkout is never edited mid-build. Awaiting Colin's ok.
