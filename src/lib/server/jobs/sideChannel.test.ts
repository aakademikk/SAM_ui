/**
 * SAM — T2: JobManager's piped stdin, closeStdin, and the ordered
 * deliverSideMessage primitive (check 12's ordering guarantee).
 *
 * Drives the real JobManager (`systemd-run --user --scope`), never
 * `systemd-run` directly, so this exercises the exact path a chat turn will
 * use. A trivial long-lived Node script stands in for the CLI: it echoes
 * every stdin line back on stdout prefixed `got:`, so the child's own output
 * proves what order it actually received lines in, independent of
 * deliverSideMessage's own return value. If `systemd-run --user` is
 * unavailable this file fails loudly, matching startTurn.test.ts's rule —
 * it never skips.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

type ManagerModule = typeof import('./manager.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'side-channel-'));
const home = path.join(tmp, 'home');

let manager: ManagerModule;

before(async () => {
  // Fail loudly, never skip: the whole point is the real spawn path.
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; sideChannel.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  assert.equal(os.homedir(), home);

  manager = await import('./manager.js');
});

/** Jobs the review tests start; closed in `after` so a failing assertion can
 *  never leave a child holding the runner open. */
const spawned: string[] = [];

after(() => {
  for (const id of spawned) manager?.getJobManager().closeStdin(id);
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const echoScript = path.join(tmp, 'echo-stdin.js');
fs.writeFileSync(
  echoScript,
  [
    "process.stdin.setEncoding('utf8');",
    "let buf = '';",
    "process.stdin.on('data', (chunk) => {",
    '  buf += chunk;',
    '  let idx;',
    "  while ((idx = buf.indexOf('\\n')) >= 0) {",
    '    const line = buf.slice(0, idx);',
    '    buf = buf.slice(idx + 1);',
    "    process.stdout.write('got:' + line + '\\n');",
    '  }',
    '});',
    "process.stdin.on('end', () => {",
    '  process.exit(0);',
    '});',
    '',
  ].join('\n'),
);

async function currentOutputText(jobId: string): Promise<string> {
  const frames = await manager.getJobManager().getOutput(jobId);
  return Buffer.concat(frames.map((f) => f.data)).toString('utf-8');
}

async function waitUntilOutputContains(jobId: string, needle: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    text = await currentOutputText(jobId);
    if (text.includes(needle)) return text;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for output to contain ${JSON.stringify(needle)}; got:\n${text}`);
}

async function waitUntil(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
}

test('a write raced against the child already exiting never crashes the process (EPIPE safety)', async () => {
  // `createArgs` always wraps the payload in a multi-statement bash script
  // (`withExitSentinel`: "cat ...; "$@"; printf ..."), so bash itself holds
  // its own copy of fd 0 open for as long as it's alive — the payload closing
  // *its own* stdin (`process.stdin.destroy()`, or even `fs.closeSync(0)`)
  // does not make the parent's write EPIPE while bash is still running.
  // Verified empirically against this exact wrapper shape before writing this
  // test. The real race this ticket guards against is narrower: the whole
  // scope (bash included) has exited, but `attach()`'s `close` handler
  // (which flips `record.status` and deletes the job from `this.jobs`) is
  // still in flight (it awaits `output.close()` first) — a write landing in
  // that gap hits a genuinely-dead pipe. Reproduced here by racing a flood of
  // `deliverSideMessage` calls against a near-instantly-exiting child.
  const job = await manager
    .getJobManager()
    .createArgs(process.execPath, ['-e', 'process.exit(0)'], { stdin: 'pipe' });

  const line = 'x'.repeat(4096) + '\n';
  const results: boolean[] = [];
  for (let i = 0; i < 300; i++) {
    results.push(await manager.getJobManager().deliverSideMessage(job.id, line, `MARK:${i}\n`));
  }

  await waitUntil(() => !manager.getJobManager().isLive(job.id));

  // Reaching this line at all is most of the proof: an uncaught EPIPE on
  // `child.stdin` (no 'error' listener) would have crashed the whole test
  // runner process before any assertion below could run.
  assert.ok(results.includes(false), 'expected the race to make at least one delivery fail once the job exited');
  assert.equal(results.at(-1), false, 'a delivery attempted well after the job is gone must report failure');

  // No marker line was appended for any call that reported failure.
  const text = await currentOutputText(job.id);
  const markerCount = (text.match(/MARK:\d+\n/g) ?? []).length;
  const successCount = results.filter(Boolean).length;
  assert.equal(markerCount, successCount, 'a marker line must be appended iff the delivery reported success');
});

test('deliverSideMessage preserves call order; closeStdin ends the child; delivery fails after exit', async () => {
  const job = await manager.getJobManager().createArgs(process.execPath, [echoScript], { stdin: 'pipe' });
  assert.equal(manager.getJobManager().isLive(job.id), true);

  // Two calls fired back-to-back, with no await between the calls themselves.
  const p1 = manager.getJobManager().deliverSideMessage(job.id, 'alpha\n', 'MARK:alpha\n');
  const p2 = manager.getJobManager().deliverSideMessage(job.id, 'beta\n', 'MARK:beta\n');
  const [ok1, ok2] = await Promise.all([p1, p2]);
  assert.equal(ok1, true);
  assert.equal(ok2, true);

  // The child's own echo proves the stdin writes reached it in call order,
  // never interleaved.
  const text = await waitUntilOutputContains(job.id, 'got:beta');
  assert.ok(
    text.indexOf('got:alpha') < text.indexOf('got:beta'),
    `expected "got:alpha" before "got:beta"; got:\n${text}`,
  );

  // The marker lines land in the same output log, in call order, at
  // increasing seq.
  const frames = await manager.getJobManager().getOutput(job.id);
  const markers = frames.filter((f) => f.data.toString('utf-8').startsWith('MARK:'));
  assert.equal(markers.length, 2, `expected two marker frames; got:\n${JSON.stringify(frames)}`);
  assert.equal(markers[0].data.toString('utf-8'), 'MARK:alpha\n');
  assert.equal(markers[1].data.toString('utf-8'), 'MARK:beta\n');
  assert.ok(markers[0].seq < markers[1].seq, 'marker seqs must increase in call order');

  // closeStdin makes the child see EOF and exit.
  assert.equal(manager.getJobManager().closeStdin(job.id), true);
  await waitUntil(() => !manager.getJobManager().isLive(job.id));

  // After exit, delivery reports failure rather than throwing or hanging.
  const ok3 = await manager.getJobManager().deliverSideMessage(job.id, 'gamma\n', 'MARK:gamma\n');
  assert.equal(ok3, false);
});

/* ========================================================================== */
/* Review 4 and 5                                                             */
/* ========================================================================== */

async function waitForExit(jobId: string): Promise<void> {
  await waitUntil(() => !manager.getJobManager().isLive(jobId), 8000);
}

test('review 4: onOutputChunk sees stdout chunks only, never stderr', async () => {
  const script = path.join(tmp, 'stderr-then-stdout.js');
  fs.writeFileSync(
    script,
    [
      "process.stderr.write('warn: partial');",
      "setTimeout(() => process.stdout.write('line one\\n'), 150);",
      "process.stdin.on('end', () => process.exit(0));",
      'process.stdin.resume();',
      '',
    ].join('\n'),
  );

  const seen: string[] = [];
  const job = await manager.getJobManager().createArgs(process.execPath, [script], {
    stdin: 'pipe',
    onOutputChunk: (chunk) => seen.push(chunk.toString('utf-8')),
  });
  spawned.push(job.id);

  await waitUntilOutputContains(job.id, 'line one');
  await waitUntil(() => seen.length > 0);
  manager.getJobManager().closeStdin(job.id);
  await waitForExit(job.id);

  // The stderr fragment is in the job's output log, but was never offered to
  // the stdout-only callback.
  assert.ok((await currentOutputText(job.id)).includes('warn: partial'));
  assert.deepEqual(seen, ['line one\n']);
});

test('review 5: a marker delivered mid-line waits for the line to finish, then follows it', async () => {
  const script = path.join(tmp, 'half-line.js');
  fs.writeFileSync(
    script,
    [
      "process.stdout.write('{\"a\":\"half');",
      "setTimeout(() => process.stdout.write('-rest\"}\\n'), 800);",
      "process.stdin.on('end', () => process.exit(0));",
      'process.stdin.resume();',
      '',
    ].join('\n'),
  );

  const job = await manager.getJobManager().createArgs(process.execPath, [script], { stdin: 'pipe' });
  spawned.push(job.id);
  await waitUntilOutputContains(job.id, '{"a":"half');

  // Delivered while the first half sits on the wire: stdin is written and
  // reported delivered, but the marker must not split the line.
  const ok = await manager.getJobManager().deliverSideMessage(job.id, 'hello\n', 'MARK:mid\n');
  assert.equal(ok, true);

  const text = await waitUntilOutputContains(job.id, 'MARK:mid');
  assert.equal(text, '{"a":"half-rest"}\nMARK:mid\n');

  manager.getJobManager().closeStdin(job.id);
  await waitForExit(job.id);
});

test('review 5: a marker still waiting when the job ends is written on a line of its own', async () => {
  const script = path.join(tmp, 'cut-short.js');
  fs.writeFileSync(
    script,
    [
      "process.stdout.write('{\"b\":\"cut');",
      "process.stdin.on('end', () => process.exit(0));",
      'process.stdin.resume();',
      '',
    ].join('\n'),
  );

  const job = await manager.getJobManager().createArgs(process.execPath, [script], { stdin: 'pipe' });
  spawned.push(job.id);
  await waitUntilOutputContains(job.id, '{"b":"cut');

  const ok = await manager.getJobManager().deliverSideMessage(job.id, 'hello\n', 'MARK:end\n');
  assert.equal(ok, true);
  manager.getJobManager().closeStdin(job.id);
  await waitForExit(job.id);

  assert.equal(await currentOutputText(job.id), '{"b":"cut\nMARK:end\n');
});
