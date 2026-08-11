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
export type TierId = 'fast' | 'max';

/** Provider rates, USD per 1M tokens. */
export interface TierRates {
  inputMiss: number;
  cacheHit: number;
  output: number;
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
