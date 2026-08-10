/**
 * Install button — appears when Chrome's beforeinstallprompt fires.
 * Hidden until the event is captured by ServiceWorkerRegistration.
 */

'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { triggerInstall } from './ServiceWorkerRegistration';

export function InstallButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'banner' }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone display mode).
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }

    const onReady = () => setReady(true);
    const onInstalled = () => { setInstalled(true); setReady(false); };

    // If the prompt was already captured before this component mounted.
    // Dynamic import to avoid circular dependency at module level.
    import('./ServiceWorkerRegistration').then((mod) => {
      if (mod.getDeferredInstall()) setReady(true);
    });

    window.addEventListener('sam:installready', onReady);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('sam:installready', onReady);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !ready) return null;

  if (variant === 'banner') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/10 border border-accent/30 rounded-lg mx-3 mb-3">
        <p className="text-xs text-void-200 flex-1">Install SAM to your home screen</p>
        <button
          type="button"
          onClick={() => triggerInstall()}
          className="px-3 py-1 bg-accent text-void-950 text-xs font-semibold rounded hover:bg-accent/90 transition-colors"
        >
          Install
        </button>
      </div>
    );
  }

  // Sidebar variant
  return (
    <button
      type="button"
      onClick={() => triggerInstall()}
      className="flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-accent/10 rounded-md transition-colors w-full"
    >
      <Download size={14} />
      Install app
    </button>
  );
}
