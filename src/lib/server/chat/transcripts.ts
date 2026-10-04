/**
 * SAM — reads a chat's history straight from its Claude CLI transcript.
 *
 * History must load from the server (spec must-do 4), and the server's only
 * copy of a chat's text is the CLI's own transcript file — SAM_ui writes
 * nothing of its own. A transcript lives at
 * `<config dir>/projects/<cwd slug>/<id>.jsonl`, where the config dir is
 * `~/.claude` for every tier except Max 2, whose CLI runs with
 * `CLAUDE_CONFIG_DIR` pointed at `max2ConfigDir()` (see tiers.ts), and the
 * slug is `agentCwd()` with every character that is not a letter or digit
 * replaced by `-` (see the tickets file's "Chat id" note).
 *
 * `AgentStreamParser` (src/lib/agentStream.ts) already turns `assistant` and
 * `user` (tool_result) stream-json events into `ChatBlock`s for the live
 * chat. A transcript entry's `message.content` is the same shape as the
 * stream event it was written from, so a turn's entries are simply replayed
 * through a fresh parser rather than maintaining a second block-builder that
 * could drift from the live one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentStreamParser } from '@/lib/agentStream';
import type { ChatAccount, ChatMessage, ChatTier, TierId } from '@/types/chat';

import { agentCwd } from './agentCwd';
import { dropUnresolvedBefore, tagPending, taggedUuids, unresolved } from './sideMessageLog';
import { max2ConfigDir } from './tiers';

/* -------------------------------------------------------------------------- */
/* Locating a transcript                                                       */
/* -------------------------------------------------------------------------- */

/** Every character that is not a letter or digit becomes `-`. Matches the
 *  CLI's own rule for turning a cwd into a `projects/` directory name (see
 *  fakeClaude.ts's cwdSlug, which mirrors this). */
export function cwdSlug(dir: string): string {
  return dir.replace(/[^A-Za-z0-9]/g, '-');
}

export interface TranscriptLocation {
  path: string;
  account: ChatAccount;
}

/** Look for `id`'s transcript under the main config dir first, then Max 2's.
 *  Both accounts share the same cwd (and so the same slug) — only the config
 *  dir differs. Null when neither location has the file. */
export function transcriptPath(id: string): TranscriptLocation | null {
  const slug = cwdSlug(agentCwd());

  const mainPath = path.join(os.homedir(), '.claude', 'projects', slug, `${id}.jsonl`);
  if (fs.existsSync(mainPath)) return { path: mainPath, account: 'main' };

  const max2Path = path.join(max2ConfigDir(), 'projects', slug, `${id}.jsonl`);
  if (fs.existsSync(max2Path)) return { path: max2Path, account: 'max2' };

  return null;
}

/* -------------------------------------------------------------------------- */
/* Raw entry shape — only the fields actually consumed                         */
/* -------------------------------------------------------------------------- */

interface TranscriptContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface TranscriptEntry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  sessionId?: string;
  uuid?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
  };
  /** Only present on a `type: 'attachment'` entry — a mid-turn side message
   *  lands here (T8 R1), not as a `user` entry. */
  attachment?: {
    type?: string;
    prompt?: unknown;
    commandMode?: string;
  };
  /** Set by `readHistory` itself (never present on disk) on a clone of a
   *  tagged late side message, or a queued_command attachment's own
   *  synthetic `user`-shaped entry — tells `buildAssistantMessage` to feed
   *  it to the parser as `sam_side` instead of its nominal type. */
  __side?: boolean;
  [key: string]: unknown;
}

/** Reads and parses a transcript file, skipping any line that is not valid
 *  JSON — a partial last line (the CLI killed mid-write) or a stray blank
 *  line must not take the rest of the chat's history down with it. */
function readEntries(filePath: string): TranscriptEntry[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      // Corrupt or partial line — skip it rather than aborting the whole read.
      continue;
    }
  }
  return entries;
}

/**
 * True for a `user` entry that is a real prompt — content holding at least
 * one text block (or a plain string) and no `tool_result` block. A
 * `tool_result` entry is also `type: 'user'` in the transcript, and must
 * never be mistaken for the start of a new turn.
 */
function isPromptContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;

  let hasText = false;
  let hasToolResult = false;
  for (const block of content as TranscriptContentBlock[]) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) hasText = true;
    if (block.type === 'tool_result') hasToolResult = true;
  }
  return hasText && !hasToolResult;
}

/** The entry types a transcript actually needs for history: everything else
 *  (`queue-operation`, `attachment`, `mode`, `last-prompt`, `system`, and any
 *  other bookkeeping type such as `atis-latch`) is skipped by construction —
 *  only `user` and `assistant` entries carry chat content. `isMeta` entries
 *  (e.g. the CLI's own image-dimensions note it injects as a `user` entry)
 *  and `isSidechain` entries (a sub-agent's own conversation, not the main
 *  thread) are dropped too: both can carry plain-string content that would
 *  otherwise look like a real prompt. */
function relevantEntries(
  entries: TranscriptEntry[],
  opts: { includeQueuedCommandAttachments?: boolean } = {},
): TranscriptEntry[] {
  return entries.filter((entry) => {
    if (opts.includeQueuedCommandAttachments && isQueuedCommandAttachment(entry)) return true;
    if (entry.type !== 'user' && entry.type !== 'assistant') return false;
    if (entry.isMeta === true) return false;
    if (entry.isSidechain === true) return false;
    return true;
  });
}

/** True for a `type: 'attachment'` entry the CLI wrote for a side message
 *  that landed mid-turn (T8 R1) — `relevantEntries` drops every attachment
 *  by default (see its own comment), so only a caller that opts in via
 *  `includeQueuedCommandAttachments` ever sees one. */
function isQueuedCommandAttachment(entry: TranscriptEntry): boolean {
  // `commandMode: 'prompt'` only: the CLI also writes `queued_command`
  // attachments for background-task completions (`commandMode:
  // 'task-notification'`, a string prompt of raw XML), which are not side
  // messages and must stay invisible in history.
  return (
    entry.type === 'attachment' &&
    entry.attachment?.type === 'queued_command' &&
    entry.attachment.commandMode === 'prompt'
  );
}

/** The text of a mid-turn side message's queued_command attachment, or
 *  `null` for any entry that isn't one. */
function queuedCommandText(entry: TranscriptEntry): string | null {
  if (!isQueuedCommandAttachment(entry)) return null;
  return extractPromptText(entry.attachment?.prompt);
}

function extractPromptText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as TranscriptContentBlock[])
    .filter((block) => block && typeof block === 'object' && block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function buildUserMessage(chatId: string, turn: number, entry: TranscriptEntry): ChatMessage {
  const text = extractPromptText(entry.message?.content);
  return {
    id: entry.uuid ?? `${chatId}-${turn}-u`,
    role: 'user',
    blocks: text ? [{ kind: 'text', text }] : [],
    sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
    done: true,
  };
}

/** Replays a turn's assistant/tool_result entries through a fresh parser —
 *  the same one the live chat uses — so the block model (tool cards, merged
 *  text, error handling) can never drift between a live turn and a replayed
 *  one. Each entry is fed in as its own stream-json line; the parser only
 *  reads `type` and `message.content`, which a transcript entry already has
 *  in the exact shape a stream event does. */
function buildAssistantMessage(chatId: string, turn: number, entries: TranscriptEntry[]): ChatMessage {
  const parser = new AgentStreamParser();
  let sessionId: string | undefined;
  let lastAssistantUuid: string | undefined;

  for (const entry of entries) {
    if (entry.type !== 'assistant' && entry.type !== 'user') continue;
    const type = entry.__side ? 'sam_side' : entry.type;
    parser.push(`${JSON.stringify({ type, message: entry.message })}\n`);
    if (typeof entry.sessionId === 'string') sessionId = entry.sessionId;
    if (entry.type === 'assistant' && typeof entry.uuid === 'string') lastAssistantUuid = entry.uuid;
  }

  const state = parser.finish(0);

  return {
    id: lastAssistantUuid ?? `${chatId}-${turn}-a`,
    role: 'assistant',
    blocks: state.blocks,
    sessionId,
    usage: state.usage,
    cost: state.reportedCostUsd !== undefined ? { usd: state.reportedCostUsd, basis: 'reported' } : undefined,
    durationMs: state.durationMs,
    done: true,
  };
}

/**
 * The chat's full history, as alternating user/assistant `ChatMessage`s, in
 * transcript order. A transcript is split into turns at each `user` entry
 * that is a real prompt (`isPromptContent`); everything from there up to
 * (not including) the next prompt — the assistant's reply plus any
 * `tool_result` entries — is replayed through one `AgentStreamParser` to
 * build that turn's assistant message. Every message returned is `done:
 * true`, because a transcript only ever holds finished turns.
 *
 * Returns `[]` for a chat with no transcript on disk, rather than throwing —
 * callers that need to distinguish "no transcript" from "empty chat" should
 * check `transcriptPath(id)` first (T6/T8 already do, to decide whether a
 * registry id is importable at all).
 */
/** The chat's first user message, as plain text — falls back to `''` for a
 *  chat with no transcript, or whose first entry is not a real prompt.
 *  Review finding 14: this one implementation replaces identical copies that
 *  used to live in `startTurn.ts`, `chatActions.ts` and `importRegistry.ts`
 *  (the fallback title's source, in all three places it is needed). */
export function firstUserMessage(id: string): string {
  const first = readHistory(id).find((m) => m.role === 'user');
  if (!first) return '';
  return first.blocks
    .map((b) => (b.kind === 'text' ? b.text : ''))
    .join('\n')
    .trim();
}

export function readHistory(id: string): ChatMessage[] {
  const found = transcriptPath(id);
  if (!found) return [];

  // T8: a late side message (one that landed after its turn's `result`) is
  // written by the CLI as an ordinary prompt-shaped `user` entry —
  // structurally identical to a genuine new turn. `tagged` names every such
  // entry `tagSideMessages` has already matched against this chat's own
  // record of what it sent (`sideMessageLog.ts`), so the loop below can tell
  // the two apart. A mid-turn side message needs no such lookup: the CLI
  // writes it as a `queued_command` attachment, a different entry type
  // entirely, which `includeQueuedCommandAttachments` below opts into seeing.
  const tagged = taggedUuids(id);
  const entries = relevantEntries(readEntries(found.path), { includeQueuedCommandAttachments: true });

  const messages: ChatMessage[] = [];
  let turn = -1;
  let promptEntry: TranscriptEntry | null = null;
  let turnEntries: TranscriptEntry[] = [];

  const flush = () => {
    if (!promptEntry) return;
    turn += 1;
    messages.push(buildUserMessage(id, turn, promptEntry));
    messages.push(buildAssistantMessage(id, turn, turnEntries));
  };

  for (const entry of entries) {
    const queuedText = queuedCommandText(entry);
    if (queuedText !== null) {
      // A turn must already be open — a queued_command attachment landing
      // before the transcript's first real prompt has nowhere to attach and
      // is dropped, same rule as any other pre-first-prompt entry.
      if (promptEntry) {
        turnEntries.push({
          type: 'user',
          __side: true,
          message: { content: [{ type: 'text', text: queuedText }] },
          uuid: entry.uuid,
          sessionId: entry.sessionId,
        });
      }
      continue;
    }

    if (entry.type === 'user' && isPromptContent(entry.message?.content)) {
      // A turn already open, and this entry is one `tagSideMessages` matched
      // to a side message this chat actually sent: it joins the open turn as
      // a side block instead of starting a new one.
      if (promptEntry !== null && typeof entry.uuid === 'string' && tagged.has(entry.uuid)) {
        turnEntries.push({ ...entry, __side: true });
        continue;
      }
      flush();
      promptEntry = entry;
      turnEntries = [];
      continue;
    }
    // Anything before the transcript's first real prompt (there should be
    // none) has nowhere to attach and is dropped.
    if (promptEntry) turnEntries.push(entry);
  }
  flush();

  return messages;
}

/**
 * Re-reads `chatId`'s transcript and matches every still-unresolved side
 * message record (`sideMessageLog.ts`'s `unresolved`) against it, so a late
 * side message's own transcript entry is never again mistaken for a new
 * top-level turn. Call once a turn's transcript is final (`startTurn.ts`'s
 * `onTurnExit` hook) — never while the file could still be mid-write.
 *
 * Two kinds of match, the earliest entry of either kind winning:
 *  - A `queued_command` attachment entry with this exact text (T8 R1's
 *    mid-turn case — already rendered correctly by `readHistory` without any
 *    tagging; matching it here only marks the record resolved, via the
 *    attachment's own uuid, so it is never also matched to a user entry).
 *  - A prompt-shaped `user` entry with this exact text, not already tagged,
 *    and not the transcript's very first relevant entry (that one can never
 *    be a side message — it is the chat's own first prompt).
 * Only entries after the chat's last already-tagged entry, and not stamped
 * more than 5 s before the record's `sentAt`, are candidates. When
 * `jobStartedAt` is given (the turn that just ended), records still
 * unresolved from before it are dropped.
 */
export function tagSideMessages(chatId: string, jobStartedAt?: string): void {
  const found = transcriptPath(chatId);
  if (!found) return;

  const records = unresolved(chatId);
  if (records.length === 0) return;

  const entries = relevantEntries(readEntries(found.path), { includeQueuedCommandAttachments: true });
  const used = taggedUuids(chatId);

  // Records resolve in the order they were sent, so an entry before the last
  // one already tagged for this chat can never be a later record's match.
  let searchFrom = 0;
  entries.forEach((entry, index) => {
    if (typeof entry.uuid === 'string' && used.has(entry.uuid)) searchFrom = index + 1;
  });

  const pairs: { text: string; uuid: string }[] = [];

  for (const record of records) {
    const sentMs = Date.parse(record.sentAt);
    // An entry written before the record existed is someone else's message
    // that happens to have the same text. Slack: the CLI can log the line a
    // moment before `recordSideMessageSent` runs. No usable timestamp: allow.
    const notTooEarly = (entry: TranscriptEntry): boolean => {
      const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
      return Number.isNaN(at) || Number.isNaN(sentMs) || at >= sentMs - SIDE_MATCH_SLACK_MS;
    };

    let matchIndex = -1;
    for (let index = searchFrom; index < entries.length; index++) {
      const entry = entries[index];
      if (typeof entry.uuid !== 'string' || used.has(entry.uuid) || !notTooEarly(entry)) continue;
      const isMidTurn = queuedCommandText(entry) === record.text;
      const isLate =
        index !== 0 &&
        entry.type === 'user' &&
        isPromptContent(entry.message?.content) &&
        extractPromptText(entry.message?.content) === record.text;
      if (isMidTurn || isLate) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex === -1) continue;

    const uuid = entries[matchIndex].uuid as string;
    pairs.push({ text: record.text, uuid });
    used.add(uuid);
    searchFrom = matchIndex + 1;
  }

  tagPending(chatId, pairs);

  // A record still unresolved that was sent before this turn's job started
  // belongs to an earlier turn that has ended: it can never match later, and
  // left in place it could claim a future message with the same text.
  if (jobStartedAt) dropUnresolvedBefore(chatId, jobStartedAt);
}

const SIDE_MATCH_SLACK_MS = 5_000;

/**
 * The `timestamp` of every prompt-shaped `user` entry in the transcript, in
 * transcript order — `undefined` for an entry carrying no timestamp. This is
 * NOT one per turn `readHistory` returns: a late side message is also a
 * prompt-shaped `user` entry, so it adds a start here but is folded into the
 * turn before it by `readHistory`, and the two lists can differ in length.
 * `chatActions.ts`'s `openChat` (review finding 7) only counts the starts at
 * or after the running job's own `startedAt` to tell whether the last turn on
 * disk is the chat's in-flight one, which does not need the two to line up.
 */
export function turnStartTimestamps(id: string): (string | undefined)[] {
  const found = transcriptPath(id);
  if (!found) return [];

  const entries = relevantEntries(readEntries(found.path));
  const starts: (string | undefined)[] = [];
  for (const entry of entries) {
    if (entry.type === 'user' && isPromptContent(entry.message?.content)) {
      starts.push(typeof entry.timestamp === 'string' ? entry.timestamp : undefined);
    }
  }
  return starts;
}

/* -------------------------------------------------------------------------- */
/* Tier inference                                                              */
/* -------------------------------------------------------------------------- */

/** Maps a transcript's `message.model` value to the tier it was run under.
 *  `null` for a model name this project never assigned, so a mix including
 *  one gives `unknown` rather than a wrong guess. */
function modelToTier(model: string): TierId | null {
  if (/^deepseek.*flash/i.test(model)) return 'fast';
  if (model === 'deepseek-v4-pro') return 'pro';
  if (/^gemini/i.test(model)) return 'gemini';
  if (/^claude-/i.test(model)) return 'max';
  return null;
}

/**
 * Infers a chat's tier from its transcript. A Max 2 transcript is `max2`
 * outright — there is no per-message model choice to read on that account.
 * On the main account, every `assistant` entry's `message.model` is
 * collected (`<synthetic>` — the CLI's own placeholder for a summarisation
 * or compaction turn, not a real model choice — is ignored). If every model
 * found maps to the same tier, that tier is returned; if they disagree, or
 * none map to a known tier, the result is `unknown` — true of many chats
 * from when the tier was chosen per message rather than per chat.
 *
 * Returns `null` when `id` has no transcript on disk at all — a distinct
 * case from `unknown`, which means "has a transcript, but its tier can't be
 * pinned down." Callers (T6, T8) only call this once they already know a
 * transcript exists, so `null` here signals a bug in that check rather than
 * a chat they need to render.
 */
export function inferTier(id: string): { tier: ChatTier; account: ChatAccount } | null {
  const found = transcriptPath(id);
  if (!found) return null;
  if (found.account === 'max2') return { tier: 'max2', account: 'max2' };

  const models = new Set<string>();
  for (const entry of readEntries(found.path)) {
    if (entry.type !== 'assistant') continue;
    const model = entry.message?.model;
    if (typeof model === 'string' && model !== '<synthetic>') models.add(model);
  }

  let tier: ChatTier | undefined;
  for (const model of models) {
    const mapped = modelToTier(model);
    if (!mapped) {
      tier = 'unknown';
      break;
    }
    if (tier === undefined) {
      tier = mapped;
    } else if (tier !== mapped) {
      tier = 'unknown';
      break;
    }
  }

  return { tier: tier ?? 'unknown', account: 'main' };
}
