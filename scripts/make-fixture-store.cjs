'use strict';

/**
 * SAM: fixture job store for the completed-jobs checks (T13).
 *
 * Usage: node scripts/make-fixture-store.cjs <out HOME dir> [--chat 5000] [--jobs 40]
 *
 * Writes `<out>/.sam/jobs/job_*` directories of a known shape, so the browser
 * and memory checks never need the real `~/.sam/jobs` (this script never reads
 * or writes it). Serve the result with scripts/run-fixture-server.cjs.
 *
 *   --chat N  chat-turn directories: `meta.json` (a `fleet:<persona> (...)` or
 *             plain command, chat-turn id format) and `stdout.log`, no `cmd.sh`.
 *             They never count as finished jobs. Default 5000.
 *   --jobs N  sam-job directories: `cmd.sh`, `meta.json` (`status`, `exitCode`,
 *             `createdAt`, `startedAt`, `endedAt`, `summary`, `general`, `unit`)
 *             and `stdout.log`. Default 40. The first 30 are fixed cases (below);
 *             any beyond 30 are filler on 4 and 5 days ago; fewer than 30 takes
 *             the first N cases only.
 *
 * The fixed cases, with every time relative to now (UTC), all inside the
 * app's 7-day retention window:
 *   - 8 finished today (6 with a counted General), 7 yesterday, 4 two days
 *     ago, 3 three days ago, 2 four days ago: 21 rows with a counted General,
 *     8 of them hephaestus, so the fleet list (10) and hephaestus's list (5)
 *     both span today and yesterday.
 *   - every finished status: `exited` 0, `exited` non-zero, `failed`,
 *     `killed`, `stopped`; finish order differs from creation order (long jobs
 *     created before shorter ones that finish first).
 *   - `summary` missing on several (the row shows the slug), `general` null on
 *     two, an unknown General (`athena`) on one, `sam` on several.
 *   - 6 not finished: 3 `running`, 1 `queued`, 1 `created`, 1 `exited` with an
 *     empty `endedAt`.
 *   - `closer.json`: `PASS (n/m checks)` on four, `FAIL: tests` on an `exited`
 *     0 job, a 118-character `UNKNOWN: ...` verdict, one with `status:
 *     pending` (no record) and one of invalid JSON (no record).
 *
 * All content is synthetic. Ids are `job_<slug>_<YYYYMMDD-HHMMSS>` from each
 * job's `createdAt` in UTC; chat turns use the server's own id format
 * (`job_<base36 ms>_<32 hex>_<seq>`). Chat-turn content comes from a fixed
 * seed, so only the times move between runs.
 *
 * Refuses an out dir whose `.sam` resolves into the real `~/.sam`, the real
 * home itself, and an existing non-empty `<out>/.sam/jobs` (remove it first).
 * Prints the counts written. Exit codes: 0 written, 2 bad usage or refused.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function fail(message) {
  console.error(`make-fixture-store: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { out: null, chat: 5000, jobs: 40 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--chat' || arg === '--jobs') {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 0) fail(`${arg} needs a whole number, got ${argv[i + 1]}`);
      opts[arg.slice(2)] = n;
      i += 1;
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}`);
    } else if (opts.out === null) {
      opts.out = arg;
    } else {
      fail(`unexpected argument ${arg}`);
    }
  }
  if (opts.out === null) fail('usage: node scripts/make-fixture-store.cjs <out HOME dir> [--chat 5000] [--jobs 40]');
  return opts;
}

/** Refuses anything that could land in, or alias, the real store. */
function guardOut(out) {
  const realHome = fs.realpathSync(os.userInfo().homedir);
  const realSam = path.join(realHome, '.sam');
  const outReal = path.resolve(out);
  if (outReal === realHome || realpathLoose(outReal) === realHome) fail(`refusing the real home ${realHome}`);
  const samReal = realpathLoose(path.join(outReal, '.sam'));
  if (samReal === realSam || samReal.startsWith(`${realSam}${path.sep}`)) {
    fail(`refusing: ${path.join(outReal, '.sam')} resolves into the real ${realSam}`);
  }
  const jobs = path.join(outReal, '.sam', 'jobs');
  if (fs.existsSync(jobs) && fs.readdirSync(jobs).length > 0) {
    fail(`${jobs} already holds entries; remove the fixture dir first`);
  }
  return outReal;
}

/** realpath of the longest existing prefix, with the rest appended. */
function realpathLoose(p) {
  let head = p;
  const tail = [];
  while (!fs.existsSync(head)) {
    tail.unshift(path.basename(head));
    const up = path.dirname(head);
    if (up === head) break;
    head = up;
  }
  return path.join(fs.realpathSync(head), ...tail);
}

/** Small seeded PRNG (mulberry32), so chat-turn content is the same every run. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** `YYYYMMDD-HHMMSS` in UTC, the sam-job id tail. */
function stamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

const iso = (ms) => new Date(ms).toISOString();

const VERDICT_UNKNOWN_118 =
  'UNKNOWN: blocked: pricing table check still fails on the third tier, because the source page moved behind a login w...';
if (VERDICT_UNKNOWN_118.length !== 118) throw new Error(`UNKNOWN verdict is ${VERDICT_UNKNOWN_118.length} characters, not 118`);

const CMD_SH = '#!/bin/bash\n# Synthetic fixture job (make-fixture-store.cjs). Never run.\nexit 0\n';

/**
 * The fixed sam-job cases. `when` places the finish (or, for jobs that are not
 * finished, the creation): `{ today: f }` is f of the way back from now to the
 * last UTC midnight, so it is always today; `{ day: -n, at: 'HH:MM' }` is a
 * clock time n days ago. `dur` is minutes from creation to finish.
 */
const CASES = [
  // Today: 6 with a counted General, 2 without.
  { slug: 'kitchen-phone-menu', general: 'hephaestus', status: 'exited', exitCode: 0, summary: 'Kitchen site: phone menu layout pass', when: { today: 0.05 }, dur: 95, closer: { kind: 'pass', verdict: 'PASS (3/3 checks)' } },
  { slug: 'sam-vault-index', general: 'sam', status: 'exited', exitCode: 0, summary: 'SAM: nightly vault index refresh', when: { today: 0.12 }, dur: 4 },
  { slug: 'untagged-maintenance', general: null, status: 'exited', exitCode: 0, summary: 'Untagged maintenance run', when: { today: 0.18 }, dur: 6 },
  { slug: 'copperline-hero-3d', general: 'hephaestus', status: 'exited', exitCode: 0, summary: 'Copperline rebrand: hero 3D scene', when: { today: 0.25 }, dur: 20, closer: { kind: 'fail', verdict: 'FAIL: tests' } },
  { slug: 'outreach-plumbers-followup', general: 'hermes', status: 'failed', exitCode: 1, summary: 'Outreach: draft follow-up batch for plumbers', when: { today: 0.35 }, dur: 12 },
  { slug: 'pricing-competitor-tiers', general: 'prometheus', status: 'exited', exitCode: 0, summary: 'Pricing research: three competitor tiers', when: { today: 0.5 }, dur: 300, closer: { kind: 'unknown', verdict: VERDICT_UNKNOWN_118 } },
  { slug: 'athena-notes-sync', general: 'athena', status: 'exited', exitCode: 0, summary: 'Notes sync (unknown General)', when: { today: 0.6 }, dur: 3 },
  { slug: 'calliope-blog-outline-gardening', general: 'calliope', status: 'killed', exitCode: null, summary: null, when: { today: 0.7 }, dur: 7 },
  // Yesterday: 6 with a counted General, 1 without.
  { slug: 'apex-contact-form-fix', general: 'hephaestus', status: 'stopped', exitCode: null, summary: 'Apex roofing: contact form fix', when: { day: -1, at: '22:40' }, dur: 15 },
  { slug: 'security-dependency-audit', general: 'cerberus', status: 'exited', exitCode: 2, summary: 'Security sweep: dependency audit', when: { day: -1, at: '21:10' }, dur: 30, closer: { kind: 'pass', verdict: 'PASS (5/5 checks)' } },
  { slug: 'sam-restart-voice-worker', general: 'sam', status: 'failed', exitCode: 1, summary: null, when: { day: -1, at: '19:05' }, dur: 2 },
  { slug: 'fern-stone-gallery-images', general: 'hephaestus', status: 'exited', exitCode: 0, summary: null, when: { day: -1, at: '17:30' }, dur: 10, closer: { kind: 'pass', verdict: 'PASS (1/1 checks)', status: 'pending' } },
  { slug: 'leads-cafes-leeds', general: 'hermes', status: 'exited', exitCode: 0, summary: 'Lead list: cafes in Leeds', when: { day: -1, at: '15:00' }, dur: 40, closer: { kind: 'pass', verdict: 'PASS (4/4 checks)' } },
  { slug: 'untagged-log-rotate', general: null, status: 'failed', exitCode: 1, summary: null, when: { day: -1, at: '13:00' }, dur: 1 },
  { slug: 'kitchen-build-check', general: 'hephaestus', status: 'exited', exitCode: 1, summary: 'Kitchen site: build check', when: { day: -1, at: '11:20' }, dur: 8 },
  // Two days ago.
  { slug: 'newsletter-october-draft', general: 'calliope', status: 'exited', exitCode: 0, summary: 'Newsletter: October issue draft', when: { day: -2, at: '20:00' }, dur: 25 },
  { slug: 'apex-gallery-lightbox', general: 'hephaestus', status: 'exited', exitCode: 0, summary: 'Apex roofing: gallery lightbox', when: { day: -2, at: '16:45' }, dur: 60, closer: { raw: '{"status": "closed", "verdict": "PASS' } },
  { slug: 'prometheus-market-sizing', general: 'prometheus', status: 'failed', exitCode: 1, summary: null, when: { day: -2, at: '10:15' }, dur: 45 },
  { slug: 'sam-tidy-worktrees', general: 'sam', status: 'exited', exitCode: 0, summary: 'SAM: tidy worktrees', when: { day: -2, at: '09:00' }, dur: 3 },
  // Three days ago.
  { slug: 'fern-stone-services-copy', general: 'hephaestus', status: 'exited', exitCode: 0, summary: 'Fern and Stone: services page copy', when: { day: -3, at: '14:00' }, dur: 30, closer: { kind: 'pass', verdict: 'PASS (2/2 checks)' } },
  { slug: 'inbox-triage', general: 'hermes', status: 'killed', exitCode: null, summary: 'Inbox triage', when: { day: -3, at: '12:00' }, dur: 90 },
  { slug: 'cerberus-port-scan', general: 'cerberus', status: 'stopped', exitCode: null, summary: null, when: { day: -3, at: '08:30' }, dur: 5 },
  // Four days ago.
  { slug: 'brickwork-case-study', general: 'calliope', status: 'exited', exitCode: 0, summary: 'Case study: brickwork client', when: { day: -4, at: '18:00' }, dur: 50 },
  { slug: 'copperline-footer-links', general: 'hephaestus', status: 'exited', exitCode: 0, summary: 'Copperline: footer links', when: { day: -4, at: '10:00' }, dur: 12 },
  // Not finished. `when` is the creation time here; `ago` is minutes before now.
  { slug: 'kitchen-production-build', general: 'hephaestus', status: 'running', summary: 'Kitchen site: production build', ago: 25 },
  { slug: 'hermes-crm-sync', general: 'hermes', status: 'running', summary: null, ago: 180 },
  { slug: 'sam-rebuild-vault-graph', general: 'sam', status: 'running', summary: 'SAM: rebuild vault graph', ago: 5 },
  { slug: 'security-secrets-scan', general: 'cerberus', status: 'queued', summary: 'Security sweep: secrets scan', ago: 1 },
  { slug: 'market-scan-receptionist', general: 'prometheus', status: 'created', summary: 'Market scan: AI receptionist pricing', ago: 0.5 },
  { slug: 'landing-faq-draft', general: 'calliope', status: 'exited', exitCode: 0, endedAt: '', summary: 'Draft: landing page FAQ', ago: 120 },
];

const FILLER_GENERALS = ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus', 'sam', null];
const FILLER_OUTCOMES = [
  { status: 'exited', exitCode: 0 },
  { status: 'exited', exitCode: 0 },
  { status: 'failed', exitCode: 1 },
  { status: 'exited', exitCode: 3 },
  { status: 'killed', exitCode: null },
  { status: 'stopped', exitCode: null },
];

/** Filler beyond the fixed cases, on 4 and 5 days ago between 06:00 and 21:00. */
function fillerCase(n) {
  const general = FILLER_GENERALS[n % FILLER_GENERALS.length];
  const outcome = FILLER_OUTCOMES[n % FILLER_OUTCOMES.length];
  const minutes = 6 * 60 + ((n * 37) % (15 * 60));
  const slug = `${general ?? 'untagged'}-batch-${String(n + 1).padStart(3, '0')}`;
  return {
    slug,
    general,
    ...outcome,
    summary: n % 4 === 3 ? null : `Batch task ${n + 1} for ${general ?? 'no General'}`,
    when: { day: n % 2 === 0 ? -4 : -5, at: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` },
    dur: 5 + (n % 7) * 9,
  };
}

function finishMs(when, now) {
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  if ('today' in when) return Math.floor((now - (now - midnight) * when.today) / 1000) * 1000;
  const [h, m] = when.at.split(':').map(Number);
  return midnight + when.day * DAY + h * HOUR + m * MIN;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSamJob(root, c, now) {
  const notFinished = 'ago' in c;
  const created = notFinished ? Math.floor(now - c.ago * MIN) : finishMs(c.when, now) - Math.round(c.dur * MIN);
  const id = `job_${c.slug}_${stamp(created)}`;
  const started = c.status === 'queued' || c.status === 'created' ? null : created + 2000;
  let endedAt = null;
  if ('endedAt' in c) endedAt = c.endedAt;
  else if (!notFinished) endedAt = iso(finishMs(c.when, now));

  const dir = path.join(root, id);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'cmd.sh'), CMD_SH, { mode: 0o755 });
  const meta = {
    id,
    command: `bash ${path.join('~/.sam/jobs', id, 'cmd.sh')}`,
    status: c.status,
    exitCode: c.exitCode ?? null,
    createdAt: iso(created),
    startedAt: started === null ? null : iso(started),
    endedAt,
    outputBytes: 96,
    lastSeq: 3,
    unit: `sam-job-${id.slice(4)}.service`,
    tier: 'implement',
    general: c.general,
  };
  if (c.summary !== null) meta.summary = c.summary;
  writeJson(path.join(dir, 'meta.json'), meta);
  fs.writeFileSync(path.join(dir, 'stdout.log'), `synthetic fixture output for ${c.slug}\nstep 1 done\nstep 2 done\n`);

  if (c.closer) {
    const file = path.join(dir, 'closer.json');
    if (c.closer.raw !== undefined) {
      fs.writeFileSync(file, c.closer.raw);
    } else {
      writeJson(file, {
        status: c.closer.status ?? 'closed',
        verdictKind: c.closer.kind,
        verdict: c.closer.verdict,
        closedAt: iso(Date.parse(endedAt) + 3 * MIN),
      });
    }
  }
  return { id, finished: !notFinished && endedAt !== '' && endedAt !== null, general: c.general };
}

const CHAT_PERSONAS = ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'];
const CHAT_TOPICS = ['status check', 'draft reply', 'quick question', 'summarise notes', 'plan the week', 'review copy'];

function writeChatTurns(root, count, now) {
  const rand = prng(1013);
  const span = 3 * DAY; // inside the 7-day retention window
  for (let i = 0; i < count; i += 1) {
    const created = Math.floor(now - span + (span * (i + 1)) / (count + 1));
    let hex = '';
    for (let k = 0; k < 4; k += 1) hex += Math.floor(rand() * 0x100000000).toString(16).padStart(8, '0');
    const id = `job_${created.toString(36)}_${hex}_${(i + 1).toString(36)}`;
    const topic = CHAT_TOPICS[Math.floor(rand() * CHAT_TOPICS.length)];
    const persona = CHAT_PERSONAS[Math.floor(rand() * CHAT_PERSONAS.length)];
    const command = rand() < 0.3 ? `fleet:${persona} (sonnet) - ${topic}` : `claude -p --output-format stream-json "${topic}"`;
    const killed = rand() < 0.03;
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    writeJson(path.join(dir, 'meta.json'), {
      id,
      command,
      status: killed ? 'killed' : 'exited',
      exitCode: killed ? null : 0,
      createdAt: iso(created),
      startedAt: iso(created + 150),
      endedAt: iso(created + 4000 + Math.floor(rand() * 60000)),
      outputBytes: 120,
      lastSeq: 2,
    });
    fs.writeFileSync(path.join(dir, 'stdout.log'), `{"type":"text","text":"synthetic chat turn ${i + 1}: ${topic}"}\n`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = guardOut(opts.out);
  const root = path.join(out, '.sam', 'jobs');
  fs.mkdirSync(root, { recursive: true });

  const now = Math.floor(Date.now() / 1000) * 1000;
  const cases = [];
  for (let i = 0; i < opts.jobs; i += 1) cases.push(i < CASES.length ? CASES[i] : fillerCase(i - CASES.length));
  const written = cases.map((c) => writeSamJob(root, c, now));
  writeChatTurns(root, opts.chat, now);

  const GENERALS = ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus', 'sam'];
  const finished = written.filter((w) => w.finished);
  const counted = finished.filter((w) => GENERALS.includes(w.general));
  const perGeneral = GENERALS.map((g) => `${g} ${counted.filter((w) => w.general === g).length}`).join(', ');
  console.log(`fixture store ${root}`);
  console.log(`sam-job dirs ${written.length} (finished ${finished.length}, counted ${counted.length}: ${perGeneral}); chat turns ${opts.chat}`);
}

main();
