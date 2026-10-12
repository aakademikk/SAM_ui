/**
 * SAM — tickets-file parser (job ticket panel, T2).
 *
 * One parser for every reader of an `implementation/*-tickets.md` file.
 * `parseTickets` and `ticketProgress` are pure; `readTicketsFile` is the one
 * thin reader. Grammar (shared definitions, repeated by the Python side):
 *  - Ticket heading: `^## T(\d+)\b[:.]?\s*(.*)$`.
 *  - Status line: the first `^Status:\s*(.*)$` line between a ticket heading
 *    and the next `^## ` heading; empty text after the colon is not readable.
 *  - Status split: known statuses, longest first, case-insensitive prefix;
 *    otherwise the first word is the label. Labels are kept as written.
 *  - "Done" is label DONE only (case-insensitive), never PARTLY DONE.
 */

import { readFile } from 'node:fs/promises';

export interface Ticket {
  n: number;
  title: string;
  label: string;
  note: string;
  claimJobId: string | null;
  files: string | null;
}

export const NO_STATUS_LABEL = 'no status';

const HEADING_RE = /^## T(\d+)\b[:.]?\s*(.*)$/;
const ANY_HEADING_RE = /^## /;
const STATUS_RE = /^Status:\s*(.*)$/;
const FILES_RE = /^Files:\s*(.*)$/;

// Longest first, so PARTLY DONE and IN PROGRESS win over any shorter word.
const KNOWN_STATUSES = [
  'IN PROGRESS',
  'PARTLY DONE',
  'SUPERSEDED',
  'SKIPPED',
  'BLOCKED',
  'DONE',
  'TODO',
  'GATE',
];

function splitStatus(text: string): { label: string; note: string } {
  const lower = text.toLowerCase();
  for (const known of KNOWN_STATUSES) {
    if (!lower.startsWith(known.toLowerCase())) continue;
    const next = text.charAt(known.length);
    if (next !== '' && !/\s/.test(next)) continue; // "DONEZO" is not DONE
    return { label: text.slice(0, known.length), note: text.slice(known.length).trim() };
  }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(text);
  return m ? { label: m[1], note: m[2].trim() } : { label: text, note: '' };
}

export function parseTickets(text: string): { tickets: Ticket[] } {
  const tickets: Ticket[] = [];
  let current: Ticket | null = null;
  let statusSeen = false;
  let filesSeen = false;

  for (const raw of text.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      current = {
        n: Number(heading[1]),
        title: heading[2].trim(),
        label: NO_STATUS_LABEL,
        note: '',
        claimJobId: null,
        files: null,
      };
      tickets.push(current);
      statusSeen = false;
      filesSeen = false;
      continue;
    }
    if (ANY_HEADING_RE.test(raw)) {
      current = null; // a non-ticket section ends the ticket
      continue;
    }
    if (!current) continue;

    if (!statusSeen) {
      const s = STATUS_RE.exec(raw);
      if (s && s[1].trim() !== '') {
        const { label, note } = splitStatus(s[1].trim());
        current.label = label;
        current.note = note;
        if (label.toLowerCase() === 'in progress') {
          current.claimJobId = note.split(/\s+/)[0] || null;
        }
        statusSeen = true;
        continue;
      }
    }
    if (!filesSeen) {
      const f = FILES_RE.exec(raw);
      if (f) {
        current.files = f[1].trim();
        filesSeen = true;
      }
    }
  }
  return { tickets };
}

export function ticketProgress(tickets: Ticket[]): { done: number; total: number } {
  return {
    done: tickets.filter((t) => t.label.toLowerCase() === 'done').length,
    total: tickets.length,
  };
}

/** Reads and parses a tickets file; null when the file does not exist. */
export async function readTicketsFile(path: string): Promise<Ticket[] | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return parseTickets(text).tickets;
}
