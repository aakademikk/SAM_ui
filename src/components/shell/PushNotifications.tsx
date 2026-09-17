/**
 * PushNotifications — subscribes this device to SAM's Web Push pings.
 *
 * Silent when the job is done:
 *   - permission granted + already subscribed → nothing (already receiving)
 *   - permission granted + not subscribed → auto-subscribe (an existing
 *     install gets push the moment this ships — no click needed)
 *   - permission default → a small "enable" banner (browsers require a user
 *     gesture before the permission prompt will show)
 *   - permission denied → nothing (only the user can undo that in the
 *     browser's site settings)
 *   - insecure context / unsupported / logged out → nothing
 *
 * Subscription rows land in ~/.sam/push-subs.json on the server
 * (POST /api/push); ~/.sam/sam-push/send.mjs fans pings out to every row.
 * VAPID keys never leave the server except the public key, fetched here.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = 'checking' | 'done' | 'denied' | 'unsupported' | 'prompt';

export function PushNotifications() {
  const [state, setState] = useState<State>('checking');

  const subscribe = useCallback(async (): Promise<boolean> => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

      const registration = await navigator.serviceWorker.ready;

      // Already subscribed — idempotent guard for remounts.
      if (await registration.pushManager.getSubscription()) return true;

      const keyRes = await fetch('/api/push');
      if (!keyRes.ok) return false;
      const keyData: unknown = await keyRes.json();
      const publicKey = (keyData as { data?: { publicKey?: string } })?.data?.publicKey;
      if (!publicKey) return false;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const device = window.matchMedia('(display-mode: standalone)').matches
        ? 'pwa'
        : 'browser';

      const saveRes = await fetch('/api/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          device,
        }),
      });
      return saveRes.ok;
    } catch (err) {
      console.debug('[SAM] push subscribe failed:', err);
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    if (Notification.permission === 'granted') {
      // Permission already given but no subscription (fresh deploy on an
      // installed PWA) — subscribe in the background, no banner needed.
      void subscribe().then((ok) => setState(ok ? 'done' : 'unsupported'));
      return;
    }
    // 'default' — never asked. Browsers want a gesture before the prompt.
    setState('prompt');
  }, [subscribe]);

  if (state !== 'prompt') return null;

  return (
    <div className="px-3 pt-3 md:px-6">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/10 border border-accent/30 rounded-lg max-w-3xl">
        <Bell size={16} className="text-accent shrink-0" />
        <p className="text-xs text-dim-100 flex-1">
          Allow notifications to get SAM pings on this device
        </p>
        <button
          type="button"
          onClick={() => {
            setState('checking');
            void Notification.requestPermission()
              .then((permission) => {
                if (permission === 'granted') return subscribe();
                setState(permission === 'denied' ? 'denied' : 'prompt');
                return false;
              })
              .then((ok) => {
                if (ok) setState('done');
              });
          }}
          className="px-3 py-1 bg-accent text-void-950 text-xs font-semibold rounded hover:bg-accent/90 transition-colors shrink-0"
        >
          Enable
        </button>
      </div>
    </div>
  );
}
