'use client';

/**
 * SAM — the phone's bottom sheet (T13, Must 6b).
 *
 * A port of e-phone.html's `#p-focus` sheet and `.scrim`: a panel fixed to
 * the bottom of the screen, rounded at the top with a grab handle, at most
 * 78% of the screen tall and scrolling inside; it slides up when opened and
 * back down when closed (0.5 s, the mockup's easing; instant under reduced
 * motion). A tap on the dimmed page outside it closes it (the scrim carries
 * `data-back`, as in the mockup), and so does swiping it down (`phoneView.ts`
 * decides how far is far enough).
 *
 * `GeneralDetailSheet` puts a General's detail in it: the same
 * `GeneralDetailPanel` content as the desktop (T11), with the mockup's large
 * 512 px bust under the handle. `BottomSheet` on its own is the shell, used
 * by the phone view for the Ask SAM chat too (T14 fills it).
 */

import { useEffect, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';

import type { FloorState, GeneralId } from '@/types/floor';

import GeneralDetailPanel from './GeneralDetailPanel';
import { sheetDragOffset, sheetReleaseCloses } from './phoneView';

const CSS = `
.fs-scrim{position:fixed;inset:0;z-index:15;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .4s}
.fs-scrim[data-open]{opacity:1;pointer-events:auto}
.fs-sheet{position:fixed;left:0;right:0;bottom:0;z-index:20;box-sizing:border-box;border-radius:18px 18px 0 0;
  padding:10px 18px calc(26px + env(safe-area-inset-bottom));max-height:78vh;max-height:78dvh;overflow:auto;overscroll-behavior:contain;
  background:linear-gradient(180deg,#0b2419,#06140e);border:1px solid rgba(61,255,90,.12);border-bottom:0;color:#e8f7ee;
  font-size:12.5px;line-height:1.35;box-shadow:0 -20px 60px rgba(0,0,0,.6);
  transform:translateY(105%);visibility:hidden;transition:transform .5s cubic-bezier(.2,.8,.2,1),visibility 0s linear .5s}
.fs-sheet[data-open]{transform:none;visibility:visible;transition:transform .5s cubic-bezier(.2,.8,.2,1),visibility 0s}
.fs-sheet[data-dragging]{transition:none}
.fs-sheet::after{content:"";position:absolute;top:10px;left:50%;width:38px;height:4px;margin-left:-19px;border-radius:2px;background:rgba(157,255,112,.16)}
.fs-sheet *,.fs-sheet *::before,.fs-sheet *::after{box-sizing:border-box}
/* the General's detail inside the sheet: the sheet is the panel, so the desktop panel's own chrome goes */
.fs-sheet .fs-general>section{background:none!important;border:0!important;border-radius:0!important;padding:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
/* e-phone.html #p-focus::before: the large bust, 162 px tall, 14 px under the top of a 176 px block */
.fs-sheet .fs-general .fd-bust{height:176px!important;margin:0 0 4px!important;background-position:center 14px!important;background-size:auto 162px!important;
  -webkit-mask:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent) center 14px/162px 162px no-repeat,linear-gradient(transparent,#000 5%,#000 95%,transparent) center 14px/162px 162px no-repeat!important;
  mask:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent) center 14px/162px 162px no-repeat,linear-gradient(transparent,#000 5%,#000 95%,transparent) center 14px/162px 162px no-repeat!important}
.fs-sheet [data-back] kbd{display:none}
@media (prefers-reduced-motion: reduce){.fs-scrim,.fs-sheet,.fs-sheet[data-open]{transition:none}}
`;

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the sheet. */
  label: string;
  children: ReactNode;
  /** Extra attributes for tests and audits. */
  dataSheet?: string;
}

/** How long the slide-down runs before closed content is dropped (the CSS transition is 0.5 s). */
const CLOSE_MS = 520;

export function BottomSheet({ open, onClose, label, children, dataSheet }: BottomSheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // keep the last content on screen while the sheet slides away, then drop it (so a closed General stops polling)
  const kept = useRef<ReactNode>(null);
  if (open) kept.current = children;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => { kept.current = null; redraw(); }, CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  // back at the top whenever it opens
  useEffect(() => { if (open && sheetRef.current) sheetRef.current.scrollTop = 0; }, [open]);

  // swipe down to close: only from the top of the sheet's own scroll, and only downwards
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let y0 = 0, t0 = 0, dy = 0, tracking = false, dragging = false;
    const reset = () => { el.style.transform = ''; el.removeAttribute('data-dragging'); tracking = false; dragging = false; dy = 0; };
    const start = (e: TouchEvent) => {
      if (!el.hasAttribute('data-open') || e.touches.length !== 1) return;
      tracking = el.scrollTop <= 0; dragging = false; dy = 0;
      y0 = e.touches[0].clientY; t0 = performance.now();
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      dy = e.touches[0].clientY - y0;
      if (!dragging) {
        if (dy <= 4) { if (dy < -4) tracking = false; return; } // an upward move is a scroll, not a swipe
        dragging = true; el.setAttribute('data-dragging', '');
      }
      e.preventDefault();
      el.style.transform = `translateY(${sheetDragOffset(dy)}px)`;
    };
    const end = () => {
      if (!tracking) return;
      const close = dragging && sheetReleaseCloses(dy, performance.now() - t0);
      reset();
      if (close) onCloseRef.current();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', reset);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', reset);
    };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div className="fs-scrim" data-back data-open={open ? '' : undefined} aria-hidden onClick={onClose} />
      <section
        ref={sheetRef}
        className="fs-sheet"
        role="dialog"
        aria-modal={open || undefined}
        aria-label={label}
        aria-hidden={open ? undefined : true}
        data-sheet={dataSheet}
        data-open={open ? '' : undefined}
      >
        {open ? children : kept.current}
      </section>
    </>
  );
}

export interface GeneralDetailSheetProps {
  /** The General whose sheet is open, or null when closed. */
  general: GeneralId | null;
  state: FloorState | null;
  onClose: () => void;
  demo?: boolean;
}

/** A General's detail in the bottom sheet: the large bust, then the same content as the desktop panel. */
export default function GeneralDetailSheet({ general, state, onClose, demo = false }: GeneralDetailSheetProps) {
  return (
    <BottomSheet open={!!general} onClose={onClose} label="General detail" dataSheet="general">
      {general ? (
        <div className="fs-general" data-general={general}>
          <GeneralDetailPanel general={general} state={state} onClose={onClose} demo={demo} />
        </div>
      ) : null}
    </BottomSheet>
  );
}
