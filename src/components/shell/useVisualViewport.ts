/**
 * Tracks the VisualViewport API for Android keyboard handling.
 *
 * On Android Chrome, the soft keyboard resizes the visual viewport but NOT
 * the layout viewport. `100vh` includes the keyboard area; `100dvh` handles
 * the simple case, but when the keyboard opens/closes the VisualViewport
 * fires resize events that we use to set a CSS custom property on the
 * terminal element so the input stays pinned above the keyboard.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';

interface UseVisualViewportOptions {
  /** Ref to the element that should track the viewport height. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** If true, offset for the key accessory bar height. */
  keyBarHeight?: number;
}

export function useVisualViewport({ containerRef, keyBarHeight = 0 }: UseVisualViewportOptions) {
  const initialised = useRef(false);

  const updateHeight = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Prefer VisualViewport API (Android Chrome). Falls back to window.innerHeight.
    const vv = window.visualViewport;
    if (vv) {
      const vh = vv.height - keyBarHeight;
      el.style.setProperty('--sam-vv-height', `${vh}px`);
      // Offset so the bottom of the container aligns with the top of the keyboard.
      const offset = vv.offsetTop ?? 0;
      el.style.setProperty('--sam-vv-offset', `${offset}px`);
    } else {
      el.style.removeProperty('--sam-vv-height');
      el.style.removeProperty('--sam-vv-offset');
    }
  }, [containerRef, keyBarHeight]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => updateHeight();
    const onScroll = () => updateHeight();

    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onScroll);

    // Initial read — defer to avoid layout thrash.
    const frame = requestAnimationFrame(() => {
      updateHeight();
      initialised.current = true;
    });

    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [updateHeight]);
}
