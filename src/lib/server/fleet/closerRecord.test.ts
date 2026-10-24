/**
 * SAM: closer record reader test (completed-jobs lists, T3).
 *
 * Each case builds a temp job directory shaped like a real one and drops a
 * `closer.json` into it (or not). Real job folders under ~/.sam/jobs are never
 * read. Every "no record" case must resolve to null without throwing.
 *
 * Spec: must-dos 14, 15, 16; check 5.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

import { CLOSER_FILE, MAX_READ_BYTES, readCloserVerdict } from './closerRecord.js';

const root = tempDir('closer-record-');
let seq = 0;

/** A fresh job directory, with `closer.json` holding `body` unless it is undefined. */
function jobDir(body?: string): string {
  const dir = path.join(root, `job_closer-case-${seq++}_20261011-090229`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ status: 'exited', exitCode: 0 }));
  if (body !== undefined) fs.writeFileSync(path.join(dir, CLOSER_FILE), body);
  return dir;
}

function record(fields: Record<string, unknown>): string {
  return JSON.stringify({ status: 'closed', verdictKind: 'pass', ...fields });
}

async function assertNoRecord(dir: string, label: string): Promise<void> {
  assert.equal(await readCloserVerdict(dir), null, label);
}

test('the record is closer.json and the read cap is 16 KB', () => {
  assert.equal(CLOSER_FILE, 'closer.json');
  assert.equal(MAX_READ_BYTES, 16384);
});

test('a valid PASS (3/3 checks) record returns the verdict and its mtime', async () => {
  const dir = jobDir(record({ verdict: 'PASS (3/3 checks)' }));
  const got = await readCloserVerdict(dir);
  assert.ok(got);
  assert.equal(got.verdict, 'PASS (3/3 checks)');
  assert.equal(got.mtimeMs, fs.statSync(path.join(dir, CLOSER_FILE)).mtimeMs);
});

test('a valid FAIL: tests record returns the verdict', async () => {
  const got = await readCloserVerdict(jobDir(record({ verdictKind: 'fail', verdict: 'FAIL: tests' })));
  assert.equal(got?.verdict, 'FAIL: tests');
});

test('a valid UNKNOWN: blocked: x record returns the verdict', async () => {
  const got = await readCloserVerdict(
    jobDir(record({ verdictKind: 'unknown', verdict: 'UNKNOWN: blocked: x' })),
  );
  assert.equal(got?.verdict, 'UNKNOWN: blocked: x');
});

test('no verdict key is no record', async () => {
  await assertNoRecord(jobDir(JSON.stringify({ status: 'closed', verdictKind: 'pass' })), 'no verdict');
});

test('a numeric verdict is no record', async () => {
  await assertNoRecord(jobDir(record({ verdict: 3 })), 'numeric');
});

test('verdict "ok" is no record', async () => {
  await assertNoRecord(jobDir(record({ verdict: 'ok' })), 'ok');
});

test('verdict "pass" in lower case is no record', async () => {
  await assertNoRecord(jobDir(record({ verdict: 'pass' })), 'lower case');
});

test('invalid JSON is no record', async () => {
  await assertNoRecord(jobDir('{"status": "closed", "verdict": "PASS'), 'invalid JSON');
});

test('an empty file is no record', async () => {
  await assertNoRecord(jobDir(''), 'empty');
});

test('a 1 MB file is no record, even when it would parse', async () => {
  const padding = 'x'.repeat(1024 * 1024);
  await assertNoRecord(jobDir(record({ verdict: 'PASS (3/3 checks)', padding })), '1 MB');
});

test('a missing file is no record', async () => {
  await assertNoRecord(jobDir(), 'missing file');
  await assertNoRecord(path.join(root, 'job_no-such-dir_20261011-090229'), 'missing directory');
});

test('a directory named closer.json is no record', async () => {
  const dir = jobDir();
  fs.mkdirSync(path.join(dir, CLOSER_FILE));
  await assertNoRecord(dir, 'directory');
});

test('valid JSON with status "unclosed" is no record', async () => {
  await assertNoRecord(jobDir(record({ status: 'unclosed', verdict: 'PASS (3/3 checks)' })), 'unclosed');
});

test('valid JSON with no status is no record', async () => {
  await assertNoRecord(jobDir(JSON.stringify({ verdict: 'PASS (3/3 checks)' })), 'no status');
});

test('a JSON array or string is no record', async () => {
  await assertNoRecord(jobDir(JSON.stringify(['PASS (3/3 checks)'])), 'array');
  await assertNoRecord(jobDir(JSON.stringify('PASS (3/3 checks)')), 'string');
});
