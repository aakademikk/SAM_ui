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
    this.sanitise();
    return this.take(Math.min(this.text.length, this.cutoff()));
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

  /**
   * Remove the CLI's injected token reminder from the accumulated text.
   *
   * The CLI drops a `<total_tokens>N tokens left</total_tokens>` reminder into
   * every turn. Claude ignores it — which is why the dashboard chat is clean —
   * but Gemini-2.5-flash sometimes parrots it back, and the parrot gets spoken:
   * Colin's 2026-09-18 Steve session had the buyer say "Tokens Left one five
   * zero zero zero zero" out loud mid-rehearsal. It is a tag, never speech, so
   * it is cut out here, wherever in the reply it lands.
   *
   * This runs before a hand-out rather than on append because a tag can arrive
   * split across two deltas; by the time the text is spoken the pair is whole.
   * A reminder that has not finished arriving is fenced instead — see `cutoff`.
   *
   * Removing text shifts every offset after it, but `spoken` needs no
   * correction: anything at an index below `spoken` was sanitised on an earlier
   * pass, so any pair still present here starts at or after it.
   */
  private sanitise(): void {
    if (!this.text.includes('<total_tokens>')) return;
    this.text = this.text.replace(/<total_tokens>[\s\S]*?<\/total_tokens>/g, '');
    // A closing tag the model emitted on its own is not speech either.
    this.text = this.text.replace(/<\/total_tokens>/g, '');
  }

  /**
   * Where the speakable text ends. An opening tag with no closing tag yet means
   * the reminder is still streaming, so everything from it on is withheld until
   * `sanitise` can take the completed pair out. Returns `text.length` when there
   * is no reminder, which is the ordinary case.
   */
  private cutoff(): number {
    const at = this.text.indexOf('<total_tokens>');
    return at === -1 ? this.text.length : at;
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
    this.sanitise();
    const at = Math.max(
      this.text.lastIndexOf('.'),
      this.text.lastIndexOf('!'),
      this.text.lastIndexOf('?'),
    );
    // The last sentence end can sit past a still-arriving reminder; stop short.
    return this.take(Math.min(at + 1, this.cutoff()));
  }
}
