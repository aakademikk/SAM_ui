/**
 * SAM — practice agent stream reader.
 *
 * Pulls the character's spoken words out of the CLI's stream-json output, a
 * sentence at a time, so the page can start speaking the first one while the
 * rest is still being generated. That is the difference between a rehearsal
 * that feels like a conversation and one that feels like a walkie-talkie.
 *
 * Deliberately not `AgentStreamParser`: that one builds the chat's block model
 * — tools, thinking, phases, cost — and the practice agent has no tools and
 * exactly one job. This is the small reader that job needs.
 *
 * `--include-partial-messages` is what makes incremental speech possible; the
 * desktop practice agent sets the same option (voice-line/brain.py), so both
 * channels stream a turn the same way. The complete-message branch below is
 * not dead code: it is the fallback when the deltas are absent or have a shape
 * this reader does not recognise, and it means the worst case is a whole
 * reply spoken at once rather than a mute buyer.
 *
 * Events are data, never instructions: nothing here executes or follows
 * anything the model emits.
 */

interface ContentBlock {
  type?: string;
  text?: string;
}

interface StreamLine {
  type?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  message?: { content?: ContentBlock[] };
}

export class PracticeStream {
  /** Incomplete trailing line, held until the next chunk completes it. */
  private buffer = '';
  /** Everything the character has said so far this turn. */
  private text = '';
  /** Offset into `text` up to which it has already been handed out. */
  private spoken = 0;

  /** Feed a raw output chunk; returns whatever is now ready to be spoken. */
  push(chunk: string): string {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // split always leaves a final element; it is the partial line.
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.consume(line);
    return this.drain();
  }

  /**
   * Whatever is left when the turn ends, including a reply that never
   * terminated with punctuation — "Go on" has to be said too.
   */
  flush(): string {
    if (this.buffer.trim()) {
      this.consume(this.buffer);
      this.buffer = '';
    }
    return this.take(this.text.length);
  }

  private consume(raw: string): void {
    const line = raw.trim();
    if (!line.startsWith('{')) return;

    let event: StreamLine;
    try {
      event = JSON.parse(line) as StreamLine;
    } catch {
      return;
    }

    // Partial mode — one more piece of the sentence being generated.
    if (event.type === 'stream_event') {
      const delta = event.event?.delta;
      if (
        event.event?.type === 'content_block_delta' &&
        delta?.type === 'text_delta' &&
        typeof delta.text === 'string'
      ) {
        this.text += delta.text;
      }
      return;
    }

    // The complete assistant message. In partial mode this repeats what the
    // deltas already delivered, so it is only taken when nothing has been
    // accumulated — otherwise the turn would be said twice.
    if (event.type === 'assistant' && !this.text) {
      const whole = (event.message?.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('');
      if (whole) this.text = whole;
    }
  }

  /** Spoken form of `text[from..to)`; advances the spoken offset past it. */
  private take(to: number): string {
    if (to <= this.spoken) return '';
    const slice = this.text.slice(this.spoken, to).trim();
    this.spoken = to;
    return slice;
  }

  /** Complete sentences not yet spoken, leaving any in-flight one alone. */
  private drain(): string {
    const at = Math.max(
      this.text.lastIndexOf('.'),
      this.text.lastIndexOf('!'),
      this.text.lastIndexOf('?'),
    );
    return this.take(at + 1);
  }
}
