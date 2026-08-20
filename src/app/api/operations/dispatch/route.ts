/**
 * POST /api/operations/dispatch — launch a named operation.
 *
 * A launch is a fleet dispatch with a brief composed from the vault's own step
 * list (see operations.buildBrief). It is deliberately NOT a pipeline engine:
 * the mapped General works the steps and stops at any 🔒 human gate. Claiming
 * more than that is exactly what the vault note warns against.
 *
 * Step-up (biometric) auth required — same bar as /api/fleet/dispatch, because
 * this runs the same CLI with the same file and bash reach.
 *
 * The environment guard below is the one from the fleet dispatch route and
 * must stay identical: the Next.js process loads `.env.local`, so `ANTHROPIC_*`
 * leak into any child and would silently route an Anthropic run to DeepSeek.
 * Every key is either a value or an explicit null, in both directions.
 */

import os from 'node:os';
import path from 'node:path';

import { getJobManager } from '@/lib/server/jobs/manager';
import { fleetModel, isDeepSeekModel, personaMayUseDeepSeek } from '@/lib/fleetModels';
import { reportFleetRun } from '@/lib/server/fleet/costLedger';
import { readFleetRegistry } from '@/lib/server/fleet/registry';
import { buildBrief, findOperation, recordRun } from '@/lib/server/operations';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';

export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'sonnet';

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
  const id = typeof body.operationId === 'string' ? body.operationId : '';
  if (!id) return failure('operationId is required.', 400);

  const operation = findOperation(id);
  if (!operation) return failure(`Unknown operation '${id}'.`, 404);
  if (operation.steps.length === 0) {
    return failure(`Operation '${operation.name}' has no steps defined in the vault.`, 409);
  }
  if (!operation.persona) {
    return failure(
      `Operation '${operation.name}' has no **Persona:** line in the vault note.`,
      409,
    );
  }

  // The persona must exist in the live registry — the vault names it, but only
  // the persona files decide what `--agent` will accept.
  const personas = await readFleetRegistry();
  const persona = personas.find((p) => p.name === operation.persona);
  if (!persona) {
    return failure(
      `Operation '${operation.name}' maps to persona '${operation.persona}', which is not in the fleet registry.`,
      409,
    );
  }

  const requestedModel = typeof body.model === 'string' ? body.model : '';
  const usable = (candidate: string) =>
    Boolean(fleetModel(candidate)) &&
    (!isDeepSeekModel(candidate) || personaMayUseDeepSeek(persona.name));

  if (requestedModel && fleetModel(requestedModel) && !usable(requestedModel)) {
    return failure(`Persona '${persona.name}' is not cleared for '${requestedModel}'.`, 400);
  }

  const model = usable(requestedModel)
    ? requestedModel
    : usable(persona.model)
      ? persona.model
      : DEFAULT_MODEL;

  const deepseek = isDeepSeekModel(model);
  const brief = buildBrief(operation);

  const args = [
    '-p',
    brief,
    '--agent',
    persona.name,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  if (!deepseek) args.push('--model', model);

  const job = await getJobManager().createArgs(claudeBin(), args, {
    // Same `fleet:<persona> (<model>) — …` shape the spend scan keys on, so an
    // operation run costs and lists exactly like any other fleet job.
    label: `fleet:${persona.name} (${model}) — operation ${operation.name}`,
    cwd: agentCwd(),
    env: {
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
      SAM_SKIP_SERVICE_LAUNCH: '1',
    },
    onExit: (finished) => reportFleetRun(finished.id, persona.name, model),
  });

  // Written at launch, not on exit: a run that dies mid-pipeline is exactly the
  // one a future session needs to find in the log.
  const today = new Date().toISOString().slice(0, 10);
  recordRun(
    operation,
    `${today} — launched from the dashboard (${stepUp.device}), persona \`${persona.name}\`, model \`${model}\`, job \`${job.id}\`. Outcome pending.`,
  );

  await logCommand({
    jobId: job.id,
    command: `[operation:${operation.id}:${persona.name}:${model}]`,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  return envelope(
    { jobId: job.id, operationId: operation.id, persona: persona.name, model },
    'sam.operations.dispatch',
    startedAt,
    estate.tick,
  );
}
