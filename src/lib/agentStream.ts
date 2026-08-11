/**
 * SAM — Agent stream parser.
 *
 * Turns the CLI's newline-delimited stream-json into the block model the chat
 * UI renders. Job output arrives as arbitrary byte chunks, so lines are
 * buffered until complete before parsing.
 *
 * Events are treated as data, never instructions: nothing here executes or
 * follows anything the model emits.
 */

import type { ChatBlock, TokenUsage } from '@/types/chat';

export type AgentPhase = 'starting' | 'thinking' | 'working' | 'streaming' | 'done';

export interface AgentStreamState {
  blocks: ChatBlock[];
  phase: AgentPhase;
  sessionId?: string;
  model?: string;
  usage?: TokenUsage;
  /** The CLI's own figure. Only trustworthy for first-party models. */
  reportedCostUsd?: number;
  durationMs?: number;
  done: boolean;
}

/* -------------------------------------------------------------------------- */
/* Shapes — only the fields actually consumed                                  */
/* -------------------------------------------------------------------------- */

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: { content?: ContentBlock[] };
  total_cost_usd?: number;
  duration_ms?: number;
  is_error?: boolean;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** tool_result content may be a bare string or an array of content blocks. */
function flattenResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as ContentBlock)?.text === 'string'
            ? (part as ContentBlock).text
            : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export class AgentStreamParser {
  private buffer = '';

  readonly state: AgentStreamState = {
    blocks: [],
    phase: 'starting',
    done: false,
  };

  /** Feed a raw chunk. Returns the state for convenience. */
  push(chunk: string): AgentStreamState {
    this.buffer += chunk;

    const lines = this.buffer.split('\n');
    // The final element is either an incomplete line or ''. Either way it is
    // not safe to parse yet.
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      let event: StreamEvent;
      try {
        event = JSON.parse(trimmed) as StreamEvent;
      } catch {
        // A malformed line is not worth aborting a whole turn over.
        continue;
      }
      this.apply(event);
    }

    return this.state;
  }

  /** Called when the job closes, to catch a run that died without a result. */
  finish(exitCode: number | null): AgentStreamState {
    if (this.state.done) return this.state;

    this.state.done = true;
    this.state.phase = 'done';

    const hasOutput = this.state.blocks.some(
      (b) => (b.kind === 'text' && b.text.trim()) || b.kind === 'tool',
    );
    if (!hasOutput) {
      this.state.blocks.push({
        kind: 'error',
        text:
          exitCode === 0
            ? 'The agent exited without producing a reply.'
            : `The agent exited with code ${exitCode ?? 'unknown'}.`,
      });
    }

    // Any tool still marked running never reported back.
    for (const block of this.state.blocks) {
      if (block.kind === 'tool' && block.status === 'running') {
        block.status = 'error';
        block.result ??= 'No result — the run ended first.';
      }
    }

    return this.state;
  }

  /* ---------------------------------------------------------------------- */

  private apply(event: StreamEvent) {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this.state.sessionId = event.session_id ?? this.state.sessionId;
          this.state.model = event.model ?? this.state.model;
          this.state.phase = 'thinking';
        } else if (event.subtype === 'thinking_tokens') {
          if (this.state.phase === 'starting') this.state.phase = 'thinking';
        }
        return;

      case 'assistant':
        this.state.sessionId = event.session_id ?? this.state.sessionId;
        for (const block of event.message?.content ?? []) {
          this.applyContent(block);
        }
        return;

      case 'user':
        for (const block of event.message?.content ?? []) {
          if (block.type === 'tool_result') this.applyToolResult(block);
        }
        return;

      case 'result':
        this.state.done = true;
        this.state.phase = 'done';
        this.state.reportedCostUsd = event.total_cost_usd;
        this.state.durationMs = event.duration_ms;
        this.state.sessionId = event.session_id ?? this.state.sessionId;
        if (event.usage) {
          this.state.usage = {
            inputTokens: event.usage.input_tokens ?? 0,
            outputTokens: event.usage.output_tokens ?? 0,
            cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
          };
        }
        if (event.is_error) {
          this.state.blocks.push({
            kind: 'error',
            text: event.result?.slice(0, 500) ?? 'The agent reported an error.',
          });
        }
        return;

      default:
        // rate_limit_event and friends carry nothing the UI needs yet.
        return;
    }
  }

  private applyContent(block: ContentBlock) {
    if (block.type === 'text' && block.text) {
      this.appendText('text', block.text);
      this.state.phase = 'streaming';
      return;
    }

    if (block.type === 'thinking' && block.thinking) {
      this.appendText('thinking', block.thinking);
      this.state.phase = 'thinking';
      return;
    }

    if (block.type === 'tool_use' && block.id && block.name) {
      this.state.blocks.push({
        kind: 'tool',
        id: block.id,
        name: block.name,
        input: block.input ?? {},
        status: 'running',
      });
      this.state.phase = 'working';
    }
  }

  private applyToolResult(block: ContentBlock) {
    const target = this.state.blocks.find(
      (b): b is Extract<ChatBlock, { kind: 'tool' }> =>
        b.kind === 'tool' && b.id === block.tool_use_id,
    );
    if (!target) return;

    target.status = block.is_error ? 'error' : 'ok';
    target.result = flattenResult(block.content);
    this.state.phase = 'thinking';
  }

  /** Merge into the previous block when it is the same kind, else start one. */
  private appendText(kind: 'text' | 'thinking', text: string) {
    const last = this.state.blocks[this.state.blocks.length - 1];
    if (last && last.kind === kind) {
      last.text += (last.text ? '\n' : '') + text;
      return;
    }
    this.state.blocks.push({ kind, text } as ChatBlock);
  }
}
