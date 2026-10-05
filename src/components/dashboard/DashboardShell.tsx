'use client';

import { useEffect } from 'react';

import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { TopBar } from '@/components/dashboard/TopBar';
import { StatCardGrid } from '@/components/dashboard/StatCardGrid';
import { ChatVoiceWidget } from '@/components/chat/ChatVoiceWidget';
import { AvatarReceptionist } from '@/components/avatar';

/**
 * Console root. Owns the data lifecycle. Theme, intensity and grid reach the
 * document element through `PreferencesApplier` in `AppShell`, on every page.
 */
export function DashboardShell() {
  const bootstrap = useDashboardStore((s) => s.bootstrap);
  const startPolling = useDashboardStore((s) => s.startPolling);
  const stopPolling = useDashboardStore((s) => s.stopPolling);

  const flushLayoutSync = useUserPreferencesStore((s) => s.flushLayoutSync);

  /* --- Data lifecycle ----------------------------------------------------- */
  useEffect(() => {
    void bootstrap();
    startPolling();
    return () => stopPolling();
  }, [bootstrap, startPolling, stopPolling]);

  /* --- Never lose a pending layout on unload ------------------------------ */
  useEffect(() => {
    const onBeforeUnload = () => flushLayoutSync();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushLayoutSync]);

  return (
    <>
      {/* The visualiser now lives in AppShell so it backs every tab, not just
          this one. Mounting it here as well would run a second full-screen
          canvas over the top of the first. */}

      <ChatVoiceWidget />

      {/* Dashboard content overlaid with semi-transparent backgrounds so the
          visualiser remains visible through the glass panels */}
      <div className="relative z-10 min-h-screen">
        <main className="mx-auto w-full max-w-[1680px] px-3 pt-3 pb-20 sm:px-5 sm:py-4">
          <TopBar />
          <StatCardGrid />

          {/* ---- Avatar Receptionist (disabled) ----------------------------
          <section className="mt-6 flex justify-center">
            <AvatarReceptionist />
          </section>
          */}

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1 pb-4">
            <span className="font-mono text-[12px] tracking-[0.16em] text-dim-500 uppercase">
              SAM core dashboard · atwood systems
            </span>
            <span className="font-mono text-[12px] tracking-[0.16em] text-dim-500 uppercase">
              drag any widget to reorder
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}
