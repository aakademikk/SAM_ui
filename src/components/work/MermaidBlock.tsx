'use client';
/**
 * SAM — Mermaid diagram block for the work panel (Must 12).
 *
 * mermaid is large, so it is loaded with a dynamic import only when a block
 * mounts in the browser. Any failure or a 15 s timeout shows the source with a
 * one-line note, and an error boundary keeps one bad block from breaking the
 * rest of the document.
 */
import { Component, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export const MERMAID_TIMEOUT_MS = 15_000;
export const MERMAID_FALLBACK_NOTE = 'diagram could not be drawn';

/** Pure: what to show when a diagram cannot be drawn. The source stays verbatim. */
export function fallbackFor(source: string, error?: unknown): { note: string; source: string; error: string } {
  const detail = error instanceof Error ? error.message : error == null ? '' : String(error);
  return { note: MERMAID_FALLBACK_NOTE, source, error: detail };
}

function Fallback({ source, error }: { source: string; error?: unknown }) {
  const f = fallbackFor(source, error);
  return (
    <div className="my-2 max-w-full">
      <p className="text-xs text-dim-300">{f.note}</p>
      <pre className="max-w-full overflow-x-auto rounded border border-void-700 bg-void-980/60 px-2 py-1.5 text-xs font-mono text-dim-200">
        {f.source}
      </pre>
    </div>
  );
}

let initialised = false;

function MermaidInner({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<unknown>(undefined);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHasFailed(false);
    const draw = async () => {
      const mod = await import('mermaid');
      const mermaid = mod.default;
      if (!initialised) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
        initialised = true;
      }
      const { svg } = await mermaid.render(`mmd-${reactId}-${Date.now()}`, source);
      return svg;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), MERMAID_TIMEOUT_MS);
    });
    Promise.race([draw(), timeout])
      .then((svg) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed(err);
        setHasFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, reactId]);

  if (hasFailed) return <Fallback source={source} error={failed} />;
  return <div ref={ref} className="my-2 max-w-full overflow-x-auto" />;
}

class Boundary extends Component<{ source: string; children: ReactNode }, { error: unknown; bad: boolean }> {
  state = { error: undefined as unknown, bad: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, bad: true };
  }
  render() {
    if (this.state.bad) return <Fallback source={this.props.source} error={this.state.error} />;
    return this.props.children;
  }
}

export function MermaidBlock({ source }: { source: string }) {
  return (
    <Boundary source={source}>
      <MermaidInner source={source} />
    </Boundary>
  );
}

export default MermaidBlock;
