/**
 * Desktop sidebar navigation. Hidden on mobile via CSS.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Terminal,
  MessageSquare,
  Settings,
  Cpu,
} from 'lucide-react';
import { InstallButton } from './InstallButton';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { id: 'terminal', label: 'Terminal', href: '/terminal', icon: Terminal },
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-40
                 w-56 bg-void-900/80 backdrop-blur-md border-r border-void-700
                 shrink-0"
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4 border-b border-void-800">
        <Cpu size={22} className="text-accent" />
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold text-void-100 tracking-wide">SAM</span>
          <span className="text-[9px] text-void-500 tracking-[0.12em] uppercase">
            Core Dashboard
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 pt-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
                ${active
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'text-void-400 hover:text-void-200 hover:bg-void-800 border border-transparent'
                }`}
            >
              <Icon size={17} strokeWidth={active ? 2.5 : 1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-void-800 space-y-1 px-2 py-3">
        <InstallButton variant="sidebar" />
        <div className="px-2 pt-1">
          <span className="text-[9px] text-void-600 tracking-[0.16em] uppercase font-mono">
            Atwood Systems
          </span>
        </div>
      </div>
    </aside>
  );
}
