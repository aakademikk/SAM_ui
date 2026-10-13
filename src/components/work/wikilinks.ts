/**
 * SAM — Obsidian wikilinks and embeds for the markdown viewer, as a small
 * remark plugin (no package), plus `linkTarget`, the client-side pre-check.
 *
 * Only types are imported from mdast, so this file loads in the CommonJS test
 * build. The server (resolveVaultFile) stays the authority; this just stops the
 * obvious refusals from ever becoming a button.
 */
import type { Image, Link, PhrasingContent, Root, Text } from 'mdast';
import { ALLOWED_TYPES } from '@/lib/workItems';

export type LinkTarget = { kind: 'vault'; path: string } | { kind: 'web'; href: string } | { kind: 'plain' };

const PLAIN: LinkTarget = { kind: 'plain' };
const VIDEO_EXT = new Set(['mp4', 'webm']);

export function extOf(p: string): string {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isVideoPath(p: string): boolean {
  return VIDEO_EXT.has(extOf(p));
}

/**
 * Classify a link or embed target found in an item at `itemPath`.
 * Vault paths come back cleaned (decoded, no `./`, no query or heading) and
 * relative; the server finds them next to the item first, then from the root.
 */
export function linkTarget(raw: string, itemPath?: string): LinkTarget {
  void itemPath; // resolution against the item is the server's job (the `from` rule)
  const t = (raw ?? '').trim();
  if (!t) return PLAIN;
  if (/^https?:\/\//i.test(t)) return { kind: 'web', href: t };
  // Any other scheme (javascript:, data:, file:, vault: ...) is plain.
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return PLAIN;
  if (t.startsWith('//') || t.startsWith('/') || t.startsWith('#')) return PLAIN;

  let p = t.split('#')[0].split('?')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    return PLAIN;
  }
  if (!p || p.includes('\\') || p.includes('\0') || /[\u0000-\u001f]/.test(p) || p.includes('%')) return PLAIN;
  const parts: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part.startsWith('.')) return PLAIN; // '..' and every dot part
    parts.push(part);
  }
  if (parts.length === 0) return PLAIN;
  const clean = parts.join('/');
  if (!(ALLOWED_TYPES as readonly string[]).includes(extOf(clean))) return PLAIN;
  return { kind: 'vault', path: clean };
}

const WIKI_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

function expand(value: string): PhrasingContent[] | null {
  const out: PhrasingContent[] = [];
  let last = 0;
  let found = false;
  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(value)) !== null) {
    found = true;
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) } as Text);
    last = m.index + m[0].length;
    const embed = m[1] === '!';
    const bar = m[2].indexOf('|');
    const targetRaw = (bar < 0 ? m[2] : m[2].slice(0, bar)).trim();
    const label = (bar < 0 ? targetRaw : m[2].slice(bar + 1)).trim() || targetRaw;
    // Drop a heading or block reference for the file part: note#Heading.
    const file = targetRaw.split('#')[0].trim();
    if (!file) {
      out.push({ type: 'text', value: m[0] } as Text);
      continue;
    }
    const withExt = extOf(file) === '' ? `${file}.md` : file;
    const url = encodePath(withExt);
    if (embed) {
      const node: Image = { type: 'image', url, alt: label, data: { vault: withExt } as Image['data'] };
      out.push(node);
    } else {
      const node: Link = {
        type: 'link',
        url,
        children: [{ type: 'text', value: label }],
        data: { vault: withExt } as Link['data'],
      };
      out.push(node);
    }
  }
  if (!found) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) } as Text);
  return out;
}

interface Parent {
  type: string;
  children?: Array<{ type: string; value?: string }>;
}

function walk(node: Parent): void {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.type === 'text' && typeof k.value === 'string') {
      const repl = expand(k.value);
      if (repl) {
        kids.splice(i, 1, ...(repl as unknown as typeof kids));
        i += repl.length - 1;
      }
    } else if (k.type !== 'code' && k.type !== 'inlineCode' && k.type !== 'link' && k.type !== 'html') {
      walk(k as unknown as Parent);
    }
  }
}

/** Remark plugin: `[[x]]`, `[[x|label]]` become links; `![[x]]` becomes an image (video by extension). */
export function remarkWikilinks() {
  return (tree: Root) => {
    walk(tree as unknown as Parent);
  };
}
