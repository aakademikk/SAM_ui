/**
 * SAM — readFrames must handle both output formats that land under
 * ~/.sam/jobs/<id>/stdout.log:
 *
 *   1. sam-job's worker (run.sh) writes PLAIN TEXT — stdout/stderr piped
 *      straight into the file with `> stdout.log 2>&1`. Its meta.json is
 *      recognisable by having a `unit` string and no `lastSeq` (see
 *      /home/col/.local/bin/sam-job).
 *   2. JobManager's own OutputWriter writes the BINARY-FRAMED format
 *      (4-byte seq BE, 4-byte len BE, data) documented in manager.ts.
 *
 * Before this ticket's fix, readFrames only understood format 2: it read the
 * first 8 bytes of a plain-text file as a frame header, got a huge bogus
 * length, and bailed out with zero frames — the Job page then showed
 * "(no output)" for every sam-job job.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// Route every ~/.sam path this test touches into a scratch HOME, set BEFORE
// the module under test is imported — JOBS_ROOT in manager.ts is computed
// from os.homedir() at module load time. The import itself is async (dynamic
// import, not a static one), so `process.env.HOME` is guaranteed to land
// before manager.ts's top-level `path.join(os.homedir(), ...)` runs; every
// test below awaits `ready` first so none can race the import.
const tmpHome = tempDir('readframes-home-');
process.env.HOME = tmpHome;

let readFrames: typeof import('./manager.js').readFrames;
const ready = (async () => {
  ({ readFrames } = await import('./manager.js'));
})();

function jobDir(id: string): string {
  const dir = path.join(tmpHome, '.sam', 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('readFrames returns a sam-job (plain-text) log as text, joined frames equal the file', async () => {
  await ready;
  const id = 'job_x_20260930-120000';
  const dir = jobDir(id);

  // sam-job meta shape (see /home/col/.local/bin/sam-job): has `unit` and
  // `notify`, no `lastSeq` at all — that absence plus the presence of `unit`
  // is what marks this as a sam-job job rather than one this server started.
  const meta = {
    id,
    command: 'echo hi',
    status: 'exited',
    exitCode: 0,
    createdAt: '2026-09-30T12:00:00.000Z',
    startedAt: '2026-09-30T12:00:00.100Z',
    endedAt: '2026-09-30T12:00:01.000Z',
    outputBytes: 0,
    unit: 'sam-job-x-1790000000',
    notify: false,
    summary: null,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

  const text = 'line one\nline two\nline three\n';
  fs.writeFileSync(path.join(dir, 'stdout.log'), text, 'utf-8');

  const frames = await readFrames(id);
  assert.ok(frames.length > 0, 'expected at least one frame');

  const joined = Buffer.concat(frames.map((f) => f.data)).toString('utf-8');
  assert.equal(joined, text);

  // seq is 1..n and monotonic, honouring fromSeq.
  for (let i = 0; i < frames.length; i++) {
    assert.equal(frames[i].seq, i + 1);
  }

  const fromMiddle = await readFrames(id, 0);
  assert.equal(fromMiddle.length, frames.length);
  if (frames.length > 1) {
    const skipFirst = await readFrames(id, frames[0].seq);
    assert.equal(skipFirst.length, frames.length - 1);
  } else {
    // Single-chunk file: asking past its only seq returns nothing.
    const skipAll = await readFrames(id, frames[0].seq);
    assert.equal(skipAll.length, 0);
  }
});

test('readFrames still parses a binary-framed file written the manager\'s own way', async () => {
  await ready;
  const id = 'job_manager_20260930-120500';
  const dir = jobDir(id);

  // A JobManager-created record: has `lastSeq`, no `unit` — the opposite
  // fingerprint from a sam-job job, so this must take the original binary path.
  const meta = {
    id,
    command: 'node build.js',
    status: 'exited',
    exitCode: 0,
    createdAt: '2026-09-30T12:05:00.000Z',
    startedAt: '2026-09-30T12:05:00.100Z',
    endedAt: '2026-09-30T12:05:01.000Z',
    outputBytes: 0,
    lastSeq: 2,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

  // Hand-build the same binary frame format OutputWriter emits: 4-byte seq
  // BE, 4-byte len BE, data — two frames.
  const chunks = [Buffer.from('hello ', 'utf-8'), Buffer.from('world\n', 'utf-8')];
  const parts: Buffer[] = [];
  chunks.forEach((data, i) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(i + 1, 0);
    header.writeUInt32BE(data.length, 4);
    parts.push(header, data);
  });
  fs.writeFileSync(path.join(dir, 'stdout.log'), Buffer.concat(parts));

  const frames = await readFrames(id);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].seq, 1);
  assert.equal(frames[0].data.toString('utf-8'), 'hello ');
  assert.equal(frames[1].seq, 2);
  assert.equal(frames[1].data.toString('utf-8'), 'world\n');

  const joined = Buffer.concat(frames.map((f) => f.data)).toString('utf-8');
  assert.equal(joined, 'hello world\n');

  // fromSeq is still honoured.
  const onlySecond = await readFrames(id, 1);
  assert.equal(onlySecond.length, 1);
  assert.equal(onlySecond[0].seq, 2);
});
