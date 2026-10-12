/**
 * SAM — streamTail.test: bounded tail read and last real activity (job ticket panel T7).
 * Fixtures are built in a temp dir, shaped like a real claude-stream.jsonl.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { failedRuns, lastActivity, readStreamTail, TAIL_BYTES } from './streamTail';

const T = '2026-10-08T21:10:00.000Z';

function line(i: number): string {
  const type = i % 2 ? 'user' : 'assistant';
  const ts = i === 19 ? T : new Date(Date.UTC(2026, 9, 8, 21, 0, i)).toISOString();
  return JSON.stringify({ type, timestamp: ts, message: { content: 'x' } });
}
const heartbeat = (i: number) =>
  JSON.stringify({ type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 30 * (i + 1), heartbeat: true });

test('lastActivity ignores 100 trailing heartbeats and the file mtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'streamtail-'));
  try {
    const file = join(dir, 'claude-stream.jsonl');
    const rows: string[] = [JSON.stringify({ type: 'system', subtype: 'init' })];
    for (let i = 0; i < 20; i++) rows.push(line(i));
    for (let i = 0; i < 100; i++) rows.push(heartbeat(i));
    writeFileSync(file, rows.join('\n') + '\n');
    const later = new Date('2026-10-09T09:00:00.000Z');
    utimesSync(file, later, later);
    const lines = await readStreamTail(file);
    assert.equal(lastActivity(lines), T);
    assert.notEqual(lastActivity(lines), statSync(file).mtime.toISOString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tail with no timestamped line gives null', () => {
  const lines = [JSON.stringify({ type: 'system' }), heartbeat(0), 'not json'];
  assert.equal(lastActivity(lines), null);
  assert.equal(lastActivity([]), null);
});

test('only the last TAIL_BYTES of a 2 MB file are read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'streamtail-'));
  try {
    const file = join(dir, 'claude-stream.jsonl');
    const row = JSON.stringify({ type: 'user', timestamp: T, pad: 'y'.repeat(200) });
    const n = Math.ceil((2 * 1024 * 1024) / (row.length + 1));
    writeFileSync(file, Array.from({ length: n }, () => row).join('\n') + '\n');
    assert.ok(statSync(file).size >= 2 * 1024 * 1024);
    const lines = await readStreamTail(file);
    const total = lines.reduce((s, l) => s + l.length + 1, 0);
    assert.ok(total <= TAIL_BYTES, `read ${total} bytes`);
    assert.ok(total > TAIL_BYTES - 2 * (row.length + 1));
    for (const l of lines) JSON.parse(l); // partial first line was dropped
    assert.equal(lastActivity(lines), T);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file gives an empty list and null', async () => {
  const lines = await readStreamTail(join(tmpdir(), 'streamtail-does-not-exist', 'x.jsonl'));
  assert.deepEqual(lines, []);
  assert.equal(lastActivity(lines), null);
});

const use = (id: string, command: string, ts: string) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const result = (id: string, content: string, ts: string, err = true) =>
  JSON.stringify({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: err }] } });

test('failedRuns counts failed tests and builds only, newest first', () => {
  const long = 'timeout 470   node scripts/t-v3-phone-flow.mjs --rows T21 2>&1 | tail -20';
  const lines = [
    use('a', 'npm test', '2026-10-09T10:00:00.000Z'),
    result('a', 'ok\n', '2026-10-09T10:00:01.000Z', false),
    use('b', 'npx tsc --noEmit', '2026-10-09T10:01:00.000Z'),
    result('b', 'Exit code 1\nerror TS1', '2026-10-09T10:01:01.000Z'),
    use('c', long, '2026-10-09T10:02:00.000Z'),
    result('c', 'Exit code 143\nTerminated', '2026-10-09T10:02:01.000Z'),
    result('missing', 'Exit code 143\n', '2026-10-09T10:03:01.000Z'),
    use('d', 'grep -rn foo src', '2026-10-09T10:04:00.000Z'),
    result('d', 'Exit code 1\n', '2026-10-09T10:04:01.000Z'),
    heartbeat(0),
    'not json',
  ];
  const r = failedRuns(lines);
  assert.equal(r.count, 3);
  assert.deepEqual(r.recent.map((x) => x.exitCode), [143, 143, 1]);
  assert.deepEqual(r.recent.map((x) => x.timedOut), [true, true, false]);
  assert.equal(r.recent[0].command, '(command not in the recent log)');
  assert.equal(r.recent[1].command, 'timeout 470 node scripts/t-v3-phone-flow.mjs --rows T21 2>&1 | tail -20');
  assert.equal(r.recent[2].command, 'npx tsc --noEmit');
  assert.equal(r.recent[2].at, '2026-10-09T10:01:01.000Z');
});

test('failedRuns trims long commands and lists at most 5', () => {
  const lines: string[] = [];
  for (let i = 0; i < 7; i++) {
    lines.push(use('x' + i, 'npm test ' + 'z'.repeat(200), '2026-10-09T10:00:00.000Z'));
    lines.push(result('x' + i, 'Exit code 2\n', '2026-10-09T10:00:01.000Z'));
  }
  const r = failedRuns(lines);
  assert.equal(r.count, 7);
  assert.equal(r.recent.length, 5);
  assert.equal(r.recent[0].command.length, 120);
  assert.deepEqual(failedRuns([]), { count: 0, recent: [] });
});
