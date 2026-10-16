/**
 * WorkDivider — the vertical drag handle on the left edge of the desktop work
 * aside. Pointer events with capture, arrow keys nudge, no text selection
 * while dragging. The parent owns the width; this only reports new ones.
 */
'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { WORK_MIN_WIDTH, maxWorkWidth, widthFromPointer } from './workWidth';

const STEP = 24;

export function WorkDivider({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const prevSelect = useRef('');

  const end = () => {
    if (!dragging) return;
    setDragging(false);
    document.body.style.userSelect = prevSelect.current;
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    prevSelect.current = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onResize(widthFromPointer(e.clientX, window.innerWidth));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    onResize(Math.max(WORK_MIN_WIDTH, Math.min(maxWorkWidth(window.innerWidth), width + dir * STEP)));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize work panel"
      aria-valuemin={WORK_MIN_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={onKey}
      className={`absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none ${
        dragging ? 'bg-accent/60' : ''
      }`}
    />
  );
}
