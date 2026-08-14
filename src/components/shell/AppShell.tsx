/**
 * AppShell — single component tree layout.
 *
 * Desktop: persistent left sidebar + content area
 * Mobile:  content area + bottom tab bar
 *
 * Both Sidebar and TabBar are mounted, but CSS controls visibility.
 * The content area is always mounted exactly once — no duplication.
 */

'use client';

import { useState } from 'react';

import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { InstallButton } from './InstallButton';
import { BootSequence } from './BootSequence';
import { useDevDuplicateCheck } from './useDevDuplicateCheck';
import { SamBackground } from '@/components/visualiser/SamBackground';

export function AppShell({ children }: { children: React.ReactNode }) {
  useDevDuplicateCheck('AppShell');

  // The boot overlay runs its own full-screen visualiser canvas. Mounting the
  // ambient one underneath it at the same time means two canvases animating a
  // 500-node mesh on a phone, which is exactly where the intro would judder.
  const [booting, setBooting] = useState(true);

  return (
    // No opaque background here: the body paints void-950 and the visualiser
    // sits above it at z-0, with all chrome and content stacked above at z-10.
    <div className="relative min-h-screen text-void-100">
      {/* Cold-start intro. Mounted here rather than on a route so the installed
          PWA gets it too — its start_url is `/`, which never hits /intro. */}
      <BootSequence once visualiser="vault" onDone={() => setBooting(false)} />

      {/* Ambient visualiser — behind every tab */}
      {!booting && <SamBackground />}

      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content — offset by sidebar on desktop, padded for tab bar on mobile */}
      <main
        className="
          relative z-10                     /* above the ambient visualiser */
          md:ml-56                          /* sidebar width on desktop */
          pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0  /* tab bar on mobile */
          min-h-screen
        "
      >
        {/* Install banner — appears when beforeinstallprompt fires */}
        <div className="md:hidden pt-3 px-3">
          <InstallButton variant="banner" />
        </div>

        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <TabBar />
    </div>
  );
}
