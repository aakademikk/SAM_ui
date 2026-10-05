Status: DRAFT 2026-10-05 (awaiting Colin's "lock it")

# SAM_ui: usage-limits tile + phone Generals pyramid

Two small builds, one spec, one build after floor-fixes lands.
Grilled 2026-10-04/05: daily note 2026-10-04 Session 19 (00:15, 00:26, 00:30) and 2026-10-05 (01:00).
Mockup: `job_samui-pyramid-mock_20261004-232600`, worktree `/home/col/SAM_ui-pyramid-mock` (throwaway), shots in its `implementation/mock-shots/`.

## 1. Goal

Colin can see at a glance how much of each seat's 5-hour and weekly Claude limit is used, and gets a phone ping before he hits a wall.
On the phone, the five Generals are big enough to read: two rows under SAM instead of one tiny row.

## 2. Must do

Usage tile

U1. The dashboard has a "Usage limits" tile showing, for each seat (main and max2): the 5-hour window %, the weekly %, when each resets, and how old the reading is ("read 14 min ago").
U2. A reading whose window has already reset shows "reset, not checked since <time>" in place of the old %. It never shows a stale % as if current.
U3. The tile only shows what runs have already reported. It never starts a Claude run, or any other probe, to get a fresh reading.
U4. When a seat's 5-hour reading reaches 80% or more, Colin gets a phone ping naming the seat, the %, and the reset time.
U5. When a seat's weekly reading reaches 80% or more, Colin gets a phone ping naming the seat, the %, and the reset time.
U6. The 5-hour reset time is recorded with every reading (today only the weekly reset is stored), so U1, U2 and U4 can show it.
U7. The tile works on phone and desktop, follows the existing widget look, and passes the UX gate rules the other widgets pass.

Phone pyramid

P1. On the phone floor, the Generals sit in two rows under SAM: Cerberus and Prometheus on the top (back) row; Hermes, Hephaestus and Calliope on the bottom (front) row.
P2. The Generals use the full width (variant B: today's column spacing). SAM takes the height left, and may be smaller than today, down to 0.6 of normal size.
P3. No link from SAM passes through another General's platform, bust or label. Lit links stay visible end to end.
P4. Tapping anywhere on a General's platform, bust or label selects that General and no other. Tap areas of the two rows do not overlap.
P5. Zooming onto a tapped General frames that General fully, whichever row it is on.
P6. The SAM tag, the 12 numeral and every General's name and state are readable and do not overlap anything.
P7. Every platform and label stays at least 16 px inside the screen edges at 360, 390 and 412 px wide.
P8. Worker figures and job pads (from the floor-fixes build) show for Generals on both rows, not hidden under the other row or under the Ask SAM bar.
P9. Short phone screens (hero 390x371) still show both rows and SAM without overlap.
P10. The pyramid is the phone layout, not a switch left in the code. The mockup's variant flag and "MOCKUP" shortcuts are not carried over.

## 3. Won't do

- No change to the desktop or laptop floor. Not one pixel.
- No probing the Claude API, no scraping claude.ai, no "check now" button (U3).
- No Fable-only figure: the rate-limit data has no separate Fable window, so the tile does not invent one.
- No usage history chart, cost-in-pounds figure, or per-model breakdown on the tile.
- No alerts for anything other than the two 80% thresholds. No alerts by email or Slack.
- No change to which Generals exist, their names, art, or order on desktop.
- No change to SAM's ring, clock or worker pads beyond the size change P2 allows.
- No deploy without Colin's go.

## 4. Constraints and locked decisions

- Floor layout is LOCKED as the hybrid: C base, D layout with SAM at the top, A's pulsing links, emerald ([[SAM_ui Visual Upgrade]], 2026-09-30).
- Phone floor spends spare height on SAM (`samMax` 2.5, Colin 2026-10-03, daily note 2026-10-03). P2 relaxes the lower bound only: SAM may shrink to 0.6 (Colin 2026-10-05 00:26: "SAM a little smaller is fine").
- Row order is Colin's call (2026-10-05 01:00): variant B with Cerberus and Prometheus on top. The mockup shots show the old order (Hermes and Hephaestus on top); the order in P1 wins.
- Phone only (Colin 2026-10-05 00:26).
- Usage readings: no probe; show each reading's age; a reading past its reset shows "reset, not checked since"; ping at 80% of the 5-hour window and 80% of the weekly; a dashboard tile (Colin, grill answers 2026-10-05 00:15 and 00:30).
- Queued behind the floor-fixes build (`build/floor-fixes`) and the tidy-fixes deploy (done, `2e60de6`). This build starts from production after floor-fixes is merged, because P8 depends on its worker figures.
- Data source: `~/bin/sam-quota-log.py` already harvests `rate_limit_event` from finished `claude -p` stream-json runs into `~/.sam/quota/runs.jsonl` (fields `seat`, `endedAt`, `fiveHour`, `sevenDay`, `sevenDayResetsAt`), hourly via `sam-quota-log.timer`.
- Known gap in that source: terminal Claude Code sessions (like SAM's chat with Colin) do not write to the job store, so their usage only shows up in the next reading from a SAM_ui chat or fleet job. U1's reading age is what keeps this honest.
- Phone pings go through the existing push path (`sam-push` / SAM_ui notifications), the same one job pings use.
- UX gate rules apply ([[UX_Design_Standards]]).
- Mockup risks to design out (job report): links crossing between top-row platforms (P3); overlapping tap areas (P4); SAM tag about 20 px above a top-row bust (P6); outer bottom-row platforms about 14 px from the edge in B (P7); only the top row reserving room for worker pads (P8); SAM dropping to 0.6 on a short hero (P9).

## 5. Done means

1. (U1) Browser check at 412x915 and 1440x900: the tile shows main and max2, both %, both reset times, and a reading age. Screenshot.
2. (U2) A test feeds a reading whose reset time has passed: the tile shows "reset, not checked since <time>" and no %. Fails on today's code.
3. (U3) Code review plus a test: with the tile open for 10 minutes, no new Claude run appears in `~/.sam/jobs` and no outbound call is made to Anthropic.
4. (U4) A test feeds a 5-hour reading of 0.80: exactly one push is sent naming the seat, % and reset. A reading of 0.79 sends none.
5. (U5) The same as check 4 for the weekly reading.
6. (U6) After one real stream-json run, the newest `runs.jsonl` row carries a 5-hour reset time that matches the run's `rate_limit_event`.
7. (U7) The UX gate passes on the build, at phone and desktop sizes.
8. (P1) Screenshot at 412x915: Cerberus and Prometheus on the top row; Hermes, Hephaestus, Calliope below.
9. (P2) Measured at 412x915: each General's bust is at least as tall as in the variant-B mockup shot; SAM's scale is between 0.6 and 2.5.
10. (P3) A geometry test: no SAM link's path crosses another General's platform, bust or label box, at 360, 390 and 412 wide.
11. (P4) A hit test over a grid of points on each General's platform, bust and label returns that General, at 360, 390 and 412 wide.
12. (P5) For each of the five Generals, the zoomed view contains its whole platform, bust and label. Screenshots.
13. (P6) A geometry test: the SAM tag, the 12 numeral and all name/state labels have no overlapping boxes.
14. (P7) A geometry test: every platform and label box is at least 16 px inside the edges at 360, 390 and 412 wide.
15. (P8) With demo jobs running on one General per row: worker figures and pads are visible for both, none under the other row or the Ask SAM bar. Screenshot at 412x915.
16. (P9) Screenshot at a 390x371 hero: both rows and SAM visible, no overlaps (checks 10, 13 and 14 also run at this size).
17. (P10) `grep` for `PYRAMID_VARIANT` and `MOCKUP` in `src/` returns nothing; phone tests assert the new sizes.
18. (Won't do: desktop) The desktop scene hash (layout, every General's zoom, both motion modes, hit-test grid) at six desktop and laptop sizes is identical to production before the build, as the mockup proved.
19. Full gates: typecheck 0 errors, lint 0 errors, `npm test` all pass, `next build` clean.
20. (P1 to P9, U1) Colin confirms on his phone after deploy: Generals readable, taps land, tile reads right.

## 6. Open questions

OPEN 1: How often may a ping repeat? SAM suggests once per seat per window: one 5-hour ping until that window resets, one weekly ping until the week resets.
OPEN 2: How fast must the ping arrive? Readings are harvested hourly today, so a ping could land up to an hour after 80% is crossed, which is a fifth of a 5-hour window. SAM suggests harvesting when each job ends, so the ping lands within a few minutes.
