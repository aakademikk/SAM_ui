/**
 * SAM — Ambient background visualiser.
 *
 * Mounted once in the AppShell so it sits behind every tab, not just the
 * dashboard. Its state comes from the local activity store, so it reacts to
 * what SAM is actually doing in this browser — thinking while a chat turn
 * runs, speaking while TTS plays — rather than polling a localhost address
 * that only exists on the desktop.
 *
 * Dimmed relative to the dashboard's rendering: this sits under dense text on
 * every screen, so it must read as atmosphere and never compete with content.
 *
 * Renders the real vault wikilink graph (see VaultGraphVisualiser) in `ambient`
 * mode — no ground of its own, no vignette, no boot assembly, and pulled well
 * down in size, brightness and tempo. The mask below is the legibility control
 * and is tuned for text; the visualiser deliberately does not add a second one.
 */

'use client';

import { VaultGraphVisualiser } from './VaultGraphVisualiser';
import { useSamActivity } from '@/lib/samActivity';

export function SamBackground() {
  const activity = useSamActivity((s) => s.activity);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        // Only the very centre is pulled back, where body copy is densest.
        // The first pass masked far too aggressively and the mesh vanished.
        maskImage:
          'radial-gradient(ellipse 110% 85% at 50% 45%, rgb(0 0 0 / 0.62) 0%, #000 42%)',
        WebkitMaskImage:
          'radial-gradient(ellipse 110% 85% at 50% 45%, rgb(0 0 0 / 0.62) 0%, #000 42%)',
      }}
    >
      <VaultGraphVisualiser state={activity} ambient />
    </div>
  );
}
