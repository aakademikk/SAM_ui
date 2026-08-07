import type { ChatRole, Severity } from '@/types/dashboard';
import type { SamContext, SarcasmLevel } from '@/lib/personalityEngine';
import { classifyIntent, composeReply } from '@/lib/personalityEngine';
import { executeCommand } from '@/lib/server/commands';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { asNumber, asRecord, asString } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LENGTH = 4_000;

/**
 * SAM's conversational endpoint.
 *
 * Today it composes replies locally from the estate snapshot the client sends.
 * To attach a model, replace `composeReply` with your provider call and keep
 * routing the result through `applyVoice` from `personalityEngine` — the tone
 * layer is the product, the token source is an implementation detail.
 */

function contextFrom(raw: unknown): SamContext {
  const r = asRecord(raw);
  return {
    operator: asString(r.operator, 'Operator'),
    systemScore: asNumber(r.systemScore),
    agentsExecuting: asNumber(r.agentsExecuting),
    agentsTotal: asNumber(r.agentsTotal),
    blockedAgents: asNumber(r.blockedAgents),
    criticalInsights: asNumber(r.criticalInsights),
    overdueTasks: asNumber(r.overdueTasks),
    runwayDays: asNumber(r.runwayDays),
    projectBlockers: asNumber(r.projectBlockers),
    vaultPending: asNumber(r.vaultPending),
    failedAutomations: asNumber(r.failedAutomations),
  };
}

function severityFor(reply: string, context: SamContext): Severity {
  if (context.criticalInsights > 0 || context.blockedAgents > 1) return 'critical';
  if (/denied|failed|error|blocked/i.test(reply)) return 'warning';
  return 'info';
}

/** Splits a reply into believable token-sized chunks for the stream. */
function chunkify(text: string): string[] {
  const chunks: string[] = [];
  const words = text.split(/(\s+)/);
  let buffer = '';

  for (const word of words) {
    buffer += word;
    // 2–3 words per frame reads like generation rather than a typewriter.
    if (buffer.length >= 9 && !/\s$/.test(word)) {
      chunks.push(buffer);
      buffer = '';
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await readJson(request);

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .map((m) => {
      const r = asRecord(m);
      return {
        role: asString(r.role, 'user') as ChatRole,
        content: asString(r.content).slice(0, MAX_MESSAGE_LENGTH),
      };
    })
    .filter((m) => m.content.length > 0);

  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return failure('No user message supplied.', 400);

  const context = contextFrom(body.context);
  const sarcasm = ([0, 1, 2, 3] as const).includes(body.sarcasm as SarcasmLevel)
    ? (body.sarcasm as SarcasmLevel)
    : 2;

  let reply: string;

  // Inline command execution: `/exec docker ps` runs through the same
  // allow-listed interpreter the terminal widget uses.
  const execMatch = last.content.match(/^\s*\/(exec|run|sh)\s+([\s\S]+)$/i);
  if (execMatch) {
    const result = executeCommand(execMatch[2], sarcasm);
    reply = [
      `\`${execMatch[2].trim()}\` → exit ${result.exitCode} in ${result.durationMs}ms`,
      '',
      ...result.lines.map((l) => (l.kind === 'stderr' ? `! ${l.text}` : `  ${l.text}`)),
      ...(result.remark ? ['', result.remark] : []),
    ].join('\n');
  } else {
    const estate = getEstate();
    // Prefer live server truth over whatever the client last polled.
    const system = estate.getSystem();
    const fleet = estate.getFleet();
    const merged: SamContext = {
      ...context,
      systemScore: system.overallScore,
      agentsExecuting: fleet.agents.filter((a) => a.status === 'executing').length,
      agentsTotal: fleet.agents.length,
      blockedAgents: fleet.agents.filter((a) => a.status === 'blocked').length,
      failedAutomations: system.automationFailures24h,
      vaultPending: estate.pendingIndex,
    };
    reply = composeReply(last.content, merged, sarcasm);

    if (classifyIntent(last.content) === 'vault') {
      estate.recordVaultQuery(last.content.slice(0, 80), 'SAM');
    }
  }

  const wantsStream = body.stream === true;

  if (!wantsStream) {
    const estate = getEstate();
    return envelope(
      { content: reply, severity: severityFor(reply, context) },
      'sam.chat',
      startedAt,
      estate.tick,
    );
  }

  const encoder = new TextEncoder();
  const chunks = chunkify(reply);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
          // Cadence: fast enough to feel responsive, slow enough to read.
          await new Promise((resolve) => setTimeout(resolve, 14 + Math.random() * 26));
        }
      } catch {
        // Client disconnected mid-stream; nothing to clean up.
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-accel-buffering': 'no',
    },
  });
}
