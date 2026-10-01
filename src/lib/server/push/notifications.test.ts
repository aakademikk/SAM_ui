/**
 * SAM — notifications.ts: `notificationTarget`'s three cases, and
 * `readNotifications` reading newest first while skipping a corrupt line.
 *
 * Spec must-do 17, 18, 19; check 12 (automated half — the browser half is
 * T21). Together with T9's `samPush.test.ts` (which already proves a
 * no-chat ping logs a `/notifications?n=<its own id>` url), this is the
 * whole automated side of check 12.
 *
 * `process.env.HOME` and `SAM_PUSH_LOG` point at a fresh temp dir/file set
 * up in `before()`, ahead of the dynamic `import()` of the module under
 * test — `notifications.ts` resolves its log path from `os.homedir()` /
 * `SAM_PUSH_LOG` at call time rather than at module load, but importing
 * only after both are set keeps this file's pattern identical to
 * `titles.test.ts` and leaves no window where a stray call could resolve to
 * Colin's real `~/.sam/push-log.jsonl`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type NotificationsModule = typeof import('./notifications.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notifications-'));
const home = path.join(tmp, 'home');
const logFile = path.join(tmp, 'push-log.jsonl');

let notifications: NotificationsModule;

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.SAM_PUSH_LOG = logFile;
  notifications = await import('./notifications.js');
});

function entry(
  overrides: Partial<import('./notifications.js').NotificationEntry> = {},
): import('./notifications.js').NotificationEntry {
  return {
    id: 'n_1',
    ts: Date.now(),
    title: 'Title',
    body: 'Body',
    url: '/notifications?n=n_1',
    tag: 'tag',
    chatId: null,
    jobId: null,
    ...overrides,
  };
}

test('notificationTarget: a chat id wins, even with a job id also set', () => {
  const target = notifications.notificationTarget(
    entry({ chatId: '11111111-2222-3333-4444-555555555555', jobId: 'job-1' }),
  );
  assert.equal(target, '/chat?c=11111111-2222-3333-4444-555555555555');
});

test('notificationTarget: no chat but a job id opens the job output', () => {
  const target = notifications.notificationTarget(entry({ chatId: null, jobId: 'job-42' }));
  assert.equal(target, '/jobs/job-42');
});

test('notificationTarget: neither chat nor job opens the entry itself', () => {
  const target = notifications.notificationTarget(entry({ id: 'n_99', chatId: null, jobId: null }));
  assert.equal(target, '/notifications?n=n_99');
});

test('readNotifications: returns newest first and skips a corrupt line', () => {
  const lines = [
    JSON.stringify(entry({ id: 'n_1', ts: 1000 })),
    'not json at all {{{',
    JSON.stringify(entry({ id: 'n_2', ts: 2000 })),
    JSON.stringify({ id: 'n_bad_shape', ts: 3000 }), // missing required fields
    JSON.stringify(entry({ id: 'n_3', ts: 3000 })),
  ];
  fs.writeFileSync(logFile, lines.join('\n') + '\n');

  const result = notifications.readNotifications();
  assert.deepEqual(result.map((e) => e.id), ['n_3', 'n_2', 'n_1']);
});

test('readNotifications: an absent log file returns an empty list', () => {
  fs.rmSync(logFile, { force: true });
  assert.deepEqual(notifications.readNotifications(), []);
});

test('readNotifications: respects the limit, still newest first', () => {
  const lines = [1, 2, 3, 4, 5].map((n) => JSON.stringify(entry({ id: `n_${n}`, ts: n })));
  fs.writeFileSync(logFile, lines.join('\n') + '\n');

  const result = notifications.readNotifications(2);
  assert.deepEqual(result.map((e) => e.id), ['n_5', 'n_4']);
});

test('finding 13: findNotification finds an id older than readNotifications\' default newest-200 page', () => {
  // 250 entries: readNotifications()'s default limit (200) keeps only the
  // newest 200, so the oldest 50 — including n_1, this ping's own link
  // target — have already aged off that page.
  const lines = Array.from({ length: 250 }, (_, i) => JSON.stringify(entry({ id: `n_${i + 1}`, ts: i + 1 })));
  fs.writeFileSync(logFile, lines.join('\n') + '\n');

  const page = notifications.readNotifications();
  assert.equal(page.length, 200);
  assert.equal(page.some((e) => e.id === 'n_1'), false, 'n_1 must already be off the default page');

  // Before this fix there was no way to reach an entry past that page at
  // all — findNotification scans the whole log, not just the page.
  const found = notifications.findNotification('n_1');
  assert.ok(found);
  assert.equal(found?.id, 'n_1');
  assert.equal(found?.ts, 1);
});

test('finding 13: findNotification returns null for an id truly not in the log', () => {
  fs.writeFileSync(logFile, JSON.stringify(entry({ id: 'n_1' })) + '\n');
  assert.equal(notifications.findNotification('n_does_not_exist'), null);
});
