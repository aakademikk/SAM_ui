/**
 * SAM — item cards under an answer: one card per work marker. Openable file
 * cards are buttons; a website card is a link that opens a new tab; anything
 * else reads "not available: <file name>" and is not a button.
 */
'use client';

import { FileText, Globe, Image as ImageIcon, LayoutTemplate, Video } from 'lucide-react';

import { cardFor, type ItemKind, type ItemMeta, type WorkMarker } from '@/lib/workItems';

export interface ItemCardsProps {
  items: WorkMarker[];
  /** Meta for a path, or null while loading or when unavailable. */
  metaFor: (path: string) => ItemMeta | null;
  onOpen: (path: string) => void;
}

const KIND_WORD: Record<ItemKind, string> = {
  document: 'document',
  page: 'page',
  image: 'image',
  video: 'video',
  website: 'website',
};

function KindIcon({ kind }: { kind: ItemKind | null }) {
  const props = { size: 16, className: 'shrink-0 text-dim-300', 'aria-hidden': true } as const;
  switch (kind) {
    case 'page':
      return <LayoutTemplate {...props} />;
    case 'image':
      return <ImageIcon {...props} />;
    case 'video':
      return <Video {...props} />;
    case 'website':
      return <Globe {...props} />;
    default:
      return <FileText {...props} />;
  }
}

const CARD =
  'flex min-h-[44px] w-full items-center gap-2 rounded border border-void-700 bg-void-900/60 px-2.5 py-2 text-left text-xs';

export function ItemCards({ items, metaFor, onOpen }: ItemCardsProps) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {items.map((marker, i) => {
        const card = cardFor(marker, marker.isWeb ? null : metaFor(marker.target));
        const inner = (
          <>
            <KindIcon kind={card.kind} />
            <span className="min-w-0 flex-1 truncate text-dim-100">{card.label}</span>
            {card.kind && <span className="shrink-0 text-dim-400">{KIND_WORD[card.kind]}</span>}
          </>
        );
        const key = `${marker.target}|${i}`;
        if (marker.isWeb) {
          return (
            <a
              key={key}
              href={marker.target}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className={`${CARD} hover:bg-void-800`}
            >
              {inner}
            </a>
          );
        }
        if (!card.openable) {
          return (
            <div key={key} className={`${CARD} opacity-70`}>
              {inner}
            </div>
          );
        }
        return (
          <button
            key={key}
            type="button"
            onClick={() => onOpen(marker.target)}
            className={`${CARD} transition-colors hover:bg-void-800`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
