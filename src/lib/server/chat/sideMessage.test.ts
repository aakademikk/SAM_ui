/**
 * SAM — sideMessage.ts: a chat can take a side message into its running turn.
 *
 * Checks 2 (opt-in live), 3, 6, 7, 9 (with-side-message case), 12. Runs real
 * turns through the real JobManager (`systemd-run --user --scope`) against
 * the fake CLI from T1, never the real `claude`, except the opt-in live
 * test. All other state lives under a temp HOME set BEFORE the modules under
 * test are imported (`JOBS_ROOT`, `REGISTRY_FILE` are computed at module
 * load). If `systemd-run --user` is unavailable this file fails loudly — it
 * never skips (except the live test's own flag-gated skip).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

import { isResultLine } from './streamInput.js';

type StartTurnModule = typeof import('./startTurn.js');
type SideMessageModule = typeof import('./sideMessage.js');
type ChatStoreModule = typeof import('./chatStore.js');
type TranscriptsModule = typeof import('./transcripts.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

// The real HOME, captured before `before()` points HOME at a temp dir for
// every test in this file. Only the opt-in live test uses it (to find a
// real account's credentials via CLAUDE_CONFIG_DIR) — never process.env.HOME
// itself, which stays the temp dir throughout so the chat store, sessions
// registry and job store never touch anything real.
const REAL_HOME = process.env.HOME;
const REAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'side-message-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const logPath = path.join(tmp, 'fake-claude.log');
const stdinLogPath = path.join(tmp, 'fake-claude-stdin.log');
const pushSubs = path.join(tmp, 'push-subs.json');

let st: StartTurnModule;
let sm: SideMessageModule;
let store: ChatStoreModule;
let transcripts: TranscriptsModule;
let manager: ManagerModule;

const exits = new Map<string, TurnExitEvent>();
const waiters = new Map<string, (e: TurnExitEvent) => void>();

function waitExit(jobId: string, timeoutMs = 20_000): Promise<TurnExitEvent> {
  const done = exits.get(jobId);
  if (done) return Promise.resolve(done);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`turn ${jobId} did not exit`)), timeoutMs);
    waiters.set(jobId, (e) => {
      clearTimeout(timer);
      resolve(e);
    });
  });
}

function assertOk(
  r: Awaited<ReturnType<StartTurnModule['startTurn']>>,
): asserts r is Extract<typeof r, { ok: true }> {
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
}

function lastReply(chatId: string): string {
  const history = transcripts.readHistory(chatId);
  const last = history[history.length - 1];
  assert.ok(last && last.role === 'assistant', 'history ends with an assistant message');
  const text = last.blocks.find((b) => b.kind === 'text');
  return text && text.kind === 'text' ? text.text : '';
}

interface StdinLogLine {
  text: string;
}

function stdinLogLines(): StdinLogLine[] {
  if (!fs.existsSync(stdinLogPath)) return [];
  return fs
    .readFileSync(stdinLogPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StdinLogLine);
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function outputText(jobId: string): Promise<string> {
  const frames = await manager.getJobManager().getOutput(jobId, 0);
  return frames.map((f) => f.data.toString('utf-8')).join('');
}

/**
 * The live test's own reply reader (SAM, T5/T6T7 follow-on 2026-10-03):
 * `lastReply` (above) reads the answer back out of `readHistory`, which
 * looks for the transcript under the temp HOME — but the real `claude`
 * binary writes its transcript under the real `CLAUDE_CONFIG_DIR`, so that
 * path is empty for the live test and `lastReply` fails with "history ends
 * with an assistant message". The turn's own job output is real regardless
 * of which HOME wrote the transcript, so read the answer from there instead:
 * every line that parses as JSON with a top-level `type === 'result'`
 * (`isResultLine`, immune to the real CLI's key order) is one answer; the
 * last one is this turn's final reply.
 */
async function lastResultTextFromOutput(jobId: string): Promise<string> {
  const out = await outputText(jobId);
  const results = out
    .split('\n')
    .filter((line) => isResultLine(line))
    .map((line) => JSON.parse(line) as { result?: string });
  const last = results[results.length - 1];
  assert.ok(last, 'at least one result line in the job output');
  return last.result ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ========================================================================== */
/* isResultLine — pure, no fixture needed                                    */
/* ========================================================================== */

test('isResultLine: a real-CLI-shaped result line (type not first) is a result', () => {
  const line =
    '{"duration_api_ms":1063,"stop_reason":"end_turn","session_id":"abc","total_cost_usd":0,' +
    '"duration_ms":1200,"is_error":false,"result":"hi","type":"result"}';
  assert.equal(isResultLine(line), true);
});

test('isResultLine: a type-first result line (the fake\'s old shape) is still a result', () => {
  const line = '{"type":"result","is_error":false,"result":"hi","session_id":"abc"}';
  assert.equal(isResultLine(line), true);
});

test('isResultLine: an assistant line whose text merely contains the string "type":"result" is not a result', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'looks like {"type":"result"} but is not one' }] },
  });
  assert.equal(isResultLine(line), false);
});

test('isResultLine: a non-JSON line is not a result', () => {
  assert.equal(isResultLine('not json at all'), false);
});

before(async () => {
  // Fail loudly, never skip: the whole point is the real spawn path.
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; sideMessage.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(pushSubs, '[]');

  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.FAKE_CLAUDE_STDIN_LOG = stdinLogPath;
  // No delay before the prompt is written; a window after it (before the
  // first reply) long enough to deliver one or more side messages into;
  // a generous linger after the first result so a check-7 message sent the
  // instant the result appears still lands inside the window.
  process.env.FAKE_CLAUDE_DELAY_MS = '0';
  process.env.FAKE_CLAUDE_TOOL_DELAY_MS = '2000';
  process.env.FAKE_CLAUDE_LINGER_MS = '3000';
  delete process.env.FAKE_CLAUDE_REPLY;
  process.env.FAKE_TITLE_FAIL = '1';
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  manager = await import('../jobs/manager.js');
  store = await import('./chatStore.js');
  transcripts = await import('./transcripts.js');
  st = await import('./startTurn.js');
  sm = await import('./sideMessage.js');

  st.onTurnExit.push((e) => {
    exits.set(e.jobId, e);
    waiters.get(e.jobId)?.(e);
  });
});

after(() => {
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('check 3: a side message sent mid-turn is written to stdin exactly once, unchanged', async () => {
  const r = await st.startTurn({ message: 'check3 prompt', tier: 'max', device: 'phone' });
  assertOk(r);

  // Sent while the fake is still inside its FAKE_CLAUDE_TOOL_DELAY_MS window
  // (2s), well before its first reply is produced.
  await sleep(300);
  const result = await sm.sendSideMessage({
    chatId: r.chatId,
    text: 'check3 side message',
    device: 'phone',
  });
  assert.deepEqual(result, { ok: true });

  await waitExit(r.jobId);

  const lines = stdinLogLines().filter((l) => l.text === 'check3 side message');
  assert.equal(lines.length, 1, 'the side message was written to stdin exactly once');
});

test('check 7: a side message arriving after the first result gets its own second result', async () => {
  const r = await st.startTurn({ message: 'check7 prompt', tier: 'max', device: 'pc' });
  assertOk(r);

  await waitFor(
    async () => (await outputText(r.jobId)).includes('"type":"result"'),
    'the first result to appear on stdout',
  );

  const result = await sm.sendSideMessage({
    chatId: r.chatId,
    text: 'check7 late side message',
    device: 'pc',
  });
  assert.deepEqual(result, { ok: true });

  await waitExit(r.jobId);

  const out = await outputText(r.jobId);
  // isResultLine, not a `{"type":"result"` prefix check: the fake now emits
  // its result lines in the real CLI's key order (type last), same reason
  // startTurn.ts's onOutputChunk no longer uses a prefix check either.
  const resultCount = out.split('\n').filter((l) => isResultLine(l)).length;
  assert.equal(resultCount, 2, 'two result events: the turn\'s own, then the side message\'s');
  assert.match(out, /SIDE:check7 late side message/, 'the second result answers the side message');
});

test('check 12: two devices\' side messages land in the order the server received the calls', async () => {
  const r = await st.startTurn({ message: 'check12 prompt', tier: 'max', device: 'phone' });
  assertOk(r);

  await sleep(300);
  // Fired without awaiting one before the other.
  const p1 = sm.sendSideMessage({ chatId: r.chatId, text: 'check12 from phone', device: 'phone' });
  const p2 = sm.sendSideMessage({ chatId: r.chatId, text: 'check12 from pc', device: 'pc' });
  const [res1, res2] = await Promise.all([p1, p2]);
  assert.deepEqual(res1, { ok: true });
  assert.deepEqual(res2, { ok: true });

  await waitExit(r.jobId);

  const lines = stdinLogLines().filter(
    (l) => l.text === 'check12 from phone' || l.text === 'check12 from pc',
  );
  assert.equal(lines.length, 2, 'neither lost nor doubled');
  assert.deepEqual(
    lines.map((l) => l.text),
    ['check12 from phone', 'check12 from pc'],
    'written in call order, not reordered',
  );
});

test('check 6 / check 9 (with side message): a dead stdin handle fails the side message but never touches the real turn', async () => {
  const r = await st.startTurn({ message: 'check6 prompt, carry on normally', tier: 'max', device: 'phone' });
  assertOk(r);

  // Simulate the reattach-without-stdin case: the chat's runningJobId now
  // names a job id this process never spawned, so JobManager's own job map
  // has no entry (and so no stdin handle) for it.
  store.setRunningJob(r.chatId, 'job_never_spawned_0000000000000000');

  const result = await sm.sendSideMessage({
    chatId: r.chatId,
    text: 'should fail, channel is gone',
    device: 'phone',
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 409);

  const exit = await waitExit(r.jobId);
  assert.equal(exit.exitCode, 0);
  assert.equal(lastReply(r.chatId), 'echo: check6 prompt, carry on normally');

  // No stdin line from the failed call reached the real job.
  const stray = stdinLogLines().filter((l) => l.text === 'should fail, channel is gone');
  assert.equal(stray.length, 0, 'the failed call never wrote to the real turn\'s stdin');

  // Check 9: no process or cgroup left behind for this turn, same rule as
  // T4's own no-side-message case — the turn's own pid and cgroup, never the
  // unscoped orphan script.
  const pid = exit.record.pid;
  assert.ok(pid, 'the finished job recorded a pid');
  assert.throws(
    () => process.kill(pid, 0),
    (err: unknown) => (err as NodeJS.ErrnoException).code === 'ESRCH',
    'the scope leader process is still alive',
  );
  const cgroupFile = path.join(home, '.sam', 'jobs', r.jobId, 'cgroup');
  if (fs.existsSync(cgroupFile)) {
    const raw = fs.readFileSync(cgroupFile, 'utf8').trim();
    const rel = raw.split(':').slice(2).join(':');
    if (rel) {
      const procsFile = path.join('/sys/fs/cgroup', rel, 'cgroup.procs');
      if (fs.existsSync(procsFile)) {
        const procs = fs.readFileSync(procsFile, 'utf8').trim();
        assert.equal(procs, '', 'a process from this turn is still in its scope cgroup');
      }
    }
  }
});

test('T8 end-to-end: a mid-turn side message survives into readHistory as a side block after the turn exits', async () => {
  const r = await st.startTurn({ message: 'e2e prompt', tier: 'max', device: 'phone' });
  assertOk(r);

  // Sent while the fake is still inside its FAKE_CLAUDE_TOOL_DELAY_MS window
  // (2s), well before its first reply — the fake now writes this as a
  // queued_command attachment (R3), exactly like the real CLI.
  await sleep(300);
  const result = await sm.sendSideMessage({
    chatId: r.chatId,
    text: 'e2e side message',
    device: 'phone',
  });
  assert.deepEqual(result, { ok: true });

  await waitExit(r.jobId);

  const history = transcripts.readHistory(r.chatId);
  assert.equal(history.length, 2, 'one user/assistant pair, not split by the side message');
  const assistantMsg = history[1];
  assert.equal(assistantMsg.role, 'assistant');
  const sideBlock = assistantMsg.blocks.find((b) => b.kind === 'side');
  assert.ok(sideBlock, 'the mid-turn side message rendered as a side block');
  if (sideBlock && sideBlock.kind === 'side') {
    assert.equal(sideBlock.text, 'e2e side message');
  }
});

test('a non-Max chat refuses a side message with 400', async () => {
  const id = '22222222-3333-4444-5555-666666666666';
  store.createChat({
    id,
    tier: 'fast',
    account: 'main',
    firstMessage: 'a fast-tier chat',
  });

  const result = await sm.sendSideMessage({ chatId: id, text: 'hello', device: 'phone' });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 400);
});

/* ========================================================================== */
/* Check 2: opt-in live test, real Max turn, real Haiku model                */
/* ========================================================================== */

const SKIP_LIVE =
  process.env.SAM_LIVE_SIDE_MESSAGE === '1'
    ? false
    : 'set SAM_LIVE_SIDE_MESSAGE=1 to spend one real Haiku call';

test(
  'check 2 (live): a side message sent 8s into a 25s tool call reaches the same turn\'s answer',
  { skip: SKIP_LIVE, timeout: 60_000 },
  async () => {
    assert.ok(REAL_HOME, 'the real HOME must be known to find real credentials');

    const savedClaudeBin = process.env.SAM_CLAUDE_BIN;
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const savedMaxModel = process.env.SAM_MAX_MODEL;
    // Only the spawned child's env changes here — process.env.HOME (and so
    // os.homedir(), and so the chat store / job store / sessions registry)
    // stays the temp dir for the whole file. The real `claude` binary and the
    // real account's credentials are reached purely via PATH resolution and
    // CLAUDE_CONFIG_DIR, scoped to this one test and restored after.
    delete process.env.SAM_CLAUDE_BIN;
    if (REAL_CLAUDE_CONFIG_DIR) {
      process.env.CLAUDE_CONFIG_DIR = REAL_CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = path.join(REAL_HOME as string, '.claude');
    }
    process.env.SAM_MAX_MODEL = 'claude-haiku-4-5-20251001';

    // Tracked outside the try so a failure partway through (e.g. the turn
    // never exits) still lets the finally below reach the job id and kill
    // the real paid CLI process rather than leaving it running.
    let liveJobId: string | undefined;

    try {
      const jobsRoot = path.join(home, '.sam', 'jobs');
      const jobDirsBefore = new Set(
        fs.existsSync(jobsRoot) ? fs.readdirSync(jobsRoot) : [],
      );

      const codeword = `sentinel-${Date.now()}`;
      const prompt =
        "Run, with the Bash tool, exactly this command: python3 -c 'import time; time.sleep(25); print(42)'. " +
        'Wait for it to finish. Then reply with exactly: DONE: <any codeword given since>, ' +
        'substituting the codeword if one arrives while you wait, or "none" if none arrives.';

      const r = await st.startTurn({ message: prompt, tier: 'max', device: 'phone' });
      assertOk(r);
      liveJobId = r.jobId;

      await sleep(8_000);
      const sent = await sm.sendSideMessage({ chatId: r.chatId, text: codeword, device: 'phone' });
      assert.deepEqual(sent, { ok: true });

      await waitExit(r.jobId, 45_000);
      liveJobId = undefined;

      const reply = await lastResultTextFromOutput(r.jobId);
      assert.match(reply, new RegExp(codeword), 'the reply reflects the side message\'s codeword');

      // Check 2: one turn, one job id — no second spawn happened for this
      // live turn specifically (earlier stand-in tests in this file have
      // already created their own job directories, so only the directories
      // that appeared during THIS test count).
      const jobDirsAfter = fs.readdirSync(jobsRoot);
      const newJobDirs = jobDirsAfter.filter((d) => !jobDirsBefore.has(d));
      assert.deepEqual(
        newJobDirs,
        [r.jobId],
        'exactly one job directory was created for this turn',
      );
    } finally {
      // If the turn is still running (e.g. this assertion above threw, or
      // the turn never exited), kill it via the job manager's own kill() —
      // it already no-ops when the job isn't live, so this is safe to call
      // unconditionally — so a failing live run never leaves a real paid CLI
      // process running after the test.
      if (liveJobId) {
        try {
          await manager.getJobManager().kill(liveJobId);
        } catch (err) {
          console.error('[sideMessage.test] failed to kill live job after failure:', err);
        }
      }
      if (savedClaudeBin === undefined) delete process.env.SAM_CLAUDE_BIN;
      else process.env.SAM_CLAUDE_BIN = savedClaudeBin;
      if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
      if (savedMaxModel === undefined) delete process.env.SAM_MAX_MODEL;
      else process.env.SAM_MAX_MODEL = savedMaxModel;
    }
  },
);
