/**
 * SAM — livePaths.test: every live path follows HOME (and keeps its env
 * override), resolved per call. Code review finding 4: a harness that sets
 * only HOME must never reach the real `~/.sam` or the real vault. A path held
 * in a module-level const would fail the "second HOME" assertions below.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';

const roots: string[] = [];
const REAL_HOME = process.env.HOME;
const OVERRIDES = [
  'SAM_TASK_STATE_PATH', 'SAM_MONEY_STATE_PATH', 'SAM_OPERATIONS_PATH', 'SAM_VAULT_DIR', 'SAM_VAULT_PATH', 'SAM_PUSH_BIN',
] as const;

function freshHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-paths-'));
  roots.push(dir);
  process.env.HOME = dir;
  for (const k of OVERRIDES) delete process.env[k];
  return dir;
}

afterEach(() => {
  process.env.HOME = REAL_HOME;
  for (const k of OVERRIDES) delete process.env[k];
});
after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf-8');
}

test('livePaths: derived from HOME per call, and SAM_VAULT_DIR wins for the vault', async () => {
  const lp = await import('./livePaths.js');
  const a = freshHome();
  assert.equal(lp.samStateDir(), path.join(a, '.sam'));
  assert.equal(lp.vaultDir(), path.join(a, 'ai-memory-vault'));
  assert.equal(lp.atwoodDir(), path.join(a, 'ai-memory-vault', '02 - Atwood Systems'));
  assert.equal(lp.activePrioritiesPath(), path.join(a, 'ai-memory-vault', 'Active Priorities.md'));
  const b = freshHome();
  assert.equal(lp.samStateDir(), path.join(b, '.sam'), 'a second HOME is honoured');
  process.env.SAM_VAULT_DIR = '/elsewhere/vault';
  assert.equal(lp.vaultDir(), '/elsewhere/vault');
  assert.equal(lp.activePrioritiesPath(), '/elsewhere/vault/Active Priorities.md');
});

test('taskState and moneyState read and write under HOME/.sam, per call, with their env override', async () => {
  const a = freshHome();
  write(path.join(a, '.sam', 'daily-tasks-state.json'), JSON.stringify({
    completions: [], customTasks: [{ id: 'seed', title: 'Seeded', done: false, priority: 'p1', tag: 'x', dueAt: null, createdAt: 'now', origin: 'operator' }],
  }));
  const tasks = await import('./taskState.js');
  const money = await import('./moneyState.js');
  assert.deepEqual(tasks.getCustomTasks().map((t) => t.id), ['seed'], 'the load reads HOME/.sam');

  const task = { id: 't1', title: 'One', done: false, priority: 'p2', tag: 't', dueAt: null, createdAt: 'now', origin: 'operator' } as const;
  tasks.upsertCustomTask({ ...task });
  money.addEntry({ label: 'Job', amount: 10, date: '2026-10-01', source: 'test', recurring: false });
  assert.ok(fs.existsSync(path.join(a, '.sam', 'daily-tasks-state.json')));
  assert.ok(fs.existsSync(path.join(a, '.sam', 'money-state.json')));

  const b = freshHome();
  tasks.upsertCustomTask({ ...task, id: 't2' });
  money.addEntry({ label: 'Job 2', amount: 20, date: '2026-10-02', source: 'test', recurring: false });
  assert.ok(fs.existsSync(path.join(b, '.sam', 'daily-tasks-state.json')), 'a second HOME gets its own file');
  assert.ok(fs.existsSync(path.join(b, '.sam', 'money-state.json')));

  const taskOverride = path.join(b, 'over', 'tasks.json');
  const moneyOverride = path.join(b, 'over', 'money.json');
  process.env.SAM_TASK_STATE_PATH = taskOverride;
  process.env.SAM_MONEY_STATE_PATH = moneyOverride;
  tasks.upsertCustomTask({ ...task, id: 't3' });
  money.addEntry({ label: 'Job 3', amount: 30, date: '2026-10-03', source: 'test', recurring: false });
  assert.ok(fs.existsSync(taskOverride), 'the task env override still wins (and its directory is made)');
  assert.ok(fs.existsSync(moneyOverride), 'the money env override still wins');
});

test('operations: Named Operations.md follows HOME, and SAM_OPERATIONS_PATH wins', async () => {
  const ops = await import('./operations.js');
  const a = freshHome();
  const note = path.join(a, 'ai-memory-vault', '02 - Atwood Systems', '00_SAM_Control', 'Named Operations.md');
  write(note, '### Operation Alpha — first\n');
  ops.invalidateOperationsCache();
  assert.equal(ops.readOperations().available, true);
  const b = freshHome();
  ops.invalidateOperationsCache();
  assert.equal(ops.readOperations().available, false, 'a second HOME has no note (no module-level path)');
  write(path.join(b, 'custom.md'), '### Operation Beta — second\n');
  process.env.SAM_OPERATIONS_PATH = path.join(b, 'custom.md');
  ops.invalidateOperationsCache();
  assert.equal(ops.readOperations().available, true);
});

test('taskMetrics: Active Priorities.md follows HOME and SAM_VAULT_DIR, read and write', async () => {
  const tm = await import('./taskMetrics.js');
  const a = freshHome();
  const file = path.join(a, 'ai-memory-vault', 'Active Priorities.md');
  write(file, '## Now\n- [ ] Ship it\n');
  tm.invalidateTasksCache();
  const [task] = tm.readTasks();
  assert.equal(task.title, 'Ship it');
  tm.setTaskDone(task, true);
  assert.match(fs.readFileSync(file, 'utf-8'), /\[x\] Ship it/, 'the tick lands in the HOME vault');

  const b = freshHome();
  tm.invalidateTasksCache();
  assert.deepEqual(tm.readTasks(), [], 'a second HOME sees none of the first vault');
  const vault = path.join(b, 'other-vault');
  write(path.join(vault, 'Active Priorities.md'), '## Next\n- [ ] Elsewhere\n');
  process.env.SAM_VAULT_DIR = vault;
  tm.invalidateTasksCache();
  assert.equal(tm.readTasks()[0]?.title, 'Elsewhere');
});

test('vaultMetrics and contacts read the HOME vault', async () => {
  const a = freshHome();
  const vault = path.join(a, 'ai-memory-vault');
  write(path.join(vault, 'Notes', 'one.md'), 'hello');
  write(path.join(vault, 'People', 'Pat Example.md'), '---\nemail: pat@example.invalid\n---\n');
  const { scanVault } = await import('./vaultMetrics.js');
  const { listContacts } = await import('./contacts.js');
  assert.equal(scanVault().totalNotes, 2);
  assert.deepEqual((await listContacts()).map((c) => c.name), ['Pat Example']);
});

test('turnPing: the default push binary is under HOME; the env override still wins', async () => {
  const { pushBin } = await import('./chat/turnPing.js');
  const a = freshHome();
  assert.equal(pushBin(), path.join(a, '.local', 'bin', 'sam-push'));
  const b = freshHome();
  assert.equal(pushBin(), path.join(b, '.local', 'bin', 'sam-push'), 'a second HOME is honoured');
  process.env.SAM_PUSH_BIN = '/bin/true';
  assert.equal(pushBin(), '/bin/true');
});

test('no live path is hard-coded in the modules that read or write the vault and state', () => {
  const dir = path.join(process.cwd(), 'src', 'lib', 'server');
  const files = [
    'taskState.ts', 'moneyState.ts', 'operations.ts', 'taskMetrics.ts', 'vaultMetrics.ts', 'telemetry.ts',
    'projectMetrics.ts', 'contacts.ts', 'chat/turnPing.ts',
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf-8');
    assert.doesNotMatch(text, /['"`]\/home\/col\/(ai-memory-vault|\.sam|\.local)/, `${f} hard-codes a live path`);
  }
});
