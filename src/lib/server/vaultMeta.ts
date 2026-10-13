import fsp from 'node:fs/promises';
import { fileName, kindFor, type ItemMeta } from '@/lib/workItems';
import { refuse, resolveVaultFile } from '@/lib/server/vaultFiles';

const TITLE_READ_BYTES = 65_536;

function stripEmphasis(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function readHead(abs: string): Promise<string> {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(TITLE_READ_BYTES);
    const { bytesRead } = await fh.read(buf, 0, TITLE_READ_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await fh.close();
  }
}

function mdTitle(text: string): string | null {
  const m = /^#{1,6}[ \t]+(.+)$/m.exec(text);
  if (!m) return null;
  const t = stripEmphasis(m[1]);
  return t || null;
}

function htmlTitle(text: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (!m) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return t || null;
}

/** Title, kind, size and availability of one item. Refusals are audited and come back unavailable. */
export async function metaFor(requested: string, from?: string): Promise<ItemMeta> {
  const unavailable: ItemMeta = { path: requested, available: false, kind: null, title: null, size: null };
  if (/^https?:\/\//i.test(requested)) {
    return { path: requested, available: true, kind: 'website', title: requested, size: null };
  }
  const r = await resolveVaultFile(requested, { from });
  if (!r.ok) {
    await refuse(requested, r.reason);
    return unavailable;
  }
  const kind = kindFor(r.rel);
  let title: string | null = null;
  try {
    const ext = r.ext.toLowerCase();
    if (ext === 'md') title = mdTitle(await readHead(r.abs));
    else if (ext === 'html') title = htmlTitle(await readHead(r.abs));
  } catch {
    title = null;
  }
  return { path: r.rel, available: true, kind, title: title ?? fileName(r.rel), size: r.size };
}
