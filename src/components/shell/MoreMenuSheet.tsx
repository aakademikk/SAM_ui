'use client';

/**
 * SAM — the phone tab bar's "More" sheet (T9, Must 8, 9, 10).
 *
 * The tab bar only has room for 4 destinations plus "More" (Must 7). This
 * sheet lists the rest, by the Sidebar's own plain labels (`Sidebar.tsx`
 * `NAV_ITEMS`) — no abbreviations, unlike the tab bar's tight labels. It
 * reuses `BottomSheet` (`GeneralDetailSheet.tsx`) rather than forking a new
 * sheet: same scrim, slide-up/swipe-down, tap-outside-to-close and instant
 * behaviour under `prefers-reduced-motion: reduce`.
 */

import Link from 'next/link';
import {
  Terminal,
  Users,
  Bot,
  Radio,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import { BottomSheet } from '@/components/dashboard/fleet/GeneralDetailSheet';

export interface MoreMenuItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/** The Sidebar's own labels (`Sidebar.tsx` `NAV_ITEMS`) for the items that don't fit the tab bar. */
export const MORE_MENU_ITEMS: readonly MoreMenuItem[] = [
  { id: 'terminal', label: 'Terminal', href: '/terminal', icon: Terminal },
  { id: 'practice', label: 'Roleplay', href: '/practice', icon: Users },
  { id: 'fleet', label: 'Fleet', href: '/fleet', icon: Bot },
  { id: 'operations', label: 'Operations', href: '/operations', icon: Radio },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
] as const;

export interface MoreMenuSheetProps {
  open: boolean;
  onClose: () => void;
}

export function MoreMenuSheet({ open, onClose }: MoreMenuSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} label="More" dataSheet="more">
      {/* The sheet (z-20) sits under the tab bar (z-50) and is anchored to the
          viewport bottom, so its last link would land beneath the bar. Pad the
          content by the bar's height (+ safe area), as AppShell's <main> does. */}
      <nav aria-label="More" className="flex flex-col gap-1 pt-2 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]">
        {MORE_MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onClose}
              className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5
                         text-void-100 hover:bg-void-800 transition-colors"
            >
              <Icon size={20} strokeWidth={1.5} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </BottomSheet>
  );
}
