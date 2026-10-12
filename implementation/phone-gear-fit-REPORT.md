# Phone gear panel fit: report

Branch `fix/phone-gear-fit` (from `c366517`), worktree `/home/col/SAM_ui-phone-gear-fit`. Nothing merged, deployed or restarted.

## Problem
On phones the gear Settings panel ran off the right edge. The phone top bar forced the health chip, sync badge and UTC clock on, all non-shrinking, so the row was about 401 px wide on any screen. The panel was `absolute right-0 w-72` pinned to the gear with no clamp to the viewport.

## What changed
- `src/components/dashboard/fleet/FleetPhoneView.tsx` (phone CSS): the health chip may now shrink (its label ellipsises, dot and value never shrink); the sync badge goes icon-only (label kept for screen readers and the title). All four items stay, per Must 3c. The gear never shrinks.
- `src/components/dashboard/TopBar.tsx`: the sync label is wrapped in `<span class="sync-label">` so the phone CSS can reduce it to icon-only. No change elsewhere.
- `src/components/dashboard/ControlDeck.tsx`: below 640 px the panel spans the header, 8 px from each edge (`max-sm:right-2 left-2 w-auto`), with `max-h-[calc(100dvh-100px)]` and its own scroll. The wrapper is `max-sm:static` so the header (a positioned, backdrop-filter ancestor) is the containing block. From 640 px up the classes are unchanged.
- `scripts/check-phone-fit.cjs`: the new check (360x800, 384x832, 390x844, 412x915, touch and mobile, plus 384 at 130% root font size, plus the More sheet at 360 and 384). Serves a built directory through the harness; never builds.
- `deploy.sh`: new `phone_fit_gate` runs after `npm test` and before the live build. It builds into a copy (`~/.cache/phone-fit/deploy-copy`), runs the check on it, removes the copy, and exits non-zero on failure (1 fail, 2 port 4950 taken). The live `.next` is never touched. `./deploy.sh --phone-fit-only` runs just this gate.
- Outside the repo: `/home/col/delivery/ux-audits/phone-fit/run-phone-fit.sh <dir>` (stops the harness, serves `<dir>`'s build, runs the check, always stops the harness; exit 0 on RESULT PASS, 1 on RESULT FAIL, 2 refused if another run holds port 4950 or the usage is wrong).

## Before: live build `/home/col/SAM_ui` (RESULT FAIL, 35 PASS, 16 FAIL)
Failures were on the top bar controls and the gear panel at 360, 384, 390 and 130% text (the 412 check also failed in the copy-build run: gear and panel to 415 px). Excerpt (full output in the commit's check run):
```
serving /home/col/SAM_ui through the harness on port 4950
FAIL  360x800: every top bar control inside the viewport (layout saved08:4 175..415; 08:40:09UTC 282..365; UTC 344..365; DIV 371..415; Console settings 371..415; svg 386..400; circle 395..398; circle 389..392 header right 360)
FAIL  360x800: gear panel inside the viewport ({"left":127,"right":415,"top":75,"bottom":566})
FAIL  360x800: nothing in the gear panel past the screen edge (operator 140..402; operator 140..402; INPUT 140..402; ambient theme 140..402)
FAIL  360x800: gear panel last control reachable ({"text":"Reset dashboard layout","top":525,"bottom":553,"left":140,"right":402} panel {"left":127,"right":415,"top":75,"bottom":566})
FAIL  384x832: every top bar control inside the viewport (layout saved08:4 168..408; DIV 364..408; Console settings 364..408; svg 379..393; circle 387..391; circle 381..385 header right 384)
FAIL  384x832: gear panel inside the viewport ({"left":120,"right":408,"top":75,"bottom":566})
FAIL  384x832: nothing in the gear panel past the screen edge (operator 133..395; operator 133..395; INPUT 133..395; ambient theme 133..395)
FAIL  384x832: gear panel last control reachable ({"text":"Reset dashboard layout","top":525,"bottom":553,"left":133,"right":395} panel {"left":120,"right":408,"top":75,"bottom":566})
FAIL  390x844: every top bar control inside the viewport (layout saved08:4 175..415; DIV 371..415; Console settings 371..415; svg 386..400; circle 395..398; circle 389..392 header right 390)
FAIL  390x844: gear panel inside the viewport ({"left":127,"right":415,"top":75,"bottom":566})
FAIL  390x844: nothing in the gear panel past the screen edge (operator 140..402; operator 140..402; INPUT 140..402; ambient theme 140..402)
FAIL  390x844: gear panel last control reachable ({"text":"Reset dashboard layout","top":525,"bottom":553,"left":140,"right":402} panel {"left":127,"right":415,"top":75,"bottom":566})
FAIL  384x832 text 130%: every top bar control inside the viewport (layout saved08:4 174..429; DIV 372..429; Console settings 372..429; svg 394..408; circle 402..405; circle 396..399 header right 384)
FAIL  384x832 text 130%: gear panel inside the viewport ({"left":55,"right":429,"top":97,"bottom":659})
FAIL  384x832 text 130%: nothing in the gear panel past the screen edge (operator 71..413; operator 71..413; INPUT 71..413; ambient theme 71..413)
FAIL  384x832 text 130%: gear panel last control reachable ({"text":"Reset dashboard layout","top":611,"bottom":642,"left":71,"right":413} panel {"left":55,"right":429,"top":97,"bottom":659})
RESULT FAIL
```

## After: this worktree's build (RESULT PASS, 51 PASS, 0 FAIL)
```
serving /home/col/SAM_ui-phone-gear-fit through the harness on port 4950
PASS  360x800: phone view renders
PASS  360x800: no horizontal overflow
PASS  360x800: health chip, sync badge, UTC clock and gear all present
PASS  360x800: every top bar control inside the viewport
PASS  360x800: gear keeps its size (44x44 or more)
PASS  360x800: gear panel inside the viewport
PASS  360x800: nothing in the gear panel past the screen edge
PASS  360x800: gear panel last control reachable
PASS  360x800: no horizontal overflow with the panel open
PASS  384x832: phone view renders
PASS  384x832: no horizontal overflow
PASS  384x832: health chip, sync badge, UTC clock and gear all present
PASS  384x832: every top bar control inside the viewport
PASS  384x832: gear keeps its size (44x44 or more)
PASS  384x832: gear panel inside the viewport
PASS  384x832: nothing in the gear panel past the screen edge
PASS  384x832: gear panel last control reachable
PASS  384x832: no horizontal overflow with the panel open
PASS  390x844: phone view renders
PASS  390x844: no horizontal overflow
PASS  390x844: health chip, sync badge, UTC clock and gear all present
PASS  390x844: every top bar control inside the viewport
PASS  390x844: gear keeps its size (44x44 or more)
PASS  390x844: gear panel inside the viewport
PASS  390x844: nothing in the gear panel past the screen edge
PASS  390x844: gear panel last control reachable
PASS  390x844: no horizontal overflow with the panel open
PASS  412x915: phone view renders
PASS  412x915: no horizontal overflow
PASS  412x915: health chip, sync badge, UTC clock and gear all present
PASS  412x915: every top bar control inside the viewport
PASS  412x915: gear keeps its size (44x44 or more)
PASS  412x915: gear panel inside the viewport
PASS  412x915: nothing in the gear panel past the screen edge
PASS  412x915: gear panel last control reachable
PASS  412x915: no horizontal overflow with the panel open
PASS  384x832 text 130%: phone view renders
PASS  384x832 text 130%: no horizontal overflow
PASS  384x832 text 130%: health chip, sync badge, UTC clock and gear all present
PASS  384x832 text 130%: every top bar control inside the viewport
PASS  384x832 text 130%: gear keeps its size (44x44 or more)
PASS  384x832 text 130%: gear panel inside the viewport
PASS  384x832 text 130%: nothing in the gear panel past the screen edge
PASS  384x832 text 130%: gear panel last control reachable
PASS  384x832 text 130%: no horizontal overflow with the panel open
PASS  360x800: More sheet inside the viewport
PASS  360x800: More sheet links inside the viewport
PASS  360x800: no horizontal overflow with the More sheet open
PASS  384x832: More sheet inside the viewport
PASS  384x832: More sheet links inside the viewport
PASS  384x832: no horizontal overflow with the More sheet open
RESULT PASS
```

## Gate blocking the unfixed code
`./deploy.sh --phone-fit-only` run in a copy of `c366517` (unfixed source plus the new `deploy.sh` and check), exit 1:
```
FAIL  412x915: gear panel inside the viewport ({"left":127,"right":415,"top":75,"bottom":566})
FAIL  384x832 text 130%: every top bar control inside the viewport (layout saved08:4 181..436; DIV 379..436; Console set
FAIL  384x832 text 130%: gear panel inside the viewport ({"left":62,"right":436,"top":97,"bottom":659})
FAIL  384x832 text 130%: nothing in the gear panel past the screen edge (operator 79..420; operator 79..420; INPUT 79..4
FAIL  384x832 text 130%: gear panel last control reachable ({"text":"Reset dashboard layout","top":611,"bottom":642,"lef
RESULT FAIL
!! phone-fit gate failed (exit 1); deploy stopped before the live build
deploy gate exit 1
```

## Desktop unchanged
Gear and open panel measured at 1280x650 and 1920x1080 on the live build and on this build: identical boxes (gear 1207,19 44x44 and panel 963,71 288x520 at 1280; gear 1839,25 and panel 1595,77 at 1920). Screenshots of the top right 420x600 compared pixel by pixel: the only differing pixels are a 13x9 px box over the clock seconds digits. Screenshots: `~/.cache/phone-gear-fit/shots/{before,after}-{1280,1920}-gear.png`. A 360 px phone screenshot with the panel open is `shots/phone360.png` (all four top bar items visible, panel inside the screen).

## Other gates
`npm test`: 596 pass, 0 fail, 2 skipped. `npm run typecheck`: clean. `npm run lint`: exit 0, one existing warning in `src/lib/server/projectMetrics.ts` (not touched here).

## For SAM: merge and deploy (Colin gate, not run)
```
cd /home/col/SAM_ui
git merge --no-ff fix/phone-gear-fit
./deploy.sh
```
`./deploy.sh` now runs the phone-fit gate on a copy build before the live build; it needs port 4950 free. Colin then checks the gear on the A16.
