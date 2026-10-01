/**
 * SAM — Agent chat types.
 *
 * A message from the agent is NOT a string. It is an ordered sequence of
 * typed blocks (thinking, tool calls, text), and the UI renders each kind
 * differently. Modelling it as a string is what forces a rewrite the moment
 * you want a collapsible tool card or a diff view, so the block list is the
 * contract everything else is built on.
 */

/** Which backend a message was run against. */
export type TierId = 'fast' | 'pro' | 'max' | 'max2' | 'gemini';

/** One pricing window, USD per 1M tokens. */
export interface RateWindow {
  inputMiss: number;
  cacheHit: number;
  output: number;
}

/**
 * Provider rates, USD per 1M tokens. DeepSeek moved to peak/off-peak billing
 * on 2026-08-16 16:00 UTC; until then the flat `old` window applies, after it
 * `peak` or `offPeak` is chosen by the UTC hour of the run.
 */
export interface TierRates {
  /** Flat rates in effect until 2026-08-16 16:00 UTC. */
  old: RateWindow;
  /** Rates in the 17 off-peak hours after the switch. */
  offPeak: RateWindow;
  /** Rates in the 7 peak hours (01:00–04:00, 06:00–10:00 UTC) after the switch. */
  peak: RateWindow;
}

export interface TierInfo {
  id: TierId;
  label: string;
  /** Model identifier actually passed to the CLI (or the CLI default). */
  model: string;
  /** True when the response leaves this machine for a third-party provider. */
  thirdParty: boolean;
  /**
   * Present when spend must be computed locally from token counts. Absent for
   * tiers whose reported cost can be trusted.
   */
  rates?: TierRates;
}

/** Lifecycle of a single tool call. */
export type ToolStatus = 'running' | 'ok' | 'error';

export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool';
      /** `tool_use_id` from the stream — used to match the later result. */
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: ToolStatus;
      /** Populated when the matching tool_result arrives. */
      result?: string;
    }
  | { kind: 'error'; text: string };

export interface TokenUsage {
  /** Fresh input tokens — billed at the cache-miss rate. */
  inputTokens: number;
  /** Tokens served from the provider's prompt cache. */
  cacheReadTokens: number;
  outputTokens: number;
}

export interface TurnCost {
  usd: number;
  /**
   * How the figure was derived. The CLI's own `total_cost_usd` prices every
   * model against an Anthropic rate table, which overstates DeepSeek by ~12x,
   * so non-Anthropic tiers are costed locally from token counts instead.
   */
  basis: 'computed' | 'reported';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ChatBlock[];
  /** Job backing this message, for reconnection. */
  jobId?: string;
  /** CLI session id, threaded into the next turn via `--resume`. */
  sessionId?: string;
  tier?: TierId;
  usage?: TokenUsage;
  cost?: TurnCost;
  /** Wall-clock duration reported by the CLI. */
  durationMs?: number;
  /** False until the run's `result` event (or a failure) lands. */
  done: boolean;
}

/* ========================================================================== */
/* Server chat store (chatStore.ts)                                           */
/* ========================================================================== */

/**
 * Tier recorded against a chat. `'unknown'` is for imported chats (T8) whose
 * transcript mixed models across turns, back when tier was chosen per
 * message rather than per chat — `inferTier` (T4) cannot pick one tier for
 * those, so the chat runs on `tierEnv('max')` until a handoff sets a real one.
 */
export type ChatTier = TierId | 'unknown';

/** Which Claude login a chat's turns run under. `max2` is the second Pro seat
 *  (see `tiers.ts`); every other tier runs on `main`. */
export type ChatAccount = 'main' | 'max2';

/**
 * One chat's server record, persisted by `chatStore.ts` to
 * `~/.sam/samui-chats.json`. This is SAM_ui's own store, never the vault —
 * titles and chat text stay under `~/.sam`.
 *
 * Timestamps are ISO-8601 strings (UTC, `Date.prototype.toISOString()`),
 * matching the rest of SAM_ui's on-disk records (see `auth/store.ts`).
 */
export interface ChatRecord {
  /** The Claude CLI session id this chat resumes (see samuiSessions.ts). */
  id: string;
  title: string;
  /** How `title` was produced. A Haiku title (T7) replaces a fallback once
   *  ready; it never reverts to fallback once set. */
  titleSource: 'fallback' | 'haiku';
  /** Failed Haiku title attempts. `queueTitle` (T7) stops retrying at 3. */
  titleTries: number;
  tier: ChatTier;
  account: ChatAccount;
  /** First 500 characters of the chat's first user message. */
  firstMessage: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. Bumped by `touchChat` on every turn. */
  lastActiveAt: string;
  turns: number;
  /** In the Archived view, not the main list. */
  archived: boolean;
  /**
   * True once deleted from the app. `deleteChat` only sets this flag — it
   * never touches the transcript file — so SAM can recover a chat by
   * clearing it by hand. `getChat` and `listChats` treat a deleted chat as
   * gone.
   */
  deleted: boolean;
  /** True for a chat `importRegistryChats` (T8) created from the old
   *  session registry, rather than one born from a live turn. */
  imported: boolean;
  /** Set while a turn is in flight; null otherwise. */
  runningJobId: string | null;
  /** Set on the OLD chat by `markHandedOff` (T18): the id it handed off to. */
  handedOffTo?: string;
  /** Set on the NEW chat by `markHandedOff` (T18): the id it came from. */
  handedOffFrom?: string;
  /** Set when a handoff's memo turn ran but produced no memo file. */
  handoffError?: string;
}

/**
 * The fields the chat list (T15/T16) needs for one row. A subset of
 * `ChatRecord` plus `running`, which is not stored — it comes from
 * `isSessionLocked` (T5) at read time, in `listChatSummaries` (T6).
 */
export interface ChatSummary {
  id: string;
  title: string;
  tier: ChatTier;
  account: ChatAccount;
  createdAt: string;
  lastActiveAt: string;
  turns: number;
  archived: boolean;
  imported: boolean;
  handedOffTo?: string;
  handedOffFrom?: string;
  handoffError?: string;
  running: boolean;
}

/** Convenience: the spoken text for a completed assistant turn. */
export function spokenText(message: ChatMessage): string {
  // Deliberately the LAST text block only. A tool-using turn emits a text
  // block before each tool call plus the actual answer; joining them would
  // narrate the whole working. The final text block is the answer.
  const texts = message.blocks.filter(
    (b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text',
  );
  const answer = texts[texts.length - 1];
  return answer ? answer.text.trim() : '';
}
