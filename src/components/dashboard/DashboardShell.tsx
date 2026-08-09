'use client';

import { useEffect } from 'react';

import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { TopBar } from '@/components/dashboard/TopBar';
import { StatCardGrid } from '@/components/dashboard/StatCardGrid';
import { VisualiserWidget } from '@/components/visualiser/VisualiserWidget';
import { ChatVoiceWidget } from '@/components/chat/ChatVoiceWidget';
import { AvatarReceptionist } from '@/components/avatar';

/**
 * Console root. Owns the data lifecycle and pushes preference state onto the
 * document element, where the CSS layer reads it.
 */
export function DashboardShell() {
  const bootstrap = useDashboardStore((s) => s.bootstrap);
  const startPolling = useDashboardStore((s) => s.startPolling);
  const stopPolling = useDashboardStore((s) => s.stopPolling);

  const ambientTheme = useUserPreferencesStore((s) => s.ambientTheme);
  const backgroundIntensity = useUserPreferencesStore((s) => s.backgroundIntensity);
  const gridOverlay = useUserPreferencesStore((s) => s.gridOverlay);
  const flushLayoutSync = useUserPreferencesStore((s) => s.flushLayoutSync);

  /* --- Data lifecycle ----------------------------------------------------- */
  useEffect(() => {
    void bootstrap();
    startPolling();
    return () => stopPolling();
  }, [bootstrap, startPolling, stopPolling]);

  /* --- Preferences → document -------------------------------------------- */
  useEffect(() => {
    document.documentElement.dataset.ambient = ambientTheme;
  }, [ambientTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sam-bg-intensity', backgroundIntensity.toFixed(2));
    // The circuit grid tracks intensity so the two layers never fight.
    root.style.setProperty(
      '--sam-grid-alpha',
      gridOverlay ? (0.02 + backgroundIntensity * 0.05).toFixed(3) : '0',
    );
  }, [backgroundIntensity, gridOverlay]);

  /* --- Never lose a pending layout on unload ------------------------------ */
  useEffect(() => {
    const onBeforeUnload = () => flushLayoutSync();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushLayoutSync]);

  return (
    <>
      {/* Visualiser is the primary background — full-screen canvas, behind everything */}
      <VisualiserWidget stateUrl="http://127.0.0.1:8790/state" />

      <ChatVoiceWidget />

      {/* Dashboard content overlaid with semi-transparent backgrounds so the
          visualiser remains visible through the glass panels */}
      <div className="relative z-10 min-h-screen">
        <main className="mx-auto w-full max-w-[1680px] px-3 py-3 sm:px-5 sm:py-4">
          <TopBar />
          <StatCardGrid />

          {/* ---- Avatar Receptionist ------------------------------------- */}
          <section className="mt-6 flex justify-center">
            <AvatarReceptionist />
          </section>

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1 pb-4">
            <span className="font-mono text-[9px] tracking-[0.16em] text-slate-700 uppercase">
              SAM core dashboard · atwood systems
            </span>
            <span className="font-mono text-[9px] tracking-[0.16em] text-slate-700 uppercase">
              drag any widget to reorder
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}
