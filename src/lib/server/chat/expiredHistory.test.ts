/**
 * Audit B-02 (T8): a chat whose transcript the CLI deleted is flagged
 * `historyExpired` in its summary; a brand-new chat with no turn yet is not.
 * HOME points at a fresh temp dir, so Colin's real ~/.claude is never read.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

test('historyExpired: true only for a chat with turns and no transcript on either seat', async () => {
  const home = tempDir('expired-history-');
  process.env.HOME = home;
  delete process.env.SAM_AGENT_CWD;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_MAX2_CONFIG_DIR = path.join(home, '.claude-max2');

  const store = await import('./chatStore.js');
  const actions = await import('./chatActions.js');
  store.__resetChatStoreForTests();
  store.setImportedAt(new Date().toISOString()); // skip the one-shot registry import

  const slug = path.join(home, 'claude').replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(home, '.claude', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'has-file.jsonl'), '{}\n');

  const mk = (id: string) =>
    store.createChat({ id, tier: 'max', account: 'main', firstMessage: 'hi', title: id });
  mk('has-file');
  mk('no-file');
  mk('brand-new');
  store.touchChat('has-file', { incrementTurns: true });
  store.touchChat('no-file', { incrementTurns: true });

  const byId = new Map(actions.listChatSummaries().map((c) => [c.id, c]));
  assert.equal(byId.get('has-file')?.historyExpired, false);
  assert.equal(byId.get('no-file')?.historyExpired, true);
  assert.equal(byId.get('brand-new')?.historyExpired, false);
});

test('historyExpired: an imported chat with turns 0 and no transcript is expired', async () => {
  const home = tempDir('expired-history-imported-');
  process.env.HOME = home;
  delete process.env.SAM_AGENT_CWD;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_MAX2_CONFIG_DIR = path.join(home, '.claude-max2');

  const store = await import('./chatStore.js');
  const actions = await import('./chatActions.js');
  store.__resetChatStoreForTests();
  store.setImportedAt(new Date().toISOString());

  store.createChat({
    id: 'imported-gone',
    tier: 'max',
    account: 'main',
    firstMessage: 'hi',
    title: 'imported-gone',
    imported: true,
  });
  store.createChat({ id: 'fresh', tier: 'max', account: 'main', firstMessage: 'hi', title: 'fresh' });

  const all = new Map(
    [...actions.listChatSummaries(), ...actions.listChatSummaries({ archived: true })].map((c) => [c.id, c]),
  );
  assert.equal(all.get('imported-gone')?.turns, 0);
  assert.equal(all.get('imported-gone')?.historyExpired, true);
  assert.equal(all.get('fresh')?.historyExpired, false);
});
