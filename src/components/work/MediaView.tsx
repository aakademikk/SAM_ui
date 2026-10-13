/**
 * SAM — image and video renderers for the work panel.
 *
 * Images (SVG included) are only ever an img element, never object, embed or
 * a frame (Must 27). Videos never start by themselves. No browser-only API is
 * touched at module load, so renderToStaticMarkup works in tests.
 */
import { useEffect, useState } from 'react';

export interface ImageItemProps {
  src: string;
  alt?: string;
}

export function ImageItem({ src, alt = '' }: ImageItemProps) {
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (bad) return <span>{alt}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt ? `Open image full size: ${alt}` : 'Open image full size'}
        className="my-2 block min-h-[44px] min-w-[44px] max-w-full cursor-zoom-in p-0 text-left"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} className="h-auto max-w-full" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Image'}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/90 p-2"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close image"
            className="fixed right-2 top-2 z-50 flex h-11 w-11 items-center justify-center rounded bg-void-900 text-lg text-dim-50"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-none max-w-none" />
        </div>
      )}
    </>
  );
}

export interface VideoItemProps {
  src: string;
  /** Shown if the file cannot be loaded at all. */
  alt?: string;
}

export function VideoItem({ src, alt = '' }: VideoItemProps) {
  const [bad, setBad] = useState(false);
  if (bad && alt) return <span>{alt}</span>;
  return (
    <video
      src={src}
      controls
      preload="metadata"
      playsInline
      onError={() => setBad(true)}
      className="my-2 block h-auto max-w-full"
    />
  );
}
