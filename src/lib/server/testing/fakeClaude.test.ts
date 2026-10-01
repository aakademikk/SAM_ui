/**
 * SAM — proves the `@/` alias resolver and the fake `claude` CLI both work.
 *
 * The `@/` import below only compiles/resolves at all because of
 * scripts/test-alias.cjs (see tsconfig.test.json and package.json's `test`
 * script) — if the resolver regresses, this file fails to run rather than
 * silently skipping.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { tierInfo } from '@/lib/server/chat/tiers';

import { writeFakeClaude } from './fakeClaude';

test('the @/ alias resolves: tierInfo is importable and correct', () => {
  const info = tierInfo('fast');
  assert.equal(info.id, 'fast');
  assert.equal(info.thirdParty, true);
});

test('fake claude, run as a turn, writes a transcript and streams stream-json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-turn-'));
  const bin = writeFakeClaude(tmp);

  const configDir = path.join(tmp, 'claude-config');
  const logPath = path.join(tmp, 'log.jsonl');
  const workCwd = path.join(tmp, 'work');
  fs.mkdirSync(workCwd, { recursive: true });

  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const result = spawnSync(
    bin,
    ['-p', 'hello there', '--session-id', sessionId, '--output-format', 'stream-json', '--verbose'],
    {
      cwd: workCwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        SAM_CHAT_ID: sessionId,
        FAKE_CLAUDE_LOG: logPath,
        FAKE_CLAUDE_REPLY: 'hi from the fake',
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);

  const stdoutLines = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(stdoutLines.length, 3);
  assert.equal(stdoutLines[0].type, 'system');
  assert.equal(stdoutLines[0].subtype, 'init');
  assert.equal(stdoutLines[0].session_id, sessionId);
  assert.equal(stdoutLines[1].type, 'assistant');
  assert.equal(stdoutLines[1].message.content[0].type, 'text');
  assert.equal(stdoutLines[1].message.content[0].text, 'hi from the fake');
  assert.equal(stdoutLines[2].type, 'result');
  assert.equal(stdoutLines[2].is_error, false);
  assert.equal(stdoutLines[2].result, 'hi from the fake');

  const slug = workCwd.replace(/[^A-Za-z0-9]/g, '-');
  const transcriptPath = path.join(configDir, 'projects', slug, `${sessionId}.jsonl`);
  const entries = fs
    .readFileSync(transcriptPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 2);

  assert.equal(entries[0].type, 'user');
  assert.equal(entries[0].message.role, 'user');
  assert.equal(entries[0].message.content, 'hello there');
  assert.equal(entries[0].sessionId, sessionId);
  assert.equal(entries[0].cwd, workCwd);

  assert.equal(entries[1].type, 'assistant');
  assert.equal(entries[1].message.role, 'assistant');
  assert.deepEqual(entries[1].message.content, [{ type: 'text', text: 'hi from the fake' }]);
  assert.equal(entries[1].sessionId, sessionId);
  assert.equal(entries[1].cwd, workCwd);

  const logEntries = fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(logEntries.length, 1);
  assert.equal(logEntries[0].cwd, workCwd);
  assert.equal(logEntries[0].CLAUDE_CONFIG_DIR, configDir);
  assert.equal(logEntries[0].SAM_CHAT_ID, sessionId);
  assert.ok(Array.isArray(logEntries[0].argv));
});

test('fake claude, given --resume, keys the transcript off the resume id, not a fresh one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-resume-'));
  const bin = writeFakeClaude(tmp);
  const configDir = path.join(tmp, 'claude-config');
  const resumeId = 'ffffffff-1111-2222-3333-444444444444';

  const result = spawnSync(bin, ['-p', 'again', '--resume', resumeId], {
    cwd: tmp,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, FAKE_CLAUDE_REPLY: 'still here' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const slug = tmp.replace(/[^A-Za-z0-9]/g, '-');
  const transcriptPath = path.join(configDir, 'projects', slug, `${resumeId}.jsonl`);
  assert.ok(fs.existsSync(transcriptPath));
});

test('fake claude writes a memo when the prompt asks for one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-memo-'));
  const bin = writeFakeClaude(tmp);
  const configDir = path.join(tmp, 'claude-config');
  const memoPath = path.join(tmp, 'memos', 'note.md');

  const result = spawnSync(
    bin,
    ['-p', `Do the thing.\nWrite the memo to: ${memoPath}`, '--session-id', 'abc12345-0000-0000-0000-000000000000'],
    {
      cwd: tmp,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, FAKE_CLAUDE_REPLY: 'done' },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(memoPath));
  assert.match(fs.readFileSync(memoPath, 'utf8'), /done/);
});

test('fake claude, in title mode, prints one JSON result line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-title-'));
  const bin = writeFakeClaude(tmp);

  const result = spawnSync(
    bin,
    ['-p', 'Give this chat a title', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'json'],
    {
      cwd: tmp,
      env: { ...process.env, FAKE_TITLE: 'Kitchen V3 Batch 4 Status' },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    type: 'result',
    is_error: false,
    result: 'Kitchen V3 Batch 4 Status',
  });
});

test('fake claude, in title mode, can be made to fail', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-titlefail-'));
  const bin = writeFakeClaude(tmp);

  const result = spawnSync(bin, ['-p', 'Give this chat a title', '--model', 'claude-haiku-4-5-20251001'], {
    cwd: tmp,
    env: { ...process.env, FAKE_TITLE_FAIL: '1' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
});
