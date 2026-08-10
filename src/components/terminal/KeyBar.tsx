/**
 * Mobile key accessory bar — sits above the virtual keyboard on Android.
 *
 * Provides: Ctrl, Esc, Tab, ←, →, Ctrl-C
 * Hidden on desktop (md: breakpoint) since a physical keyboard is assumed.
 */

'use client';

interface KeyBarProps {
  /** Called with the key name when a button is pressed. */
  onKey: (key: string) => void;
}

const KEYS = [
  { label: 'Ctrl', value: 'ctrl', wide: false },
  { label: 'Esc', value: 'esc', wide: false },
  { label: 'Tab', value: 'tab', wide: false },
  { label: '←', value: 'arrowleft', wide: false },
  { label: '→', value: 'arrowright', wide: false },
  { label: 'Ctrl-C', value: 'ctrl-c', wide: true },
] as const;

export function KeyBar({ onKey }: KeyBarProps) {
  return (
    <div
      className="md:hidden flex items-center gap-1 px-1.5 py-1.5
                 bg-void-850 border-t border-void-700
                 select-none"
      style={{ touchAction: 'manipulation' }}
    >
      {KEYS.map((k) => (
        <button
          key={k.value}
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            onKey(k.value);
          }}
          className={`
            flex items-center justify-center
            bg-void-700 hover:bg-void-600 active:bg-void-500
            text-void-300 text-xs font-medium
            border border-void-600 rounded
            py-2 transition-colors
            select-none touch-none
            ${k.wide ? 'flex-[1.5]' : 'flex-1'}
          `}
          style={{ touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
