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
 */

'use client';

import { VisualiserWidget } from './VisualiserWidget';
import { useSamActivity } from '@/lib/samActivity';

export function SamBackground() {
  const activity = useSamActivity((s) => s.activity);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 opacity-90"
      style={{
        // Only the very centre is pulled back, where body copy is densest.
        // The first pass masked far too aggressively and the mesh vanished.
        maskImage:
          'radial-gradient(ellipse 110% 85% at 50% 45%, rgb(0 0 0 / 0.45) 0%, #000 45%)',
        WebkitMaskImage:
          'radial-gradient(ellipse 110% 85% at 50% 45%, rgb(0 0 0 / 0.45) 0%, #000 45%)',
      }}
    >
      <VisualiserWidget state={activity} hud={false} />
    </div>
  );
}
