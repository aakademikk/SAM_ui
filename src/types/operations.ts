/**
 * SAM — Named Operations types.
 *
 * A named operation is a code-word-dispatched pipeline defined in the vault at
 * `00_SAM_Control/Named Operations.md`. The vault note is the source of truth;
 * these types are the shape the dashboard reads it in.
 */

export interface OperationStep {
  /** 1-based position in the pipeline. */
  index: number;
  /** Bolded step name, e.g. "Pull 20 leads". */
  title: string;
  /** The rest of the step line — how it runs and what verifies it. */
  detail: string;
  /** Marked 🔒 in the vault: SAM prepares, Colin performs the final action. */
  gate: boolean;
}

export interface OperationRun {
  /** Raw run-log bullet from the vault. */
  text: string;
  /** Leading ISO date if the bullet starts with one. */
  at: string | null;
}

export interface Operation {
  /** Slug derived from the trigger phrase, e.g. `bait-the-hook`. */
  id: string;
  /** Display name without the `Operation ` prefix, e.g. "Bait the Hook". */
  name: string;
  /** Trailing descriptor after the em dash on the heading. */
  summary: string;
  /** The spoken code word, e.g. "Sam, initiate operation bait the hook." */
  trigger: string;
  purpose: string;
  /** Mapped Tier 2 General, from the vault's `**Persona:**` line. */
  persona: string | null;
  steps: OperationStep[];
  /** The `**Defaults to confirm:**` line, if present. */
  defaults: string | null;
  /** Parsed from the note's `## Run log` section. Newest first. */
  runs: OperationRun[];
}

export interface OperationsPayload {
  operations: Operation[];
  /** False when the vault note is missing or unreadable. */
  available: boolean;
}

export interface OperationDispatchResult {
  jobId: string;
  operationId: string;
  persona: string;
  model: string;
}
