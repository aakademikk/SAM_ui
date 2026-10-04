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

import { useEffect, useState } from 'react';

import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { InstallButton } from './InstallButton';
import { PushNotifications } from './PushNotifications';
import { BootSequence } from './BootSequence';
import { SignedOutOverlay } from './SignedOutOverlay';
import { useDevDuplicateCheck } from './useDevDuplicateCheck';
import { SamBackground } from '@/components/visualiser/SamBackground';
import { readSidebarCollapsed, writeSidebarCollapsed } from '@/lib/sidebarCollapse';

export function AppShell({ children }: { children: React.ReactNode }) {
  useDevDuplicateCheck('AppShell');

  // The boot overlay runs its own full-screen visualiser canvas. Mounting the
  // ambient one underneath it at the same time means two canvases animating a
  // 500-node mesh on a phone, which is exactly where the intro would judder.
  const [booting, setBooting] = useState(true);

  // Desktop Sidebar collapse (Must 31). Owned here, not inside `Sidebar`
  // itself, because this component's own `md:ml-*` offset has to track it
  // too — a prop plus a callback keeps both in lockstep on every render,
  // not just after a reload. Starts expanded and reads the stored choice
  // after mount, same hydration-safe pattern as `ChatList.tsx`'s own
  // collapse: the server prerender has no localStorage, and an initialiser
  // that disagreed with it would mismatch on hydration.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    if (readSidebarCollapsed(localStorage)) setSidebarCollapsed(true);
  }, []);
  const toggleSidebarCollapsed = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    writeSidebarCollapsed(localStorage, next);
  };

  return (
    // No opaque background here: the body paints void-950 and the visualiser
    // sits above it at z-0, with all chrome and content stacked above at z-10.
    <div className="relative min-h-screen text-void-100">
      {/* Cold-start intro. Mounted here rather than on a route so the installed
          PWA gets it too — its start_url is `/`, which never hits /intro. */}
      <BootSequence once visualiser="vault" onDone={() => setBooting(false)} />

      {/* Ambient visualiser — behind every tab */}
      {!booting && <SamBackground />}

      {/* Global auth gate — renders null unless this device's session has
          been revoked (ux-fixes-spec.md §6, open question 1). Mounted once
          here, same as SamBackground/BootSequence, so every page gets it
          without each page wiring it up itself. */}
      <SignedOutOverlay />

      {/* Desktop sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebarCollapsed} />

      {/* Main content — offset by sidebar on desktop, padded for tab bar on mobile */}
      <main
        className={`
          relative z-10                     /* above the ambient visualiser */
          ${sidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-56'}
          pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0  /* tab bar on mobile */
          min-h-screen
        `}
      >
        {/* Install banner — appears when beforeinstallprompt fires */}
        <div className="md:hidden pt-3 px-3">
          <InstallButton variant="banner" />
        </div>

        {/* Push enable banner — appears only until notifications are allowed */}
        <PushNotifications />

        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <TabBar />
    </div>
  );
}
