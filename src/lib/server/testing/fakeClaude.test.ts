/**
 * SAM — proves the `@/` alias resolver and the fake `claude` CLI both work.
 *
 * The `@/` import below only compiles/resolves at all because of
 * scripts/test-alias.cjs (see tsconfig.test.json and package.json's `test`
 * script) — if the resolver regresses, this file fails to run rather than
 * silently skipping.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

import { tierInfo } from '@/lib/server/chat/tiers';

import { writeFakeClaude } from './fakeClaude';

test('the @/ alias resolves: tierInfo is importable and correct', () => {
  const info = tierInfo('fast');
  assert.equal(info.id, 'fast');
  assert.equal(info.thirdParty, true);
});

test('fake claude, run as a turn, writes a transcript and streams stream-json', () => {
  const tmp = tempDir('fake-claude-turn-');
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
  const tmp = tempDir('fake-claude-resume-');
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
  const tmp = tempDir('fake-claude-memo-');
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
  const tmp = tempDir('fake-claude-title-');
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
  const tmp = tempDir('fake-claude-titlefail-');
  const bin = writeFakeClaude(tmp);

  const result = spawnSync(bin, ['-p', 'Give this chat a title', '--model', 'claude-haiku-4-5-20251001'], {
    cwd: tmp,
    env: { ...process.env, FAKE_TITLE_FAIL: '1' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('fake claude, in stream-json mode, reads the prompt from stdin and folds a mid-delay side message into the first reply', async () => {
  const tmp = tempDir('fake-claude-streamjson-');
  const bin = writeFakeClaude(tmp);
  const configDir = path.join(tmp, 'claude-config');
  const stdinLogPath = path.join(tmp, 'stdin-log.jsonl');
  const workCwd = path.join(tmp, 'work');
  fs.mkdirSync(workCwd, { recursive: true });

  const sessionId = 'aaaaaaaa-1111-2222-3333-444444444444';

  const child = spawn(
    bin,
    ['-p', '--input-format', 'stream-json', '--session-id', sessionId, '--output-format', 'stream-json', '--verbose'],
    {
      cwd: workCwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        FAKE_CLAUDE_REPLY: 'hi',
        FAKE_CLAUDE_TOOL_DELAY_MS: '200',
        FAKE_CLAUDE_LINGER_MS: '50',
        FAKE_CLAUDE_STDIN_LOG: stdinLogPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitPromise = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  child.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] } }) +
      '\n',
  );
  await delay(50);
  child.stdin.write(
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'side one' }] } }) + '\n',
  );
  await delay(20);
  child.stdin.end();

  const code = await exitPromise;
  assert.equal(code, 0, stderr);

  const stdoutLines = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(stdoutLines.length, 3);
  assert.equal(stdoutLines[0].type, 'system');
  assert.equal(stdoutLines[0].subtype, 'init');
  assert.equal(stdoutLines[1].type, 'assistant');
  assert.equal(stdoutLines[2].type, 'result');
  assert.equal(stdoutLines[2].is_error, false);
  assert.equal(stdoutLines[2].result, 'hi | SIDE:side one');

  const slug = workCwd.replace(/[^A-Za-z0-9]/g, '-');
  const transcriptPath = path.join(configDir, 'projects', slug, `${sessionId}.jsonl`);
  const entries = fs
    .readFileSync(transcriptPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 3);

  assert.equal(entries[0].type, 'user');
  assert.equal(entries[0].message.content, 'hello there');
  // T8 (R3): a side message received before the first reply is written as a
  // queued_command attachment, matching the real CLI's own mid-turn shape
  // (SAM's probe, 2026-10-03) — not a plain 'user' entry.
  assert.equal(entries[1].type, 'attachment');
  assert.equal(entries[1].attachment.type, 'queued_command');
  assert.deepEqual(entries[1].attachment.prompt, [{ type: 'text', text: 'side one' }]);
  assert.equal(entries[2].type, 'assistant');
  assert.deepEqual(entries[2].message.content, [{ type: 'text', text: 'hi | SIDE:side one' }]);

  const stdinLogEntries = fs
    .readFileSync(stdinLogPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(stdinLogEntries.length, 1);
  assert.equal(stdinLogEntries[0].text, 'side one');
});

test('fake claude, in stream-json mode, answers a side message that arrives inside the post-result linger window with its own result', async () => {
  const tmp = tempDir('fake-claude-streamjson-linger-');
  const bin = writeFakeClaude(tmp);
  const configDir = path.join(tmp, 'claude-config');
  const workCwd = path.join(tmp, 'work');
  fs.mkdirSync(workCwd, { recursive: true });

  const sessionId = 'bbbbbbbb-1111-2222-3333-444444444444';

  const child = spawn(
    bin,
    ['-p', '--input-format', 'stream-json', '--session-id', sessionId, '--output-format', 'stream-json', '--verbose'],
    {
      cwd: workCwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        FAKE_CLAUDE_REPLY: 'first',
        FAKE_CLAUDE_TOOL_DELAY_MS: '0',
        FAKE_CLAUDE_LINGER_MS: '500',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stdoutBuffer = '';
  const stdoutLines: Array<{ type: string; result?: string }> = [];
  let resolveFirstResult: (() => void) | null = null;
  const firstResultSeen = new Promise<void>((resolve) => {
    resolveFirstResult = resolve;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let idx: number;
    while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.trim() === '') continue;
      const parsed = JSON.parse(line);
      stdoutLines.push(parsed);
      if (parsed.type === 'result' && resolveFirstResult) {
        resolveFirstResult();
        resolveFirstResult = null;
      }
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitPromise = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  child.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] } }) +
      '\n',
  );

  // Wait for the fake's first `result` event on stdout — not a fixed delay —
  // so this proves the late message truly arrives after the turn's first
  // answer, regardless of how long the child process takes to start.
  await firstResultSeen;
  child.stdin.write(
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'late one' }] } }) + '\n',
  );
  await delay(50);
  child.stdin.end();

  const code = await exitPromise;
  assert.equal(code, 0, stderr);

  const resultLines = stdoutLines.filter((l) => l.type === 'result');
  assert.equal(resultLines.length, 2);
  assert.equal(resultLines[0].result, 'first');
  assert.equal(resultLines[1].result, 'SIDE:late one');
});

test('fake claude, in stream-json mode, does not exit on its own after the first result while stdin stays open, and exits 0 once stdin closes', async () => {
  const tmp = tempDir('fake-claude-streamjson-noexit-');
  const bin = writeFakeClaude(tmp);
  const configDir = path.join(tmp, 'claude-config');
  const workCwd = path.join(tmp, 'work');
  fs.mkdirSync(workCwd, { recursive: true });

  const sessionId = 'cccccccc-1111-2222-3333-444444444444';

  const child = spawn(
    bin,
    ['-p', '--input-format', 'stream-json', '--session-id', sessionId, '--output-format', 'stream-json', '--verbose'],
    {
      cwd: workCwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        FAKE_CLAUDE_REPLY: 'first',
        FAKE_CLAUDE_TOOL_DELAY_MS: '0',
        // Deliberately short — if the old self-exit timer were still in
        // effect, the process would be gone well before the 2s check below.
        FAKE_CLAUDE_LINGER_MS: '50',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stdoutBuffer = '';
  let resolveFirstResult: (() => void) | null = null;
  const firstResultSeen = new Promise<void>((resolve) => {
    resolveFirstResult = resolve;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let idx: number;
    while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.trim() === '') continue;
      const parsed = JSON.parse(line);
      if (parsed.type === 'result' && resolveFirstResult) {
        resolveFirstResult();
        resolveFirstResult = null;
      }
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  let exited = false;
  const exitPromise = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      exited = true;
      resolve(code);
    });
  });

  child.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] } }) +
      '\n',
  );

  await firstResultSeen;
  await delay(2000);
  assert.equal(exited, false, 'the fake must not exit on its own while stdin is still open');

  child.stdin.end();
  const code = await exitPromise;
  assert.equal(code, 0, stderr);
});
