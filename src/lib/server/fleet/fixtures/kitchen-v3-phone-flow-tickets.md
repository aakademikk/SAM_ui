# Kitchen 3D concept demo, v3 phone flow (R4): tickets

Spec: [kitchen-v3-phone-flow-spec.md](kitchen-v3-phone-flow-spec.md) (Status: LOCKED 2026-10-07, commit `c41d600`).
Baseline: `a7a165a` (R3, live on the preview). Branch `build/kitchen-v3`, worktree `/home/col/Atwood_demos/kitchen-v3-wt`.
Written 2026-10-07. 24 tickets: T1 to T22 build and prove, T23 swaps the preview, T24 is Colin's gate (not built).
Open questions: 1 to 8 are ANSWERED in the spec. Question 9 (the tier price) is OPEN and blocks outreach only, so no ticket here is blocked by it.

Contents: Rules for every ticket, Tickets T1 to T24, Coverage table (must-do to ticket, check to ticket), Decisions the tickets make where the spec is silent.

## Rules for every ticket

These apply to every worker; each ticket repeats only what is specific to it.

1. Phones only. "Phone" is `tier.phone` (`src/lib/tier.ts:11`, width under 768 at load). Every new behaviour is behind `tier.phone`. Desktop, tablets, tall windows and a 768 px touch screen must stay byte-for-byte as at `a7a165a`. After T2 exists, run it at the end of every ticket (`node scripts/t-v3-desktop-same.mjs`) and report PASS or FAIL.
2. Builds go to `~/.cache/kitchen-r4/`, never `dist/`. Set `KITCHEN_DIST=~/.cache/kitchen-r4/new-dist` (or `base-dist`) for every check. Never write to, build into, or serve `dist/`, `dist-old-*`, port 4799 or the kitchen-preview unit. Only T23 touches `dist/`. Set `TMPDIR=~/.cache/kitchen-r4/tmp` (create it) so nothing lands under `/tmp`.
3. Check script: all new phone checks are named rows in `scripts/t-v3-phone-flow.mjs` (created by T3), style of `scripts/t-v3-phone.mjs`, PASS or FAIL per row, output under `implementation/v3-build/R4/`. Run a ticket's rows with `HARNESS_BROWSER=brave KITCHEN_DIST=~/.cache/kitchen-r4/new-dist node scripts/t-v3-phone-flow.mjs --rows T<n>`. Phone profile: A16 (384 x 644, dpr 2.8125, touch, the Android UA of `scripts/t-v3-phone.mjs`) and 390 x 844 at dpr 2; add 360 x 800 where the ticket says.
4. Proof must fail on the baseline and pass after. Run the ticket's rows first against `~/.cache/kitchen-r4/base-dist` (built from `a7a165a`; see T1) and record the FAIL, then against the new build and record the PASS. Guard tickets (T1, T2) cannot fail on the baseline by design; they say how they are proven instead.
5. Config strings: every visible string stays in `src/config.ts` and `src/brand.css`; UK English, no em dashes in site copy. JS gzipped stays under 400 KB. Zero console errors.
6. Read-only on anything a ticket does not list under Files. Never read or print env files, keys or tokens.
7. Commit one commit per ticket, message `R4 T<n>: <title>`, local only, no push. The commit includes the ticket's script rows and outputs. Set the ticket's Status line to DONE in this file in the same commit (only that line).
8. If stuck, or a spec number cannot be met, stop and end the reply with exactly `BLOCKED: <reason>; unblock: <what>` (Colin 2026-10-07: blocks escalate to SAM). Do not change a locked number, weaken a threshold or skip a row to get past a block.
9. Heavy WebGL is never torn down at the moment an animation starts. The tile canvas stays alive on phones (never disposed). Keep the studio `box` and `all` mattes separate. Do not add backdrop blur to anything on phones.
10. Harness hooks other scripts rely on stay: the walk wrapper keeps `data-layer="walk"`, the picture canvas keeps the class `walk-frames`, `diag()` keeps its existing keys. If a hook must go, say so in the ticket's commit message and amend the dependent row in T22.

---

## T1: Build tooling into the cache
Status: DONE 2026-10-07 (base+new build exit 0, gz JS 380249, dist checksum unchanged, OUTDIR=dist guard exits 1)
Spec: Done means (Builds), check #1 (tooling; the full run is T22)
Depends on: none
Blocked by: none
Context: Every later check builds into `~/.cache/kitchen-r4/`. The baseline build is `a7a165a` exported with `git archive`, and the new build is the working tree. `dist/` is git-ignored and served by the preview unit, so a build into it republishes the preview. This ticket only makes the tooling; it must never run a build into `dist/`.
Files: scripts/r4-build.sh (new)
Steps:
1. Write `scripts/r4-build.sh` with modes `base`, `new` and `clean`. Set `TMPDIR` inside `~/.cache/kitchen-r4/tmp`.
2. `base`: `git archive a7a165a | tar -x -C ~/.cache/kitchen-r4/base`, symlink the repo's `node_modules` into it, then `npx vite build --outDir ~/.cache/kitchen-r4/base-dist --emptyOutDir` run from that directory. Skip if `base-dist/index.html` already exists.
3. `new`: `npx tsc --noEmit -p .` then `npx vite build --outDir ~/.cache/kitchen-r4/new-dist --emptyOutDir` from the repo root; print the gzipped JS total (`gzip -c ~/.cache/kitchen-r4/new-dist/assets/*.js | wc -c`) and fail above 400000 bytes.
4. `clean`: copy the tracked tree (`git archive HEAD`) to `~/.cache/kitchen-r4/clean`, run `npm ci` there, then the `new` steps with `--outDir ~/.cache/kitchen-r4/clean-dist`. This is the "fresh npm ci" of check 1; T22 uses it.
5. Every mode records a checksum of `dist/` (sorted `find dist -type f | xargs sha256sum | sha256sum`) before and after and fails if it changed. The script never passes `dist` as an output directory; add a guard that exits 1 if any `--outDir` resolves under the repo.
6. Run `base`, `new` and the guard.
Do not touch: `dist/`, `dist-old-r2/`, `dist-old-r3/`, `vite.config.ts`, `package.json`, `src/`.
Proof: `bash scripts/r4-build.sh base && bash scripts/r4-build.sh new` exit 0 and print the gzipped JS (under 400000); `~/.cache/kitchen-r4/base-dist/index.html` and `new-dist/index.html` exist; the `dist/` checksum is identical before and after; `git status --short` shows no change under `dist/` and only the new script. Guard proof: `bash scripts/r4-build.sh` with an injected `OUTDIR=dist` environment test exits 1. (Check 1 passes on the baseline too; that is its job. What fails on `a7a165a` is that the tooling does not exist.)
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T2: Desktop-unchanged guard
Status: DONE 2026-10-07 (36 position rows + URL set PASS, 3 of 4 chained PASS, fps-r1 PASS at the 58 fps floor the baseline itself needs; mutant FAILS 3 rows)
Spec: must-do #1, check #2
Depends on: T1
Blocked by: none
Context: This is the guard that every later ticket runs. It opens the baseline build and the new build side by side with `?skipintro` and compares them at the same scroll anchors. Desktop here means everything that is not `tier.phone`: 1440 x 900, a tall 1024 x 1366 window, and 768 x 1024 with touch and a coarse pointer (`tier.coarse` is true there, which changes the hold at `src/lib/scroll.ts:270`, and 768 takes the desktop path, OQ 8). At this point the two builds are identical, so the first run passes; the guard is proven by a deliberate change.
Files: scripts/t-v3-desktop-same.mjs (new); implementation/v3-build/R1/fps-r1.mjs, scripts/t-v3-stops-scroll.mjs, scripts/t-v3-hotspots.mjs, scripts/v3-clip-diff.mjs (edit only if one does not read `KITCHEN_DIST`; they must never fall back to `dist/` when it is set)
Steps:
1. Read `scripts/harness.mjs` (`serve`, `launch`, `KITCHEN_DIST`) and `scripts/t-v3-stops-scroll.mjs` for the selectors that find each stop's element (`#craft`, `#portfolio`, `#process`, `[data-panel]`, `[data-hold]`).
2. Serve the baseline and the new build on two ports (harness falls back to any free port; do not use 4799, 4798 or 8777).
3. At each of the three sizes scroll both to the same twelve anchors, given as element anchors found by the same selector in both builds: the walk in (two anchors), each stop's pin start and end (six), between stops (one), `#studio` top, `#studio` end and the footer; that is twelve with the footer.
4. Before every screenshot apply the settle rule: no network request for 1 s, the stop clip and block build finished (`diag()` idle), hotspot pulses finished, no running CSS transition or fade, and two screenshots 200 ms apart differ in at most 0.02 per cent of pixels.
5. Compare: at most 0.1 per cent of pixels differ by more than 24 in any channel, at every position and size. Also compare the sets of URLs fetched at 1440: they must be equal.
6. Chain the existing desktop checks against the new build: `node implementation/v3-build/R1/fps-r1.mjs` at 1440 (60 fps, none over 50 ms), the desktop rows of `scripts/t-v3-stops-scroll.mjs` and `scripts/t-v3-hotspots.mjs`, and `scripts/v3-clip-diff.mjs` (desktop clips only). Report each as PASS or FAIL.
7. Prove the guard bites: build a throwaway variant (a temporary copy of the tree under `~/.cache/kitchen-r4/mutant`) into `~/.cache/kitchen-r4/mutant-dist` with a one-line desktop change (for example `.glass` padding in `src/brand.css`), run the guard against it and show it FAILS, then delete the mutant. Do not commit the mutation.
8. Write `implementation/v3-build/R4/desktop-same.txt` with every position, size and difference figure.
Do not touch: `src/`, `public/`, `dist/`, `dist-old-*`.
Proof: `HARNESS_BROWSER=brave node scripts/t-v3-desktop-same.mjs` (base-dist vs new-dist) prints PASS for all 36 position rows, the URL-set row and the four chained checks; the same command against `mutant-dist` prints FAIL. (Guard: it passes on the baseline by design; what fails is the mutant.)
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T3: Phone-flow script, flag, config and held-view maths
Status: DONE 2026-10-07 (T3 rows 0/13 on base, 13/13 on new; tsc 0; gz JS 380358; desktop guard 36/36 PASS); re-run 2026-10-08 at end cx 0.47: 13/13 PASS
Spec: must-do #1, #7 (numbers and clamp), check #6 (the clamp row)
Depends on: T2
Blocked by: none
Context: Every later ticket adds rows to one script and reads the held view from one pure function, so both exist first. The held view is walk frame 50, starting at zoom 1.30 centre (0.39, 0.56) and ending at zoom 1.20 centre (0.47, 0.58) (amended 2026-10-08 from 0.50); `frameFit` (`src/lib/frameFit.ts:70` to `:71`) clamps the crop inside the frame, which is why the start x is 0.39 and not 0.30 (at 384 x 644 a requested 0.30 is drawn at 0.385). Nothing on the page uses this yet; desktop must not change.
Files: src/config.ts (edit), src/lib/heldView.ts (new), src/lib/tier.ts (edit, add `phoneFlow` only), src/lib/diag.ts (edit, add keys), scripts/t-v3-phone-flow.mjs (new)
Steps:
1. In `src/config.ts` add a `phoneFlow` block: `heldFrame: 50`, `start: { z: 1.30, cx: 0.39, cy: 0.56 }`, `end: { z: 1.20, cx: 0.47, cy: 0.58 }` (amended 2026-10-08 from 0.50), `glideMs: 2600`, `glideMaxMs: 4500`, `fadeFallbackMs: 600`. Do not edit `config.walk.phoneView` or `config.hero.settleFrame` (tall desktop windows still use them).
2. `src/lib/tier.ts`: export `tier.phoneFlow = tier.phone` and nothing else new (tier.phone is already width under 768 at load).
3. `src/lib/heldView.ts`: `heldViewAt(t: number): View` with t clamped to 0..1, linear in zoom and centre, using the config numbers; `HELD_FRAME`. Expose both on `diag().heldView = { at: heldViewAt, start, end }` at module load so a row can call them through `page.evaluate`.
4. Create `scripts/t-v3-phone-flow.mjs`: a row runner with `--rows T<n>[,T<n>]`, named rows `T<n>.<name>`, PASS or FAIL lines, a summary exit code, A16 and 390 x 844 and 360 x 800 profiles, a request-log helper (URL, timestamp) and a screenshot helper that writes to `implementation/v3-build/R4/shots/`. Reuse `scripts/phone-jank/lib.mjs` (`A16`, `open`, `drag`, the `drawImage` counter) rather than copying it.
5. Rows `T3.*`: (a) `tier.phoneFlow` is true at 384 x 644 and 390 x 844 and false at 768 x 1024 and 1440 x 900 (read from a new `diag().phoneFlow`); (b) `heldViewAt(0)` equals zoom 1.30, centre (0.39, 0.56) and `heldViewAt(1)` equals zoom 1.20, centre (0.47, 0.58) within 0.005; (c) the DRAWN centre x, `frameFit(w, h, 1080, 1920, heldViewAt(t))` offset over full width, is strictly greater at t = 0.02 than at t = 0 for 384 x 644, 390 x 844 and 360 x 800 (the pan is real from the first swipe), and never decreases as t rises to 1.
Do not touch: `config.walk.phoneView`, `config.hero.settleFrame`, any desktop path, `dist/`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T3` against base-dist: row (a) and (b) FAIL (no flag, no function); against new-dist all `T3.*` rows PASS. `bash scripts/r4-build.sh new` exits 0, `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T4: Re-cut the glide video (1080 frames, ends on frame 50)
Status: DONE 2026-10-07 (T4 rows 0/1 on base, 7/7 on new; 1080x1920 H.264 L4.0, N=79, 3.72 MB, last-frame diff 1.74, first 1.49; R3 port.json untouched; CRF 19 with CRF 14 zones on first and held frames)
Spec: must-do #3, #8 (video re-encoded from the 1080 frames), #20 (size), check #4 (the frame count N), check #18 (video size in the report)
Depends on: T3
Blocked by: none
Context: This is the ticket that re-cuts and re-encodes the glide video. The R3 video (`public/walk/glide/port.mp4`, 720 x 1280, 79 frames, ends on walk frame 93, 1.31 MB) is made by `scripts/make-glide-video.mjs`, which reads `config.hero.settleFrame.port` (93, still needed by tall desktop windows) and scales the 1080 WebP frames down to 720 x 1280. The new video must run walk frame 1 to walk frame 50 over about 2.6 s with the same sine in-out easing, at the source size 1080 x 1920, and must end exactly on the held frame. The old files stay in place until T22 so nothing breaks in between; the new ones get new names. Nothing loads the new video yet (T8 does).
Files: scripts/make-glide-video.mjs (edit), public/walk/glide/port-held.mp4 (new), public/walk/glide/port-held.json (new)
Steps:
1. Add a `--held` mode to `scripts/make-glide-video.mjs` (leave the default mode and its outputs exactly as they are). In `--held` mode: SETTLE = `config.phoneFlow.heldFrame` and MS = `config.phoneFlow.glideMs` (read from `src/config.ts` with the same regex style, key `phoneFlow`); W x H = 1080 x 1920, no resize (decode the `public/walk/port/NNNN.webp` frames straight to PNG); same 30 fps tick list, `ticks[last] = 50`; working directory `~/.cache/kitchen-r4/glide-frames` (not `~/.cache/kitchen-r3`); outputs `port-held.mp4` and `port-held.json` with an extra `view` key holding the start and end views of `config.phoneFlow`.
2. Encode H.264 at level 4.0 (1080 x 1920 is 8160 macroblocks, over the level 3.1 limit the R3 script used), main profile, yuv420p, bt709, `+faststart`, no audio, `-preset slow`. Choose the CRF so the file is at most 4 MB (the estimate from pixel count is 2.5 to 3 MB; spec 6 MB phone ceiling covers video plus frames 1 and 50). Replace the script's hard-coded `2e6` budget with a per-mode budget (4e6 for `--held`).
3. The video carries no zoom or pan baked in (as R3). Record in `port-held.json` the per-tick view the page must apply so the first video frame matches the dissolve's end (frame 1 at `viewAt(1)`, zoom 1.24 centre 0.33, 0.5) and the last frame matches the held start view (zoom 1.30, centre 0.39, 0.56): a straight line in zoom and centre between those two views over the ticks, written as `views: [{z, cx, cy}]`, one per tick.
4. Run `node scripts/make-glide-video.mjs --held`.
5. Add rows `T4.*` to `scripts/t-v3-phone-flow.mjs`: (a) `ffprobe -count_frames` gives 1080 x 1920, H.264, and a frame count equal to `port-held.json` `ticks.length` (record N; T8 and T9 read it from the file, never hard-code it); (b) `ticks[0]` is 1, `ticks[last]` is 50, ticks never decrease; (c) the last decoded video frame (ffmpeg) against `public/walk/port/0050.webp` has a mean absolute difference under 2 in 255; (d) the first video frame against `0001.webp` the same; (e) file size at most 4 MB, listed in `implementation/v3-build/R4/glide-video.txt` with N and the CRF.
Do not touch: `public/walk/glide/port.mp4`, `port.json` (T22 retires them), `public/walk/port/`, `config.hero.settleFrame`, the default (non `--held`) mode's output.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T4` FAILS on base-dist (files absent) and PASSES after, with the figures written to `implementation/v3-build/R4/glide-video.txt`. `node scripts/make-glide-video.mjs` (default mode) still reproduces the R3 `port.json` byte for byte (`git diff --stat public/walk/glide/port.json` empty).
If stuck: end with `BLOCKED: <reason>; unblock: <what>`. If the file cannot come in under 4 MB without visible blocking, report the CRF and size and end with `BLOCKED` naming the 6 MB ceiling.

## T5: Held frames and the held picture on phones
Status: DONE 2026-10-07 (T5 rows 2/11 on base, 11/11 on new; walk fetches only 0001+0050, 2 decodes, upscale 1.30, sharp diff 0.86%, gradient ratio 1.32 vs a7a165a frame 50; dissolve+intro PASS; guard 38 PASS 0 FAIL)
Spec: must-do #6 (no other walk frame fetched), #8, check #3, #5 (walk fetch rows), #7
Depends on: T4
Blocked by: none
Context: On phones the walk store (`src/hero/useWalk.ts`, `FrameStore` with the 720 set and its format calibration) and the scroll-scrubbed canvas (`src/hero/WalkPlayer.tsx`) are replaced by two stills: walk frame 1 (the dissolve hand-over) and walk frame 50 (the held frame), both from the 1080 x 1920 set `public/walk/port/` (`0001`, `0050`), decoded once at their own size: no `resizeWidth`, no `resizeQuality`, no 1.5 device-pixel cap. The picture is one canvas 1080 x 1920 inside a wrapper whose box is the largest viewport height anchored to the top (T6 gives it the scroll-driven transform). For this ticket the picture sits at the start view and switches from frame 1 to frame 50 when the hero's `arrived` flag is set (the real glide arrives in T8). The tile intro canvas and the dissolve are unchanged; the page must stay working on phones between tickets.
Files: src/lib/heldFrames.ts (new), src/hero/HeldView.tsx (new), src/hero/useWalk.ts (edit), src/hero/Backdrop.tsx (edit), src/hero/Hero.tsx (edit)
Steps:
1. `src/lib/heldFrames.ts`: fetch `walk/port/0001` and `walk/port/0050` (frame 50 first is not needed; frame 1 first for the dissolve), format WebP with no calibration (frames are 181 KB and 185 KB; record sizes), `createImageBitmap(blob)` with no size options, expose `frameOne` and `held` readiness, decode ms into `diag().held = { decodeMs, w, h }` (T20 logs it). No other walk file is requested on phones.
2. `src/hero/HeldView.tsx`: wrapper `div` sized `100vw` by the largest viewport height (use `lvh`, anchored `top: 0`, `position: absolute`), inside it `<canvas className="walk-frames" width=1080 height=1920>` laid out like a cover-fit canvas (`frameFit` with PLAIN at the wrapper's size), drawn once per frame change (frame 1, then frame 50), not per scroll. Keep the wrapper inside `data-layer="walk"`. Use `svh` for the page layout and never `window.innerHeight` (must-do 19).
3. `useWalk.ts`: when `tier.phoneFlow`, do not create a `FrameStore` and do not use `portPhone`; load `heldFrames` instead and report `frameOne` from it. The aspect on phones is forced to `'port'` (the held frame is portrait); record in the commit if a <768 px landscape window behaves differently from `a7a165a`.
4. `Backdrop.tsx`: on `tier.phoneFlow` mount `HeldView` instead of `WalkPlayer` and `GlideVideo`; desktop mounts exactly what it mounts today. `Hero.tsx`: on phones skip the canvas-glide and video branches (no store); `arrived` is set straight after the dissolve for now (T8 replaces this with the glide).
5. Rows `T5.*`: (a) over the dissolve and a scripted scroll to the footer at 384 x 644 and 390 x 844, the request log has no URL under `walk/port720/`, and under `walk/port/` only `0001` and `0050` (any extension); (b) after the dissolve `diag().walk.decodes` has at most 2 entries and rises by at most 2 afterwards; (c) a spy installed before load shows the `createImageBitmap` call for frame 50 has no `resizeWidth` and no `resizeQuality`; the held canvas is 1080 x 1920; `diag().view.upscale` is at most 1.35 at the start view at 384 x 644 (write `diag().view` from HeldView in the shape WalkPlayer used); (d) sharp: build `implementation/v3-build/R4/held-view-candidates/B-start-0.39.png` (frame 50, zoom 1.30, centre 0.39, 0.56, by the `frameFit` maths, 1080 x 1811, the same method as `NOTES.md`; the original `B-start.png` used centre 0.30 and the spec moved the start to 0.39 at lock), then compare a page screenshot at scroll 0 on the kitchen band only (device rows 700 to 1100) with the header, hero copy, render label, concept label, price line and "Book a design visit" masked (rectangles read from the page): at most 2 per cent of unmasked pixels differ by more than 24; the mean horizontal plus vertical gradient over the same masked band is at least 1.25 times the baseline build's screenshot at the same scroll with the same masks. Record both figures; the 1.25 threshold is proposed and not yet run, so if it fails with the picture otherwise correct, report the measured ratio and end with `BLOCKED` (do not lower it).
6. Run `node scripts/t-v2-dissolve.mjs` and `node scripts/t-v2-intro.mjs` on the A16 profile against the new build. They must pass unchanged. If one reads a walk-store field that no longer exists on phones, keep the field alive in `diag()` rather than editing the script (rule 10); only if impossible, stop with `BLOCKED`.
Do not touch: `src/hero/IntroTiles.tsx`, `src/hero/tiles.ts`, `src/hero/WalkPlayer.tsx` and `src/lib/frames.ts` (desktop still uses them), `public/walk/`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T5` FAILS on base-dist (it fetches `port720/` and 50+ frames, decodes dozens, upscales 1.86 times) and PASSES on new-dist; `scripts/t-v2-dissolve.mjs` and `scripts/t-v2-intro.mjs` PASS on the A16 profile; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T6: Hero one screen and the scroll-driven held view
Status: DONE 2026-10-08 (T6 rows 11/32 on base, 32/32 on new; tsc 0; gz JS 381674; guard positions 36 + URL set + hotspots 55 PASS); re-run 2026-10-08 at end cx 0.47: 32/32 PASS
Spec: must-do #6 (hero one screen, copy fade), #7, #19 (picture, svh), check #5 (hero height), #6, #17 (picture row)
Depends on: T5
Blocked by: none
Context: With no walk on phones there is no walk-in track: the hero is one screen (`#hero` 100 svh, today `screens * 100` svh at `src/hero/Hero.tsx:160` with `WALK_SCREENS = 4`) and the scroll marks that drive the walk are dead on phones. The held picture moves only by a CSS transform (zoom, then pan), from the start view when the glide ends to the end view by the time `#studio` reaches the top of the screen, then stays there. It is monotonic and reversible. While scrolling it does no decoding and no canvas redraw. Position maths use `svh` and the page's own element positions, never `window.innerHeight`.
Files: src/hero/Hero.tsx (edit), src/lib/scroll.ts (edit), src/hero/HeldView.tsx (edit), src/lib/heldView.ts (edit)
Steps:
1. `Hero.tsx`: `screens = tier.phoneFlow ? 1 : (tier.reduced ? 1 : 1 + WALK_SCREENS)`. The copy fade-out stays over 0.45 of a screen of scroll; measure the screen as the hero's own height (an `svh`), not `window.innerHeight` (line 138 area), on phones only.
2. `scroll.ts`: on `tier.phoneFlow` make `measure()`/`update()` skip the walk marks and stops (`fitLegs`, `measureMarks`, `stopAt`): `scrollState.leg = 'parked'`, `frame = 50`, `pos = 50`, `stops` all `'none'`, no `pauses`. Add `scrollState.held` (progress 0..1) = clamp of scrollY over the span from 0 to the document-Y at which `#studio` top meets the top of the screen (`studio.getBoundingClientRect().top + scrollY`), measured from the layout (no `innerHeight`). Desktop branches stay as they are.
3. `HeldView.tsx`: on each scroll update write one transform on the wrapper: `translate3d` and `scale` from `heldViewAt(scrollState.held)` through the same `frameFit` maths (zoom first, then pan, clamped by `frameFit`), `will-change: transform`, written only when the value changes. No `drawImage`, no decode. Record the REQUESTED view and the DRAWN centre in `diag().heldView.now`.
4. Rows `T6.*` (A16 profile, CPU 4 times, 250 px/s drag from the top to the studio at 384 x 644, 390 x 844 and 360 x 800, sampling the transform every animation frame): (a) `#hero` height equals 100 svh within 1 px and no `[data-hold]`/`data-tail` spacer exists; (b) at scroll 0 after the glide the requested view is zoom 1.30 centre (0.39, 0.56) within 0.005; (c) the drawn centre x has moved within the first 60 px of scroll at all three sizes and the transform differs from its start value within 60 px; (d) at `#studio` top the requested view is zoom 1.20 centre (0.47, 0.58) within 0.005 and stays so to the footer; (e) zoom never rises and neither requested nor drawn centre moves left on the way down; scrolling back up retraces the same values within 0.01; (f) the hero copy is opaque at scroll 0 once faded in and its opacity is 0 by 0.45 of a screen of scroll; (g) the held canvas is drawn 0 times during the drag (`drawImage` counter in `scripts/phone-jank/lib.mjs`) and `diag().walk.decodes` does not grow; (h) toolbar, picture only (style of `scripts/phone-jank/toolbar-android.mjs`: override `innerHeight` 644 to 720, fire `resize`, svh unchanged) at scroll 0 and at the studio: the picture moves by at most 1 device pixel (cross-correlation of the kitchen-band strip).
Do not touch: `WALK_SCREENS` and every desktop branch of `scroll.ts`, `src/hero/WalkPlayer.tsx`, `src/sections/*`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T6` FAILS on base-dist (hero is 500 svh, walk decodes during scroll) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T7: The kitchen stays on screen
Status: DONE 2026-10-08 (T7 rows 0/6 on base, 6/6 on new at end cx 0.47; smallest cooker margin +45.4 / +13.8 / +8.2 px at 384x644 / 390x844 / 360x800; studio floor+ceiling 75.7 / 77.4 / 77.4 (limit 78); tsc 0; gz JS 381676; guard positions 36 + URLs + fps 59.7 + stops 40 + clip PASS, hotspots 55 rows 0 FAIL)
Spec: must-do #9, check #8
Depends on: T6
Blocked by: none
Context: Colin accepted the framing (floor plus ceiling about 75 per cent at the stops and 75.7 / 77.5 / 77.4 at the studio view, OQ 2). This ticket proves the locked view numbers keep the cooker, island and sink on screen all along the pan. It is a check ticket: the numbers are locked, so a failure is not fixed here.
Files: scripts/t-v3-phone-flow.mjs (edit)
Steps:
1. Row `T7.matte-boxes`: for the start view, three mid-pan views (t = 0.25, 0.5, 0.75) and the studio view, at 384 x 644, 390 x 844 and 360 x 800: take the cooker, island and sink matte boxes of the frame-50 layer set (`public/v3/stops/craft/port/layers.json`, `frame: 50`; use the part scan in `src/v3/useStopLayers.ts` `partsInView` boxes or read the mattes with the method of `implementation/v3-build/R1/framing.mjs`), map them through `heldViewAt(t)` and `frameFit`, and assert each box is wholly inside the screen.
2. Row `T7.share`: `implementation/v3-build/R1/framing.mjs` (`cmap('port', 50)`, `windowOf`, `share`) at each of those views and sizes: floor plus ceiling at most 78 per cent; at the studio view expect 75.7 / 77.5 / 77.4 per cent (record the three figures).
3. Save a page screenshot of the start and studio views at all three sizes to `implementation/v3-build/R4/shots/` and write the file names in the report, to be compared by eye with `B-start-0.39.png` (T5) and `held-view-candidates/B-end.png`.
Do not touch: `src/`, the locked view numbers in `config.phoneFlow`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T7` FAILS on base-dist (no held view: the matte boxes at the baseline's stops do not meet the rows' views) and PASSES on new-dist. If a box leaves the screen or a share exceeds 78, end with `BLOCKED: <which size and view>; unblock: Colin to choose a new view`.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T8: The glide plays on phones and a touch cannot break it
Status: DONE 2026-10-08 (T8 rows fail on base (no video frame seen, ends on 93), 44/44 on new; N=79 by ffprobe, dropped 0, hand-over 1.21; tsc 0; gz JS 382487; dissolve+intro PASS; guard positions 38 PASS 0 FAIL, urls/fps/stops/clip PASS)
Spec: must-do #2, #3, #4 (video path, lock, ignore touch and keys), check #3, #4 (no-touch, touch and key runs)
Depends on: T6
Blocked by: none
Context: After the dissolve the camera zooms in once per visit as the T4 video (`port-held.mp4`, ends on frame 50). The page does not scroll during it, so the video alone moves the picture. From the first video frame to the end the page cannot be scrolled by touch or keys, a touch is ignored (no skip), and the lock is always released. R3's failure: `autoScrollTo` cancels on `touchstart` (`src/lib/scroll.ts:301` to `:305`), `endGlideVideo(true)` (`src/hero/glide.ts:143`) freed the pinned canvas and the picture snapped 93 then 3. The new glide does not use `autoScrollTo` or any scroll position at all. Phones do not call `holdScroll` here either (must-do 18 allows only this lock); the lock is its own function.
Files: src/hero/glide.ts (edit), src/hero/GlideVideo.tsx (edit), src/hero/Hero.tsx (edit), src/hero/Backdrop.tsx (edit), src/lib/scroll.ts (edit)
Steps:
1. `scroll.ts`: add `lockForGlide(on: boolean)` used by the glide only: sets `document.documentElement.style.overflow = 'hidden'`, adds a non-passive `touchmove` listener that calls `preventDefault`, a `keydown` listener that swallows Space, PageDown, PageUp, End, Home and the arrows, and a `wheel` preventer; `on(false)` removes all of it and clears `overflow` to the empty string. It also sets a flag read by `Hero`. It records a counter `diag().glide.touchIgnored` when a touch lands while locked. It does not touch `holdScroll`, and `onKey`'s hold branch stays for desktop.
2. `glide.ts` and `GlideVideo.tsx`: on `tier.phoneFlow` load `walk/glide/port-held.json` and `port-held.mp4` (not `port.*`), size the video as a cover-fit box over the held canvas (same wrapper as `HeldView`), and per video frame (`requestVideoFrameCallback`, else `timeupdate` polling as today) apply the per-tick `views[k]` from the json as the CSS transform, so the last frame sits on the held start view. The held canvas is already showing frame 50 under the video before it plays (decode before start), so at the end the video is simply taken away; the hand-over difference is the mean absolute difference between the last video frame and the held canvas.
3. `Hero.tsx`: on phones, after the dissolve, lock, `startGlideVideo`, wait for `ended` (limit `config.phoneFlow.glideMaxMs`), unlock, set `arrived`. No `autoScrollTo`, no `scrollY` test, no `endGlideVideo(cancelled)` path. Remove nothing the desktop uses.
4. Record `diag().glide = { path: 'video', dropped, total, handoverMs, touchIgnored }` in the shape T20 will log.
5. Rows `T8.*` (A16 profile, CPU 6 times, cold start, CDP `Input.dispatchTouchEvent` for touches): run the glide four ways here, three of them in this ticket: no touch; a swipe at 0.5 s, 1.3 s and 2.2 s into it; the keys Space, PageDown, End and ArrowDown at 0.5 s, 1.3 s and 2.2 s into it. (The blocked-video run is T9.) Each run asserts: `scrollY` stays 0 until the glide has ended; `dropped` is at most 2 of N, N read from the file with `ffprobe -count_frames` (not 79); the sequence of pictures (video frame index, then the held frame) never goes backwards and never skips more than 2 video frames; hand-over mean difference under 2 in 255 (use the `HANDOVER` hook in `scripts/t-v3-phone.mjs`, port it into the row if it is not exported); the glide still plays whole when touched or keyed and `touchIgnored` is at least 1 in the touch runs; after every run `document.documentElement.style.overflow` is empty and no `touchmove` handler is attached within 4.5 s and a swipe then scrolls the page by at least 100 px. Screenshots at 0.3 s, 1.3 s and the end of the glide for each run go to `implementation/v3-build/R4/shots/glide-<run>-<t>.png`.
6. Run `node scripts/t-v2-dissolve.mjs` and `node scripts/t-v2-intro.mjs` again (check 3 stays green).
Do not touch: `autoScrollTo` and the desktop canvas glide, `public/walk/glide/port.*`, `IntroTiles`, the dissolve timings.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T8` FAILS on base-dist (touch cancels the glide, it scrolls, dropped is counted against 79 frames, it ends on frame 93) and PASSES on new-dist for the no-touch, swipe and key runs; `t-v2-dissolve.mjs` and `t-v2-intro.mjs` PASS; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T9: Glide failure paths and the unlock guarantee
Status: DONE 2026-10-08 (T9 rows fail on base (page never locked), 29/29 on new in 5 of 6 runs, 27/29 once under machine load, not reproduced; T8 44/44 still; tsc 0; gz JS 383017; guard positions+URLs PASS; subagent also edited src/lib/heldFrames.ts for the fade state)
Spec: must-do #4 (always released within 4.5 s), #5, check #4 (blocked-video run and stall)
Depends on: T8
Blocked by: none
Context: If the video cannot play (file missing, autoplay refused, no first frame in 1.5 s) the page runs no canvas glide: it cross-fades from frame 1 to the held view over 0.6 s with the same lock and unlock. The lock is released on every path (video ended, failed, stalled) within 4.5 s of the glide starting.
Files: src/hero/glide.ts (edit), src/hero/Hero.tsx (edit), src/hero/HeldView.tsx (edit), scripts/t-v3-phone-flow.mjs (edit)
Steps:
1. `glide.ts`/`Hero.tsx`: on any failure branch (json or mp4 error, `play()` rejected, no first frame in 1.5 s, `ended` not seen) take the fallback: lock, cross-fade the frame-1 picture to the frame-50 held picture over `config.phoneFlow.fadeFallbackMs` (opacity on the two layers in `HeldView`, no decode), unlock, set `arrived`. `diag().glide.path = 'fade'` with `why`.
2. A watchdog: one timer started with the lock calls `lockForGlide(false)` at `config.phoneFlow.glideMaxMs` (4500) whatever else has happened, and the code path that already unlocked cancels it. A stalled video (paused by the harness at 1 s) is therefore released by 4.5 s and ends on the held frame.
3. Rows `T9.*`: (a) with `walk/glide/port-held.mp4` blocked (route abort): a 0.6 s cross-fade, `diag().glide.path` is `fade`, no walk decode (`diag().walk.decodes` unchanged), the same lock (scrollY 0 until it ends, touch ignored) and the same unlock; (b) with the video paused at 1 s: the lock is released by 4.5 s, the picture ends on the held frame, overflow empty, a swipe scrolls at least 100 px; (c) with `port-held.json` returning 404: same as (a); (d) the fallback never shows a half-state: sample the picture every animation frame; opacity of frame 1 and frame 50 sums to 1 within 0.02 and never reverses.
Do not touch: the T8 video path's behaviour (re-run the `T8` rows), desktop branches.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T9` FAILS on base-dist (it runs a canvas glide with walk decodes and cancels on touch) and PASSES on new-dist; `--rows T8` still PASS; `node scripts/t-v3-desktop-same.mjs` PASS. Check 4 is now fully covered by T8 plus T9.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T10: No scroll hold, clips or blocks on phones
Status: DONE 2026-10-08 (T10 rows 10/24 on base, 24/24 on new; 0 clip requests, 0 holdCalls, 0 overflow-hidden frames, 0 cancelled touchmoves; T8 44/44; tsc 0; gz JS 383052; guard positions+URLs PASS; also edited src/lib/diag.ts for holdCalls; T9 json404 fade row flaked once under load)
Spec: must-do #17, #18, check #16
Depends on: T6
Blocked by: none
Context: The three stops and their opening clips are tied to different walk frames and cannot play on one held frame (spec Checked fact 2, OQ 3). On phones nothing fetches or decodes a clip frame, nothing draws the glass-block card build, `holdScroll` is never called outside the glide lock, the root is never given `overflow: hidden` outside it, and no touch is cancelled outside it. The cards still need to appear: T11 and T12 give them a scroll-linked fade. Desktop and the 768 px touch screen keep all of it.
Files: src/v3/StopPlayer.tsx (edit), src/v3/Hotspots.tsx (edit), src/lib/scroll.ts (edit)
Steps:
1. `StopPlayer.tsx` (the effect around `:62` to `:100`, `fetch(clip.json)` at `:75`, `setPauseFrame` at `:80`, `holdScroll` at `:448` and `:494`, the two canvases at `:537`): when `tier.phoneFlow` the component returns before fetching anything and renders no clip or block canvas, so no `clip.json`, no clip frame request, no `[data-layer^='clip-']` or `[data-layer^='blocks-']` element. Leave the desktop and coarse-768 paths unchanged.
2. `Hotspots.tsx`: `PHONE()` (`:78`) is `tier.coarse || innerWidth < 768` and also covers touch tablets, which keep the tile at `a7a165a` (T2's 768 touch case). Introduce `tier.phoneFlow` checks only: on phones never set `dock`/`data-dock` and render no `[data-tile]`. Do not delete the tile code or the `tileOpen` and `tileClose` strings (the spec says "on phones"; the coarse-768 path still uses them, see Decisions). On phones `useStopLayers` does not load a stop's layer set (T14 gives the phone its one frame-50 set).
3. `scroll.ts`: `holdScroll` and the `onKey` hold branch stay for non-phones; on `tier.phoneFlow` make `holdScroll` a no-op that records `diag().holdCalls` (so a spy sees it was called) unless the caller is the glide lock.
4. Rows `T10.*` over the full scripted scroll (top to footer, 250 px/s drag and 2500 px/s fling) at 384 x 644 and 390 x 844: (a) no request for a clip frame (no URL under `v3/stops/*/port/` matching `/\d\d\.(avif|webp)$/`) and no `clip.json`; (b) no `[data-layer^='clip-']` or `[data-layer^='blocks-']` canvas is ever visible; (c) `holdScroll` is never called after the glide (spy), the root's `overflow` is never `hidden` after the glide (sampled each frame), and no `touchmove` during either gesture has `defaultPrevented` true; (d) no `[data-tile]`, no `[data-dock]`.
5. Mark the phone clip rows of older scripts obsolete (do not edit them here; T22 lists them).
Do not touch: StopPlayer behaviour at 768 and above, `public/v3/stops/`, `tileOpen`/`tileClose` in `src/config.ts`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T10` FAILS on base-dist (clip frames are fetched, holds are called, the tile exists) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS (including the 768 x 1024 touch case, which still builds clips and the tile).
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T11: Full-size cards in normal flow, one at a time
Status: DONE 2026-10-08 (T11 rows 7/27 on base, 27/27 on new; cards static, no tile/hold, 0 frames with two cards, gaps 587/787/743 px = 100svh-57; T6 32/32; tsc 0; gz JS 383159; guard positions+URLs PASS; brand.css needed no edit)
Spec: must-do #10, #12, check #9, #11
Depends on: T10
Blocked by: none
Context: Today each card is `sticky top-20` in a section with a 70 svh hold spacer (`src/sections/Section.tsx:41` and `:49`; `Craft.tsx:15` and `:17`, `Portfolio.tsx:20` and `:21`, `Process.tsx:16` and `:17`). Measured at 384 x 644 the cards are 1171, 1653 and 1364 px tall (1.8 to 2.6 screens) with a pin that shows only the top 564 px, which is the likeliest cause of "always misses the top". On phones the cards are the full-size cards in normal page flow: not sticky, no hold, no collapsed tile, the dark tint without backdrop blur that R2 fix 4 gave phone cards, copy and order as today. Between cards there is one full screen of clear kitchen (100 svh minus the header, OQ 6) and no two cards are ever on screen together. The classes are chosen by `tier.phoneFlow` in JS (width at load, OQ 8), not by a CSS media query, so a resize cannot flip them.
Files: src/sections/Section.tsx (edit), src/sections/Craft.tsx (edit), src/sections/Portfolio.tsx (edit), src/sections/Process.tsx (edit), src/brand.css (edit, phone block only)
Steps:
1. `Section.tsx`: when `tier.phoneFlow` render no `[data-hold]` and no `[data-tail]` spacer, no `sticky`, and no `rise` class. Add a clear-kitchen gap as margin on the section in `svh` (one screen minus the header height, header 57 px, so `calc(100svh - 57px)` between a card's bottom and the next card's top), and a `scroll-margin-top` of at least 69 px (header bottom plus 12 px).
2. `Craft.tsx`, `Portfolio.tsx`, `Process.tsx`: pass the phone variant of `panelClass`, `className` and `holdSvh` (0). Keep the desktop strings as they are, including the `lg:` classes and `sm:pb-[70svh]` on Process.
3. `brand.css`: inside the existing `@media (max-width: 767px)` block, ensure phone cards keep `--tile-tint`/tint at 0.86 without `backdrop-filter`. Do not add any blur.
4. Rows `T11.*` at 384 x 644, 390 x 844 and 360 x 800, for each of Craft, Kitchens and Process: (a) the card's computed `position` is not `sticky`; no `[data-tile]`, `[data-dock]`, "Read more" text or `[data-hold]` in the phone DOM; the card has no `backdrop-filter`; the card's bottom can be brought above the screen bottom (its full text is reachable); (b) in a 250 px/s drag and a 2500 px/s fling (CDP touch), the number of animation frames on which two cards both intersect the screen is 0, and a card has left the screen (its bottom is above the header's bottom) before the next card's top enters the screen; (c) the layout gap between one card's bottom and the next card's top is at least 100 svh minus the header height.
Do not touch: card copy, order, the studio, desktop classes, `Section.tsx` behaviour when `!tier.phoneFlow`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T11` FAILS on base-dist (cards are sticky, with a hold spacer and a tile) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T12: Card fade driven by scroll, top always seen
Status: DONE 2026-10-08 (T12 rows fail on base (opacity 0 at top, scroll-margin 0), 24/24 on new at CPU x4; scroll-margin 69; links land at 69 px under a 57 px header; tsc 0; gz JS 383246; guard positions 38 PASS 0 FAIL; no brand.css edit needed)
Spec: must-do #11, check #10
Depends on: T11
Blocked by: none
Context: Each card must be fully opaque before its top edge has risen above 65 per cent of the screen height, driven by scroll position and not by a timer, so a fast flick never shows a half-built card. While the top is between the safe line (header bottom plus 12 px, 69 px on the A16) and that 65 per cent line, its first line (the eyebrow) is wholly on screen and nothing covers it. A link to a section lands with the card's top under the header. There is no clip and no block build (T10), so this fade is the only card animation on phones.
Files: src/sections/Section.tsx (edit), src/brand.css (edit, phone block only)
Steps:
1. `Section.tsx` on `tier.phoneFlow`: subscribe to `onScroll` (`src/lib/scroll.ts`), and write the card's `opacity` straight to the DOM (no React state) from the card's top as a fraction of the section's `svh`: 0 when the top is at or below the screen bottom, rising linearly to 1 at 65 per cent of the screen height, and 1 above that. Use `getBoundingClientRect().top` over the screen height taken from the hero's `svh` box (not `innerHeight`). Remove the `IntersectionObserver` path for phones.
2. Opacity only (no transform), so the eyebrow stays inside the card box; the card's box must not be covered by the header, the render label, the concept label or the studio panel when between 69 px and the 65 per cent line. If the render label (`left-3 top-16`) overlaps the eyebrow rectangle, move the card's top margin, not the label.
3. Confirm `scroll-margin-top` is at least 69 px on the card section (T11) and that an in-page link (`href="#craft"`) lands with the card's top at or below the header's bottom.
4. Rows `T12.*` at 384 x 644, 390 x 844 and 360 x 800 for both gestures (250 px/s drag, 2500 px/s fling): every animation frame records each card's top, its computed opacity, the eyebrow's rectangle and `document.elementFromPoint` at the eyebrow centre. Assert: opacity at least 0.99 on every frame where the card's top is at or above 65 per cent of the screen height; on every frame where the top is between 69 px and that line the eyebrow is wholly inside the screen and the element at its centre is inside the card; the card's `scroll-margin-top` is at least 69 px; clicking each nav-style link (`#craft`, `#portfolio`, `#process`) lands the card's top at or below the header's bottom.
Do not touch: desktop `rise` and IntersectionObserver path, `StopPlayer`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T12` FAILS on base-dist (built by a 1.6 s timer after a clip, behind a pin) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T13: Card legibility over the whole pan
Status: DONE 2026-10-08 (T13 row fails on base (no full card found), 2/2 on new; worst contrast 6.74:1 over 6 cards, whole pan (limit 4.5); tint unchanged 0.86; copy-grep PASS; tsc 0; no src change so desktop guard not needed)
Spec: must-do #13, check #12
Depends on: T12
Blocked by: none
Context: Cream text on the card tint must pass WCAG AA (4.5 to 1) against the lightest pixel behind it, across the whole pan of the held view, as R2's `tile-contrast.mjs` measures for the tile. The full card uses tint 0.86 (`--tile-tint`). If this fails the fix is the tint alpha in `src/brand.css` (phone block), not a blur.
Files: implementation/v3-build/R2/tile-contrast.mjs (read; copy to a new script, do not edit), scripts/t-v3-card-contrast.mjs (new), src/brand.css (edit only if a ratio fails)
Steps:
1. Read `implementation/v3-build/R2/tile-contrast.mjs`. Adapt it into `scripts/t-v3-card-contrast.mjs` for the full card: for each card text box (eyebrow, heading, paragraphs, list text), compute the lightest pixel behind it from the held frame through `heldViewAt(t)` at t = 0, 0.5 and 1, composite the card tint over it, and the ratio against the text colour.
2. Run at 384 x 644 and 390 x 844. Every ratio at least 4.5. If one fails, raise the phone card tint alpha in small steps (record it) until it passes; never above 0.92.
3. Rows `T13.*` in `scripts/t-v3-phone-flow.mjs` calls the script and PASSes only if every ratio is at least 4.5. Also run `node scripts/copy-grep.mjs` (the copy check) and require PASS.
Do not touch: card copy, header blur, desktop tint.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T13` against base-dist FAILS (no full card on phones, so the script finds none) and against new-dist PASSES with the ratios written to `implementation/v3-build/R4/card-contrast.txt`; `node scripts/copy-grep.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T14: The studio sits on the held picture, with the frame-50 layers loaded late
Status: DONE 2026-10-08 (T14 rows 2/12 on base (only console rows), 12/12 on new at 384x644 and 390x844; frame-50 set loaded 7 ms after the Process card is on screen, 0 requests before; diff 2.71 in 255; drawn once; same transform as held wrapper; tsc 0; gz JS 383573; guard positions+URLs PASS; subagent also edited src/lib/diag.ts (studioDraws); parked uses heldP >= 0.999 since held is boolean)
Spec: must-do #15 (layer set, drawn once, same wrapper, late load), check #14 (default-scheme difference), #5 (layer timing, one set)
Depends on: T10
Blocked by: none
Context: Each layer set only lines up on the walk frame it was rendered for (spec Checked fact 1: craft vs frame 50 mean difference 2.29, but one frame off 9.3). The phone studio therefore uses the frame-50 set (`public/v3/stops/craft/port/`, `frame: 50`), not the studio's own frame-1 set. It is drawn once, inside the same transformed wrapper as the held picture, so it follows it exactly. In the default scheme the recoloured picture is the held frame (mean difference under 3 in 255). It loads when the Process card first comes into view, not before, and it is the only layer set loaded on phones.
Files: src/sections/Studio.tsx (edit), src/App.tsx (edit), src/hero/HeldView.tsx (edit), src/lib/layers.ts (edit only if needed)
Steps:
1. `Studio.tsx` `useStudioImage`: on `tier.phoneFlow` call `loadLayerSet('craft', 'port', info)` (the loader's `loadV3` already reads `v3/stops/craft/port/layers.json`) instead of `'studio'`; the load flag comes from `App.tsx`'s `loadStudio`, which on phones becomes true when the Process card's rectangle first intersects the screen (the `#process` top test at `App.tsx:28` is currently `< window.innerHeight`; on phones use the card's rect against the `svh` height of the hero, set once, never un-set).
2. `StudioLayer` (`Studio.tsx:91` onward): on phones render the recoloured canvas inside `HeldView`'s transformed wrapper (a second canvas at the layers' 1080 x 1920 size, laid out exactly like the held canvas), drawn once per scheme change with no `viewAt(…, 1)` and no redraw on scroll or resize beyond the scheme. It is visible whenever the scroll is at or below `#studio` (held progress 1) and fades per the existing hold/fade logic when the visitor scrolls back up.
3. `App.tsx`: on phones `parked` is true when `scrollState.held >= 1` (T6), not `leg === 'parked'`, and `useStopLayers` loads nothing (T10).
4. Rows `T14.*`: (a) the request log's first request for any file of `v3/stops/craft/port/` (layers) is timestamped after the first animation frame on which the Process card's rectangle intersects the screen; no request under `v3/stops/studio/`, `kitchens/` or `process/`; the only `v3/stops/*/port/` files fetched are the frame-50 set's `layers.json`, neutral, six mattes, three finishes, three woods and three sinks (the files named in `layers.json`); (b) in the default scheme, the studio picture (read from the offscreen canvas) against the held frame 50 has a mean absolute difference under 3 in 255 over the whole frame (the measure in Checked fact 1); (c) the studio canvas is drawn exactly once per scheme (counter) and 0 times during a scroll; (d) at the studio the studio canvas's bounding transform equals the held wrapper's.
Do not touch: `public/v3/stops/*`, the desktop studio (frame 1 set and `viewAt(…, 1)`), `useStudioImage` on non-phones.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T14` FAILS on base-dist (studio set is `studio/` frame 1, loaded when `#process` top is above the screen bottom, with other stops' sets also loaded) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T15: Studio hotspots, choosers and recolour on the held view
Status: DONE 2026-10-08 (T15 rows fail on base (4/10), 20/20 on new at 384x644 and 390x844; 5 rings x 5 pulses then gone; taps, keyboard and zero rings at cards PASS; 99.4% of changed pixels in the matte, original back by 2 s; recolour a16+p390 and combos a16+p390 PASS (192 combos each, 0 wrong); tsc 0; gz JS 383822; guard positions+URLs PASS; also edited Studio.tsx load trigger (heldP >= 0.999 for jumps to the studio); T15_SKIP_SCRIPTS=1 skips the script rows)
Spec: must-do #15 (tap mapping), #16, check #14 (recolour), #15
Depends on: T14
Blocked by: none
Context: Hotspots on phones are at the Design studio only (OQ 4, a change to v3 must-do 12 for phones). The five rings pulse five times as the studio arrives, then stay gone for that visit. Every part (run, island, cooker, worktop, sink, handles) opens its chooser by tap, keyboard and the studio panel's list, with the same options (the shared 8 colours, 3 woods, 3 sinks, 3 finishes), and nothing outside the chosen part changes. Taps map through the held view, and the mapping must be worked out from `svh` and the page's own positions, not `window.innerHeight` (`src/v3/Hotspots.tsx:104` and `:267` map from `window.innerWidth` and `innerHeight` today).
Files: src/v3/Hotspots.tsx (edit), src/sections/Studio.tsx (edit), src/brand.css (edit if the chooser needs room), scripts/t-v3-recolour.mjs, scripts/t-v2-combos.mjs (edit only the frame-50 pointing and the phone rows)
Steps:
1. `Hotspots.tsx`: on `tier.phoneFlow` `currentCtx()` (`:85`) returns only `'studio'` when held progress is 1 and `#studio` straddles the screen middle, else `null`; never a stop. `mapper(L)` (`:100`) uses `heldViewAt(1)` with `frameFit` on the held wrapper's size (the `lvh` box) instead of `window.innerWidth`/`innerHeight`; `toView` subtracts the wrapper's top (0) and the toolbar-independent offsets.
2. The ring scan and the part list use the frame-50 layer set from T14 (`studio?.layers`). The pulse stays at five and the `ringsGone` / `data-gone` behaviour; no rings, no hint, no chooser at the three cards (ctx null).
3. Recolour: after a choice the recoloured picture is the T14 canvas redrawn once (the scheme changed); every changed pixel lies inside the chosen part's matte mapped through the current view. Hold about 1 s after scrolling back up (v2.1 must-do 13, `config.configurator.holdMs`) and fade by 2 s.
4. Point the phone rows of `scripts/t-v3-recolour.mjs` and `scripts/t-v2-combos.mjs` at the frame-50 set (read how they load the layer set; edit only phone rows and keep their desktop rows intact).
5. Rows `T15.*` at 384 x 644 and 390 x 844 at the studio: (a) five rings are shown, each pulses five times and is then hidden (`data-gone`); (b) a tap on the ring point of each of run, island, cooker, worktop and sink opens that part's chooser with exactly the right options (8 shared colours, 3 woods, 3 sinks; run and island also hold the 3 finishes); (c) keyboard only (Tab, Enter, arrows, Escape) reaches every part and every choice with a visible focus, including handles through the panel list; (d) at each of the three cards: zero rings (`.hotspot-ring` count), no hint, no chooser; (e) `scripts/t-v3-recolour.mjs` and `scripts/t-v2-combos.mjs` cycle every run, island, cooker, handle, wood and sink choice at both phone sizes with no errors, a screenshot of each in the report, and the outside-the-chosen-part difference and lighting correlation passing; (f) after choosing a scheme and scrolling up 400 px, at 0.5 s the chosen colours are still on screen and at least 99 per cent of changed pixels lie inside the chosen part's matte mapped through the current view, and by 2 s the original render is back.
Do not touch: desktop hotspots (stops and studio), `public/v3/stops/`, the palette/woods/sinks/finishes.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T15` FAILS on base-dist (rings at all three stops, studio on the frame-1 set, taps mapped from `innerHeight`) and PASSES on new-dist; `scripts/t-v3-recolour.mjs` and `scripts/t-v2-combos.mjs` PASS at both phone sizes; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T16: The studio is clear
Status: DONE 2026-10-08 (T16 rows fail on base (A16 ring points of run, island, cooker sit behind the panel at every position), 20/20 on new at 384x644 and 390x844; no card on screen at studio top, middle, end; ring points between header and panel; T11 27/27 and T12 24/24 still; tsc 0; gz JS 383822; guard positions+URLs PASS; one CSS rule #process margin-bottom 1rem; base FAIL seen at A16 only, the card-pins-over-studio half did not show on base)
Spec: must-do #14, check #13
Depends on: T15, T12
Blocked by: none
Context: At the Design studio no card is on screen. The studio's own panel is the only overlay (at the foot of the screen), and the cooker, island, run, worktop and sink are each wholly or mostly in the clear part of the picture above it, with each ring point inside the screen, below the header and above the panel. The studio section is `.studio` (160 svh with a 100 svh sticky `.studio-view`, `src/brand.css:105`); the Process card must have left before it arrives (T11 spacing).
Files: src/brand.css (edit, phone block only), src/sections/Studio.tsx (edit, only if the panel needs a phone variant)
Steps:
1. Scroll to `#studio` top, middle and end at 384 x 644 and 390 x 844 and check the layout; adjust only the phone studio panel (height, padding, chip layout) in `brand.css` if a ring point sits behind the panel, using the panel's existing `data-studio-panel` and `.studio-panel` rules. Do not move the view numbers.
2. Rows `T16.*`: at those three scroll positions and both sizes: no `[data-panel]` card intersects the screen; the studio panel is the only overlay besides the header and the labels; the ring point of each of run, island, cooker, worktop and sink (from the part scan, mapped through `heldViewAt(1)`) lies inside the screen, below the header's bottom and above the panel's top. Screenshots go to `implementation/v3-build/R4/shots/studio-<pos>-<size>.png` for comparison by eye with `held-view-candidates/B-end.png`.
Do not touch: the view numbers, hotspot logic, desktop panel placement.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T16` FAILS on base-dist (a card pins over the studio view and the studio uses the frame-1 view) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T17: Toolbar cannot move the picture or the cards
Status: DONE 2026-10-08 (T17 rows 32/34 on base (the two tap rows FAIL: hotspot mapping reads innerHeight, ring points move up to 43 px; picture, cards and fade already hold on base as layout is in svh), 34/34 on new; picture within 1 px, card tops 0 px, opacity within 0.01, taps hit the same part; no src change; tsc 0)
Spec: must-do #19, check #17
Depends on: T16
Blocked by: none
Context: The Android toolbar changes `innerHeight` by about 76 px (644 to 720) while `svh` stays. The page layout is in `svh`, the held picture's box is the largest viewport height anchored to the top, and its transform is worked out from `svh` and the page's own positions. T6 proved the picture alone; this proves it with the cards, the studio and the hotspot mapping all present.
Files: scripts/t-v3-phone-flow.mjs (edit); src/ only if a row fails (name the file in the commit)
Steps:
1. Row `T17.toolbar` in the style of `scripts/phone-jank/toolbar-android.mjs`: override `innerHeight` 644 to 720 and fire `resize` (svh unchanged) at scroll 0, a mid-card position (the middle of each card) and the studio. The held picture's position differs by at most 1 device pixel (cross-correlation of the kitchen-band strip) and every card's top is identical (0 px).
2. Add: a tap on a ring point at the studio hits the same part before and after the flip; the card fade opacity (T12) at a fixed scroll is the same before and after within 0.01.
3. If a row fails, find the `innerHeight` use that causes it (`grep -n "innerHeight" src`), fix it on phones only, and re-run T6, T12 and T15 rows.
Do not touch: desktop uses of `innerHeight`.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T17` FAILS on base-dist (the walk frame, hero and cards move on a flip) and PASSES on new-dist; T6, T12, T15 rows still PASS; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T18: Reduced motion on phones
Status: DONE 2026-10-08 (T18 rows 4/8 on base (shows frame 1, no studio view), 28/28 on new; no intro, no video, no frame-1 fetch, transform constant at the studio view (z 1.2, cx 0.47) at 8 scroll positions, cards cross-fade by opacity only, five rings open choosers; T6 32/32, T8 44/44, T12 24/24, T15 20/20 still; tsc 0; gz JS 383862; guard positions PASS; also edited src/lib/heldFrames.ts and src/hero/useWalk.ts to skip the frame-1 fetch)
Spec: must-do #21, check #19
Depends on: T16
Blocked by: none
Context: With reduced motion on a phone: no intro, no glide, no pan. The held frame sits fixed at the studio view, each card cross-fades in place, and the studio and every hotspot work. Today reduced motion holds the walk on frame 1 (`Hero.tsx firstPhase`, `scroll.ts update()` with `tier.reduced`).
Files: src/hero/Hero.tsx (edit), src/hero/HeldView.tsx (edit), src/lib/scroll.ts (edit), src/sections/Section.tsx (edit)
Steps:
1. `HeldView`: when `tier.reduced && tier.phoneFlow` show frame 50 at `heldViewAt(1)` from the first paint and never change the transform; skip frame 1 and the video; `Hero`: `phase` starts on `'walk'`, `arrived` true, no glide, no lock.
2. `Section.tsx`: the T12 fade becomes an opacity cross-fade in place (no transform, no motion), still scroll-driven.
3. The studio and hotspots: the studio layers (T14) load at once under reduced motion (as today `loadStudio` starts true).
4. Rows `T18.*` with reduced motion emulated at 384 x 644: no intro tiles (`[data-layer="intro"]` absent), no `<video>`, the held picture's transform equals the studio view at every sampled scroll position, each card cross-fades in place (opacity changes, no transform), and the studio and all five parts work (tap each ring point and see the chooser).
Do not touch: desktop reduced-motion behaviour.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T18` FAILS on base-dist (reduced motion holds frame 1 at zoom 1.24) and PASSES on new-dist; `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T19: Labels, console and overflow
Status: DONE 2026-10-08 (T19 rows 26/32 on base (the six labels-over-card rows fail: no card at the mid-card scroll on base), 32/32 on new at 384x644 and 390x844; labels, price and book visible and uncovered over cards and the studio; no overflow and no console errors at 360, 384, 390, 768, 1440; t7-shell PASS; no src change; tsc 0)
Spec: must-do #22, check #20
Depends on: T18
Blocked by: none
Context: The render label, the concept-demo label, the "Kitchens from £30,000" concept line and "Book a design visit" stay as in v3, visible over the cards and the studio. Honesty rules untouched. No horizontal overflow at 360, 384, 390, 768 and 1440, zero console errors.
Files: scripts/t-v3-phone-flow.mjs (edit); src/ only if a row fails
Steps:
1. Rows `T19.*`: at 384 x 644 and 390 x 844, over a card (Kitchens, mid-card) and over the studio: the render label (`[data-render-label]`), the concept-demo label (`[data-demo-label]`), the price line (`[data-price]`) and the book button (`[data-book]`) are visible and not covered (`elementFromPoint` at each centre is inside the element). Run `scripts/t7-shell.mjs` rows for the labels and the v2.1 price and button checks against the new build.
2. At 360, 384, 390, 768 and 1440 widths, `document.documentElement.scrollWidth` equals the client width at the top, mid-card, studio and footer; zero `console.error` and `pageerror` over the whole scripted scroll.
3. If a label is covered by a card at some scroll, fix the stacking in `brand.css` phone block (the labels are `fixed z-20`, cards in `main z-10`), not by hiding the card.
Do not touch: the copy of the labels, the price line text, desktop layout.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T19` and `node scripts/t7-shell.mjs` against new-dist PASS. These rows are mostly a guard that holds on the baseline as well; record which `T19` rows FAIL on base-dist (for example any label covered by a pinned card) and say so plainly if none do. `node scripts/t-v3-desktop-same.mjs` PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T20: The ?debug log for the phone flow
Status: DONE 2026-10-08 (debuglog rows FAIL on base (no glide fields, HELD or VIEW), PASS on new: GLIDE video dropped 0 of 74 handover 32ms touch ignored 0, HELD decode 39.1ms 1080x1920, 5 VIEW lines in 4.1 s, 0 console errors; desktop-style case moved to 1280x800 because phones no longer pause at stops; tsc 0; gz JS 384053; guard positions+URLs PASS)
Spec: must-do #23, check #21
Depends on: T18
Blocked by: none
Context: With `?debug` the page ships a log to the box sink (port 4798; `src/lib/DebugOverlay.tsx`, which reads `diag()` every 100 ms). Colin's A16 log must show whether the glide held and nothing decoded during the scroll. The test script `scripts/t-v3-debuglog.mjs` runs its own stub sink on 4798 (not 4799).
Files: src/lib/DebugOverlay.tsx (edit), src/lib/diag.ts (edit), scripts/t-v3-debuglog.mjs (edit)
Steps:
1. `diag.ts`: extend the `glide` type with `touchIgnored`, and add `held?: { decodeMs: number; w: number; h: number }` and `heldView?: { z; cx; cy }` (keys already written by T5, T6, T8).
2. `DebugOverlay.tsx`: add log lines: `GLIDE <path> dropped <d> of <n> handover <ms>ms touch ignored <count>` (replacing the R3 line's fields only for phones, keep the existing line for desktop); `HELD decode <ms>ms <w>x<h>`; and while the page is scrolling, one `VIEW z <z> cx <cx> cy <cy> y <scrollY>` line every second (not per frame; track scrolling by a changed `scrollY` since the last tick). Keep the existing DECODE, FORMAT and STOP lines for desktop.
3. `scripts/t-v3-debuglog.mjs`: add a phone case (A16 profile) that scrolls and requires the sink to receive the glide line with its four fields, the held-frame decode line and at least one VIEW line per second of scrolling.
Do not touch: the sink URL and the log shipping interval.
Proof: `node scripts/t-v3-debuglog.mjs` FAILS on base-dist (no HELD or VIEW lines, glide line has no touch ignored) and PASSES on new-dist; its existing desktop-style assertions still PASS.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T21: Smoothness and weight
Status: DONE 2026-10-08 (T21 8/8 on new at CPU x4, three drags and three flings: decodes 0, canvas draws 0, 0 frames over 50 ms, 0 over 100 ms, longest frame 33.4 to 50 ms, 0 long tasks; base fails on decodes ~173 and draws 171 to 237 per run; CPU x6 recorded (1 frame over 50 ms in the drag, longest 66.6 ms); bytes 4,091,320 (video 3,725,032, frames 181,339 + 184,949; whole page 8.6 MB) vs 6 MB; fixed studio compose pacing on phones (yieldFrame in Studio.tsx); T12 24/24, T14 12/12, T15 20/20 (scripts skipped); tsc 0; gz JS 384096; guard positions+URLs PASS)
Spec: must-do #20, check #18
Depends on: T19, T20
Blocked by: none
Context: A16 profile, Brave on the box GPU, CPU throttled 4 times, a finger drag at 250 px/s and a 2500 px/s fling from the top of the page to the footer, three runs each: walk decodes during the scroll 0, walk-canvas redraws during the scroll 0, at most 1 animation frame over 50 ms and none over 100 ms in each run, no long task over 100 ms after the glide has finished. Phone bytes fetched before the studio (glide video, frames 1 and 50, fonts excluded) at most 6 MB. This is a measuring ticket; if it fails, find the cause in code and fix on phones only.
Files: scripts/t-v3-phone-flow.mjs (edit); src/ only if a row fails
Steps:
1. Row `T21.smooth`: three runs of the drag and three of the fling at CPU 4 times; per run record decodes during the scroll (`diag().walk.decodes` growth), held-canvas draws (`drawImage` counter), frames over 50 ms, frames over 100 ms, and long tasks over 100 ms after the glide (`PerformanceObserver` `longtask`). Assert the thresholds above for every run. Record the same at CPU 6 times with no threshold.
2. Row `T21.bytes`: sum the response bytes of the request log from load to the first request for the frame-50 layers (T14) excluding fonts; at most 6 MB. List the glide video's size and the two frames' sizes in `implementation/v3-build/R4/weight.txt`.
3. If frames over 50 ms or long tasks appear, use `scripts/phone-jank/trace-long.mjs` to find the task, fix it on phones only, and re-run the earlier rows (`T6`, `T8`, `T12`, `T15`).
Do not touch: the view numbers, the 6 MB ceiling, desktop code.
Proof: `node scripts/t-v3-phone-flow.mjs --rows T21` FAILS on base-dist (walk decodes during scroll, canvas redraws, long tasks) and PASSES on new-dist for all six runs; the CPU 6 figures are written beside them. If a run cannot pass without changing a locked number, end with `BLOCKED`.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T22: Retire the superseded rows, run every check, write the report
Status: DONE 2026-10-09 (checks 1 to 22 PASS in REPORT.md; verify-v3 15 PASS 0 FAIL; desktop guard all PASS; phone-flow T3 to T21 all rows PASS; clean and new build gz JS 384096, dist checksum unchanged; R3 glide files retired, nothing reads them)
Spec: check #22, check #1 (clean install), check #2 and #3 (full re-run); the gate for T23
Depends on: T21
Blocked by: none
Context: Several older phone rows expect behaviour this spec reverses (the R2 glass tile, the R3 glide to frame 93, the stop clips and block builds, the stop pins). They are amended on purpose or removed, never left to fail, and listed with the old and new expectation. `verify-v3.mjs` runs the older scripts against `KITCHEN_DIST` with the box preload and `VERIFY_CACHE`, as R3 did.
Files: scripts/t-v3-phone.mjs, scripts/t-v3-stops-scroll.mjs, scripts/t-v3-hotspots.mjs, scripts/t-v3-discover.mjs, scripts/t-v3-cardplace.mjs, scripts/t-v3-layout.mjs (edit phone rows only), implementation/v3-build/R4/REPORT.md (new), public/walk/glide/port.mp4 and port.json (see step 5)
Steps:
1. Build clean: `bash scripts/r4-build.sh clean` (fresh `npm ci` in a copy, `tsc --noEmit`, vite build, gzipped JS under 400000) and `bash scripts/r4-build.sh new`; assert the `dist/` checksum is unchanged (check 1).
2. Amend or remove the phone rows named in the spec: the R2 tile rows of `t-v3-phone.mjs`, the R3 glide rows that expected frame 93, and the phone rows of `t-v3-stops-scroll`, `t-v3-hotspots`, `t-v3-discover`, `t-v3-cardplace` and `t-v3-layout`. Rows that waited for a stop clip or a block build on phones are removed (check 16 in T10 asserts their absence). Desktop rows are not touched. List every changed row in the report with old and new expectation.
3. Run `HARNESS_BROWSER=brave KITCHEN_DIST=~/.cache/kitchen-r4/new-dist node verify-v3.mjs` (box preload, `VERIFY_CACHE`, as R3): no FAIL.
4. Run in full: `node scripts/t-v3-desktop-same.mjs` (check 2), `node scripts/t-v2-dissolve.mjs` and `node scripts/t-v2-intro.mjs` on the A16 profile (check 3), and `node scripts/t-v3-phone-flow.mjs` (every `T3` to `T21` row).
5. Retire the unreferenced R3 glide files only if nothing under `src/`, `scripts/` or `verify-v3.mjs` still reads `walk/glide/port.json` or `port.mp4` (`grep -rn "glide/port\." src scripts verify-v3.mjs`); the R3 default mode of `make-glide-video.mjs` stays. If anything still reads them, leave them and say so.
6. Write `implementation/v3-build/R4/REPORT.md`: one table of checks 1 to 22 with PASS or FAIL, the command that proved it and the output file; the glide video size, N, the weight figures, the longest long task after the glide; the amended-rows list; every `BLOCKED` or decision noted by earlier tickets. T23 runs only if no check is FAIL.
Do not touch: desktop rows of any script, `dist/`.
Proof: the report shows PASS for checks 1 to 22 (check 23 is T24), `verify-v3.mjs` has no FAIL, and `git status` shows `dist/` untouched. Against `a7a165a` the same command set shows FAIL on every new `T3` to `T21` row (the reason each fails on the baseline is in each ticket).
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T23: Preview swap into dist/ with a one-line rollback
Status: DONE 2026-10-09 (dist swapped, dist-old-r4 kept; 4799 serves the new index.html; rollback in ROLLBACK.txt)
Spec: Done means (Builds paragraph), Won't do (the internal preview swap is not a public deploy)
Depends on: T22 (all of checks 1 to 22 PASS)
Blocked by: none
Context: The kitchen preview unit on port 4799 runs `vite preview` over `dist/` in this worktree. Colin's standing permission for internal preview swaps (2026-10-07 18:19, Job_Closer_Spec must-do 14; the kitchen preview is on the approved list) covers this swap, and it runs automatically once every check passes. It is not a public deploy: no push, no merge to main, no outreach. This is the only ticket that touches `dist/`. Do not restart or stop the preview unit; `vite preview` serves the directory, so a rename is enough.
Files: dist/ (replace), dist-old-r4/ (new, the previous build)
Steps:
1. Precondition: read `implementation/v3-build/R4/REPORT.md`; if any of checks 1 to 22 is not PASS, do nothing and end with `BLOCKED: check <n> not passing; unblock: fix and re-run T22`.
2. Rebuild fresh from the committed tree so `dist/` equals the commit: `git status --short` must be clean of tracked changes, then `bash scripts/r4-build.sh new` and record the commit hash and the sha256 of `index.html`.
3. Swap (the old build kept beside it): `cp -a ~/.cache/kitchen-r4/new-dist dist-new-r4 && mv dist dist-old-r4 && mv dist-new-r4 dist`. If `dist-old-r4` already exists, stop with `BLOCKED: dist-old-r4 exists; unblock: Colin to say whether to overwrite`. Leave `dist-old-r2` and `dist-old-r3` alone.
4. Verify without touching port 4799 except a read: `curl -sI http://127.0.0.1:4799/` returns 200 and `curl -s http://127.0.0.1:4799/ | sha256sum` matches `dist/index.html`'s hash (if the unit caches, report it and do not restart it).
5. Write the rollback to `implementation/v3-build/R4/ROLLBACK.txt`, one line: `cd /home/col/Atwood_demos/kitchen-v3-wt && mv dist dist-rejected-r4 && mv dist-old-r4 dist` (the unit keeps serving the directory). Test the line's logic in the report only (do not run it).
6. Report the commit hash, the date and the rollback line, and commit only `ROLLBACK.txt` and the report line (`dist/` is git-ignored).
Do not touch: `dist-old-r2/`, `dist-old-r3/`, the preview unit's definition, any push or deploy.
Proof: `dist/index.html` has the hash of `new-dist/index.html`, `dist-old-r4/index.html` has the hash of the previous `dist/index.html` (recorded before step 3), port 4799 serves the new `index.html`, and the rollback line is in `ROLLBACK.txt`.
If stuck: end with `BLOCKED: <reason>; unblock: <what>`.

## T24: GATE, Colin's A16 test with ?debug (not built)
Status: GATE
Spec: check #23
Depends on: T23
Blocked by: Colin (no agent builds or ticks this)
Context: The real phone is the only proof of the last four wishes. Colin opens the kitchen preview on his A16 with `?debug` and confirms. SAM reports the log.
Files: none
Steps:
1. Colin, on the A16, opens the preview with `?debug` and confirms: the glide plays whole and a touch cannot break it; nothing jerks while scrolling; each big card's top is seen and each leaves before the next; at the Design studio the whole kitchen is clear for the colours.
2. SAM reads the sink log (`GLIDE` line: path, dropped, hand-over, touch ignored; and the longest long task after the glide) and reports both figures to Colin with his answer.
3. If Colin reports a fault, SAM writes a new ticket from it; if he accepts, the R4 branch is ready for his word on merge (no merge or public deploy happens without it).
Do not touch: anything. No agent runs this ticket.
Proof: Colin's yes in writing, plus SAM's two log figures.

---

## Coverage table

Every must-do 1 to 23 and every check 1 to 23 maps to at least one ticket. The first column is the spec number; "T" columns are the tickets whose Steps build it or whose Proof tests it.

### Must-do to ticket

| must-do | tickets |
|---|---|
| 1 Phones only, desktop unchanged | T2, T3, T22 (and the guard in every ticket) |
| 2 Intro and dissolve unchanged | T5, T8, T22 |
| 3 Glide as hardware video, ends on held frame | T4, T8 |
| 4 Touch cannot break the glide, lock always released | T8, T9 |
| 5 Fallback cross-fade | T9 |
| 6 One held view, no walk, hero one screen | T5, T6 |
| 7 Held view moves by CSS transform, numbers and clamp | T3, T6 |
| 8 Held picture sharp | T4, T5 |
| 9 Kitchen stays on screen | T7 |
| 10 Full cards in normal flow | T11 |
| 11 Top of every card seen | T12 |
| 12 One card at a time, one screen of kitchen between | T11 |
| 13 Cards legible | T13 |
| 14 Studio clear | T16 |
| 15 Colours sit on the kitchen (frame-50 set, drawn once, same wrapper, late load) | T14, T15 |
| 16 Hotspots at the studio only | T15 |
| 17 No clips or block build | T10 |
| 18 No scroll hold | T10 |
| 19 Android toolbar | T6, T17 |
| 20 Smoothness and weight | T4 (video size), T21 |
| 21 Reduced motion | T18 |
| 22 Labels and honesty rules | T19 (T13 for copy check) |
| 23 ?debug log | T20 |

### Check to ticket

| check | tickets |
|---|---|
| 1 Build and weight | T1, T22 |
| 2 Desktop unchanged | T2 (guard), T22 (full re-run), and every ticket's closing run |
| 3 Intro and hand-over | T5, T8, T22 |
| 4 The glide (four ways) | T4 (N from the file), T8 (no touch, swipes, keys), T9 (blocked video, stall) |
| 5 No walk, late layer set | T5 (walk fetches, decodes), T6 (hero height), T14 (layer timing, one set) |
| 6 Held view and hero | T3 (clamp maths), T6 |
| 7 Sharp | T5 |
| 8 Kitchen on screen | T7 |
| 9 Full cards, normal flow | T11 |
| 10 Top always seen | T12 |
| 11 One at a time | T11 |
| 12 Legibility | T13 |
| 13 Studio clear | T16 |
| 14 Colours sit on the kitchen | T14 (default scheme), T15 (cycle, scroll-up hold) |
| 15 Hotspots | T15 |
| 16 No clips, no blocks, no hold | T10 |
| 17 Toolbar | T6 (picture), T17 (picture and cards) |
| 18 Smoothness and weight | T21 |
| 19 Reduced motion | T18 |
| 20 Labels | T19 |
| 21 The log | T20 |
| 22 Earlier checks that still apply | T22 |
| 23 Colin on his A16 | T24 (gate) |

## Decisions the tickets make where the spec is silent

1. Tablets and touch screens at 768 px or more keep the glass tile, the clips and the hold at `a7a165a` (must-do 1 and check 2 win). The spec says the tile code and its strings "go on phones"; the tickets stop using them on phones (T10) but do not delete them, because `PHONE()` in `src/v3/Hotspots.tsx:78` is `tier.coarse || innerWidth < 768` and so covers those screens.
2. `B-start.png` in the candidates folder was rendered at centre x 0.30; the lock moved the start to 0.39. T5 renders a new reference `B-start-0.39.png` for the sharpness row instead of using the old picture.
3. The glide video gets new file names (`port-held.mp4`, `port-held.json`) so the R3 files keep working until T22 retires them; the 1080 x 1920 video needs H.264 level 4.0 (the R3 script's level 3.1 cannot carry it) and a 4 MB budget in place of 2 MB.
4. A landscape window under 768 px wide is forced onto the portrait held frame (T5), since the phone path is chosen by width at load.
5. The sharpness gradient ratio (1.25 times the baseline) is a proposed threshold that has not been run; T5 reports the measured ratio and stops with `BLOCKED` rather than lowering it.
6. T7 (framing) and T21 (smoothness) are measuring tickets; if a locked number fails they stop with `BLOCKED` for Colin instead of changing the view.
