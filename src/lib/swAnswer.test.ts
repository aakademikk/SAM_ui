/**
 * SAM — notification click handling (answer buttons, T16).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleClick, type ClickDeps, type ClickEvent, type ClickWindow } from './swAnswer.js';

const ORIGIN = 'https://sam.example';
const actions = [
  { action: 'a', title: 'Accept' },
  { action: 'b', title: 'Decline' },
];
const data = { url: '/jobs/job_x', jobId: 'job_x', questionId: 'q_0123abcd', ts: 1 };

function rig(opts: { status?: number; throws?: boolean; wins?: ClickWindow[]; action: string; data?: object }) {
  const log = {
    closed: 0,
    fetches: [] as Array<{ input: string; init: RequestInit }>,
    shown: [] as Array<{ title: string; options: Record<string, unknown> }>,
    opened: [] as string[],
    focused: [] as string[],
    navigated: [] as string[],
  };
  const pending: Promise<unknown>[] = [];
  const event: ClickEvent = {
    action: opts.action,
    notification: {
      title: 'SAM asks',
      body: 'Run it?',
      tag: 'q-q_0123abcd',
      data: (opts.data ?? data) as never,
      actions,
      icon: '/i.png',
      badge: '/b.png',
      close: () => {
        log.closed++;
      },
    },
    waitUntil: (p) => {
      pending.push(p);
    },
  };
  const deps: ClickDeps = {
    fetch: async (input, init) => {
      log.fetches.push({ input, init });
      if (opts.throws) throw new Error('offline');
      const status = opts.status ?? 200;
      return { status, ok: status >= 200 && status < 300 };
    },
    showNotification: async (title, options) => {
      log.shown.push({ title, options });
    },
    matchAll: async () => opts.wins ?? [],
    openWindow: async (u) => {
      log.opened.push(u.href);
    },
    origin: ORIGIN,
  };
  handleClick(event, deps);
  return { log, done: () => Promise.all(pending) };
}

test('swAnswer: action a closes, posts once, opens nothing, shows nothing on 200', async () => {
  const { log, done } = rig({ action: 'a', status: 200 });
  await done();
  assert.equal(log.closed, 1);
  assert.equal(log.fetches.length, 1);
  const f = log.fetches[0];
  assert.equal(f.input, '/api/questions/answer');
  assert.equal(f.init.method, 'POST');
  assert.equal(f.init.credentials, 'same-origin');
  const h = f.init.headers as Record<string, string>;
  assert.equal(h['x-answer-via'], 'push');
  assert.equal(h['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(f.init.body as string), { jobId: 'job_x', questionId: 'q_0123abcd', answer: 'a' });
  assert.equal(log.opened.length, 0);
  assert.equal(log.shown.length, 0);
});

test('swAnswer: action b posts answer b', async () => {
  const { log, done } = rig({ action: 'b' });
  await done();
  assert.equal(JSON.parse(log.fetches[0].init.body as string).answer, 'b');
});

for (const [name, o] of [
  ['401', { status: 401 }],
  ['503', { status: 503 }],
  ['network error', { throws: true }],
] as const) {
  test(`swAnswer: ${name}: same notification shown again, same tag, renotify false, no window`, async () => {
    const { log, done } = rig({ action: 'a', ...o });
    await done();
    assert.equal(log.closed, 1);
    assert.equal(log.shown.length, 1);
    const s = log.shown[0];
    assert.equal(s.title, 'SAM asks');
    assert.equal(s.options.tag, 'q-q_0123abcd');
    assert.equal(s.options.renotify, false);
    assert.equal(s.options.body, 'Run it?');
    assert.deepEqual(s.options.actions, actions);
    assert.deepEqual(s.options.data, data);
    assert.equal(log.opened.length + log.focused.length + log.navigated.length, 0);
  });
}

test('swAnswer: 409 and 404 show nothing', async () => {
  for (const status of [409, 404]) {
    const { log, done } = rig({ action: 'a', status });
    await done();
    assert.equal(log.shown.length, 0);
    assert.equal(log.opened.length, 0);
  }
});

test('swAnswer: unknown action only closes', async () => {
  const { log, done } = rig({ action: 'c' });
  await done();
  assert.equal(log.closed, 1);
  assert.equal(log.fetches.length, 0);
  assert.equal(log.shown.length, 0);
  assert.equal(log.opened.length, 0);
});

test('swAnswer: a/b without jobId or questionId falls back to a body tap', async () => {
  const { log, done } = rig({ action: 'a', data: { url: '/jobs/job_x' } });
  await done();
  assert.equal(log.fetches.length, 0);
  assert.deepEqual(log.opened, [`${ORIGIN}/jobs/job_x`]);
});

function win(url: string, log: { focused: string[]; navigated: string[] }): ClickWindow {
  return {
    url,
    focus: async () => {
      log.focused.push(url);
    },
    navigate: async (u) => {
      log.navigated.push(u.pathname);
    },
  };
}

test('swAnswer: empty action: focuses a matching window, no fetch', async () => {
  const wins: ClickWindow[] = [];
  const r = rig({ action: '', wins });
  wins.push(win(`${ORIGIN}/jobs/job_x`, r.log));
  await r.done();
  assert.equal(r.log.closed, 1);
  assert.equal(r.log.fetches.length, 0);
  assert.equal(r.log.focused.length, 1);
  assert.equal(r.log.navigated.length, 0);
  assert.equal(r.log.opened.length, 0);
});

test('swAnswer: empty action: navigates another window when none matches', async () => {
  const wins: ClickWindow[] = [];
  const r = rig({ action: '', wins });
  wins.push(win(`${ORIGIN}/chat`, r.log));
  await r.done();
  assert.equal(r.log.focused.length, 1);
  assert.deepEqual(r.log.navigated, ['/jobs/job_x']);
  assert.equal(r.log.opened.length, 0);
});

test('swAnswer: empty action: opens a window when none exist; cross-origin url ignored', async () => {
  const r = rig({ action: '' });
  await r.done();
  assert.deepEqual(r.log.opened, [`${ORIGIN}/jobs/job_x`]);
  const x = rig({ action: '', data: { url: 'https://evil.example/x' } });
  await x.done();
  assert.equal(x.log.opened.length, 0);
});
