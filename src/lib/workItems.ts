/**
 * SAM — work-area items: marker lines in a reply, file kinds, and card labels.
 * Pure and client-safe: no `node:` imports.
 */

export const ALLOWED_TYPES = ['md', 'html', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'pdf'] as const;

export type ItemKind = 'document' | 'page' | 'image' | 'video' | 'website';

export interface WorkMarker {
  target: string;
  isWeb: boolean;
}

export interface ItemMeta {
  path: string;
  available: boolean;
  kind: ItemKind | null;
  title: string | null;
  size: number | null;
}

/** The vault's usual location, used to turn an absolute marker path into a vault-relative one. */
const DEFAULT_VAULT_ROOT = '/home/col/ai-memory-vault';

function markerRe(): RegExp {
  return /^[ \t]*<!--[ \t]*work:[ \t]*(.+?)[ \t]*-->[ \t]*$/gm;
}

function isWebAddress(t: string): boolean {
  return /^https?:\/\//i.test(t);
}

function relativeToVault(target: string, roots: string[]): string {
  for (const root of roots) {
    const r = root.replace(/\/+$/, '');
    if (r && target.startsWith(r + '/')) return target.slice(r.length + 1);
  }
  return target;
}

/** Remove marker lines from `text` and return them in order. `vaultRoot` adds a root besides the default. */
export function parseMarkers(text: string, vaultRoot?: string): { text: string; markers: WorkMarker[] } {
  const roots = vaultRoot ? [vaultRoot, DEFAULT_VAULT_ROOT] : [DEFAULT_VAULT_ROOT];
  const markers: WorkMarker[] = [];
  const re = markerRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const isWeb = isWebAddress(raw);
    markers.push({ target: isWeb ? raw : relativeToVault(raw, roots), isWeb });
  }
  if (markers.length === 0) return { text, markers };
  // Drop each marker line with its line break so no blank line is left behind.
  const stripped = text.replace(/^[ \t]*<!--[ \t]*work:[ \t]*(.+?)[ \t]*-->[ \t]*(?:\r?\n|$)/gm, '');
  return { text: stripped, markers };
}

export function fileName(target: string): string {
  const clean = target.split(/[?#]/)[0].replace(/\/+$/, '');
  const i = clean.lastIndexOf('/');
  return i < 0 ? clean : clean.slice(i + 1);
}

export function kindFor(target: string): ItemKind | null {
  if (isWebAddress(target)) return 'website';
  const name = fileName(target);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'md':
    case 'pdf':
      return 'document';
    case 'html':
      return 'page';
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
    default:
      return null;
  }
}

function hostOf(address: string): string {
  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}

export function cardFor(
  marker: WorkMarker,
  meta: ItemMeta | null,
): { label: string; kind: ItemKind | null; openable: boolean } {
  if (marker.isWeb) return { label: hostOf(marker.target), kind: 'website', openable: true };
  const kind = kindFor(marker.target);
  const name = fileName(marker.target);
  if (kind === null || (meta && meta.available === false)) {
    return { label: `not available: ${name}`, kind: null, openable: false };
  }
  if (!meta) return { label: name, kind, openable: false };
  return { label: meta.title ?? name, kind, openable: true };
}
