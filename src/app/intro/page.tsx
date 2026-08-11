/**
 * /intro — the standalone boot screen the desktop kiosk browser opens on.
 *
 * The sequence itself lives in BootSequence so the kiosk and the installed
 * mobile PWA show exactly the same thing; this route only decides where to go
 * afterwards. Unlike the AppShell mount, this one plays every time — the kiosk
 * lands here deliberately.
 */

'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { BootSequence } from '@/components/shell/BootSequence';

export default function IntroPage() {
  const router = useRouter();

  const goToDashboard = useCallback(() => {
    router.replace('/');
  }, [router]);

  return (
    <div className="fixed inset-0 bg-[#010812]">
      <BootSequence onDone={goToDashboard} />
    </div>
  );
}
