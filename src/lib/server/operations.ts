/**
 * SAM — Named Operations.
 *
 * Reads (and appends run-log entries to) the vault's code-word dispatch
 * registry at `00_SAM_Control/Named Operations.md`. The vault note is the
 * source of truth — the dashboard never holds its own copy of a pipeline, so
 * editing the note in Obsidian changes what a launch actually runs.
 *
 * Same posture as taskMetrics: cached reads, best-effort writes, and a parser
 * that tolerates the note being edited by hand (it is, constantly).
 */

import fs from 'node:fs';

import type {
  Operation,
  OperationRun,
  OperationStep,
  OperationVariable,
} from '@/types/operations';

const OPERATIONS_PATH =
  process.env.SAM_OPERATIONS_PATH ??
  '/home/col/ai-memory-vault/02 - Atwood Systems/00_SAM_Control/Named Operations.md';

const CACHE_MS = 8_000;

/** `### Operation Bait the Hook — electrician acquisition loop` */
const OP_HEADING_RE = /^###\s+Operation\s+(.+?)\s*$/;
/** `1. **Pull 20 leads** — run n8n …` */
const STEP_RE = /^(\d+)\.\s*\*\*(.+?)\*\*\s*(?:—|-|–)?\s*(.*)$/;
const FIELD_RE = /^\*\*([A-Za-z ]+):\*\*\s*(.*)$/;

/** Strip wikilink syntax and backticks so the UI renders plain prose. */
function clean(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/`/g, '')
    .trim();
}

/** Slug from the operation name: "Bait the Hook" → "bait-the-hook". */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split a heading into its name and the descriptor after the em dash. */
function splitHeading(raw: string): { name: string; summary: string } {
  const parts = raw.split(/\s+—\s+/);
  return {
    name: parts[0].trim(),
    summary: parts.slice(1).join(' — ').trim(),
  };
}

/** `start` is the index of the `## Run log` heading; walking begins after it. */
function parseRunLog(lines: string[], start: number): Map<string, OperationRun[]> {
  const runs = new Map<string, OperationRun[]>();
  let current: string | null = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // A new `##` section ends the run log.
    if (/^##\s+/.test(line) && !/^###/.test(line)) break;

    const heading = line.match(OP_HEADING_RE);
    if (heading) {
      current = slug(splitHeading(heading[1]).name);
      if (!runs.has(current)) runs.set(current, []);
      continue;
    }

    if (!current) continue;
    const bullet = line.match(/^-\s+(.*)$/);
    if (!bullet) continue;

    const text = bullet[1].trim();
    // The placeholder bullets that mark a never-run operation aren't runs.
    if (text.startsWith('(')) continue;

    const date = text.match(/^\*{0,2}(\d{4}-\d{2}-\d{2})/);
    runs.get(current)!.push({ text: clean(text), at: date ? date[1] : null });
  }

  // Newest first — the note is appended to, so it reads oldest-first on disk.
  for (const list of runs.values()) list.reverse();
  return runs;
}

export function parseOperations(text: string): Operation[] {
  const lines = text.split('\n');

  // The run log lives in its own `## Run log` section and repeats the same
  // `### Operation <name>` headings, so find its boundary before walking the
  // definitions — otherwise every operation gets parsed twice.
  const runLogStart = lines.findIndex((l) => /^##\s+Run log\s*$/i.test(l));
  const defEnd = runLogStart === -1 ? lines.length : runLogStart;
  const runs =
    runLogStart === -1 ? new Map<string, OperationRun[]>() : parseRunLog(lines, runLogStart);

  const operations: Operation[] = [];
  let current: Operation | null = null;
  // Set while walking the bullets under a `**Variables:**` field. A `- key =
  // value` line is collected; anything else (a field, a step) ends the block.
  let collectingVars = false;

  const push = () => {
    if (current) operations.push(current);
  };

  for (let i = 0; i < defEnd; i++) {
    const line = lines[i];

    const heading = line.match(OP_HEADING_RE);
    if (heading) {
      push();
      collectingVars = false;
      const { name, summary } = splitHeading(heading[1]);
      current = {
        id: slug(name),
        name,
        summary,
        trigger: '',
        purpose: '',
        persona: null,
        steps: [],
        defaults: null,
        variables: [],
        runs: [],
      };
      continue;
    }

    if (!current) continue;

    if (collectingVars) {
      const bullet = line.match(/^-\s*([^=]+?)\s*=\s*(.*)$/);
      if (bullet) {
        current.variables.push({ key: clean(bullet[1]), value: clean(bullet[2]) });
        continue;
      }
      collectingVars = false;
    }

    const field = line.match(FIELD_RE);
    if (field) {
      const key = field[1].trim().toLowerCase();
      const value = clean(field[2]);
      if (key === 'trigger') current.trigger = value.replace(/^"|"$/g, '');
      else if (key === 'purpose') current.purpose = value;
      else if (key === 'persona') current.persona = value.split(/\s+—\s+/)[0].trim() || null;
      else if (key === 'defaults to confirm') current.defaults = value;
      else if (key === 'variables') collectingVars = true;
      continue;
    }

    const step = line.match(STEP_RE);
    if (step) {
      const entry: OperationStep = {
        index: Number.parseInt(step[1], 10),
        title: clean(step[2]),
        detail: clean(step[3]),
        gate: /🔒/.test(line),
      };
      current.steps.push(entry);
    }
  }
  push();

  for (const op of operations) {
    op.runs = runs.get(op.id) ?? [];
  }
  return operations;
}

let cached: { at: number; operations: Operation[]; available: boolean } | null = null;

function readNow(): { operations: Operation[]; available: boolean } {
  try {
    const text = fs.readFileSync(OPERATIONS_PATH, 'utf-8');
    return { operations: parseOperations(text), available: true };
  } catch {
    return { operations: [], available: false };
  }
}

/** Cached for CACHE_MS so a burst of page polls doesn't re-read the note. */
export function readOperations(): { operations: Operation[]; available: boolean } {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { operations: cached.operations, available: cached.available };
  }
  const result = readNow();
  cached = { at: Date.now(), ...result };
  return result;
}

export function invalidateOperationsCache() {
  cached = null;
}

export function findOperation(id: string): Operation | null {
  return readOperations().operations.find((o) => o.id === id) ?? null;
}

/**
 * Compose the brief a launch dispatches. Deliberately verbatim from the vault:
 * the agent is told the same pipeline Colin reads, including which steps are
 * human gates, so it can't quietly "complete" a step it has no channel for.
 */
export function buildBrief(op: Operation): string {
  const lines: string[] = [
    `Run Operation ${op.name}${op.summary ? ` — ${op.summary}` : ''}.`,
    '',
    `Purpose: ${op.purpose}`,
    '',
    'Steps, in order. Verify each step against its real output before starting the next.',
    '',
  ];

  for (const step of op.steps) {
    lines.push(`${step.index}. ${step.title}${step.detail ? ` — ${step.detail}` : ''}`);
    if (step.gate) {
      lines.push(
        '   HUMAN GATE: do not attempt this step. Prepare everything it needs, then stop and hand over to Colin.',
      );
    }
  }

  if (op.defaults) {
    lines.push('', `Defaults to confirm: ${op.defaults}`);
  }

  if (op.variables.length > 0) {
    lines.push('', 'Variables — use these exact values:', '');
    for (const v of op.variables) {
      lines.push(`- ${v.key}: ${v.value}`);
    }
  }

  lines.push(
    '',
    'Rules: evidence only — verify each step from actual output, never assume. A step that fails stops the operation: report it, never silently skip. Stop at any human gate and hand over.',
    '',
    'The full definition, capability map and gates are in the vault at "02 - Atwood Systems/00_SAM_Control/Named Operations.md" — read it before starting.',
  );

  return lines.join('\n');
}

/**
 * Replace an operation's `**Variables:**` block in the vault note. If the
 * operation has none yet, the block is inserted right after its heading;
 * otherwise the existing block's bullets are replaced. Returns false when the
 * operation can't be found or the note can't be written.
 */
export function setOperationVariables(
  opId: string,
  variables: OperationVariable[],
): boolean {
  try {
    const text = fs.readFileSync(OPERATIONS_PATH, 'utf-8');
    const lines = text.split('\n');

    const runLogStart = lines.findIndex((l) => /^##\s+Run log\s*$/i.test(l));
    const defEnd = runLogStart === -1 ? lines.length : runLogStart;

    // Locate this operation's heading in the definition section (the run log
    // repeats the same headings, so stop before it).
    let headingAt = -1;
    for (let i = 0; i < defEnd; i++) {
      const heading = lines[i].match(OP_HEADING_RE);
      if (heading && slug(splitHeading(heading[1]).name) === opId) {
        headingAt = i;
        break;
      }
    }
    if (headingAt === -1) return false;

    const block = ['**Variables:**', ...variables.map((v) => `- ${v.key} = ${v.value}`)];

    // Find an existing block inside this operation's section.
    let varsStart = -1;
    let varsEnd = -1;
    for (let i = headingAt + 1; i < defEnd; i++) {
      if (/^###/.test(lines[i])) break; // next operation
      if (/^\*\*Variables:\*\*\s*$/.test(lines[i])) {
        varsStart = i;
        let j = i + 1;
        while (j < defEnd && /^-\s+/.test(lines[j])) j++;
        varsEnd = j;
        break;
      }
    }

    if (varsStart === -1) {
      // Insert after the heading's blank line, before the first field, so the
      // block reads as part of the definition.
      let insertAt = headingAt + 1;
      while (insertAt < defEnd && lines[insertAt].trim() === '') insertAt++;
      lines.splice(insertAt, 0, ...block);
    } else {
      lines.splice(varsStart, varsEnd - varsStart, ...block);
    }

    fs.writeFileSync(OPERATIONS_PATH, lines.join('\n'), 'utf-8');
    invalidateOperationsCache();
    return true;
  } catch {
    return false;
  }
}

/**
 * Append a run to the operation's section under `## Run log`. Best-effort: a
 * note whose run log was restructured by hand is left alone rather than
 * guessed at — the dispatch itself already succeeded by this point.
 */
export function recordRun(op: Operation, entry: string): void {
  try {
    const text = fs.readFileSync(OPERATIONS_PATH, 'utf-8');
    const lines = text.split('\n');

    const runLogStart = lines.findIndex((l) => /^##\s+Run log\s*$/i.test(l));
    if (runLogStart === -1) return;

    // Find this operation's heading inside the run log.
    let headingAt = -1;
    for (let i = runLogStart + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) break;
      const heading = lines[i].match(OP_HEADING_RE);
      if (heading && slug(splitHeading(heading[1]).name) === op.id) {
        headingAt = i;
        break;
      }
    }
    if (headingAt === -1) return;

    // Insert after the heading's existing bullets, so runs read oldest-first.
    let insertAt = headingAt + 1;
    while (insertAt < lines.length && lines[insertAt].startsWith('- ')) insertAt++;

    lines.splice(insertAt, 0, `- ${entry}`);
    fs.writeFileSync(OPERATIONS_PATH, lines.join('\n'), 'utf-8');
    invalidateOperationsCache();
  } catch {
    // Run-log write failures never fail the dispatch.
  }
}
