import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '@/lib/server/testing/tempDir';

const home = tempDir('vm-home-');
const vault = tempDir('vm-vault-');
process.env.HOME = home;
process.env.SAM_VAULT_DIR = vault;

const mdText = 'intro\n\n## The **Big** `Plan`\nbody';
fs.mkdirSync(path.join(home, '.sam'), { recursive: true });
fs.mkdirSync(path.join(vault, '.git'));
fs.writeFileSync(path.join(vault, '.git', 'config'), 'c');
fs.writeFileSync(path.join(vault, 'a.md'), mdText);
fs.writeFileSync(path.join(vault, 'p.html'), '<html><head><title>Fish &amp; Chips</title></head></html>');
fs.writeFileSync(path.join(vault, 'pic.png'), 'pngdata');

const auditPath = path.join(home, '.sam', 'audit.log');
const auditLines = () =>
  fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf-8').split('\n').filter(Boolean) : [];

test('md title from first heading, emphasis stripped, size in bytes', async () => {
  const { metaFor } = await import('./vaultMeta.js');
  const m = await metaFor('a.md');
  assert.deepEqual(m, {
    path: 'a.md',
    available: true,
    kind: 'document',
    title: 'The Big Plan',
    size: Buffer.byteLength(mdText),
  });
});

test('html title with entities decoded', async () => {
  const { metaFor } = await import('./vaultMeta.js');
  const m = await metaFor('p.html');
  assert.equal(m.title, 'Fish & Chips');
  assert.equal(m.kind, 'page');
});

test('png falls back to file name', async () => {
  const { metaFor } = await import('./vaultMeta.js');
  const m = await metaFor('pic.png');
  assert.equal(m.title, 'pic.png');
  assert.equal(m.kind, 'image');
  assert.equal(m.size, 7);
});

test('missing and dot-folder paths are unavailable with one audit line each', async () => {
  const { metaFor } = await import('./vaultMeta.js');
  const before = auditLines().length;
  const a = await metaFor('nope.md');
  assert.equal(a.available, false);
  assert.equal(auditLines().length, before + 1);
  const b = await metaFor('.git/config');
  assert.equal(b.available, false);
  assert.equal(b.size, null);
  const lines = auditLines();
  assert.equal(lines.length, before + 2);
  assert.equal(JSON.parse(lines[lines.length - 1]).reason, 'dot-part');
});

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
});
