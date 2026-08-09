'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { VisualiserWidget } from '@/components/visualiser/VisualiserWidget';

export default function IntroPage() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [bootText, setBootText] = useState('');
  const [ready, setReady] = useState(false);

  const bootSequence = [
    'INITIALIZING CORE SYSTEMS…',
    'NEURAL MESH ONLINE',
    'VOICE INTERFACE READY',
    'VISUALISER CONNECTED',
    'DASHBOARD ACTIVE',
  ];

  /* ---- Boot text animation ----------------------------------------------- */
  useEffect(() => {
    setVisible(true);
    let lineIdx = 0;
    let charIdx = 0;
    let currentText = '';

    const timer = setInterval(() => {
      if (lineIdx < bootSequence.length) {
        const line = bootSequence[lineIdx];
        if (charIdx < line.length) {
          currentText += line[charIdx];
          setBootText((prev) => {
            // Replace the last line
            const lines = prev.split('\n');
            lines[lines.length - 1] = currentText;
            return lines.join('\n');
          });
          charIdx++;
        } else {
          setBootText((prev) => prev + '\n');
          lineIdx++;
          charIdx = 0;
          currentText = '';
          if (lineIdx === bootSequence.length) {
            setTimeout(() => setReady(true), 600);
          }
        }
      }
    }, 35);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Redirect to dashboard --------------------------------------------- */
  const goToDashboard = useCallback(() => {
    router.replace('/');
  }, [router]);

  /* ---- Auto-redirect after ready ----------------------------------------- */
  useEffect(() => {
    if (ready) {
      const t = setTimeout(goToDashboard, 800);
      return () => clearTimeout(t);
    }
  }, [ready, goToDashboard]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#010812] transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onClick={ready ? goToDashboard : undefined}
    >
      {/* Core glow */}
      <div className="relative mb-8">
        {/* Compact visualiser, fades in behind the orb/text */}
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-1000 ${visible ? 'opacity-60' : 'opacity-0'}`}
        >
          <VisualiserWidget size={220} stateUrl="http://127.0.0.1:8790/state" />
        </div>
        <div
          className="h-32 w-32 rounded-full transition-all duration-1000"
          style={{
            background: ready
              ? 'radial-gradient(circle, rgba(0,210,255,0.4) 0%, rgba(0,210,255,0.1) 40%, transparent 70%)'
              : 'radial-gradient(circle, rgba(0,210,255,0.15) 0%, transparent 60%)',
            boxShadow: ready
              ? '0 0 60px -10px rgba(0,210,255,0.5), 0 0 120px -20px rgba(0,210,255,0.3)'
              : 'none',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-mono text-[32px] font-bold tracking-[0.2em] transition-all duration-700"
            style={{
              color: ready ? '#fff' : 'rgba(0,210,255,0.6)',
              textShadow: ready
                ? '0 0 20px rgba(0,210,255,0.6), 0 0 60px rgba(0,210,255,0.3)'
                : 'none',
            }}
          >
            SAM
          </span>
        </div>
      </div>

      {/* Boot console */}
      <pre className="mb-8 h-[120px] font-mono text-[10px] tracking-[0.12em] text-slate-500">
        {bootText || (visible ? ' ' : '')}
      </pre>

      {/* Enter prompt */}
      <div
        className={`transition-all duration-500 ${ready ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
      >
        {ready && (
          <p className="animate-pulse font-mono text-[10px] tracking-[0.2em] text-accent">
            PRESS ANY KEY OR CLICK TO ENTER
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 font-mono text-[8px] tracking-[0.18em] text-slate-700">
        ATWOOD SYSTEMS · CORE DASHBOARD
      </div>
    </div>
  );
}
