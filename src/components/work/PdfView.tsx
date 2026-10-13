'use client';
/**
 * SAM — PDFs drawn by SAM_ui, page by page (Must 32).
 *
 * pdfjs-dist is ESM and browser-only: it is loaded by dynamic import inside an
 * effect, never at module top level, so the test build never touches it.
 * Safe settings: no eval, no scripting, no XFA, no form layer. Pages are drawn
 * to canvas as they scroll into view. Only http(s) Link annotations become
 * anchors (pdfLinks.ts); every action annotation is ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { safePdfLinks, type SafePdfLink } from './pdfLinks';

export const PDF_MAX_BYTES = 52_428_800;
const LOAD_TIMEOUT_MS = 15_000;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export interface PdfViewProps {
  path: string;
  size: number;
  /** The item the link came from, passed on so the server can resolve relative paths. */
  from?: string;
}

function fileUrl(path: string, from?: string): string {
  return `/api/vault/file?path=${encodeURIComponent(path)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; doc: PDFDocumentProxy };

type Box = [number, number, number, number];

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  zoom: number;
  /** Height over width of page 1, used until this page has been measured. */
  ratio: number;
  register: (n: number, el: HTMLDivElement | null) => void;
}

function PdfPage({ doc, pageNumber, width, zoom, ratio, register }: PdfPageProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [links, setLinks] = useState<{ link: SafePdfLink; box: Box }[]>([]);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      holder.current = el;
      register(pageNumber, el);
    },
    [register, pageNumber],
  );

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width * zoom) / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current;
      if (!c) return;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      task = page.render({
        canvas: c,
        canvasContext: ctx,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      try {
        await task.promise;
      } catch {
        return; // cancelled or failed: leave the page blank
      }
      if (cancelled) return;
      setMeasured({ w: viewport.width, h: viewport.height });
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (cancelled) return;
      setLinks(
        safePdfLinks(annotations).map((link) => {
          const [x1, y1] = viewport.convertToViewportPoint(link.rect[0], link.rect[1]) as [number, number];
          const [x2, y2] = viewport.convertToViewportPoint(link.rect[2], link.rect[3]) as [number, number];
          const box: Box = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
          return { link, box };
        }),
      );
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageNumber, width, zoom]);

  const w = width * zoom;
  const h = measured && measured.w === w ? measured.h : w * ratio;
  return (
    <div ref={setRef} data-page={pageNumber} className="relative mx-auto my-2 bg-white" style={{ width: w, height: h }}>
      <canvas ref={canvas} aria-label={`Page ${pageNumber}`} className="block" />
      {links.map(({ link, box }, i) => (
        <a
          key={i}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          aria-label={`Open ${link.url} in a new tab`}
          className="absolute"
          style={{ left: box[0], top: box[1], width: box[2], height: box[3] }}
        />
      ))}
    </div>
  );
}

export function PdfView({ path, size, from }: PdfViewProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  const [ratio, setRatio] = useState(1.414);
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pages = useRef(new Map<number, HTMLDivElement>());
  const tooBig = size > PDF_MAX_BYTES;

  useEffect(() => {
    if (tooBig) return;
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
    setState({ kind: 'loading' });
    setCurrent(1);
    (async () => {
      const res = await fetch(fileUrl(path, from), { signal: ctl.signal, cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('fetch');
      const data = new Uint8Array(await res.arrayBuffer());
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      // isEvalSupported is no longer an option in pdfjs-dist 6 (it never evals); kept off
      // explicitly for older builds. Scripting is never loaded: it is off by default and the
      // pdf.sandbox files are not imported.
      const params = { data, isEvalSupported: false, enableXfa: false, stopAtErrors: false };
      const loadingTask = pdfjs.getDocument(params as Parameters<typeof pdfjs.getDocument>[0]);
      task = loadingTask;
      const loaded = await loadingTask.promise;
      if (cancelled) return;
      const first = await loaded.getPage(1);
      const v = first.getViewport({ scale: 1 });
      if (cancelled) return;
      clearTimeout(timer);
      setRatio(v.height / v.width);
      setState({ kind: 'ready', doc: loaded });
    })().catch(() => {
      if (!cancelled) setState({ kind: 'error' });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctl.abort();
      if (task) void task.destroy();
    };
  }, [path, from, attempt, tooBig]);

  const ready = state.kind === 'ready';
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(Math.max(0, el.clientWidth - 16));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ready]);

  const register = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pages.current.set(n, el);
    else pages.current.delete(n);
  }, []);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let best = 1;
    for (const [n, p] of pages.current) if (p.offsetTop <= mid && n > best) best = n;
    // At the very bottom the last page is the current one, even if it is shorter than a third of the view.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) for (const n of pages.current.keys()) if (n > best) best = n;
    setCurrent(best);
  }, []);

  if (tooBig) {
    return (
      <div role="status" className="p-3">
        <p>Too big to show here.</p>
        <p className="mt-1 break-all text-sm opacity-70">{path}</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className="p-3">
        <p>Could not load.</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-2 min-h-[44px] rounded border px-4 py-2">
          Retry
        </button>
      </div>
    );
  }
  if (state.kind === 'loading') {
    return (
      <div role="status" className="p-3">
        Loading PDF…
      </div>
    );
  }

  const total = state.doc.numPages;
  const btn = 'flex h-11 w-11 items-center justify-center rounded border text-lg disabled:opacity-40';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 p-1">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
          className={btn}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
          className={btn}
        >
          +
        </button>
        <span aria-live="polite" className="text-sm">
          Page {current} of {total}
        </span>
      </div>
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto bg-black/10">
        {Array.from({ length: total }, (_, i) => (
          <PdfPage key={i + 1} doc={state.doc} pageNumber={i + 1} width={width} zoom={zoom} ratio={ratio} register={register} />
        ))}
      </div>
    </div>
  );
}
