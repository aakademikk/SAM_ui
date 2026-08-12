/**
 * POST /api/fleet/dispatch — run a Tier 2 General persona as a stateless job.
 *
 * Executes the real Claude Code CLI as a server-side job, exactly like the
 * chat agent route but with `--agent` and a `--model` override. Step-up
 * (biometric) auth is required — a General has file and bash reach.
 *
 * Environment guard: the Next.js process loads `.env.local`, so `ANTHROPIC_*`
 * are inherited by any child. A dispatch that inherits them silently routes to
 * DeepSeek regardless of `--model`. The fleet always runs Claude-tier
 * Generals, so those keys are stripped — the same guard the Max chat tier
 * applies.
 */

import os from 'node:os';
import path from 'node:path';

import { getJobManager } from '@/lib/server/jobs/manager';
import { readFleetRegistry } from '@/lib/server/fleet/registry';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';

export const dynamic = 'force-dynamic';

const MAX_BRIEF_CHARS = 8000;

/** Model aliases the CLI resolves to the latest of that class. */
const ALLOWED_MODELS = ['haiku', 'sonnet', 'opus'] as const;

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
  const allowed = ALLOWED_MODELS as readonly string[];
  const model = allowed.includes(requestedModel as (typeof ALLOWED_MODELS)[number])
    ? requestedModel
    : allowed.includes(persona.model as (typeof ALLOWED_MODELS)[number])
      ? persona.model
      : 'sonnet';

  const args = [
    '-p',
    brief,
    '--agent',
    persona.name,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  args.push('--model', model);

  const job = await getJobManager().createArgs(claudeBin(), args, {
    // Display-only label. Never executed; the prefix is what the spend scan
    // keys on, so keep the shape `fleet:<persona> (<model>) — …`.
    label: `fleet:${persona.name} (${model}) — ${brief.slice(0, 60)}${brief.length > 60 ? '…' : ''}`,
    cwd: agentCwd(),
    env: {
      ANTHROPIC_BASE_URL: null,
      ANTHROPIC_AUTH_TOKEN: null,
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_MODEL: null,
      // The SessionStart hook launches a visualiser and a voice-line terminal
      // tab — desirable at the desk, not for a headless fleet job.
      SAM_SKIP_SERVICE_LAUNCH: '1',
    },
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
