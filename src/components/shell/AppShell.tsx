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

import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { InstallButton } from './InstallButton';
import { useDevDuplicateCheck } from './useDevDuplicateCheck';

export function AppShell({ children }: { children: React.ReactNode }) {
  useDevDuplicateCheck('AppShell');

  return (
    <div className="min-h-screen bg-void-950 text-void-100">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content — offset by sidebar on desktop, padded for tab bar on mobile */}
      <main
        className="
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
