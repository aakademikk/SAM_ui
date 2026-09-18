/**
 * SAM — practice agent wire types.
 *
 * Shared by the server routes that read the briefs off disk and the client
 * page that lists them, so the shape is declared once. Lives here rather than
 * in the server module because a client component may not import anything that
 * pulls `node:fs` into the browser bundle.
 */

export interface PracticeBrief {
  /** Filename stem — what the client sends back to open a session. */
  id: string;
  /** The `# Brief —` heading, prefix stripped. */
  title: string;
  /** Who the operator is talking to, from `## Speaker`. */
  speaker: string;
  /** The scenario's own first line, spoken by TTS rather than generated. */
  openingLine: string;
  /**
   * The brief carries facts marked `[real]`, so this persona is a live lead
   * rather than a composite. Surfaced in the picker because rehearsing against
   * a real person's actual position is a different exercise from a constructed
   * one — and because the two should not be confused while scrolling a list.
   */
  realLead: boolean;
  /**
   * An Edge TTS voice name from the brief's `## Voice` section, or `''` when
   * the brief declares none. The voice belongs to the persona, not to the app:
   * three tradesmen rehearsed back to back in one voice is a worse exercise,
   * because the ear cannot tell the scenarios apart.
   */
  voice: string;
  /** Signed percentage (`-4%`) from `## Voice`, or `''` for the default. */
  rate: string;
}

export interface PracticeBriefsResult {
  briefs: PracticeBrief[];
}

export interface PracticeTurnResult {
  jobId: string;
  /** The CLI session id, threaded into the next turn. */
  sessionId: string;
  /** Who is speaking — empty on a continuation turn; the page already has it. */
  speaker: string;
  /** The scenario's opening line — empty on a continuation turn. */
  openingLine: string;
  brief: string;
  /** The persona's voice/pace, read from the brief on disk. */
  voice: string;
  rate: string;
}

/** A line of the rehearsal transcript. */
export interface PracticeLine {
  role: 'buyer' | 'colin' | 'note';
  text: string;
  /**
   * Set while the buyer's turn is still arriving, so the next sentence appends
   * to this line instead of opening a new one.
   */
  streaming?: boolean;
}
