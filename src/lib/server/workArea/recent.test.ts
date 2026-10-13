import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '@/lib/server/testing/tempDir';

const home = tempDir('recent-home-');
const vault = tempDir('recent-vault-');
process.env.HOME = home;
process.env.SAM_VAULT_DIR = vault;
fs.mkdirSync(path.join(home, '.sam'), { recursive: true });

const recentFile = path.join(home, '.sam', 'work-area', 'recent.jsonl');
const lineCount = () =>
  fs.existsSync(recentFile) ? fs.readFileSync(recentFile, 'utf-8').split('\n').filter(Boolean).length : 0;

function writeRecord(paths: string[]): void {
  fs.mkdirSync(path.dirname(recentFile), { recursive: true });
  const rows = paths.map((p, i) => ({
    at: new Date(1_800_000_000_000 + i * 1000).toISOString(),
    path: p,
    chatId: 'chat-1',
    messageId: `job-${i}`,
    title: `T ${p}`,
  }));
  fs.writeFileSync(recentFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(vault, `f${i}.md`), `# F${i}\n`);

test('file is absent before anything is recorded', async () => {
  const { readRecent } = await import('./recent.js');
  assert.equal(fs.existsSync(recentFile), false);
  assert.deepEqual(await readRecent(), []);
});

test('25 lines over 18 distinct paths gives 18 entries, newest first, one per path', async () => {
  const { readRecent } = await import('./recent.js');
  const paths: string[] = [];
  for (let i = 0; i < 18; i++) paths.push(`f${i}.md`);
  paths.push('f0.md', 'f1.md', 'f2.md', 'f3.md', 'f4.md', 'f5.md', 'f6.md');
  assert.equal(paths.length, 25);
  writeRecord(paths);
  const got = await readRecent();
  assert.equal(got.length, 18);
  assert.equal(new Set(got.map((e) => e.path)).size, 18);
  // newest line is f6 (index 24); f5 (23) ... f0 (19), then f17 (17) down to f7.
  assert.deepEqual(
    got.map((e) => e.path),
    ['f6.md', 'f5.md', 'f4.md', 'f3.md', 'f2.md', 'f1.md', 'f0.md', ...Array.from({ length: 11 }, (_, k) => `f${17 - k}.md`)],
  );
  assert.equal(got[0].messageId, 'job-24');
  assert.equal(got[0].chatId, 'chat-1');
  assert.equal(got[0].missing, false);
});

test('25 lines over 25 paths gives 20', async () => {
  const { readRecent } = await import('./recent.js');
  writeRecord(Array.from({ length: 25 }, (_, i) => `f${i}.md`));
  const got = await readRecent();
  assert.equal(got.length, 20);
  assert.equal(got[0].path, 'f24.md');
});

test('a deleted file shows missing: true; a website is never missing; nothing is audited', async () => {
  const { readRecent } = await import('./recent.js');
  fs.writeFileSync(path.join(vault, 'gone.md'), '# gone');
  writeRecord(['gone.md', 'https://example.com/x']);
  fs.rmSync(path.join(vault, 'gone.md'));
  const got = await readRecent();
  const byPath = new Map(got.map((e) => [e.path, e]));
  assert.equal(byPath.get('gone.md')?.missing, true);
  assert.equal(byPath.get('https://example.com/x')?.missing, false);
  assert.equal(fs.existsSync(path.join(home, '.sam', 'audit.log')), false);
});

test('recordTurnItems on a temp job adds exactly two lines', async () => {
  const { recordTurnItems } = await import('./recent.js');
  fs.writeFileSync(path.join(vault, 'plan.md'), '# The Plan\n');
  fs.rmSync(recentFile, { force: true });
  const jobId = 'job-recent-1';
  const dir = path.join(home, '.sam', 'jobs', jobId);
  fs.mkdirSync(dir, { recursive: true });
  const ev = (text: string) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n';
  const body =
    ev('Here it is.\n<!-- work: plan.md -->\n<!-- more -->\nMore.') +
    ev('Also\n<!-- work: https://example.com/page -->\n') +
    JSON.stringify({ type: 'result', is_error: false, result: 'x' }) +
    '\n';
  const data = Buffer.from(body, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(data.length, 4);
  fs.writeFileSync(path.join(dir, 'stdout.log'), Buffer.concat([header, data]));

  await recordTurnItems({
    chatId: 'chat-9',
    jobId,
    exitCode: 0,
    tier: 'max',
    internal: false,
    record: {} as never,
    chat: null,
  } as never);

  assert.equal(lineCount(), 2);
  const rows = fs.readFileSync(recentFile, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.path), ['plan.md', 'https://example.com/page']);
  assert.equal(rows[0].title, 'The Plan');
  assert.equal(rows[1].title, 'example.com');
  assert.equal(rows[0].messageId, jobId);
  assert.equal(rows[0].chatId, 'chat-9');
  assert.equal(fs.statSync(path.dirname(recentFile)).mode & 0o777, 0o700);
});

test('labelRecent: chat title, Chat fallback, and project rules', async () => {
  const { labelRecent } = await import('./recent.js');
  const e = (p: string, chatId: string) => ({ path: p, chatId, messageId: 'm', at: '', title: 't', missing: false });
  const got = labelRecent(
    [
      e('02 - Atwood Systems/Alpha/x.md', 'c1'),
      e('03 - Personal/Health/y.md', 'gone'),
      e('Notes/z.md', 'c1'),
      e('top.md', 'c1'),
      e('02 - Atwood Systems/file.md', 'c1'),
      e('https://example.com/a', 'c1'),
    ],
    (id) => (id === 'c1' ? 'My chat' : null),
  );
  assert.deepEqual(got.map((g) => g.chatTitle), ['My chat', 'Chat', 'My chat', 'My chat', 'My chat', 'My chat']);
  assert.deepEqual(got.map((g) => g.project), [
    '02 - Atwood Systems/Alpha',
    '03 - Personal/Health',
    'Notes',
    'top.md',
    '02 - Atwood Systems',
    '',
  ]);
});
