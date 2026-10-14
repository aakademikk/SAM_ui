/**
 * App layout — wraps all main pages in the AppShell (sidebar + tab bar).
 * The /intro page lives outside this group so it renders standalone.
 */

import { AppShell } from '@/components/shell/AppShell';
import { BuildWatch } from '@/components/shell/BuildWatch';

/**
 * Every app page renders per request, so its HTML goes out `no-store` and a
 * phone can never restore a stale copy from its HTTP cache (2026-10-14: the
 * prerendered /chat went out `s-maxage=31536000`, and the A16 kept opening a
 * pre-13-Oct build from the home screen). Checked live by
 * scripts/check-page-cache.cjs at the end of every deploy.
 */
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <BuildWatch />
      {children}
    </AppShell>
  );
}
