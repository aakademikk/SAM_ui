import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'SAM — Core Dashboard',
  description:
    'Command console for SAM (Seriously Awesome Machine): agent fleet supervision, vault memory, system telemetry and raw command execution.',
  applicationName: 'SAM',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#05050d',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-ambient="void" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
