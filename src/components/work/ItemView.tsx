'use client';
/**
 * SAM — one item, any kind (Must 7, 19, 20, 32). Fetches meta, applies the
 * size caps, then loads the right renderer. No endless spinner: 15 s (meta
 * included) then "could not load" and a Retry button the user presses. Nothing
 * retries by itself. PdfView keeps its own 15 s timer and Retry.
 */
import { useCallback, useEffect, useState } from 'react';
import { MarkdownView } from './MarkdownView';
import { ImageItem, VideoItem } from './MediaView';
import { HtmlFrame } from './HtmlFrame';
import { WebsiteLink } from './WebsiteLink';
import { PdfView } from './PdfView';
import { decide, LOAD_TIMEOUT_MS, type ItemDecision, type Renderer } from './itemState';
import type { ItemMeta } from '@/lib/workItems';

export interface ItemViewProps {
  path: string;
  from?: string;
  onOpenItem?: (path: string, from?: string) => void;
  /** Full-screen panel: HTML and PDF fill the height instead of 70vh. */
  fullScreen?: boolean;
}

function query(path: string, from?: string): string {
  return `path=${encodeURIComponent(path)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'decided'; decision: ItemDecision; meta: ItemMeta; text?: string };

/** The scrolling body gives no definite height, so frames get an explicit one. */
function frameHeight(fullScreen?: boolean): string {
  return fullScreen ? 'h-[calc(100dvh-7rem)]' : 'h-[70vh]';
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-3">
      <p>Could not load.</p>
      <button type="button" onClick={onRetry} className="min-h-[44px] min-w-[44px] rounded border px-4">
        Retry
      </button>
    </div>
  );
}

interface TimedProps {
  renderer: Exclude<Renderer, 'markdown' | 'pdf'>;
  url: string;
  meta: ItemMeta;
  from?: string;
  onRetry: () => void;
  fullScreen?: boolean;
}

/** Image, video or HTML: a 15 s timer cleared by the element's load or loadedmetadata. */
function Timed({ renderer, url, meta, from, onRetry, fullScreen }: TimedProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
  if (failed) return <Failed onRetry={onRetry} />;
  const name = meta.title ?? meta.path.split('/').pop() ?? meta.path;
  return (
    <div
      className={`w-full max-w-full ${renderer === 'html' ? frameHeight(fullScreen) : ''}`}
      onLoadCapture={() => setLoaded(true)}
      onLoadedMetadataCapture={() => setLoaded(true)}
      onErrorCapture={() => setFailed(true)}
    >
      {renderer === 'image' ? <ImageItem src={url} alt={name} /> : null}
      {renderer === 'video' ? <VideoItem src={url} alt={name} /> : null}
      {renderer === 'html' ? <HtmlFrame path={meta.path} from={from} /> : null}
    </div>
  );
}

export function ItemView({ path, from, onOpenItem, fullScreen }: ItemViewProps) {
  const isWeb = /^https?:\/\//i.test(path);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (isWeb) return;
    let cancelled = false;
    const ctl = new AbortController();
    // One 15 s deadline covers the meta fetch; markdown gets its own 15 s for the body.
    const metaTimer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
    setPhase({ kind: 'loading' });
    (async () => {
      const res = await fetch(`/api/vault/meta?${query(path, from)}`, { signal: ctl.signal, cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('meta');
      const body = (await res.json()) as { items?: ItemMeta[] };
      clearTimeout(metaTimer);
      const meta = body.items?.[0];
      if (!meta) throw new Error('meta');
      const decision = decide(meta);
      if (decision.state === 'load' && decision.renderer === 'markdown') {
        const mdCtl = new AbortController();
        const onAbort = () => mdCtl.abort();
        ctl.signal.addEventListener('abort', onAbort);
        const mdTimer = setTimeout(() => mdCtl.abort(), LOAD_TIMEOUT_MS);
        try {
          const file = await fetch(`/api/vault/file?${query(path, from)}`, { signal: mdCtl.signal, cache: 'no-store', credentials: 'same-origin' });
          if (!file.ok) throw new Error('file');
          const text = await file.text();
          if (!cancelled) setPhase({ kind: 'decided', decision, meta, text });
        } finally {
          clearTimeout(mdTimer);
          ctl.signal.removeEventListener('abort', onAbort);
        }
        return;
      }
      if (!cancelled) setPhase({ kind: 'decided', decision, meta });
    })().catch(() => {
      if (!cancelled) setPhase({ kind: 'failed' });
    });
    return () => {
      cancelled = true;
      clearTimeout(metaTimer);
      ctl.abort();
    };
  }, [path, from, attempt, isWeb]);

  if (isWeb) return <WebsiteLink href={path} />;
  if (phase.kind === 'loading') return <p role="status" className="p-3 text-sm opacity-70">Loading...</p>;
  if (phase.kind === 'failed') return <Failed onRetry={retry} />;

  const { decision, meta } = phase;
  if (decision.state === 'unavailable') return <p role="status" className="break-words p-3">{decision.label}</p>;
  if (decision.state === 'too-big') {
    return (
      <div role="status" className="p-3">
        <p>Too big to show here.</p>
        <p className="mt-1 break-all text-sm opacity-70">{decision.path}</p>
      </div>
    );
  }
  const url = `/api/vault/file?${query(meta.path, from)}`;
  switch (decision.renderer) {
    case 'markdown':
      return <MarkdownView source={phase.text ?? ''} itemPath={meta.path} onOpenItem={onOpenItem} />;
    case 'pdf':
      return (
        <div className={`w-full max-w-full ${frameHeight(fullScreen)}`}>
          <PdfView path={meta.path} size={meta.size ?? 0} from={from} />
        </div>
      );
    default:
      return <Timed key={attempt} renderer={decision.renderer} url={url} meta={meta} from={from} onRetry={retry} fullScreen={fullScreen} />;
  }
}

export default ItemView;
