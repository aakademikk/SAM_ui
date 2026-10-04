import type { Metadata, Viewport } from 'next';

import './globals.css';
import { ServiceWorkerRegistration } from '@/components/shell/ServiceWorkerRegistration';
import { ScreenWakeLock } from '@/components/shell/ScreenWakeLock';
import { bootScript } from '@/lib/preferencesBoot';

export const metadata: Metadata = {
  title: 'SAM — Core Dashboard',
  description: 'Command console for SAM: daily tasks, project delivery health, and system telemetry.',
  applicationName: 'SAM',
  robots: { index: false, follow: false },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'SAM',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  // Matches manifest background_color so the PWA splash hands over to the boot
  // screen without a colour step.
  themeColor: '#010812',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Android-only: resize the LAYOUT viewport when the soft keyboard opens so the
  // composer and tab bar ride above it natively. Without this, the keyboard is
  // dismissed because the JS-driven resize (--sam-vv-height) races the IME's own
  // scroll-into-view during the open animation.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-ambient="toxic" suppressHydrationWarning>
      <head>
        {/* Saved theme, intensity and grid onto <html> before first paint, so a
            reload never flashes Toxic (floor-fixes Must 11). First in <head>;
            `data-ambient="toxic"` above stays the default for a device with
            nothing saved, and suppressHydrationWarning covers the difference. */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
        {/* Apple PWA meta — Next.js appleWebApp above handles most, but these are the belt-and-suspenders */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SAM" />
      </head>
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistration />
        <ScreenWakeLock />
      </body>
    </html>
  );
}
