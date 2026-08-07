'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, Settings2 } from 'lucide-react';

import { AMBIENT_THEMES, type AmbientTheme } from '@/types/dashboard';
import { SARCASM_LABELS, type SarcasmLevel } from '@/lib/personalityEngine';
import { cn } from '@/lib/utils';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-white/5"
    >
      <span className="min-w-0">
        <span className="block text-[11.5px] text-slate-300">{label}</span>
        {hint && <span className="block text-[10px] text-slate-600">{hint}</span>}
      </span>
      <span
        className={cn(
          'relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors',
          checked ? 'bg-[var(--sam-accent)]/70' : 'bg-void-500',
        )}
      >
        <motion.span
          className="absolute top-[2px] size-[11px] rounded-full bg-slate-100"
          animate={{ left: checked ? 13 : 2 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        />
      </span>
    </button>
  );
}

export function ControlDeck() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const ambientTheme = useUserPreferencesStore((s) => s.ambientTheme);
  const setAmbientTheme = useUserPreferencesStore((s) => s.setAmbientTheme);
  const backgroundIntensity = useUserPreferencesStore((s) => s.backgroundIntensity);
  const setBackgroundIntensity = useUserPreferencesStore((s) => s.setBackgroundIntensity);
  const parallaxEnabled = useUserPreferencesStore((s) => s.parallaxEnabled);
  const setParallaxEnabled = useUserPreferencesStore((s) => s.setParallaxEnabled);
  const gridOverlay = useUserPreferencesStore((s) => s.gridOverlay);
  const setGridOverlay = useUserPreferencesStore((s) => s.setGridOverlay);
  const reducedMotion = useUserPreferencesStore((s) => s.reducedMotion);
  const setReducedMotion = useUserPreferencesStore((s) => s.setReducedMotion);
  const compactDensity = useUserPreferencesStore((s) => s.compactDensity);
  const setCompactDensity = useUserPreferencesStore((s) => s.setCompactDensity);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);
  const setSarcasm = useUserPreferencesStore((s) => s.setSarcasm);
  const operatorName = useUserPreferencesStore((s) => s.operatorName);
  const setOperatorName = useUserPreferencesStore((s) => s.setOperatorName);
  const resetLayout = useUserPreferencesStore((s) => s.resetLayout);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Console settings"
        aria-expanded={open}
        className={cn(
          'rounded-[4px] border border-void-400/60 p-1.5 text-slate-400 transition-colors',
          open ? 'border-[var(--sam-accent)]/50 bg-white/6 text-slate-100' : 'hover:bg-white/5 hover:text-slate-200',
        )}
      >
        <Settings2 size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="glass-strong absolute top-full right-0 z-50 mt-2 w-72 origin-top-right rounded-[6px] p-3 shadow-[0_28px_70px_-18px_rgba(0,0,0,0.92)]"
          >
            {/* Operator */}
            <label className="mb-3 block">
              <span className="label mb-1.5 block">operator</span>
              <input
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                maxLength={40}
                className="glass-sunken w-full rounded-[4px] border border-void-400/60 px-2 py-1.5 text-[11.5px] text-slate-200 focus:border-[var(--sam-accent)]/50 focus:outline-none"
              />
            </label>

            {/* Ambient theme */}
            <div className="mb-3">
              <span className="label mb-1.5 block">ambient theme</span>
              <div className="grid grid-cols-5 gap-1.5">
                {AMBIENT_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setAmbientTheme(theme.id as AmbientTheme)}
                    title={theme.label}
                    aria-label={theme.label}
                    aria-pressed={ambientTheme === theme.id}
                    className={cn(
                      'relative flex h-9 items-center justify-center rounded-[4px] border transition-all',
                      ambientTheme === theme.id
                        ? 'border-slate-200/60 ring-1 ring-slate-200/30'
                        : 'border-void-400/60 hover:border-void-300',
                    )}
                    style={{
                      background: `linear-gradient(135deg, ${theme.swatch[0]}55, ${theme.swatch[1]}55)`,
                    }}
                  >
                    {ambientTheme === theme.id && <Check size={11} className="text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Background intensity */}
            <div className="mb-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">background intensity</span>
                <span className="tabular font-mono text-[9.5px] text-slate-500">
                  {(backgroundIntensity * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={backgroundIntensity}
                onChange={(event) => setBackgroundIntensity(Number(event.target.value))}
                aria-label="Background intensity"
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-void-500 accent-[var(--sam-accent)]"
              />
              {backgroundIntensity < 0.03 && (
                <p className="mt-1 text-[10px] text-slate-600 italic">
                  Renderer offline. Your GPU thanks you.
                </p>
              )}
            </div>

            {/* Sarcasm */}
            <div className="mb-3">
              <span className="label mb-1.5 block">sam&apos;s filter</span>
              <div className="grid grid-cols-4 gap-1">
                {([0, 1, 2, 3] as SarcasmLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSarcasm(level)}
                    aria-pressed={sarcasm === level}
                    className={cn(
                      'rounded-[3px] border px-1 py-1 font-mono text-[9px] tracking-wider uppercase transition-colors',
                      sarcasm === level
                        ? 'border-[var(--sam-accent)]/55 bg-[var(--sam-accent)]/18 text-[var(--sam-accent)]'
                        : 'border-void-400/60 text-slate-500 hover:text-slate-300',
                    )}
                  >
                    {SARCASM_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>

            <div className="my-2 h-px bg-void-500/60" />

            <Toggle
              label="Pointer parallax"
              hint="Camera drifts with the cursor"
              checked={parallaxEnabled}
              onChange={setParallaxEnabled}
            />
            <Toggle
              label="Circuit grid"
              hint="Floor plane overlay"
              checked={gridOverlay}
              onChange={setGridOverlay}
            />
            <Toggle
              label="Compact density"
              hint="Tighter grid rows"
              checked={compactDensity}
              onChange={setCompactDensity}
            />
            <Toggle
              label="Reduce motion"
              hint="Freezes ambient animation"
              checked={reducedMotion}
              onChange={setReducedMotion}
            />

            <div className="my-2 h-px bg-void-500/60" />

            <button
              type="button"
              onClick={() => {
                resetLayout();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-[11.5px] text-slate-400 transition-colors hover:bg-alarm-500/12 hover:text-alarm-300"
            >
              <RotateCcw size={12} />
              Reset dashboard layout
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
