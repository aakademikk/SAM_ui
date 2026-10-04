/**
 * Mobile bottom tab bar. Renders only on small screens via CSS.
 *
 * Four destinations plus a "More" sheet (ux-fixes-spec.md Must 7 to 10): the
 * audit found 9 items here, four of them jargon (Term/RP/Ops/Prefs), each
 * cell well under the 44x44px floor. `MoreMenuSheet` carries the rest by
 * their plain Sidebar names.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  Activity,
  Bell,
  MoreHorizontal,
} from 'lucide-react';

import { MoreMenuSheet } from './MoreMenuSheet';

export const TABS = [
  { id: 'dashboard', label: 'Dash', href: '/', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageSquare },
  { id: 'notifications', label: 'Pings', href: '/notifications', icon: Bell },
  { id: 'status', label: 'Status', href: '/status', icon: Activity },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50
                   bg-void-900/95 backdrop-blur-md border-t border-void-700
                   flex items-center justify-around
                   pb-[env(safe-area-inset-bottom,0px)]
                   h-[calc(3.5rem+env(safe-area-inset-bottom,0px))]"
      >
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5 min-w-0 px-1 py-1
                ${active
                  ? 'text-accent'
                  : 'text-void-100'
                } transition-colors`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              <span className="text-[12px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5 min-w-0 px-1 py-1
            ${moreOpen
              ? 'text-accent'
              : 'text-void-100'
            } transition-colors`}
        >
          <MoreHorizontal size={20} strokeWidth={moreOpen ? 2.5 : 1.5} />
          <span className="text-[12px] font-medium leading-none">More</span>
        </button>
      </nav>

      <MoreMenuSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
