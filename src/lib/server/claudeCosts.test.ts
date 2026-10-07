/**
 * SAM — claudeCosts.test: the spend scanner reads only what a transcript
 * gained since the last scan, and starts over when a file shrinks or is
 * replaced. The memory fix of 2026-10-07: /api/fleet/spend is polled every
 * 2.5 s and used to re-read every changed transcript whole on each call.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const REAL_HOME = process.env.HOME;
let home = '';
let transcript = '';
let mod: typeof import('./claudeCosts.js');

function line(id: string, pad = 0): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        id,
        model: 'deepseek-flash',
        usage: { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 1000 },
      },
      pad: 'x'.repeat(pad),
    }) + '\n'
  );
}

/** Write a transcript of at least `bytes` bytes; returns the number of turns. */
function fill(file: string, bytes: number, idPrefix: string): number {
  let n = 0;
  let size = 0;
  const parts: string[] = [];
  while (size < bytes) {
    const l = line(`${idPrefix}-${n++}`, 400);
    parts.push(l);
    size += l.length;
  }
  fs.writeFileSync(file, parts.join(''), 'utf-8');
  return n;
}

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-costs-'));
  process.env.HOME = home;
  transcript = path.join(home, '.claude', 'projects', 'x', 's.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  mod = await import('./claudeCosts.js');
  mod.claudeCostsTestHooks.memoTtlMs = 0; // each call scans; the memo has its own test
  await measureOne();
});
after(() => {
  process.env.HOME = REAL_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

/** Cost of one `line()`, measured before any transcript exists, so no rate is hard-coded. */
let one = 0;
async function measureOne(): Promise<void> {
  const probe = path.join(home, '.claude', 'projects', 'probe', 'p.jsonl');
  fs.mkdirSync(path.dirname(probe), { recursive: true });
  fs.writeFileSync(probe, line('probe'), 'utf-8');
  one = (await mod.claudeCosts()).costUsd;
  fs.rmSync(path.dirname(probe), { recursive: true, force: true });
  mod.claudeCostsTestHooks.reset();
}

test('claudeCosts: an append is priced from the tail alone, under 64 KB read', async () => {
  assert.ok(one > 0);
  const count = fill(transcript, 20 * 1024 * 1024, 'a');

  const first = await mod.claudeCosts();
  assert.ok(Math.abs(first.costUsd - count * one) < 1e-6, 'full scan totals every turn');
  assert.ok(mod.claudeCostsTestHooks.bytesRead >= 20 * 1024 * 1024, 'first scan reads the file');

  fs.appendFileSync(transcript, line('appended'), 'utf-8');
  mod.claudeCostsTestHooks.reset();
  const second = await mod.claudeCosts();
  assert.ok(Math.abs(second.costUsd - first.costUsd - one) < 1e-9, 'total rose by exactly the new line');
  assert.ok(
    mod.claudeCostsTestHooks.bytesRead < 64 * 1024,
    `second call read ${mod.claudeCostsTestHooks.bytesRead} bytes, want under 65536`,
  );
});

test('claudeCosts: a partial last line is held back until it is complete', async () => {
  fill(transcript, 64 * 1024, 'p');
  const base = (await mod.claudeCosts()).costUsd;

  const next = line('partial');
  fs.appendFileSync(transcript, next.slice(0, 40), 'utf-8');
  assert.equal((await mod.claudeCosts()).costUsd, base, 'half a line costs nothing');
  fs.appendFileSync(transcript, next.slice(40), 'utf-8');
  assert.ok(Math.abs((await mod.claudeCosts()).costUsd - base - one) < 1e-9, 'completed line counted once');
});

test('claudeCosts: a shrunk file is re-read from the start', async () => {
  fill(transcript, 256 * 1024, 'big');
  await mod.claudeCosts();
  const small = fill(transcript, 32 * 1024, 'small');
  const r = await mod.claudeCosts();
  assert.ok(Math.abs(r.costUsd - small * one) < 1e-6, 'totals follow the smaller file');
});

test('claudeCosts: a replaced file (new inode, not smaller) is re-read from the start', async () => {
  const n = fill(transcript, 64 * 1024, 'old');
  await mod.claudeCosts();
  const replacement = transcript + '.new';
  const bigger = fill(replacement, 96 * 1024, 'new');
  fs.renameSync(replacement, transcript);
  const r = await mod.claudeCosts();
  assert.ok(bigger > n);
  assert.ok(Math.abs(r.costUsd - bigger * one) < 1e-6, 'old file contributes nothing');
});

test('claudeCosts: concurrent callers inside the memo window share one scan', async () => {
  mod.claudeCostsTestHooks.memoTtlMs = 30_000;
  try {
    mod.claudeCostsTestHooks.reset();
    const n = fill(transcript, 64 * 1024, 'memo');
    const [a, b] = await Promise.all([mod.claudeCosts(), mod.claudeCosts()]);
    assert.equal(a, b, 'one shared result');
    assert.ok(Math.abs(a.costUsd - n * one) < 1e-6);
    const read = mod.claudeCostsTestHooks.bytesRead;
    fs.appendFileSync(transcript, line('later'), 'utf-8');
    const c = await mod.claudeCosts();
    assert.equal(c, a, 'a later call inside 30 s is memoised');
    assert.equal(mod.claudeCostsTestHooks.bytesRead, read, 'and reads nothing');
  } finally {
    mod.claudeCostsTestHooks.memoTtlMs = 0;
    mod.claudeCostsTestHooks.reset();
  }
});
