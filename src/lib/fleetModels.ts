/**
 * SAM — Fleet model registry. Pure, client-safe (same rule as lib/costing.ts).
 *
 * One source of truth for which models a General may run on, shared by the
 * fleet UI, the dispatch route and the spend scan. Previously the list was
 * hardcoded in all three, which is how the UI and the dispatch allowlist drift
 * apart and a model becomes selectable but un-dispatchable.
 *
 * Two providers, selected by completely different mechanisms:
 *
 *   - Anthropic models are CLI aliases, passed as `--model haiku`.
 *   - DeepSeek models are chosen by *environment* — ANTHROPIC_BASE_URL plus
 *     ANTHROPIC_AUTH_TOKEN plus ANTHROPIC_MODEL — exactly as the chat Fast tier
 *     does. `--model` is not passed for these; the CLI would treat the id as an
 *     Anthropic alias and the endpoint would silently serve something else.
 */

export type FleetProvider = 'anthropic' | 'deepseek';

export interface FleetModel {
  id: string;
  label: string;
  hint: string;
  provider: FleetProvider;
}

export const FLEET_MODELS: readonly FleetModel[] = [
  { id: 'haiku', label: 'Haiku', hint: 'fast · cheap · workers', provider: 'anthropic' },
  { id: 'sonnet', label: 'Sonnet', hint: 'balanced · generals', provider: 'anthropic' },
  { id: 'opus', label: 'Opus', hint: 'max capability · expensive', provider: 'anthropic' },
  {
    id: 'deepseek-v4-flash',
    label: 'Flash',
    hint: 'deepseek · cheapest · read-only',
    provider: 'deepseek',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'Pro',
    hint: 'deepseek · stronger · read-only',
    provider: 'deepseek',
  },
] as const;

export const FLEET_MODEL_IDS: readonly string[] = FLEET_MODELS.map((m) => m.id);

export function fleetModel(id: string): FleetModel | undefined {
  return FLEET_MODELS.find((m) => m.id === id);
}

export function isDeepSeekModel(id: string): boolean {
  return fleetModel(id)?.provider === 'deepseek';
}

/**
 * Generals cleared to run on a third-party endpoint.
 *
 * The constraint is not the provider — the chat Fast tier already runs DeepSeek
 * against the same CLI, same tools and same working directory. It is
 * supervision: chat is interactive and a fleet job is dispatch-and-forget, so
 * an unattended General with write and bash reach is a different proposition to
 * one you are watching. That line held for cerberus + prometheus (read-only by
 * definition — see their persona files).
 *
 * Widened to all five Generals on Colin's call 2026-08-16. The write-capable
 * three already held the MCP `llm()` router tool (per-call, context-flat); this
 * clears the full dispatch-on-DeepSeek path for them too. DeepSeek dispatch
 * remains gated behind the dispatch route's step-up auth either way.
 */
export const DEEPSEEK_ALLOWED_PERSONAS: readonly string[] = [
  'cerberus',
  'prometheus',
  'hephaestus',
  'hermes',
  'calliope',
];

export function personaMayUseDeepSeek(persona: string): boolean {
  return DEEPSEEK_ALLOWED_PERSONAS.includes(persona);
}

/** Models this persona may actually be dispatched on. */
export function modelsForPersona(persona: string): readonly FleetModel[] {
  return personaMayUseDeepSeek(persona)
    ? FLEET_MODELS
    : FLEET_MODELS.filter((m) => m.provider === 'anthropic');
}
