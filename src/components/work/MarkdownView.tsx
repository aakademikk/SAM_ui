/**
 * SAM — Markdown item renderer for the work panel.
 *
 * No raw-HTML plugin is loaded, so react-markdown shows raw HTML as plain
 * text (Must 15). Its default urlTransform drops javascript: links; it is kept.
 * Phone first: tables and code scroll inside themselves, never the page.
 */
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
// The test build is CommonJS (module node16), where TS1479 objects to requiring
// an ESM-only package; Node 22.22 loads it through require at run time anyway.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1479 (test build only; the app build resolves these as ESM)
import ReactMarkdown from 'react-markdown';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1479 (test build only)
import remarkGfm from 'remark-gfm';
import { ImageItem, VideoItem } from '@/components/work/MediaView';
import { MermaidBlock } from '@/components/work/MermaidBlock';
import { isVideoPath, linkTarget, remarkWikilinks } from '@/components/work/wikilinks';
import type { ItemMeta } from '@/lib/workItems';

export interface MarkdownViewProps {
  source: string;
  /** Vault path of the item being shown; vault links and embeds are found next to it first. */
  itemPath?: string;
  /** Opens another vault item: the path as written, and the item it was found in. */
  onOpenItem?: (path: string, from?: string) => void;
}

const metaCache = new Map<string, Promise<boolean>>();

/** Ask /api/vault/meta whether a link target is available. Unknown or failed means no. */
function useAvailable(path: string, from?: string): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    const key = `${from ?? ''}\n${path}`;
    let pending = metaCache.get(key);
    if (!pending) {
      const qs = `path=${encodeURIComponent(path)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
      pending = fetch(`/api/vault/meta?${qs}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<{ items?: ItemMeta[] }>) : { items: [] }))
        .then((j) => j.items?.[0]?.available === true) // one path asked, so the first answer is its answer
        .catch(() => false);
      metaCache.set(key, pending);
      void pending.then((v) => {
        if (!v) metaCache.delete(key);
      });
    }
    void pending.then((v) => {
      if (live) setOk(v);
    });
    return () => {
      live = false;
    };
  }, [path, from]);
  return ok;
}

function VaultLink({
  path,
  from,
  onOpen,
  children,
}: {
  path: string;
  from?: string;
  onOpen?: (path: string, from?: string) => void;
  children: ReactNode;
}) {
  const ok = useAvailable(path, from);
  if (!ok || !onOpen) return <span>{children}</span>;
  return (
    <button type="button" onClick={() => onOpen(path, from)} className="text-sky-400 underline text-left">
      {children}
    </button>
  );
}

function vaultFileUrl(path: string, from?: string): string {
  return `/api/vault/file?path=${encodeURIComponent(path)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
}

const OUTSIDE_LINK = /^https?:\/\//i;

function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

export function MarkdownView({ source, itemPath, onOpenItem }: MarkdownViewProps) {
  return (
    <div className="min-w-0 max-w-full break-words text-sm leading-relaxed text-dim-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWikilinks]}
        components={{
          h1: (p) => <h1 className="mt-4 mb-2 text-xl font-semibold text-dim-50">{p.children}</h1>,
          h2: (p) => <h2 className="mt-4 mb-2 text-lg font-semibold text-dim-50">{p.children}</h2>,
          h3: (p) => <h3 className="mt-3 mb-1.5 text-base font-semibold text-dim-50">{p.children}</h3>,
          h4: (p) => <h4 className="mt-3 mb-1 text-sm font-semibold text-dim-50">{p.children}</h4>,
          h5: (p) => <h5 className="mt-2 mb-1 text-sm font-semibold text-dim-100">{p.children}</h5>,
          h6: (p) => <h6 className="mt-2 mb-1 text-sm font-semibold text-dim-200">{p.children}</h6>,
          p: (p) => <p className="my-2">{p.children}</p>,
          ul: (p) => <ul className="my-2 list-disc pl-5">{p.children}</ul>,
          ol: (p) => <ol className="my-2 list-decimal pl-5">{p.children}</ol>,
          li: (p) => <li className="my-0.5">{p.children}</li>,
          blockquote: (p) => (
            <blockquote className="my-2 border-l-2 border-void-600 pl-3 text-dim-200">{p.children}</blockquote>
          ),
          hr: () => <hr className="my-4 border-void-700" />,
          table: (p) => (
            <div className="my-2 max-w-full overflow-x-auto">
              <table className="border-collapse text-xs">{p.children}</table>
            </div>
          ),
          th: (p) => (
            <th className="border border-void-700 bg-void-900 px-2 py-1 text-left font-semibold">{p.children}</th>
          ),
          td: (p) => <td className="border border-void-700 px-2 py-1 align-top">{p.children}</td>,
          pre: (p) => {
            // A mermaid block draws without a wrapping pre (the code override renders it).
            const first = p.node?.children?.[0];
            const cls = first && first.type === 'element' ? first.properties?.className : undefined;
            if (Array.isArray(cls) && cls.includes('language-mermaid')) return <>{p.children}</>;
            return (
            <pre className="my-2 max-w-full overflow-x-auto rounded border border-void-700 bg-void-980/60 px-2 py-1.5 text-xs font-mono text-dim-200">
              {p.children}
            </pre>
            );
          },
          input: (p: ComponentProps<'input'>) => (
            <input type="checkbox" checked={!!p.checked} disabled readOnly className="mr-1.5 align-middle" />
          ),
          a: (p) => {
            const href = typeof p.href === 'string' ? p.href : '';
            if (OUTSIDE_LINK.test(href)) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="text-sky-400 underline break-all"
                >
                  {p.children}
                </a>
              );
            }
            const t = linkTarget(href, itemPath);
            if (t.kind === 'vault') {
              return (
                <VaultLink path={t.path} from={itemPath} onOpen={onOpenItem}>
                  {p.children}
                </VaultLink>
              );
            }
            return <span>{p.children}</span>;
          },
          img: (p) => {
            // Only vault images load. Anything else, http(s) included, shows as its alt text.
            const alt = typeof p.alt === 'string' ? p.alt : '';
            const src = typeof p.src === 'string' ? p.src : '';
            const t = linkTarget(src, itemPath);
            if (t.kind !== 'vault') return <span>{alt}</span>;
            if (isVideoPath(t.path)) {
              return <VideoItem src={vaultFileUrl(t.path, itemPath)} alt={alt} />;
            }
            return <ImageItem src={vaultFileUrl(t.path, itemPath)} alt={alt} />;
          },
          code: (p) => {
            const lang = /language-(\w+)/.exec(p.className ?? '')?.[1];
            if (lang === 'mermaid') {
              return <MermaidBlock source={textOf(p.children).replace(/\n$/, '')} />;
            }
            return (
              <code className={`${p.className ?? ''} rounded bg-void-900 px-1 font-mono text-xs`}>
                {p.children}
              </code>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownView;
