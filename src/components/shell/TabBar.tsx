/**
 * Mobile bottom tab bar. Renders only on small screens via CSS.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Terminal,
  MessageSquare,
  Settings,
} from 'lucide-react';

const TABS = [
  { id: 'dashboard', label: 'Dash', href: '/', icon: LayoutDashboard },
  { id: 'terminal', label: 'Term', href: '/terminal', icon: Terminal },
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageSquare },
  { id: 'settings', label: 'Prefs', href: '/settings', icon: Settings },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
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
            className={`flex flex-col items-center justify-center gap-0.5 min-w-0 px-3 py-1
              ${active
                ? 'text-accent'
                : 'text-void-500 hover:text-void-300'
              } transition-colors`}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
            <span className="text-[10px] font-medium leading-none">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
