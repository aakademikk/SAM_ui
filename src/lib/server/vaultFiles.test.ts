import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '@/lib/server/testing/tempDir';

const home = tempDir('vf-home-');
const vault = tempDir('vf-vault-');
const outside = tempDir('vf-out-');
process.env.HOME = home;
process.env.SAM_VAULT_DIR = vault;

const w = (rel: string, text: string) => fs.writeFileSync(path.join(vault, rel), text);
fs.mkdirSync(path.join(home, '.sam'), { recursive: true });
fs.mkdirSync(path.join(vault, 'notes', '.secret'), { recursive: true });
fs.mkdirSync(path.join(vault, '.git'));
fs.mkdirSync(path.join(vault, '.obsidian'));
fs.mkdirSync(path.join(vault, 'proj'));
w('a.md', '# a');
w('pic.png', 'png');
w('clip.mp4', 'mp4');
w('proj/index.md', '# i');
w('proj/fig.png', 'fig');
w('x.env', 'fixture');
w('.hidden.md', 'h');
w('.git/config', 'c');
w('.obsidian/app.json', '{}');
w('notes/.secret/a.md', 's');
w('note.txt', 't');
fs.mkdirSync(path.join(vault, 'dir.md'));
fs.writeFileSync(path.join(outside, 'o.md'), 'outside');
fs.symlinkSync(path.join(outside, 'o.md'), path.join(vault, 'link.md'));

const auditPath = path.join(home, '.sam', 'audit.log');
const auditLines = () =>
  fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf-8').split('\n').filter(Boolean) : [];

const refused: Array<[string, string, string]> = [
  ['../x', '../x', 'dotdot'],
  ['encoded dots', '%2e%2e/x', 'encoded'],
  ['double encoded dots', '%252e%252e/x', 'encoded'],
  ['backslash', '..\\x', 'backslash'],
  ['absolute outside', path.join(outside, 'o.md'), 'absolute-outside'],
  ['nul', 'a\u0000.md', 'nul'],
  ['.git/config', '.git/config', 'dot-part'],
  ['.obsidian/app.json', '.obsidian/app.json', 'dot-part'],
  ['x.env', 'x.env', 'type'],
  ['.hidden.md', '.hidden.md', 'dot-part'],
  ['notes/.secret/a.md', 'notes/.secret/a.md', 'dot-part'],
  ['symlink out', 'link.md', 'symlink-outside'],
  ['note.txt', 'note.txt', 'type'],
  ['missing', 'nope.md', 'missing'],
  ['directory', 'dir.md', 'not-file'],
];

for (const [name, req, reason] of refused) {
  test(`refuses ${name}`, async () => {
    const { resolveVaultFile, refuse } = await import('./vaultFiles.js');
    const r = await resolveVaultFile(req);
    assert.deepEqual(r, { ok: false, reason });
    const before = auditLines().length;
    await refuse(req, reason);
    const lines = auditLines();
    assert.equal(lines.length, before + 1);
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.equal(entry.event, 'vault-refused');
    assert.equal(entry.reason, reason);
    assert.equal(entry.path, req);
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  });
}

test('refuses non-string and empty input', async () => {
  const { resolveVaultFile } = await import('./vaultFiles.js');
  assert.equal((await resolveVaultFile(undefined)).ok, false);
  assert.equal((await resolveVaultFile('')).ok, false);
});

test('serves md, png, mp4', async () => {
  const { resolveVaultFile } = await import('./vaultFiles.js');
  for (const [p, ext] of [['a.md', 'md'], ['pic.png', 'png'], ['clip.mp4', 'mp4']]) {
    const r = await resolveVaultFile(p);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.rel, p);
      assert.equal(r.ext, ext);
      assert.ok(r.size > 0);
      assert.equal(r.abs, path.join(fs.realpathSync(vault), p));
    }
  }
});

test('serves an absolute path inside the vault', async () => {
  const { resolveVaultFile } = await import('./vaultFiles.js');
  const r = await resolveVaultFile(path.join(vault, 'a.md'));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.rel, 'a.md');
});

test('from-relative image, then vault-root fallback', async () => {
  const { resolveVaultFile } = await import('./vaultFiles.js');
  const r = await resolveVaultFile('fig.png', { from: 'proj/index.md' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.rel, 'proj/fig.png');
  const root = await resolveVaultFile('pic.png', { from: 'proj/index.md' });
  assert.equal(root.ok, true);
  if (root.ok) assert.equal(root.rel, 'pic.png');
  assert.deepEqual(await resolveVaultFile('nope.png', { from: 'proj/index.md' }), {
    ok: false,
    reason: 'missing',
  });
});

test('from-relative ..  is refused even when it would collapse inside the vault', async () => {
  const { resolveVaultFile } = await import('./vaultFiles.js');
  assert.deepEqual(await resolveVaultFile('../pic.png', { from: 'proj/index.md' }), {
    ok: false,
    reason: 'dotdot',
  });
});

test('resolving alone writes no audit line', async () => {
  assert.equal(auditLines().length, refused.length);
});
