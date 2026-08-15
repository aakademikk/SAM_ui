/**
 * SAM — vault contact resolver.
 *
 * The address book for anything SAM sends. Scans the vault for notes carrying
 * an `email:` frontmatter field and matches a spoken name against their title
 * and aliases.
 *
 * Two rules shape the whole module, both from SAM_Omni_Plan:
 *
 *  1. **Match on `email:`, not on `type:`.** A client's details already live in
 *     their client note (Brad's is `type: log`), so requiring a separate person
 *     note would duplicate mutable data — the same mistake rejected for phone
 *     numbers, where ContactsContract stays authoritative.
 *
 *  2. **Return candidates, never a winner.** The existing phone path takes
 *     `contacts[0]` and sends. Confirming "Send to Mike?" when two Mikes exist
 *     rubber-stamps the action while hiding the recipient error, which is the
 *     error that actually costs something. Ambiguity has to reach the caller so
 *     it can stop and ask.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

const VAULT_PATH = process.env.SAM_VAULT_PATH ?? '/home/col/ai-memory-vault';

// Mirrors IGNORED_DIRS in vaultMetrics.ts and build_vault_graph.py — keep the
// three in step or they will disagree about what the vault contains.
const IGNORED_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);
const CACHE_MS = 30_000;

export interface Contact {
  /** Note basename — the display name. */
  name: string;
  email: string;
  /** Spoken alternatives, e.g. a filename of "Horizon Blinds - Brad". */
  aliases: string[];
  /** Vault-relative path, for citing the source of an address. */
  path: string;
  status: string;
}

export type MatchKind = 'none' | 'single' | 'ambiguous';

export interface ContactMatch {
  query: string;
  kind: MatchKind;
  /** Every candidate. Length > 1 means the caller must ask, not choose. */
  matches: Contact[];
}

let cached: { at: number; contacts: Contact[] } | null = null;

/* -------------------------------------------------------------- frontmatter */

/**
 * Minimal frontmatter reader — only the three fields this module needs.
 *
 * Deliberately not a YAML parser: the rest of the server code is
 * dependency-free, and a full parser would be a lot of surface for
 * `email`, `aliases` and `status`.
 */
function readFrontmatter(raw: string): Record<string, string> | null {
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;

  const fields: Record<string, string> = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  return fields;
}

/** `[Mike, Mikey]` or a bare `Mike` → ["Mike", "Mikey"]. */
function parseAliases(value: string | undefined): string[] {
  if (!value) return [];
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/* ------------------------------------------------------------------- scan */

async function walk(dir: string, out: Contact[]): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (!entry.name.endsWith('.md')) continue;

    let raw: string;
    try {
      // Frontmatter lives at the top; no need to read a 900-line daily note.
      const handle = await fsp.open(full, 'r');
      const buf = Buffer.alloc(2048);
      const { bytesRead } = await handle.read(buf, 0, 2048, 0);
      await handle.close();
      raw = buf.subarray(0, bytesRead).toString('utf-8');
    } catch {
      continue;
    }

    const fm = readFrontmatter(raw);
    const email = fm?.email;
    if (!email) continue;

    out.push({
      name: entry.name.slice(0, -3),
      email,
      aliases: parseAliases(fm.aliases),
      path: path.relative(VAULT_PATH, full),
      status: fm.status ?? 'active',
    });
  }
}

/** Every addressable contact in the vault. Cached briefly; the vault is on disk. */
export async function listContacts(): Promise<Contact[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.contacts;

  const contacts: Contact[] = [];
  await walk(VAULT_PATH, contacts);
  contacts.sort((a, b) => a.name.localeCompare(b.name));

  cached = { at: now, contacts };
  return contacts;
}

/* ------------------------------------------------------------------ match */

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

/** Every name this contact answers to. */
function handles(c: Contact): string[] {
  return [c.name, ...c.aliases].map(normalise);
}

/**
 * Resolve a spoken name to candidates.
 *
 * Exact matches win outright — if "Mike" names someone exactly, a contact
 * merely *starting* with "mike" is not a competing candidate. Only when there
 * is no exact hit does it fall back to prefix matching, which is what makes
 * partial speech ("call Mich…") still resolve.
 *
 * Substring matching is deliberately not used: "a" would match half the vault,
 * and a resolver that returns noise trains the caller to ignore ambiguity.
 */
export async function resolveContact(query: string): Promise<ContactMatch> {
  const q = normalise(query);
  const all = (await listContacts()).filter((c) => c.status !== 'archived');

  if (!q) return { query, kind: 'none', matches: [] };

  const exact = all.filter((c) => handles(c).includes(q));
  const chosen = exact.length > 0 ? exact : all.filter((c) => handles(c).some((h) => h.startsWith(q)));

  return {
    query,
    kind: chosen.length === 0 ? 'none' : chosen.length === 1 ? 'single' : 'ambiguous',
    matches: chosen,
  };
}
