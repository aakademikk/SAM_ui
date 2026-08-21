/**
 * App layout — wraps all main pages in the AppShell (sidebar + tab bar).
 * The /intro page lives outside this group so it renders standalone.
 */

import { AppShell } from '@/components/shell/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
