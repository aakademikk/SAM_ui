/**
 * SAM — Haiku chat titles, with a first-message fallback.
 *
 * Spec must-do 2a: after a chat's first reply, Haiku writes a short title
 * (about 3 to 6 words). Until then, or if that call fails, the title is the
 * first message cut short. No Anthropic pay-per-use key is used — the title
 * call is the same one-shot CLI route proved in the tickets file's "Haiku
 * route for titles" note: a `claude -p` with `--model claude-haiku-4-5-*`,
 * `--output-format json`, `--max-turns 1`, no tools and no session
 * persistence, run with `tierEnv('max')` (the main seat — Max 2 was at its
 * session limit when this was proved, so it is never used for titles) plus
 * `SAM_SKIP_SERVICE_LAUNCH=1`, cwd `os.tmpdir()`.
 *
 * A title call is not a user job: `generateTitle` spawns the CLI directly
 * rather than going through `JobManager`, so it never appears in the job
 * list. `queueTitle` runs at most one of these at a time, in-process, so a
 * burst of turns finishing together (or T8's registry import) never spawns
 * 178 CLI calls at once.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';

import { claudeBin } from '@/lib/server/claudeBin';
import type { ChatMessage } from '@/types/chat';

import { getChat, recordTitleTryFailure, setTitle } from './chatStore';
import { tierEnv } from './tiers';
import { readHistory } from './transcripts';

/** Model used for titles — the one proved in the tickets file's note. Never
 *  the chat turn's own model; do not read this from a tier's TierInfo. */
const TITLE_MODEL = 'claude-haiku-4-5-20251001';

/** How long each text is allowed to be in the title prompt. */
const PROMPT_TEXT_CHARS = 600;

/** Longest a cleaned title is ever allowed to be. */
const MAX_TITLE_WORDS = 8;

/* ========================================================================== */
/* fallbackTitle                                                             */
/* ========================================================================== */

/** Longest a fallback title is ever allowed to be, before the `…`. */
const FALLBACK_MAX_CHARS = 48;

/**
 * The title shown until Haiku produces one, or forever if it never does:
 * whitespace collapsed to single spaces, cut at a word boundary to 48
 * characters or fewer, with `…` appended when it was cut. An empty (or
 * whitespace-only) message gives "New chat".
 */
export function fallbackTitle(firstMessage: string): string {
  const text = firstMessage.replace(/\s+/g, ' ').trim();
  if (!text) return 'New chat';
  if (text.length <= FALLBACK_MAX_CHARS) return text;
  const cut = text.slice(0, FALLBACK_MAX_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  // Only break on a word boundary that leaves a reasonable amount of text;
  // otherwise (e.g. one long word) just hard-cut.
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/* ========================================================================== */
/* generateTitle                                                             */
/* ========================================================================== */

export interface GenerateTitleOptions {
  bin?: string;
  timeoutMs?: number;
}

function truncateForPrompt(text: string): string {
  return text.length > PROMPT_TEXT_CHARS ? text.slice(0, PROMPT_TEXT_CHARS) : text;
}

function buildPrompt(firstMessage: string, firstReply: string): string {
  return [
    'Write a short title for this chat, 3 to 6 words.',
    'Reply with the title text only: no quotes, no trailing punctuation, no preamble or explanation.',
    '',
    `First message: ${truncateForPrompt(firstMessage)}`,
    '',
    `First reply: ${truncateForPrompt(firstReply)}`,
  ].join('\n');
}

/** Same null-removes-the-key overlay `JobManager` uses, reimplemented here
 *  because a title call deliberately does not go through `JobManager` (it
 *  is not a user job — see the module comment). */
function mergeEnv(overrides: Record<string, string | null>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Strip wrapping quotes and a trailing full stop, then cap at 8 words — a
 *  model that ignores the "3 to 6 words" ask (or wraps its answer in quotes)
 *  must never hand back a title-length paragraph. */
function cleanTitle(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^["'“‘]+/, '').replace(/["'”’]+$/, '').trim();
  text = text.replace(/\.+$/, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_TITLE_WORDS).join(' ');
}

interface TitleResult {
  is_error?: boolean;
  result?: string;
}

/**
 * One title call, spawned directly (not through `JobManager` — see the
 * module comment). Rejects on a non-zero exit, a timeout, `is_error`, or
 * output that cannot be parsed or cleaned into a non-empty title; callers
 * (`queueTitle`) treat any rejection the same way: leave the fallback in
 * place and record the try.
 */
export function generateTitle(
  firstMessage: string,
  firstReply: string,
  options: GenerateTitleOptions = {},
): Promise<string> {
  const bin = options.bin ?? claudeBin();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const prompt = buildPrompt(firstMessage, firstReply);

  const args = [
    '-p',
    prompt,
    '--model',
    TITLE_MODEL,
    '--output-format',
    'json',
    '--max-turns',
    '1',
    '--tools',
    '',
    '--no-session-persistence',
  ];

  const env = mergeEnv({
    ...tierEnv('max'),
    SAM_SKIP_SERVICE_LAUNCH: '1',
  });

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const child = spawn(bin, args, {
      cwd: os.tmpdir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      settle(() => {
        child.kill('SIGKILL');
        reject(new Error(`generateTitle: timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      settle(() => reject(err));
    });

    child.on('close', (code) => {
      settle(() => {
        if (code !== 0) {
          reject(new Error(`generateTitle: exited ${code}: ${stderr.trim() || stdout.trim()}`));
          return;
        }
        let parsed: TitleResult | null = null;
        try {
          parsed = JSON.parse(stdout.trim()) as TitleResult;
        } catch (err) {
          reject(
            new Error(`generateTitle: could not parse CLI output (${(err as Error).message}): ${stdout.trim()}`),
          );
          return;
        }
        if (!parsed || parsed.is_error) {
          reject(new Error(`generateTitle: CLI reported is_error: ${stdout.trim()}`));
          return;
        }
        const title = cleanTitle(String(parsed.result ?? ''));
        if (!title) {
          reject(new Error('generateTitle: empty title after cleaning'));
          return;
        }
        resolve(title);
      });
    });
  });
}

/* ========================================================================== */
/* queueTitle                                                                */
/* ========================================================================== */

function textOf(message: ChatMessage | undefined): string {
  if (!message) return '';
  return message.blocks
    .map((b) => (b.kind === 'text' ? b.text : ''))
    .join('\n')
    .trim();
}

/**
 * Runs at most one Haiku call at a time — a burst of turns finishing
 * together, or T8's 178-chat registry import, must never spawn a pile of CLI
 * processes at once. Two FIFO lanes rather than one (review finding 10):
 * `live` always drains fully before `background` gets a turn, so a chat
 * Colin starts right after deploy gets its title the moment its own turn
 * ends, rather than queued behind however much of the one-time import's
 * backlog is still waiting. Checked fresh after every attempt (not decided
 * once up front), so a live call queued WHILE a background one is already
 * running still jumps the rest of the background lane the moment that one
 * attempt finishes.
 */
interface QueuedTitle {
  chatId: string;
  run: () => Promise<void>;
}

const liveQueue: QueuedTitle[] = [];
const backgroundQueue: QueuedTitle[] = [];
let draining = false;

function drainQueues(): void {
  if (draining) return;
  draining = true;
  void (async () => {
    try {
      let next: QueuedTitle | undefined;
      while ((next = liveQueue.shift() ?? backgroundQueue.shift())) {
        await next.run();
      }
    } finally {
      draining = false;
    }
  })();
}

export interface QueueTitleOptions {
  /** True for T8's registry import: queued behind every `live` (default)
   *  call, including ones queued after it. */
  background?: boolean;
}

/**
 * Queue a title attempt for `chatId`, run once its turn in the queue comes
 * up. On success, sets the store's title to the Haiku result (`setTitle`,
 * source `'haiku'`). On any failure (CLI error, timeout, empty/unparsable
 * result, or the chat having vanished), records the try
 * (`recordTitleTryFailure`) and leaves the current title — the fallback, or
 * an earlier Haiku title — exactly as it was.
 *
 * Returns a promise for this call's own attempt (useful for tests); it
 * always resolves, never rejects, once `generateTitle`'s own promise settles
 * either way.
 */
export function queueTitle(chatId: string, options: QueueTitleOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const task = { chatId, run: () => attemptTitle(chatId).finally(resolve) };
    (options.background ? backgroundQueue : liveQueue).push(task);
    drainQueues();
  });
}

async function attemptTitle(chatId: string): Promise<void> {
  try {
    const chat = getChat(chatId);
    if (!chat) return;
    const history = readHistory(chatId);
    const firstMessage = textOf(history.find((m) => m.role === 'user'));
    const firstReply = textOf(history.find((m) => m.role === 'assistant'));
    const title = await generateTitle(firstMessage, firstReply);
    setTitle(chatId, title, 'haiku');
  } catch {
    recordTitleTryFailure(chatId);
  }
}
