/**
 * Dev-mode check: warns if a component is mounted more than once.
 *
 * Phase 4's cardinal rule — one component tree, no breakpoint-duplicated
 * terminal instances opening duplicate SSE connections.
 */

'use client';

import { useRef } from 'react';

// Track mount counts globally so the check survives HMR and sibling instances.
const mountCounts = new Map<string, number>();

if (typeof window !== 'undefined') {
  // Reset on every page navigation so the count reflects the current tree.
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    mountCounts.clear();
    return originalPushState(...args);
  };
  window.addEventListener('popstate', () => mountCounts.clear());
}

/**
 * Call once at the top of a component. In dev mode, warns if componentName
 * is already mounted elsewhere in the tree.
 */
export function useDevDuplicateCheck(componentName: string) {
  const warned = useRef(false);

  if (process.env.NODE_ENV === 'development' && !warned.current) {
    const count = mountCounts.get(componentName) ?? 0;
    mountCounts.set(componentName, count + 1);

    if (count > 0) {
      console.warn(
        `[SAM] DUPLICATE MOUNT: <${componentName}> is mounted ${count + 1} times. ` +
          'This means two component trees are fighting over the same server session. ' +
          'Use a single tree and swap only the chrome via CSS breakpoints.',
      );
      warned.current = true;
    }

    // Clean up on unmount so navigating away + back doesn't falsely warn.
    return () => {
      const c = mountCounts.get(componentName) ?? 1;
      if (c <= 1) {
        mountCounts.delete(componentName);
      } else {
        mountCounts.set(componentName, c - 1);
      }
    };
  }
}
