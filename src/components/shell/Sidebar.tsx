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
  Bot,
  Radio,
  Activity,
  Users,
  Bell,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { InstallButton } from './InstallButton';
import { LoginButton } from '@/components/auth/LoginButton';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { id: 'terminal', label: 'Terminal', href: '/terminal', icon: Terminal },
  { id: 'chat', label: 'Chat', href: '/chat', icon: MessageSquare },
  { id: 'practice', label: 'Roleplay', href: '/practice', icon: Users },
  { id: 'fleet', label: 'Fleet', href: '/fleet', icon: Bot },
  { id: 'status', label: 'Status', href: '/status', icon: Activity },
  { id: 'operations', label: 'Operations', href: '/operations', icon: Radio },
  { id: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
] as const;

/** Floating label beside a collapsed-rail icon. The parent carries `group` +
    `relative`. Focus uses `focus-visible` so a mouse click does not leave it
    pinned open; `z-50` keeps it above the aside's own contents, and the aside
    (z-40, no overflow clipping) sits above `<main>` (z-10). */
const RAIL_TOOLTIP_CLASS =
  'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 ' +
  'whitespace-nowrap rounded-md border border-void-700 bg-void-800 px-2 py-1 ' +
  'text-xs font-medium text-void-100 shadow-lg opacity-0 transition-opacity ' +
  'group-hover:opacity-100 group-focus-visible:opacity-100';

interface SidebarProps {
  /** Desktop only: whether the Sidebar is folded to an icon rail. Owned by
      `AppShell` rather than read here independently — `AppShell`'s own
      `md:ml-*` offset has to agree with this on every render (not just after
      a reload), and two components each reading `localStorage` on their own
      effect timing could disagree for a frame or go stale when one side
      toggles. A single source of truth passed down as a prop (plus the
      toggle callback) avoids that without a new context or a storage-event
      listener. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();

  if (collapsed) {
    return (
      <aside
        className="hidden md:flex flex-col items-center fixed left-0 top-0 bottom-0 z-40
                   w-[72px] bg-void-900/80 backdrop-blur-md border-r border-void-700
                   shrink-0 py-3 gap-1"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          className="group relative flex items-center justify-center w-11 h-11 mb-1 text-dim-400 hover:text-void-100 hover:bg-void-800 rounded-md transition-colors"
        >
          <PanelLeftOpen size={18} />
          <span className={RAIL_TOOLTIP_CLASS} aria-hidden="true">
            Expand sidebar
          </span>
        </button>

        <nav className="flex-1 flex flex-col items-center gap-1 w-full px-2">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`group relative flex items-center justify-center w-11 h-11 rounded-md transition-colors
                  ${active
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'text-dim-100 hover:text-void-100 hover:bg-void-800 border border-transparent'
                  }`}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.5} />
                {/* Always rendered (opacity, not display:none / sr-only) so the
                    icon-only link keeps its accessible name (axe link-name),
                    and fading it in on hover / keyboard focus doubles as the
                    floating label the spec asks for. Absolute + pointer-events
                    none: it never joins the rail's layout or steals clicks. */}
                <span className={RAIL_TOOLTIP_CLASS}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-40
                 w-56 bg-void-900/80 backdrop-blur-md border-r border-void-700
                 shrink-0"
    >
      {/* Brand */}
      <div className="flex items-center gap-1.5 pl-3 pr-1 pt-4 pb-3 border-b border-void-800">
        <Cpu size={22} className="text-accent shrink-0" />
        <div className="flex flex-col leading-none min-w-0">
          <span className="text-sm font-bold text-void-100 tracking-wide">SAM</span>
          <span className="text-[12px] text-dim-400 tracking-[0.12em] uppercase truncate">
            Core Dashboard
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
          className="ml-auto flex items-center justify-center w-11 h-11 shrink-0 text-dim-400 hover:text-void-100 hover:bg-void-800 rounded-md transition-colors"
        >
          <PanelLeftClose size={16} />
        </button>
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
                  : 'text-dim-100 hover:text-void-100 hover:bg-void-800 border border-transparent'
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
        <LoginButton />
        <div className="px-2 pt-1">
          <span className="text-[12px] text-dim-500 tracking-[0.16em] uppercase font-mono">
            Atwood Systems
          </span>
        </div>
      </div>
    </aside>
  );
}
