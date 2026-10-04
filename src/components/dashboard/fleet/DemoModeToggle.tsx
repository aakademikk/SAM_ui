'use client';

/**
 * SAM — Demo mode switch (T20, Must 18, 20).
 *
 * A single control that both flips `demo` on/off and, while it is on, is
 * itself the persistent on-screen "Demo" marker Must 20 requires — there is
 * no separate always-on badge, this button doubles as both so there is only
 * ever one place that says so.
 */

export interface DemoModeToggleProps {
  demo: boolean;
  onToggle: () => void;
  className?: string;
}

export default function DemoModeToggle({ demo, onToggle, className }: DemoModeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={demo}
      aria-label={demo ? 'Demo mode is on. Click to return to the live fleet.' : 'Switch the Dashboard to demo mode.'}
      title={
        demo
          ? 'Demo mode: replaying invented demo jobs, no live data on screen. Click to return to the live fleet.'
          : 'Switch to demo mode: replays invented demo jobs on a loop, hides all live data.'
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold tracking-[0.08em] uppercase transition-colors ${className ?? ''}`}
      style={
        demo
          ? { background: 'rgba(45,212,191,.16)', borderColor: 'rgba(45,212,191,.55)', color: '#2dd4bf' }
          : { background: 'rgba(157,255,112,.045)', borderColor: 'rgba(61,255,90,.2)', color: '#98b6a6' }
      }
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: demo ? '#2dd4bf' : '#5f7d6e',
          boxShadow: demo ? '0 0 6px #2dd4bf' : undefined,
        }}
      />
      Demo
    </button>
  );
}
