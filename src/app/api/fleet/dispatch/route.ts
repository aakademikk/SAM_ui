/**
 * POST /api/fleet/dispatch — run a Tier 2 General persona as a stateless job.
 *
 * Executes the real Claude Code CLI as a server-side job, exactly like the
 * chat agent route but with `--agent` and a `--model` override. Step-up
 * (biometric) auth is required — a General has file and bash reach.
 *
 * Environment guard: the Next.js process loads `.env.local`, so `ANTHROPIC_*`
 * are inherited by any child. A dispatch that inherits them silently routes to
 * DeepSeek regardless of `--model`. So the environment is always stated in
 * full, never left to inheritance — every key is either a value or an explicit
 * null, in both directions:
 *
 *   - Anthropic models: all four keys nulled, `--model <alias>` passed.
 *   - DeepSeek models:  base URL + token + model set, `--model` omitted (the
 *                       CLI would read the id as an Anthropic alias), and
 *                       MAX_THINKING_TOKENS=0 — DeepSeek emits an unrequested
 *                       reasoning block on every call, measured at 2.9x billed
 *                       output for no quality gain.
 *
 * DeepSeek dispatch is limited to the read-only Generals. See
 * lib/fleetModels.ts for why that line is drawn at supervision, not provider.
 */

import os from 'node:os';
import path from 'node:path';

import { getJobManager } from '@/lib/server/jobs/manager';
import { fleetModel, isDeepSeekModel, personaMayUseDeepSeek } from '@/lib/fleetModels';
import { reportFleetRun } from '@/lib/server/fleet/costLedger';
import { readFleetRegistry } from '@/lib/server/fleet/registry';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';

export const dynamic = 'force-dynamic';

const MAX_BRIEF_CHARS = 8000;

/** Fallback when neither the request nor the persona names a usable model. */
const DEFAULT_MODEL = 'sonnet';

/** Where the agent runs. Its CLAUDE.md is what makes SAM sound like SAM. */
function agentCwd(): string {
  return process.env.SAM_AGENT_CWD ?? path.join(os.homedir(), 'claude');
}

function claudeBin(): string {
  return process.env.SAM_CLAUDE_BIN ?? 'claude';
}

export async function POST(request: Request) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  const startedAt = Date.now();
  const estate = getEstate();

  const body = await readJson(request);

  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  if (!brief) return failure('brief is required.', 400);
  if (brief.length > MAX_BRIEF_CHARS) {
    return failure(`Brief too long (max ${MAX_BRIEF_CHARS} chars).`, 413);
  }

  // Persona must come from the live registry — never passed to `--agent`
  // unvalidated.
  const personaName = typeof body.persona === 'string' ? body.persona : '';
  const personas = await readFleetRegistry();
  const persona = personas.find((p) => p.name === personaName);
  if (!persona) {
    return failure(`Unknown persona '${personaName}'.`, 400);
  }

  const requestedModel = typeof body.model === 'string' ? body.model : '';

  const usable = (id: string) =>
    Boolean(fleetModel(id)) && (!isDeepSeekModel(id) || personaMayUseDeepSeek(persona.name));

  // A deliberate, known-but-disallowed choice is rejected rather than quietly
  // downgraded — silently running a different model than the one asked for is
  // exactly the failure this route already guards against elsewhere.
  if (requestedModel && fleetModel(requestedModel) && !usable(requestedModel)) {
    return failure(
      `Persona '${persona.name}' is not cleared for '${requestedModel}'. ` +
        'DeepSeek dispatch is limited to the read-only Generals.',
      400,
    );
  }

  const model = usable(requestedModel)
    ? requestedModel
    : usable(persona.model)
      ? persona.model
      : DEFAULT_MODEL;

  const deepseek = isDeepSeekModel(model);

  const args = [
    '-p',
    brief,
    '--agent',
    persona.name,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  // DeepSeek is selected by environment, not by alias — see the header note.
  if (!deepseek) args.push('--model', model);

  const job = await getJobManager().createArgs(claudeBin(), args, {
    // Display-only label. Never executed; the prefix is what the spend scan
    // keys on, so keep the shape `fleet:<persona> (<model>) — …`.
    label: `fleet:${persona.name} (${model}) — ${brief.slice(0, 60)}${brief.length > 60 ? '…' : ''}`,
    cwd: agentCwd(),
    env: {
      // Stated in full either way. Never partially set, never inherited.
      ...(deepseek
        ? {
            ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,
            ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? null,
            ANTHROPIC_API_KEY: null,
            ANTHROPIC_MODEL: model,
            MAX_THINKING_TOKENS: '0',
          }
        : {
            ANTHROPIC_BASE_URL: null,
            ANTHROPIC_AUTH_TOKEN: null,
            ANTHROPIC_API_KEY: null,
            ANTHROPIC_MODEL: null,
          }),
      // The SessionStart hook launches a visualiser and a voice-line terminal
      // tab — desirable at the desk, not for a headless fleet job.
      SAM_SKIP_SERVICE_LAUNCH: '1',
    },
    // DeepSeek spend is invisible to every other ledger — the CLI misprices it
    // and the estate service is the single cost picture. Anthropic runs are
    // skipped inside the reporter; they are already costed from the job store.
    onExit: (finished) => reportFleetRun(finished.id, persona.name, model),
  });

  await logCommand({
    jobId: job.id,
    command: `[fleet:${persona.name}:${model}] ${brief.slice(0, 200)}`,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  return envelope(
    { jobId: job.id, persona: persona.name, model },
    'sam.fleet.dispatch',
    startedAt,
    estate.tick,
  );
}
