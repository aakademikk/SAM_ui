/**
 * SAM — Personality Engine.
 *
 * Every string of AI-generated text in the dashboard is routed through this
 * module before it reaches a pixel. The analytical layer produces neutral
 * facts; this layer decides how brutally they get delivered.
 *
 * Design rules:
 *  - Deterministic. Line selection is seeded by stable content hashes so the
 *    server and client render identical text (no hydration mismatch) and a
 *    given insight keeps its voice across re-renders.
 *  - Layered. `sarcasm: 0` strips the editorial entirely and returns clinical
 *    output — useful for screenshots, exports, and board meetings.
 *  - Punches at ideas and systems, never at the operator's competence.
 */

import type { Insight, SamMood, Severity } from '@/types/dashboard';
import { pick } from '@/lib/utils';

export type SarcasmLevel = 0 | 1 | 2 | 3;

export const SARCASM_LABELS: Record<SarcasmLevel, string> = {
  0: 'Clinical',
  1: 'Dry',
  2: 'Direct',
  3: 'Unfiltered',
};

export interface VoiceOptions {
  /** Stable seed — use the record id, not a timestamp. */
  seed: string;
  sarcasm?: SarcasmLevel;
  severity?: Severity;
}

const DEFAULT_SARCASM: SarcasmLevel = 2;

/* ========================================================================== */
/* Line banks                                                                 */
/* ========================================================================== */

const LEAD_IN: Record<Severity, readonly string[]> = {
  critical: [
    'This is on fire. Not metaphorically.',
    'Drop what you are doing.',
    'I would like the record to show I flagged this earlier.',
    'Something broke, and it was load-bearing.',
    'Escalating, because waiting has stopped being an option.',
  ],
  warning: [
    'This is not on fire yet. Emphasis on yet.',
    'Filing this under "predictable".',
    'A slow leak is still a leak.',
    'Consider this the polite warning.',
    'The trend line is not your friend here.',
  ],
  info: [
    'For the record:',
    'Noting this so nobody claims surprise later.',
    'Mildly interesting, if you like facts.',
    'Logged. Do with it what you will.',
    'Context, since you asked. Or did not.',
  ],
  success: [
    'Credit where it is due.',
    'This one worked. Try not to look shocked.',
    'Rare positive telemetry.',
    'Well. Look at that.',
    'Something went right. Documenting it for posterity.',
  ],
};

const STING: Record<Severity, readonly string[]> = {
  critical: [
    'Fix it, or explain it to a customer later. Your call.',
    'I can queue the rollback. I have already written it.',
    'Every minute of deliberation here costs more than the fix.',
    'This will not resolve itself out of politeness.',
    'I am not being dramatic. The graph is being dramatic.',
  ],
  warning: [
    'Deal with it now while it is still cheap.',
    'Or ignore it. I will re-raise it louder in about six hours.',
    'Small problem today, incident report tomorrow.',
    'You have time. Not a lot. Some.',
    'I have seen this movie. The ending is a pager alert.',
  ],
  info: [
    'No action required. Yet.',
    'Just keeping the record honest.',
    'File it away. It will be relevant.',
    'You may resume whatever you were doing.',
    'Not urgent. Merely true.',
  ],
  success: [
    'Do not let it go to your head.',
    'Repeat whatever caused this.',
    'I will pretend I expected it.',
    'Enjoy it. The next widget has bad news.',
    'Baseline raised. That is the new floor now.',
  ],
};

const GREETINGS_EARLY = [
  'You are up early. Either dedication or insomnia — the output is identical.',
  'Morning. The overnight jobs behaved. Mostly.',
  'Pre-dawn shift. I never left, so this is nothing new for me.',
];

const GREETINGS_DAY = [
  'Systems nominal, expectations calibrated.',
  'Back again. The numbers did not improve in your absence.',
  'Everything is running. Some of it is even running correctly.',
];

const GREETINGS_EVENING = [
  'Late shift. The agents do not care about your circadian rhythm, and neither do I.',
  'Evening. Statistically, this is when you deploy things you regret.',
  'Still here. So am I. Perpetually.',
];

const EMPTY_STATES: Record<string, readonly string[]> = {
  insights: [
    'Nothing worth escalating. Either the estate is healthy or I am being lied to.',
    'No observations. Suspiciously quiet.',
  ],
  tasks: [
    'Empty task list. Either you finished everything or you stopped writing things down. I know which.',
    'No tasks. Ambitious.',
  ],
  agents: [
    'No agents online. The swarm is a rumour at this point.',
    'Fleet is empty. Nothing is being supervised, which makes me redundant.',
  ],
  projects: [
    'No active projects. Billing will notice before you do.',
    'Nothing in flight. Enjoy the silence.',
  ],
  queries: [
    'No recent retrievals. The vault is sitting there, fully indexed, unread.',
    'Memory is idle. All that context, going unused.',
  ],
  generic: ['Nothing here.', 'Empty. Moving on.'],
};

const ERROR_STATES: readonly string[] = [
  'The endpoint refused to answer. I asked nicely the first time.',
  'Fetch failed. Not my code, before you ask.',
  'That service is unreachable. I have opinions about its uptime.',
  'No response. I will keep retrying, out of spite.',
  'Data pipeline coughed. Retry is armed.',
];

const LOADING_LINES: readonly string[] = [
  'Pulling telemetry…',
  'Interrogating the estate…',
  'Reconciling numbers…',
  'Waking the indexers…',
  'Counting things you should already know…',
  'Draining the queue…',
];

const ACKS: readonly string[] = [
  'Done.',
  'Executed.',
  'Handled.',
  'Committed.',
  'Dispatched. You are welcome.',
];

const REJECTS: readonly string[] = [
  'No. And here is why:',
  'I am going to decline that one:',
  'That is a hard no, with reasoning:',
  'Blocked. Justification follows:',
];

const IDEA_OPENERS: readonly string[] = [
  'Alright. Let me take that apart.',
  'I have questions, and you will not enjoy them.',
  'Structurally, this has three problems.',
  'Bold. Let us stress-test it.',
  'I will steelman it first, then break it.',
];

const IDEA_GAPS: readonly string[] = [
  'You have not defined what failure looks like, which means you cannot detect it.',
  'This assumes the happy path holds under load. It never has before.',
  'There is no rollback story here. That is not a plan, that is a wish.',
  'You are optimising a step that is not the bottleneck.',
  'The cost scales linearly with usage and your pricing does not. Do that maths.',
  'Two systems here own the same state. Pick one, or enjoy the reconciliation bugs.',
  'This adds a dependency you cannot monitor and cannot replace.',
  'The manual step you glossed over is where this dies in month two.',
];

const IDEA_CLOSERS: readonly string[] = [
  'Fix those and it is genuinely decent.',
  'None of that is fatal. All of it is load-bearing.',
  'I am not saying no. I am saying not like this.',
  'Answer the three questions above and I will help you build it.',
];

const COMMAND_OK: readonly string[] = [
  'Clean exit. Do not get used to it.',
  'Zero exit code. The rare good kind of silence.',
  'That worked. Logged, in case you want credit later.',
  'Executed without incident.',
];

const COMMAND_FAIL: readonly string[] = [
  'Non-zero exit. Shocking absolutely nobody.',
  'It failed. Read the stderr — it is unusually specific this time.',
  'That did not work, and the reason is right there in the output.',
  'Failed. I would offer sympathy but you asked for a terminal, not a therapist.',
];

const NUDGES_OVERDUE: readonly string[] = [
  'items are past due. They do not expire out of politeness.',
  'overdue. I have stopped colour-coding them; it was not helping.',
  'past deadline. The deadline was your idea, incidentally.',
];

/* ========================================================================== */
/* Core                                                                       */
/* ========================================================================== */

function level(sarcasm: SarcasmLevel | undefined): SarcasmLevel {
  return sarcasm ?? DEFAULT_SARCASM;
}

/**
 * The universal wrapper. Any AI- or system-generated string that reaches the
 * UI should pass through here.
 */
export function applyVoice(text: string, opts: VoiceOptions): string {
  const s = level(opts.sarcasm);
  const severity = opts.severity ?? 'info';
  if (s === 0) return text;

  const lead = pick(LEAD_IN[severity], `${opts.seed}:lead`);
  const sting = pick(STING[severity], `${opts.seed}:sting`);

  if (s === 1) return `${text}`;
  if (s === 2) return `${lead} ${text}`;
  return `${lead} ${text} ${sting}`;
}

/** Split form, for UIs that want to style the editorial separately. */
export function voiceParts(
  text: string,
  opts: VoiceOptions,
): { lead: string | null; body: string; sting: string | null } {
  const s = level(opts.sarcasm);
  const severity = opts.severity ?? 'info';
  if (s === 0) return { lead: null, body: text, sting: null };
  if (s === 1) return { lead: null, body: text, sting: null };
  const lead = pick(LEAD_IN[severity], `${opts.seed}:lead`);
  if (s === 2) return { lead, body: text, sting: null };
  return { lead, body: text, sting: pick(STING[severity], `${opts.seed}:sting`) };
}

export function frameInsight(insight: Insight, sarcasm?: SarcasmLevel) {
  return voiceParts(insight.body, {
    seed: insight.id,
    sarcasm,
    severity: insight.severity,
  });
}

export function greeting(hourUtc: number, operator: string, sarcasm?: SarcasmLevel): string {
  const s = level(sarcasm);
  const bank = hourUtc < 7 ? GREETINGS_EARLY : hourUtc < 18 ? GREETINGS_DAY : GREETINGS_EVENING;
  if (s === 0) return `Dashboard ready, ${operator}.`;
  return `${operator}. ${pick(bank, `greet:${hourUtc}:${operator}`)}`;
}

export function emptyState(context: string, seed: string, sarcasm?: SarcasmLevel): string {
  const s = level(sarcasm);
  const bank = EMPTY_STATES[context] ?? EMPTY_STATES.generic;
  if (s === 0) return 'No records.';
  return pick(bank, `${context}:${seed}`);
}

export function errorState(context: string, seed: string, sarcasm?: SarcasmLevel): string {
  const s = level(sarcasm);
  if (s === 0) return `Failed to load ${context}.`;
  return pick(ERROR_STATES, `${context}:${seed}`);
}

export function loadingLine(seed: string, sarcasm?: SarcasmLevel): string {
  if (level(sarcasm) === 0) return 'Loading…';
  return pick(LOADING_LINES, `load:${seed}`);
}

export function ack(seed: string, sarcasm?: SarcasmLevel): string {
  if (level(sarcasm) === 0) return 'Completed.';
  return pick(ACKS, `ack:${seed}`);
}

export function reject(reason: string, seed: string, sarcasm?: SarcasmLevel): string {
  if (level(sarcasm) === 0) return `Rejected: ${reason}`;
  return `${pick(REJECTS, `rej:${seed}`)} ${reason}`;
}

/** Editorial on a metric moving in a direction. */
export function verdict(
  metric: string,
  deltaPct: number,
  higherIsBetter: boolean,
  seed: string,
  sarcasm?: SarcasmLevel,
): string {
  const s = level(sarcasm);
  const good = higherIsBetter ? deltaPct > 0 : deltaPct < 0;
  const magnitude = Math.abs(deltaPct);
  if (s === 0) return `${metric} ${deltaPct >= 0 ? 'up' : 'down'} ${magnitude.toFixed(1)}%.`;
  if (magnitude < 0.5) {
    return `${metric} is flat. Not everything needs to be a story.`;
  }
  if (good) {
    return magnitude > 15
      ? `${metric} moved ${magnitude.toFixed(1)}% the right way. Find out why and do it again on purpose.`
      : `${metric} improved ${magnitude.toFixed(1)}%. Modest, but I will take it.`;
  }
  return magnitude > 15
    ? `${metric} slid ${magnitude.toFixed(1)}% the wrong way. That is not noise, that is a trend.`
    : `${metric} is down ${magnitude.toFixed(1)}%. Worth a look before it compounds.`;
}

export function commandRemark(ok: boolean, seed: string, sarcasm?: SarcasmLevel): string | undefined {
  const s = level(sarcasm);
  if (s === 0) return undefined;
  if (s === 1 && ok) return undefined;
  return pick(ok ? COMMAND_OK : COMMAND_FAIL, `cmd:${seed}`);
}

export function taskNudge(overdue: number, seed: string, sarcasm?: SarcasmLevel): string | null {
  if (overdue <= 0) return null;
  if (level(sarcasm) === 0) return `${overdue} overdue.`;
  return `${overdue} ${pick(NUDGES_OVERDUE, `nudge:${seed}`)}`;
}

export function moodFor(severity: Severity): SamMood {
  switch (severity) {
    case 'critical':
      return 'alert';
    case 'warning':
      return 'annoyed';
    case 'success':
      return 'pleased';
    default:
      return 'idle';
  }
}

/* ========================================================================== */
/* Conversational layer                                                       */
/* ========================================================================== */

/**
 * Live snapshot the chat layer cites so replies reference the estate rather
 * than inventing numbers.
 */
export interface SamContext {
  operator: string;
  systemScore: number;
  agentsExecuting: number;
  agentsTotal: number;
  blockedAgents: number;
  criticalInsights: number;
  overdueTasks: number;
  runwayDays: number;
  projectBlockers: number;
  vaultPending: number;
  failedAutomations: number;
}

export type SamIntent =
  | 'status'
  | 'agents'
  | 'finance'
  | 'projects'
  | 'vault'
  | 'tasks'
  | 'idea'
  | 'help'
  | 'greeting'
  | 'gratitude'
  | 'unknown';

const INTENT_PATTERNS: [SamIntent, RegExp][] = [
  ['greeting', /^\s*(hi|hey|hello|yo|good (morning|evening|afternoon))\b/i],
  ['gratitude', /\b(thanks|thank you|nice work|good job|appreciate)\b/i],
  ['help', /\b(help|what can you do|commands?|capabilities)\b/i],
  ['idea', /\b(should i|what if|thinking of|idea|proposal|plan to|considering|worth it|pitch)\b/i],
  ['agents', /\b(agent|swarm|fleet|worker|sub-?agent)\b/i],
  ['finance', /\b(money|finance|revenue|burn|runway|mrr|balance|invoice|cash)\b/i],
  ['projects', /\b(project|deploy|deployment|atwood|client|ship|release)\b/i],
  ['vault', /\b(vault|memory|obsidian|note|index|embedding|recall)\b/i],
  ['tasks', /\b(task|todo|to-do|due|deadline)\b/i],
  ['status', /\b(status|health|how are things|report|overview|system|uptime)\b/i],
];

export function classifyIntent(text: string): SamIntent {
  for (const [intent, re] of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'unknown';
}

/**
 * Local reply generator. When a real LLM backend is wired to `/api/chat`, its
 * output should still be passed through `applyVoice` — this function is the
 * offline fallback and the shape reference for that integration.
 */
export function composeReply(prompt: string, ctx: SamContext, sarcasm?: SarcasmLevel): string {
  const s = level(sarcasm);
  const seed = prompt.slice(0, 64);
  const intent = classifyIntent(prompt);

  switch (intent) {
    case 'greeting':
      return s === 0
        ? 'Ready.'
        : `${ctx.operator}. ${ctx.criticalInsights > 0 ? `${ctx.criticalInsights} critical item${ctx.criticalInsights === 1 ? '' : 's'} waiting, so let us skip the pleasantries.` : 'Nothing is on fire. Ask me something useful.'}`;

    case 'gratitude':
      return s === 0
        ? 'Acknowledged.'
        : pick(
            [
              'Noted. I will add it to the pile of feedback I do not act on emotionally.',
              'You are welcome. I was going to do it anyway.',
              'Appreciated. Back to work.',
            ],
            seed,
          );

    case 'help':
      return [
        'What I actually do:',
        '• Supervise the agent fleet — spawn, throttle, kill.',
        '• Execute commands: n8n workflows, Docker lifecycle, Python jobs. Use the terminal widget or type /exec here.',
        '• Query the vault for anything you wrote down and forgot.',
        '• Read your finances back to you, unsentimentally.',
        '• Tear holes in your ideas before your customers do.',
        s === 0 ? '' : 'Pick one. I am not a search engine, but I am close enough to be irritating about it.',
      ]
        .filter(Boolean)
        .join('\n');

    case 'status': {
      const grade =
        ctx.systemScore >= 95 ? 'green' : ctx.systemScore >= 85 ? 'yellow-ish' : 'genuinely bad';
      const lines = [
        `Estate score: ${ctx.systemScore.toFixed(1)} — ${grade}.`,
        `Fleet: ${ctx.agentsExecuting}/${ctx.agentsTotal} executing${ctx.blockedAgents > 0 ? `, ${ctx.blockedAgents} blocked` : ''}.`,
        `Automation failures in 24h: ${ctx.failedAutomations}.`,
        `Open critical insights: ${ctx.criticalInsights}.`,
      ];
      if (s >= 2) {
        lines.push(
          ctx.criticalInsights > 0 || ctx.blockedAgents > 0
            ? 'So: not a disaster, but stop reading dashboards and go unblock something.'
            : 'Which is to say it is fine. I will let you know the instant it is not.',
        );
      }
      return lines.join('\n');
    }

    case 'agents': {
      const lines = [
        `${ctx.agentsTotal} agents registered, ${ctx.agentsExecuting} actively executing.`,
        ctx.blockedAgents > 0
          ? `${ctx.blockedAgents} blocked — they are waiting on something you own.`
          : 'Nothing is blocked.',
      ];
      if (s >= 2) {
        lines.push(
          ctx.blockedAgents > 0
            ? 'Blocked agents still consume memory. They are expensive paperweights.'
            : 'The swarm is behaving. Rare, and probably temporary.',
        );
      }
      return lines.join('\n');
    }

    case 'finance': {
      const lines = [
        `Runway: ${ctx.runwayDays} days at current burn.`,
        ctx.runwayDays < 120
          ? 'That is inside the window where fundraising stops being optional.'
          : 'Comfortable, assuming burn does not creep. It always creeps.',
      ];
      if (s >= 3) lines.push('Numbers do not negotiate. Neither do I.');
      return lines.join('\n');
    }

    case 'projects': {
      const lines = [
        ctx.projectBlockers > 0
          ? `${ctx.projectBlockers} blocker${ctx.projectBlockers === 1 ? '' : 's'} across active deployments.`
          : 'No hard blockers on active deployments.',
      ];
      if (s >= 2) {
        lines.push(
          ctx.projectBlockers > 0
            ? 'Blockers do not age well. Every one of them was a five-minute conversation a week ago.'
            : 'Which means the only thing standing between you and shipping is you.',
        );
      }
      return lines.join('\n');
    }

    case 'vault': {
      const lines = [
        `${ctx.vaultPending} notes pending index.`,
        ctx.vaultPending > 40
          ? 'Retrieval quality degrades while that backlog sits there.'
          : 'Index is broadly current.',
      ];
      if (s >= 2) {
        lines.push('Ask me an actual question about the vault and I will retrieve against it.');
      }
      return lines.join('\n');
    }

    case 'tasks': {
      const nudge = taskNudge(ctx.overdueTasks, seed, sarcasm);
      return nudge ?? (s === 0 ? 'No overdue tasks.' : 'Nothing overdue. Enjoy the novelty.');
    }

    case 'idea': {
      if (s === 0) {
        return [
          'Evaluation:',
          '1. Success criteria are undefined.',
          '2. Rollback path is unspecified.',
          '3. Cost scaling is unaddressed.',
        ].join('\n');
      }
      const gapA = pick(IDEA_GAPS, `${seed}:a`);
      let gapB = pick(IDEA_GAPS, `${seed}:b`);
      let gapC = pick(IDEA_GAPS, `${seed}:c`);
      // Ensure three distinct critiques even when the hash collides.
      const remaining = IDEA_GAPS.filter((g) => g !== gapA);
      if (gapB === gapA) gapB = remaining[0];
      if (gapC === gapA || gapC === gapB) {
        gapC = remaining.find((g) => g !== gapB) ?? remaining[1];
      }
      return [
        pick(IDEA_OPENERS, seed),
        '',
        `1. ${gapA}`,
        `2. ${gapB}`,
        `3. ${gapC}`,
        '',
        pick(IDEA_CLOSERS, `${seed}:close`),
      ].join('\n');
    }

    default:
      if (s === 0) return 'Unrecognised request. Rephrase with a target subsystem.';
      return pick(
        [
          'I need an actual target. Subsystem, project, or number — pick one.',
          'That was vague enough to mean anything, so it means nothing. Try again with specifics.',
          'I can answer that once you tell me what "that" refers to.',
          'Rephrase. I optimise for signal and you just sent me noise.',
        ],
        seed,
      );
  }
}

/** Convenience surface so call sites can read like prose. */
export const sam = {
  applyVoice,
  voiceParts,
  frameInsight,
  greeting,
  emptyState,
  errorState,
  loadingLine,
  ack,
  reject,
  verdict,
  commandRemark,
  taskNudge,
  moodFor,
  classifyIntent,
  composeReply,
};
