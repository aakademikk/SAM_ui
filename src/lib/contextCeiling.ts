/**
 * SAM — how full a chat's context is (audit B-01/B-03, spec must-do 9 and 10).
 *
 * A chat is one CLI session resumed for ever, so every turn re-sends the whole
 * conversation. After each Max or Max 2 turn the server stores that turn's
 * context size on the chat (`ChatRecord.contextTokens`, written by the exit
 * hook in `server/chat/startTurn.ts`). At `CONTEXT_BANNER_TOKENS` the chat
 * page shows a "Hand off now" banner; at `CONTEXT_HANDOFF_TOKENS` the next
 * turn hands off by itself (T10).
 *
 * Dependency-free on purpose: the chat page (a client component) imports the
 * threshold and the banner rule from here, so this file must never pull in
 * `node:*` or any server module.
 *
 * The size is the LAST model call's prompt (fresh input + cache read + cache
 * creation), read from that call's own assistant event. Never the turn's
 * final `result` event: its usage is summed over every call in the turn
 * (measured 4.1M on a turn whose real context was 385k), which would
 * overstate the context many times over.
 */

/** At or above this, the chat page shows the context banner. */
export const CONTEXT_BANNER_TOKENS = 200_000;

/** At or above this, the next turn hands off by itself (T10). */
export const CONTEXT_HANDOFF_TOKENS = 400_000;

/** The usage fields one model call reports, as the stream carries them. */
export interface CallUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The prompt size of one model call: fresh input plus cache read plus cache creation. */
export function contextOf(usage: CallUsage): number {
  return (
    count(usage.input_tokens) +
    count(usage.cache_read_input_tokens) +
    count(usage.cache_creation_input_tokens)
  );
}

/**
 * The usage of the turn's last model call on the chat's own conversation,
 * from its stream-json output (one JSON event per line), or null when the
 * turn made no such call.
 *
 * Skipped, walking back from the end:
 *   - every non-`assistant` event (the `result` total included);
 *   - a subagent's call (`parent_tool_use_id` set): its context is the
 *     subagent's, not the chat's;
 *   - the CLI's synthetic API-error message, and any event whose usage sums
 *     to 0: storing 0 would wipe the real size a failed turn left behind.
 * One call can emit several assistant events with the same message id, all
 * carrying the same usage, so the last event is the last call.
 */
export function lastCallUsage(streamText: string): CallUsage | null {
  const lines = streamText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"assistant"')) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const e = event as {
      type?: unknown;
      parent_tool_use_id?: unknown;
      is_api_error_message?: unknown;
      message?: { usage?: unknown };
    };
    if (e.type !== 'assistant') continue;
    if (e.parent_tool_use_id !== undefined && e.parent_tool_use_id !== null) continue;
    if (e.is_api_error_message === true) continue;
    const usage = e.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    if (contextOf(usage as CallUsage) <= 0) continue;
    return usage as CallUsage;
  }
  return null;
}

/** The chat page's banner rule: a stored size at or over the banner line, on a
 *  chat that has not already been handed off. */
export function showContextBanner(chat: { contextTokens?: number; handedOffTo?: string }): boolean {
  return (
    typeof chat.contextTokens === 'number' &&
    chat.contextTokens >= CONTEXT_BANNER_TOKENS &&
    !chat.handedOffTo
  );
}

/** "210k": the banner's rounded size. */
export function formatContextK(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}
