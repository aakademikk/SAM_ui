import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '@/lib/server/testing/tempDir';

const vault = tempDir('vw-vault-');
process.env.SAM_VAULT_DIR = vault;
const opsFile = path.join(vault, 'Named Operations.md');
process.env.SAM_OPERATIONS_PATH = opsFile;
const prioFile = path.join(vault, 'Active Priorities.md');

import { setTaskDone } from '@/lib/server/taskMetrics';
import { setOperationVariables, recordRun, parseOperations } from '@/lib/server/operations';
import { editVaultFile } from '@/lib/server/vaultWrite';
import type { DailyTask } from '@/types/dashboard';

const PRIO = '## Now\n\n- [ ] Ship the thing\n- [ ] Other\n\n## Next\n\n- [ ] Later thing\n';
const OPS = [
  '# Named Operations',
  '',
  '### Operation Bait the Hook — loop',
  '',
  '**Trigger:** go',
  '',
  '## Run log',
  '',
  '### Operation Bait the Hook',
  '- old run',
  '',
].join('\n');

const noTmp = () =>
  assert.deepEqual(
    fs.readdirSync(vault).filter((f) => f.endsWith('.tmp')),
    [],
  );

/**
 * Simulates another writer: right after the first read of `target` returns,
 * appends a line to it (once). Works against both the old direct
 * readFileSync/writeFileSync code and the new helper.
 */
function appendAfterFirstRead(target: string, line: string): () => void {
  const orig = fs.readFileSync;
  let done = false;
  (fs as any).readFileSync = function (p: any, ...rest: any[]) {
    const out = (orig as any).call(fs, p, ...rest);
    if (!done && p === target) {
      done = true;
      fs.appendFileSync(target, line);
    }
    return out;
  };
  return () => {
    (fs as any).readFileSync = orig;
  };
}

function captureWarnings(): { msgs: string[]; restore: () => void } {
  const msgs: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void msgs.push(a.join(' '));
  return { msgs, restore: () => void (console.warn = orig) };
}

function reset() {
  fs.writeFileSync(prioFile, PRIO);
  fs.writeFileSync(opsFile, OPS);
}

const vw = (m: string[]) => m.filter((x) => x.includes('[vault-write]')).length;

test('setTaskDone keeps a line appended mid-edit', () => {
  reset();
  const undo = appendAfterFirstRead(prioFile, '- [ ] Added in Obsidian\n');
  const w = captureWarnings();
  try {
    setTaskDone({ title: 'Ship the thing' } as DailyTask, true);
  } finally {
    undo();
    w.restore();
  }
  const text = fs.readFileSync(prioFile, 'utf-8');
  assert.match(text, /- \[x\] Ship the thing/);
  assert.match(text, /Added in Obsidian/);
  assert.equal(vw(w.msgs), 1);
  noTmp();
});

test('setOperationVariables keeps a line appended mid-edit', () => {
  reset();
  const undo = appendAfterFirstRead(opsFile, '\nAppended elsewhere\n');
  const w = captureWarnings();
  let ok = false;
  try {
    ok = setOperationVariables('bait-the-hook', [{ key: 'city', value: 'Leeds' } as never]);
  } finally {
    undo();
    w.restore();
  }
  const text = fs.readFileSync(opsFile, 'utf-8');
  assert.equal(ok, true);
  assert.match(text, /- city = Leeds/);
  assert.match(text, /Appended elsewhere/);
  assert.equal(vw(w.msgs), 1);
  noTmp();
});

test('recordRun keeps a line appended mid-edit', () => {
  reset();
  const op = parseOperations(OPS)[0];
  const undo = appendAfterFirstRead(opsFile, '\nAppended elsewhere\n');
  const w = captureWarnings();
  try {
    recordRun(op, 'new run');
  } finally {
    undo();
    w.restore();
  }
  const text = fs.readFileSync(opsFile, 'utf-8');
  assert.match(text, /- new run/);
  assert.match(text, /Appended elsewhere/);
  assert.equal(vw(w.msgs), 1);
  noTmp();
});

test('editVaultFile beforeWrite hook: retry applies once, second mismatch drops the edit', () => {
  reset();
  const w = captureWarnings();
  let calls = 0;
  try {
    const ok = editVaultFile(prioFile, (t) => t + 'X\n', {
      beforeWrite: () => {
        if (calls++ === 0) fs.appendFileSync(prioFile, 'from hook\n');
      },
    });
    assert.equal(ok, true);
    let n = 0;
    const dropped = editVaultFile(prioFile, (t) => t + 'Y\n', {
      beforeWrite: () => fs.appendFileSync(prioFile, `race ${n++}\n`),
    });
    assert.equal(dropped, false);
  } finally {
    w.restore();
  }
  const text = fs.readFileSync(prioFile, 'utf-8');
  assert.match(text, /from hook/);
  assert.match(text, /X\n/);
  assert.doesNotMatch(text, /Y\n/);
  assert.equal(vw(w.msgs), 3); // retry; then retry + drop
  noTmp();
});

test('editVaultFile keeps file mode and logs (not throws) on a missing file', () => {
  reset();
  fs.chmodSync(prioFile, 0o640);
  assert.equal(
    editVaultFile(prioFile, (t) => t + 'Z\n'),
    true,
  );
  assert.equal(fs.statSync(prioFile).mode & 0o777, 0o640);
  const w = captureWarnings();
  try {
    assert.equal(
      editVaultFile(path.join(vault, 'nope.md'), (t) => t),
      false,
    );
  } finally {
    w.restore();
  }
  assert.equal(vw(w.msgs), 1);
  noTmp();
});
