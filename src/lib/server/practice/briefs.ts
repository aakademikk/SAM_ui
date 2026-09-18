/**
 * SAM — practice agent briefs.
 *
 * The practice agent's personas are markdown files in the practice-agent
 * project, not in SAM_ui. That folder is where the desktop voice client
 * (`practise.sh <brief>`) reads them from, and where they get edited by hand,
 * so the app reads the same files rather than holding copies — a briefing
 * change then lands on both channels with no sync step and no second source of
 * truth for the same scenario.
 *
 * A brief is a scenario for a live voice roleplay: who the buyer is, what they
 * want, what they will not say, and the line the character opens with. The
 * parsing here is deliberately shallow — the app needs a title, a speaker and
 * an opening line to build a picker. The body is for the model, not for us.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PracticeBrief } from '@/types/practice';

/**
 * Where the practice project lives. The desktop needs no equivalent setting
 * because it is launched from inside the folder; the app has to be told.
 */
export const PRACTICE_ROOT =
  process.env.SAM_PRACTICE_ROOT ?? path.join(os.homedir(), 'practice-agent');

const BRIEFS_DIR = path.join(PRACTICE_ROOT, 'briefs');
const DISCIPLINE_FILE = path.join(PRACTICE_ROOT, 'ROLEPLAY_DISCIPLINE.md');

/**
 * The roleplay contract, passed to the CLI as `--system-prompt`.
 *
 * Read per request rather than cached at module load: an edit to the discipline
 * should take effect on the next turn, the same way a brief edit does, without
 * a rebuild. It is a 2KB read.
 *
 * Throws when the file is missing. That is deliberate — the caller must refuse
 * the turn rather than spawn a `claude` with an empty system prompt, which
 * would silently produce a helpful assistant wearing the buyer's name: the one
 * failure this whole feature exists to prevent.
 */
export function readDiscipline(): string {
  return fs.readFileSync(DISCIPLINE_FILE, 'utf8').trim();
}

/** First non-empty body line under a `## Heading`. */
function section(text: string, heading: string): string {
  const lines = text.split('\n');
  const wanted = `## ${heading}`.toLowerCase();
  const at = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (at === -1) return '';
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    // A heading before any content means the section is empty, not that the
    // next section's text belongs to this one.
    return line.startsWith('#') ? '' : line;
  }
  return '';
}

/** Every non-empty body line under a `## Heading`, in file order. */
function sectionLines(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const wanted = `## ${heading}`.toLowerCase();
  const at = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (at === -1) return [];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#')) break;
    out.push(line);
  }
  return out;
}

/** `key: value` lines under a `## Heading`, keys lowercased. */
function keyValues(text: string, heading: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of sectionLines(text, heading)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * An Edge voice name, `en-GB-ThomasNeural`.
 *
 * Validated rather than trusted because the value ends up in two places that
 * do not fail loudly: the client hands it to voice-line as a synthesis
 * argument, and the desktop reads it out of the same file. `''` means the
 * brief declares no voice, and the caller falls back — which is the right
 * outcome for a brief written before this section existed.
 */
const VOICE_RE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]{3,24}Neural$/;

/** The signed percentage shape edge-tts accepts, e.g. `-4%` or `+15%`. */
const RATE_RE = /^[+-]\d{1,3}%$/;

function parseBrief(id: string, text: string): PracticeBrief {
  const heading = text.split('\n').find((line) => line.startsWith('# Brief')) ?? '';
  const voice = keyValues(text, 'Voice');
  return {
    id,
    title: heading.replace(/^#\s*Brief\s*[—-]\s*/, '').trim() || id,
    speaker: section(text, 'Speaker'),
    // One line in every brief on disk. A wrapped opening line would truncate
    // here, so keep them unwrapped when writing new ones.
    openingLine: section(text, 'Opening line'),
    realLead: /\[real\b/.test(text),
    voice: VOICE_RE.test(voice.voice ?? '') ? voice.voice : '',
    rate: RATE_RE.test(voice.rate ?? '') ? voice.rate : '',
  };
}

/** Every brief on disk, alphabetical. A missing folder yields []. */
export function listBriefs(): PracticeBrief[] {
  let names: string[];
  try {
    names = fs.readdirSync(BRIEFS_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    .sort()
    .flatMap((name) => {
      try {
        const text = fs.readFileSync(path.join(BRIEFS_DIR, name), 'utf8');
        return [parseBrief(name.slice(0, -3), text)];
      } catch {
        // One unreadable brief is omitted, not fatal to the whole list.
        return [];
      }
    });
}

/**
 * A brief's metadata and full text, or null when the id is unknown.
 *
 * The id is checked against a strict charset before it reaches the filesystem:
 * a request body must never be able to name a file outside briefs/, and
 * `path.join` alone would happily resolve `../../` out of it.
 */
export function readBrief(id: string): { brief: PracticeBrief; text: string } | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;
  let text: string;
  try {
    text = fs.readFileSync(path.join(BRIEFS_DIR, `${id}.md`), 'utf8');
  } catch {
    return null;
  }
  return { brief: parseBrief(id, text), text };
}

/**
 * The first message of a session: hand the character its brief.
 *
 * Kept word-for-word identical to `Brain.load_brief` in voice-line/brain.py,
 * because the two channels install the same character and a divergence here
 * shows up as the desktop and phone versions of a persona behaving differently.
 * The reply is a single "ready" and is discarded by both — the caller speaks
 * the scenario's own opening line instead, so the model's acknowledgement is
 * never heard.
 */
export function loadPrompt(briefText: string): string {
  return (
    'Here is the brief for this session. Read it fully and become the ' +
    'character described. Do not reply with anything except the single ' +
    'word: ready\n\n--- BEGIN BRIEF ---\n' +
    briefText.trim() +
    '\n--- END BRIEF ---'
  );
}
