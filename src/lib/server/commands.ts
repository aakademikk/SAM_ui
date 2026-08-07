/**
 * SAM — Command interpreter.
 *
 * SECURITY NOTE, read this before wiring it to anything real:
 * This interpreter **never shells out**. It resolves commands against the
 * in-process estate model in `telemetry.ts` and returns synthesised streams.
 * That is deliberate — an HTTP endpoint that pipes request bodies into a shell
 * is a remote code execution hole, not a feature.
 *
 * To connect real infrastructure, replace individual `handlers` entries with
 * calls to scoped, authenticated clients (Docker Engine API over a unix socket,
 * the n8n REST API with a service token, a job runner for Python). Keep the
 * allow-list model below: resolve a known verb to a known operation, never
 * interpolate operator input into a shell string.
 */

import type { CommandResult, TerminalStreamKind } from '@/types/dashboard';
import { commandRemark } from '@/lib/personalityEngine';
import type { SarcasmLevel } from '@/lib/personalityEngine';
import { formatDuration } from '@/lib/utils';
import { getEstate } from '@/lib/server/telemetry';

type Line = { kind: TerminalStreamKind; text: string };

const out = (text: string): Line => ({ kind: 'stdout', text });
const err = (text: string): Line => ({ kind: 'stderr', text });
const sys = (text: string): Line => ({ kind: 'system', text });

/** Commands that are refused outright, with the reason SAM gives. */
const REFUSED: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^\s*rm\s+(-[a-z]*\s+)*-?[rf]/i,
    reason:
      'Denied. You are asking me to recursively delete things through a web form. I have read the incident reports that start this way.',
  },
  {
    pattern: /^\s*(curl|wget|nc|ncat|telnet)\b/i,
    reason:
      'Denied. Arbitrary egress from the supervisor process is not a capability I am going to hand you through a text box.',
  },
  {
    pattern: /^\s*(sudo|su)\b/i,
    reason: 'Denied. If you needed root you would not be asking a dashboard for it.',
  },
  {
    pattern: /[;&|]{1,2}\s*\S/,
    reason:
      'Denied. Command chaining is not supported, and the fact that you tried it is noted in the log.',
  },
  {
    pattern: /\$\(|`/,
    reason: 'Denied. Command substitution is exactly the thing this interpreter refuses to do.',
  },
];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

const HELP_TEXT: Line[] = [
  sys('SAM shell — available verbs'),
  out(''),
  out('  status                     estate summary + health score'),
  out('  ps [agents]                running processes / agent fleet'),
  out('  top                        live resource consumers'),
  out('  df | free | uptime         host resource readouts'),
  out(''),
  out('  docker ps                  container inventory'),
  out('  docker restart <service>   restart a managed container'),
  out('  docker logs <service>      tail recent container output'),
  out(''),
  out('  n8n list                   registered workflows'),
  out('  n8n run <workflow>         trigger a workflow now'),
  out('  n8n status                 orchestrator queue depth'),
  out(''),
  out('  agent list                 fleet roster'),
  out('  agent spawn <role>         provision a new worker'),
  out('  agent kill <codename>      terminate a worker'),
  out('  agent boost <codename>     raise a worker priority'),
  out(''),
  out('  vault stats                index health'),
  out('  vault reindex [--priority] drain the embedding backlog'),
  out('  vault query "<text>"       semantic retrieval'),
  out(''),
  out('  python <script.py>         run a registered job'),
  out('  git status                 working tree state'),
  out('  ls [path] | whoami | echo  the usual'),
  out('  clear                      wipe scrollback'),
];

/* ========================================================================== */

export function executeCommand(input: string, sarcasm: SarcasmLevel = 2): CommandResult {
  const startedAt = Date.now();
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: true, exitCode: 0, durationMs: 0, lines: [] };
  }

  for (const rule of REFUSED) {
    if (rule.pattern.test(trimmed)) {
      return {
        ok: false,
        exitCode: 126,
        durationMs: Date.now() - startedAt,
        lines: [err(`sam: permission denied: ${trimmed.split(/\s+/)[0]}`)],
        remark: rule.reason,
      };
    }
  }

  const tokens = tokenize(trimmed);
  const verb = (tokens[0] ?? '').toLowerCase();
  const args = tokens.slice(1);
  const estate = getEstate();

  const finish = (lines: Line[], exitCode = 0): CommandResult => ({
    ok: exitCode === 0,
    exitCode,
    durationMs: Date.now() - startedAt,
    lines,
    remark: commandRemark(exitCode === 0, trimmed, sarcasm),
  });

  switch (verb) {
    case 'help':
    case '?':
      return finish(HELP_TEXT);

    case 'whoami':
      return finish([out('operator@atwood — supervised by SAM (full estate authority)')]);

    case 'echo':
      return finish([out(args.join(' '))]);

    case 'uptime': {
      const system = estate.getSystem();
      return finish([
        out(
          `up ${formatDuration(system.uptimeSec)},  load average: ${system.loadAvg.join(', ')},  ${estate.agents.length} agents registered`,
        ),
      ]);
    }

    case 'status': {
      const system = estate.getSystem();
      const fleet = estate.getFleet();
      const degraded = system.services.filter((s) => s.state !== 'operational');
      return finish([
        sys('═══ ESTATE STATUS ═══'),
        out(`health score       ${system.overallScore.toFixed(1)}/100`),
        out(`cpu / mem / disk   ${system.cpuPct.toFixed(0)}% / ${system.memPct.toFixed(0)}% / ${system.diskPct.toFixed(0)}%`),
        out(`agents             ${fleet.agents.filter((a) => a.status === 'executing').length} executing, ${fleet.agents.filter((a) => a.status === 'blocked').length} blocked, ${fleet.agents.length} total`),
        out(`token throughput   ${fleet.totalTokensPerMin.toLocaleString('en-US')}/min`),
        out(`services           ${system.services.length - degraded.length}/${system.services.length} operational`),
        ...(degraded.length > 0 ? [err(`degraded           ${degraded.map((d) => d.name).join(', ')}`)] : []),
        out(`automation 24h     ${system.automationRuns24h} runs, ${system.automationFailures24h} failed`),
        out(`vault              ${estate.indexedNotes.toLocaleString('en-US')}/${estate.totalNotes.toLocaleString('en-US')} indexed, ${estate.pendingIndex} pending`),
      ]);
    }

    case 'ps': {
      if (args[0] === 'agents' || args[0] === 'agent') {
        const fleet = estate.getFleet();
        return finish([
          sys('CODENAME   SWARM      STATUS      CPU%   MEM      TASK'),
          ...fleet.agents.map((a) =>
            out(
              `${a.codename.padEnd(10)} ${a.swarm.padEnd(10)} ${a.status.padEnd(11)} ${a.cpuPct.toFixed(0).padStart(4)}   ${`${a.memMb.toFixed(0)}M`.padEnd(8)} ${a.currentTask}`,
            ),
          ),
        ]);
      }
      const system = estate.getSystem();
      return finish([
        sys('PID    SERVICE              STATE          LAT     UPTIME'),
        ...system.services.map((s, i) =>
          out(
            `${(1204 + i * 37).toString().padEnd(6)} ${s.name.padEnd(20)} ${s.state.padEnd(14)} ${`${s.latencyMs}ms`.padEnd(7)} ${s.uptimePct.toFixed(2)}%`,
          ),
        ),
      ]);
    }

    case 'top': {
      const fleet = estate.getFleet();
      const top = [...fleet.agents].sort((a, b) => b.cpuPct - a.cpuPct).slice(0, 6);
      return finish([
        sys(`tasks: ${fleet.agents.length} total, ${fleet.agents.filter((a) => a.status === 'executing').length} running`),
        sys('CODENAME   CPU%    MEM%    TOK/MIN   QUEUE'),
        ...top.map((a) =>
          out(
            `${a.codename.padEnd(10)} ${a.cpuPct.toFixed(1).padStart(5)}  ${((a.memMb / a.memCapMb) * 100).toFixed(1).padStart(6)}  ${a.tokensPerMin.toLocaleString('en-US').padStart(8)}   ${a.queueDepth}`,
          ),
        ),
      ]);
    }

    case 'df': {
      const system = estate.getSystem();
      return finish([
        sys('FILESYSTEM        SIZE   USED   AVAIL  USE%  MOUNT'),
        out(`/dev/nvme0n1p1    2.0T   ${((system.diskPct / 100) * 2).toFixed(1)}T   ${(2 - (system.diskPct / 100) * 2).toFixed(1)}T   ${system.diskPct.toFixed(0)}%  /`),
        out(`vault-volume      512G   ${(estate.vaultSizeMb / 1024).toFixed(1)}G   ${(512 - estate.vaultSizeMb / 1024).toFixed(0)}G   ${((estate.vaultSizeMb / 1024 / 512) * 100).toFixed(0)}%  /srv/vault`),
      ]);
    }

    case 'free': {
      const system = estate.getSystem();
      const totalGb = 64;
      const usedGb = (system.memPct / 100) * totalGb;
      return finish([
        sys('              TOTAL      USED      FREE'),
        out(`Mem:          ${totalGb}G      ${usedGb.toFixed(1)}G     ${(totalGb - usedGb).toFixed(1)}G`),
        out(`Swap:         16G       ${(usedGb * 0.06).toFixed(1)}G      ${(16 - usedGb * 0.06).toFixed(1)}G`),
      ]);
    }

    case 'ls': {
      const path = args[0] ?? '.';
      if (path.includes('vault')) {
        return finish([
          out('00-inbox/        01-clients/      02-systems/      03-finance/'),
          out('04-playbooks/    05-research/     06-incidents/    _templates/'),
          out(`${estate.totalNotes.toLocaleString('en-US')} notes · ${(estate.vaultSizeMb / 1024).toFixed(2)} GB`),
        ]);
      }
      return finish([
        out('docker-compose.yml   n8n/                 services/            scripts/'),
        out('terraform/           vault/               .env.example         Makefile'),
      ]);
    }

    case 'git': {
      if (args[0] !== 'status') return finish([err(`git: '${args[0] ?? ''}' is not a supported subcommand`)], 1);
      return finish([
        out('On branch main'),
        out("Your branch is ahead of 'origin/main' by 3 commits."),
        out(''),
        out('Changes not staged for commit:'),
        err('  modified:   services/ledger/reconcile.py'),
        err('  modified:   n8n/workflows/ingest-webhook.json'),
        out(''),
        out('Untracked files:'),
        err('  scripts/rotate-credentials.sh'),
      ]);
    }

    case 'docker': {
      const sub = (args[0] ?? '').toLowerCase();
      const system = estate.getSystem();

      if (sub === 'ps') {
        return finish([
          sys('CONTAINER ID   IMAGE                    STATUS          PORTS'),
          ...system.services.map((s, i) =>
            out(
              `${(0xa1f30b + i * 977).toString(16).padEnd(14)} atwood/${s.kind}:latest`.padEnd(48) +
                `${s.state === 'operational' ? `Up ${formatDuration(system.uptimeSec / (i + 2))}` : s.state === 'maintenance' ? 'Restarting' : 'Up (unhealthy)'}`.padEnd(16) +
                `${8000 + i * 11}->${8000 + i * 11}/tcp`,
            ),
          ),
        ]);
      }

      if (sub === 'restart') {
        const target = args[1];
        if (!target) return finish([err('docker restart: missing container name')], 2);
        const service = estate.restartService(target);
        if (!service) return finish([err(`docker: no such container: ${target}`)], 1);
        return finish([
          sys(`stopping ${service.name}…`),
          out(`${service.name}`),
          sys(`starting ${service.name}…`),
          out(`container ${service.name} is up — latency ${service.latencyMs}ms, incidents reset`),
        ]);
      }

      if (sub === 'logs') {
        const target = args[1] ?? 'n8n-orchestrator';
        return finish([
          sys(`-- tailing ${target} --`),
          out(`[info ] worker booted, concurrency=8`),
          out(`[info ] webhook /ingest/atwood 200 in 41ms`),
          err(`[warn ] retry 2/5 for job 8841c — upstream timeout`),
          out(`[info ] job 8841c completed in 2,104ms`),
          err(`[error] job 8842a failed — ECONNRESET from chroma-embed`),
          out(`[info ] queue depth 4, ${estate.automationRuns24h} runs today`),
        ]);
      }

      if (sub === 'stats') {
        const fleet = estate.getFleet();
        return finish([
          sys('NAME                 CPU %    MEM USAGE / LIMIT'),
          ...fleet.agents.slice(0, 6).map((a) =>
            out(`${a.codename.toLowerCase().padEnd(20)} ${a.cpuPct.toFixed(2).padStart(6)}   ${a.memMb.toFixed(0)}MiB / ${a.memCapMb}MiB`),
          ),
        ]);
      }

      return finish([err(`docker: '${sub}' is not a supported subcommand. Try: ps, restart, logs, stats`)], 1);
    }

    case 'n8n': {
      const sub = (args[0] ?? '').toLowerCase();

      if (sub === 'list') {
        return finish([
          sys('ID    WORKFLOW                       TRIGGER      LAST RUN     STATUS'),
          out('wf01  ingest-webhook                 webhook      2m ago       ok'),
          out('wf02  vault-nightly-reindex          cron 03:00   9h ago       ok'),
          out('wf03  invoice-reconcile              cron 06:00   6h ago       ok'),
          err('wf04  client-digest-email            cron 08:00   4h ago       failed'),
          out('wf05  docker-health-sweep            interval 5m  1m ago       ok'),
          out('wf06  lead-enrichment                webhook      18m ago      ok'),
        ]);
      }

      if (sub === 'run') {
        const workflow = args[1];
        if (!workflow) return finish([err('n8n run: specify a workflow id or name')], 2);
        estate.automationRuns24h++;
        return finish([
          sys(`POST /rest/workflows/${workflow}/run`),
          out(`execution 4471${estate.tick % 100} queued`),
          out(`node "trigger"        ok    3ms`),
          out(`node "fetch-source"   ok    412ms`),
          out(`node "transform"      ok    88ms`),
          out(`node "persist-vault"  ok    241ms`),
          out(`workflow ${workflow} finished — 4 nodes, 744ms`),
        ]);
      }

      if (sub === 'status') {
        return finish([
          out(`orchestrator: operational`),
          out(`queue depth : ${estate.agents.reduce((s, a) => s + a.queueDepth, 0)}`),
          out(`runs (24h)  : ${estate.automationRuns24h}`),
          estate.automationFailures24h > 0
            ? err(`failures    : ${estate.automationFailures24h}`)
            : out(`failures    : 0`),
        ]);
      }

      return finish([err(`n8n: '${sub}' is not a supported subcommand. Try: list, run, status`)], 1);
    }

    case 'agent': {
      const sub = (args[0] ?? '').toLowerCase();
      const fleet = estate.getFleet();

      if (sub === 'list' || sub === '') {
        return finish([
          sys('CODENAME   ROLE           SWARM      STATUS       DONE   ERR'),
          ...fleet.agents.map((a) =>
            out(
              `${a.codename.padEnd(10)} ${a.role.padEnd(14)} ${a.swarm.padEnd(10)} ${a.status.padEnd(12)} ${a.tasksCompleted.toString().padStart(4)}  ${a.errorCount.toString().padStart(4)}`,
            ),
          ),
        ]);
      }

      const codename = (args[1] ?? '').toUpperCase();
      const agent = estate.agents.find((a) => a.codename === codename);

      if (sub === 'kill') {
        if (!agent) return finish([err(`agent: no worker named '${args[1] ?? ''}'`)], 1);
        estate.commandAgent(agent.id, 'kill');
        return finish([
          sys(`SIGTERM → ${agent.codename}`),
          out(`${agent.codename} drained ${agent.queueDepth} queued task(s) back to dispatch`),
          out(`${agent.codename} terminated after ${formatDuration(agent.uptimeSec)} uptime`),
        ]);
      }

      if (sub === 'boost') {
        if (!agent) return finish([err(`agent: no worker named '${args[1] ?? ''}'`)], 1);
        estate.commandAgent(agent.id, 'boost');
        return finish([
          out(`${agent.codename} priority raised — cpu quota +60%, token budget +50%`),
        ]);
      }

      if (sub === 'spawn') {
        const role = args[1] ?? 'worker';
        return finish([
          sys(`provisioning sandbox for role="${role}"…`),
          out('pulling image atwood/agent-runtime:latest    ok'),
          out('mounting vault (read-only)                   ok'),
          out('injecting scoped credentials                 ok'),
          out(`worker registered with supervisor — awaiting dispatch`),
        ]);
      }

      return finish([err(`agent: '${sub}' is not a supported subcommand. Try: list, spawn, kill, boost`)], 1);
    }

    case 'vault': {
      const sub = (args[0] ?? '').toLowerCase();

      if (sub === 'stats') {
        const vault = estate.getVault();
        return finish([
          out(`notes        ${vault.totalNotes.toLocaleString('en-US')} (${vault.indexedNotes.toLocaleString('en-US')} indexed)`),
          out(`embeddings   ${vault.embeddings.toLocaleString('en-US')}`),
          out(`pending      ${vault.pendingIndex}`),
          out(`size         ${(vault.vaultSizeMb / 1024).toFixed(2)} GB`),
          out(`cache hit    ${(vault.cacheHitRate * 100).toFixed(1)}%`),
          out(`p95 retrieval ${vault.retrievalP95Ms}ms`),
        ]);
      }

      if (sub === 'reindex') {
        const priority = args.includes('--priority');
        const drained = estate.pendingIndex;
        estate.pendingIndex = priority ? 0 : Math.floor(drained * 0.35);
        estate.indexedNotes += drained - estate.pendingIndex;
        return finish([
          sys(`reindex started (${priority ? 'priority' : 'background'} lane)`),
          out(`scanning /srv/vault … ${estate.totalNotes.toLocaleString('en-US')} notes`),
          out(`embedding ${drained - estate.pendingIndex} changed notes`),
          out(`index committed — ${estate.pendingIndex} still queued`),
        ]);
      }

      if (sub === 'query') {
        const query = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
        if (!query) return finish([err('vault query: provide a query string')], 2);
        estate.recordVaultQuery(query, 'OPERATOR');
        const vault = estate.getVault();
        const hits = vault.recentQueries[0]?.hits ?? 3;
        return finish([
          sys(`semantic search: "${query}"`),
          ...Array.from({ length: Math.min(4, hits) }, (_, i) =>
            out(
              `  ${(0.94 - i * 0.07).toFixed(2)}  ${['01-clients', '02-systems', '04-playbooks', '06-incidents'][i]}/${query.split(' ').slice(0, 3).join('-')}-${i + 1}.md`,
            ),
          ),
          out(`${hits} hits in ${vault.recentQueries[0]?.latencyMs ?? 0}ms`),
        ]);
      }

      return finish([err(`vault: '${sub}' is not a supported subcommand. Try: stats, reindex, query`)], 1);
    }

    case 'python':
    case 'python3': {
      const script = args[0];
      if (!script) return finish([err('python: no script specified')], 2);
      if (!script.endsWith('.py')) {
        return finish([err(`python: can't open file '${script}': not a python script`)], 2);
      }
      const failed = script.includes('reconcile');
      return finish(
        failed
          ? [
              sys(`python3 ${script}`),
              out('loading ledger snapshot … 4,182 rows'),
              out('matching against Stripe payouts … 4,179 matched'),
              err('Traceback (most recent call last):'),
              err(`  File "${script}", line 214, in reconcile`),
              err('    raise LedgerMismatch(f"{len(unmatched)} unmatched entries")'),
              err('services.ledger.errors.LedgerMismatch: 3 unmatched entries'),
            ]
          : [
              sys(`python3 ${script}`),
              out('environment: venv/atwood (py3.12.4)'),
              out('job started'),
              out(`processed ${(estate.tick * 17) % 900 + 100} records`),
              out('job completed successfully'),
            ],
        failed ? 1 : 0,
      );
    }

    case 'clear':
    case 'cls':
      return finish([]);

    default:
      return finish(
        [err(`sam: command not found: ${verb}`), sys("type `help` for the supported verb list")],
        127,
      );
  }
}
