/**
 * SAM — pure rules for the item view: what to do with an item's meta, and the
 * load timeout. No React and no browser calls, so it runs under node:test.
 */
import { fileName, type ItemMeta } from '@/lib/workItems';

export const LOAD_TIMEOUT_MS = 15_000;
export const TEXT_MAX_BYTES = 2_097_152;
export const PDF_MAX_BYTES = 52_428_800;

export type Renderer = 'markdown' | 'html' | 'image' | 'video' | 'pdf';

export type ItemDecision =
  | { state: 'unavailable'; label: string }
  | { state: 'too-big'; message: string; path: string }
  | { state: 'load'; renderer: Renderer };

function rendererFor(path: string): Renderer | null {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'md':
      return 'markdown';
    case 'html':
      return 'html';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'mp4':
    case 'webm':
      return 'video';
    case 'pdf':
      return 'pdf';
    default:
      return null;
  }
}

export function decide(meta: ItemMeta): ItemDecision {
  const renderer = rendererFor(meta.path);
  if (!meta.available || meta.kind === null || renderer === null) {
    return { state: 'unavailable', label: `not available: ${fileName(meta.path)}` };
  }
  const size = meta.size;
  if (size !== null && size !== undefined) {
    const cap = renderer === 'pdf' ? PDF_MAX_BYTES : renderer === 'markdown' || renderer === 'html' ? TEXT_MAX_BYTES : null;
    if (cap !== null && size > cap) {
      return { state: 'too-big', message: 'too big to show here', path: meta.path };
    }
  }
  return { state: 'load', renderer };
}

/** Rejects with Error('timeout') if the promise has not settled after ms. */
export function withTimeout<T>(promise: Promise<T>, ms: number = LOAD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
