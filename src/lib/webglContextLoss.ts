/**
 * SAM — watch a WebGL canvas for context loss (2026-10-08).
 *
 * After two GPU process crashes close together (NVIDIA Xid 69 on the kiosk),
 * Chrome never restores the context and composites the dead canvas as an
 * opaque white layer. The visualiser uses this to hide the canvas while the
 * context is lost and show it again if Chrome restores it.
 * Diagnosis: ~/.sam/work/samui-background/diagnosis-2026-10-08.md.
 */

/** Calls `onChange(true)` on `webglcontextlost` and `onChange(false)` on
 *  `webglcontextrestored`. Returns a function that removes both listeners. */
export function watchContextLoss(target: EventTarget, onChange: (lost: boolean) => void): () => void {
  const onLost = () => onChange(true);
  const onRestored = () => onChange(false);
  target.addEventListener('webglcontextlost', onLost);
  target.addEventListener('webglcontextrestored', onRestored);
  return () => {
    target.removeEventListener('webglcontextlost', onLost);
    target.removeEventListener('webglcontextrestored', onRestored);
  };
}
