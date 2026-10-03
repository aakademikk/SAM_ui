'use client';

/**
 * SAM — one link for every screen (T13, Must 6c).
 *
 * Chooses the desktop shell (`FleetDashboardShell`) or the phone layout
 * (`FleetPhoneView`) with the mockup's own gate: the phone layout when
 * `(max-width:819px),(pointer:coarse) and (max-height:559px)` matches (a
 * phone, or a phone on its side), the desktop otherwise; `?view=phone` or
 * `?view=desktop` overrides it for testing, as in the mockup.
 *
 * No flash of the wrong layout. The mockup decides in a script at the top of
 * the page, before anything is drawn, and hides the page while it
 * redirects. The server here cannot know the viewport, so it renders
 * neither layout: only an empty emerald-black page (the mockup's hidden
 * page). The decision runs in a layout effect, which React runs
 * synchronously after the first commit and before the browser paints, and
 * its state update re-renders before that paint too. So the first frame
 * with content is already the right layout, on a fresh load (hydration) and
 * on a client-side navigation alike, and only one layout (one floor canvas,
 * one set of polls) is ever mounted. If the viewport later crosses the
 * breakpoint (a resized window), the view follows it.
 *
 * The chat widget (T14) is the default `chatSlot`: `DashboardChatWidget`,
 * in the desktop's Chat slot or the phone's Ask SAM sheet. The wake word is
 * listened for here (`useWakeWord`), not inside the widget, because the
 * phone's sheet unmounts the widget while it is closed and the phone must
 * keep polling the bridge while the Dashboard is visible (WakeGate.java). A
 * "Hey Sam" leaves a `wakeToken` for the widget (which starts hands-free on
 * its open chat and clears it) and tells the layout to bring the chat on
 * screen: the phone opens the Ask SAM sheet, the small-laptop drawer
 * switches to its Chat tab (Must 3e). Off in demo mode, and when a caller
 * passes its own `chatSlot`.
 *
 * Not mounted at `/` yet: T22 swaps the route.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useWakeWord } from '@/lib/useWakeWord';

import DashboardChatWidget from './DashboardChatWidget';
import FleetDashboardShell from './FleetDashboardShell';
import FleetPhoneView from './FleetPhoneView';
import { PHONE_QUERY, chooseFleetView } from './phoneView';
import type { FleetViewKind } from './phoneView';

export interface FleetViewProps {
  /** Demo mode (T20). */
  demo?: boolean;
  /** Overrides the chat widget (T14, `DashboardChatWidget` by default): the desktop's Chat slot, the phone's Ask SAM sheet. */
  chatSlot?: ReactNode;
  /** The phone's slot below the job in flight (T15). */
  phoneBelowJobSlot?: ReactNode;
}

export default function FleetView({ demo = false, chatSlot, phoneBelowJobSlot }: FleetViewProps) {
  const [view, setView] = useState<FleetViewKind | null>(null);

  useLayoutEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const decide = () => setView(chooseFleetView(window.location.search, mq.matches));
    decide();
    mq.addEventListener('change', decide);
    return () => mq.removeEventListener('change', decide);
  }, []);

  /* "Hey Sam" while the Dashboard is on screen goes to the widget's chat (Must 3e) */
  const ownChat = chatSlot === undefined;
  const [wakeToken, setWakeToken] = useState(0);
  const wakeCount = useRef(0);
  const onWake = useCallback(() => {
    wakeCount.current += 1;
    setWakeToken(wakeCount.current);
  }, []);
  const onWakeHandled = useCallback(() => setWakeToken(0), []);
  useWakeWord(onWake, ownChat && !demo);

  const chat = ownChat ? (
    <DashboardChatWidget
      demo={demo}
      variant={view === 'phone' ? 'sheet' : 'panel'}
      wakeToken={wakeToken}
      onWakeHandled={onWakeHandled}
    />
  ) : chatSlot;

  if (view === 'phone') return <FleetPhoneView demo={demo} chatSlot={chat} chatWake={wakeToken} belowJobSlot={phoneBelowJobSlot} />;
  if (view === 'desktop') return <FleetDashboardShell demo={demo} chatSlot={chat} chatWake={wakeToken} />;
  return (
    <div
      className="fleet-dashboard"
      data-fleet-view="pending"
      aria-busy
      style={{ minHeight: '100dvh', background: '#030a07' }}
    />
  );
}
