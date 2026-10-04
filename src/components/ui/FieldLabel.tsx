/**
 * A visible caption for a text field, sitting on the field's top border like a
 * fieldset legend. It is a real `<label for>` — not `sr-only` and not an
 * `aria-label` — so the name is on screen for everyone (ux-fixes Must 21), yet
 * it is absolutely positioned inside the field's own wrapper and so adds no
 * height: a composer on a 390 px phone does not move.
 *
 * The wrapper must be `relative`; `bg` should match the field's own fill so
 * the caption cleanly interrupts the border.
 */

import { cn } from '@/lib/utils';

export function FieldLabel({
  htmlFor,
  bg = 'bg-void-900',
  className,
  children,
}: {
  htmlFor: string;
  /** Tailwind background class matching the field the caption sits on. */
  bg?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'absolute -top-1.5 left-3 z-10 px-1 rounded-sm text-[12px] leading-3 text-dim-500 select-none',
        bg,
        className,
      )}
    >
      {children}
    </label>
  );
}
