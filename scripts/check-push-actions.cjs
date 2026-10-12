'use strict';

/**
 * SAM — browser check for the answer buttons on a push (spec check 3).
 *
 * Builds the app into a COPY (never the live .next), serves it on a random
 * free port, registers the real service worker in Chromium (412 x 915),
 * delivers pushes with ServiceWorker.deliverPushMessage and reads
 * registration.getNotifications().
 *
 * Usage: node scripts/check-push-actions.cjs
 *   CHECK_SW_FROM=<git ref>  build the copy with src/app/sw.ts from that ref
 *                            (HEAD shows the "before" FAIL).
 * Prints PASS/FAIL per assertion. Prints a BLOCKED line if the worker file
 * needs a login to be fetched (nothing is minted, no env file is read).
 * Copy: $HOME/.cache/answer-buttons/build-t15/, removed at the end.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const copy = path.join(os.homedir(), '.cache', 'answer-buttons', 'build-t15');
const CHROME = '/home/col/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? ` (${detail})` : ''}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || '').slice(-600)}`);
  }
  return r;
}

async function main() {
  let server = null;
  let browser = null;
  try {
    fs.rmSync(copy, { recursive: true, force: true });
    fs.mkdirSync(copy, { recursive: true });
    run('rsync', ['-a', '--exclude=node_modules', '--exclude=.next', '--exclude=.git', repo + '/', copy + '/']);
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'));
    if (process.env.CHECK_SW_FROM) {
      const src = run('git', ['show', `${process.env.CHECK_SW_FROM}:src/app/sw.ts`], { cwd: repo }).stdout;
      fs.writeFileSync(path.join(copy, 'src/app/sw.ts'), src);
      console.log(`building with sw.ts from ${process.env.CHECK_SW_FROM}`);
    }
    console.log('building in the copy (slow)...');
    run('npm', ['run', 'build'], { cwd: copy, maxBuffer: 1 << 28 });

    const port = await freePort();
    console.log(`serving the copy on port ${port}`);
    server = spawn(path.join(copy, 'node_modules/.bin/next'), ['start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: copy,
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${base}/sw.js`);
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const swRes = await fetch(`${base}/sw.js`, { redirect: 'manual' });
    if (!swRes.ok) {
      console.log(`BLOCKED: /sw.js answered ${swRes.status} without a login; unblock: a signed-in session for the worker registration (not minted here)`);
      process.exitCode = 2;
      return;
    }

    const { chromium } = require('/home/col/3d-render/node_modules/playwright-core');
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
    await context.grantPermissions(['notifications'], { origin: base });
    const page = await context.newPage();
    await page.goto(`${base}/offline`, { waitUntil: 'load' });

    const cdp = await context.newCDPSession(page);
    const regIds = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      for (const r of e.registrations) regIds.push(r.registrationId);
    });
    await cdp.send('ServiceWorker.enable');

    const scope = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      return r.scope;
    });
    if (!regIds.length) await new Promise((r) => setTimeout(r, 1000));
    const registrationId = regIds[regIds.length - 1];
    if (!registrationId) throw new Error(`no registration id for scope ${scope}`);

    async function deliver(payload) {
      await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        for (const n of await r.getNotifications()) n.close();
      });
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: base,
        registrationId,
        data: JSON.stringify(payload),
      });
      for (let i = 0; i < 20; i++) {
        const got = await page.evaluate(async () => {
          const r = await navigator.serviceWorker.ready;
          return (await r.getNotifications()).map((n) => ({
            tag: n.tag,
            actions: (n.actions || []).map((a) => ({ action: a.action, title: a.title })),
            data: n.data,
          }));
        });
        if (got.length) return got;
        await new Promise((r) => setTimeout(r, 250));
      }
      return [];
    }

    const q = { title: 'SAM asks', body: 'Run it?', questionId: 'q_0123abcd', jobId: 'job_t15-check' };
    const acc = { action: 'a', title: 'Accept' };
    const dec = { action: 'b', title: 'Decline' };

    const two = await deliver({ ...q, actions: [acc, dec] });
    const n = two[0] || {};
    check('one notification', two.length === 1, `got ${two.length}`);
    check('tag is q-<id>', n.tag === 'q-q_0123abcd', `tag ${n.tag}`);
    check('actions.length === 2', (n.actions || []).length === 2, `got ${(n.actions || []).length}`);
    check(
      'titles are Accept and Decline',
      JSON.stringify((n.actions || []).map((a) => a.title)) === '["Accept","Decline"]',
      JSON.stringify(n.actions),
    );
    check('data.url is /jobs/<jobId>', n.data && n.data.url === '/jobs/job_t15-check', JSON.stringify(n.data));

    const three = await deliver({ ...q, actions: [acc, dec, { action: 'a', title: 'Third' }] });
    check('three actions show two', three.length === 1 && three[0].actions.length === 2, JSON.stringify(three[0]));

    const bad = await deliver({ ...q, actions: [{ action: 'c', title: 'Nope' }, acc] });
    const ids = bad.length ? bad[0].actions.map((a) => a.action) : [];
    check('action id c is dropped', bad.length === 1 && ids.length > 0 && !ids.includes('c'), JSON.stringify(ids));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGTERM');
    fs.rmSync(copy, { recursive: true, force: true });
  }
  console.log(failures ? `FAILED ${failures}` : 'ALL PASS');
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.log(`FAIL  script error: ${e.message}`);
  process.exitCode = 1;
});
