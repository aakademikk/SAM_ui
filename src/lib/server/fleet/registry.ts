/**
 * SAM — Fleet persona registry.
 *
 * Reads the runtime personas from `~/.claude/agents/*.md` and parses their
 * frontmatter. The vault Generals notes remain the source of truth; these
 * files are the executable layer a dispatch actually runs. Reading them live
 * means the roster always reflects what `--agent` can accept, so the dispatch
 * route and the roster can never drift apart.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { FleetPersona } from '@/types/fleet';

const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');

interface RawFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  tools?: string;
}

/** Parse the leading YAML block of a persona file. Values are single-line. */
export function parsePersonaFrontmatter(raw: string): RawFrontmatter {
  const out: RawFrontmatter = {};
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return out;

  for (const line of block[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    const trimmed = value.trim();
    if (key === 'name' || key === 'description' || key === 'model' || key === 'tools') {
      out[key] = trimmed;
    }
  }
  return out;
}

/** All personas `--agent` can accept, sorted by name. Empty on any error. */
export async function readFleetRegistry(): Promise<FleetPersona[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(AGENTS_DIR);
  } catch {
    return [];
  }

  const personas: FleetPersona[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    let raw: string;
    try {
      raw = await fsp.readFile(path.join(AGENTS_DIR, entry), 'utf-8');
    } catch {
      continue;
    }

    const fm = parsePersonaFrontmatter(raw);
    if (!fm.name) continue;

    personas.push({
      name: fm.name,
      description: fm.description ?? '',
      model: fm.model ?? 'sonnet',
      tools: (fm.tools ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  personas.sort((a, b) => a.name.localeCompare(b.name));
  return personas;
}
