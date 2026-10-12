'use strict';

/**
 * SAM — browser check for the Notifications tab answer buttons (spec check 14).
 *
 * Same method as check-push-actions.cjs: builds the app into a COPY (never the
 * live .next), serves it on port 3998, drives Chromium at 412 x 915.
 *
 * Fixture data lives under $HOME/.cache/answer-buttons/check-tab/:
 *   SAM_PUSH_LOG              four pings (open question, answered, failed, none)
 *   SAM_JOB_STORE             three closer.json files holding the questions
 *   SAM_CLOSER_ANSWER_PY      the staged closer_answer.py.next, in an overlay
 *                             with the live modules, dispatch and push stubbed
 *   HOME                      a scratch home, so the app's own session key and
 *                             credential store are fresh and throwaway
 * The session cookie is minted through the app's own session code
 * (createSessionCookies) compiled from the copy and run against that scratch
 * home. It is held in memory only and never printed.
 *
 * Usage: node scripts/check-answer-tab.cjs
 *   CHECK_PAGE_FROM=<git ref>  build with the notifications page from that ref
 *                              (HEAD before the ticket shows the FAIL lines).
 * Prints PASS/FAIL per assertion; BLOCKED line if it cannot run.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const root = path.join(os.homedir(), '.cache', 'answer-buttons', 'check-tab');
const copy = path.join(root, 'build');
const fixture = path.join(root, 'fixture');
const CLOSER = '/home/col/.sam/closer';
const CHROME = '/home/col/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const PORT = 3998;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? ` (${detail})` : ''}`);
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || '').slice(-600)}`);
  }
  return r;
}

const Q = {
  open: 'q_aaaa1111',
  done: 'q_bbbb2222',
  fail: 'q_cccc3333',
};

function question(id, state, result) {
  return {
    id,
    kind: 'yesno',
    text: `Question text for ${id}`,
    options: ['Accept', 'Decline'],
    source: 'check',
    gated: false,
    acceptAction: 'none',
    state,
    createdAt: '2026-10-09T09:00:00Z',
    answeredAt: state === 'open' ? null : '2026-10-09T09:30:00Z',
    answeredVia: state === 'open' ? null : 'tab',
    result,
  };
}

function writeFixture() {
  fs.rmSync(fixture, { recursive: true, force: true });
  const store = path.join(fixture, 'jobs');
  const jobs = {
    job_open: question(Q.open, 'open', null),
    job_done: question(Q.done, 'accepted', 'Accepted'),
    job_fail: question(Q.fail, 'failed', 'the seat guard refused it'),
  };
  for (const [job, q] of Object.entries(jobs)) {
    fs.mkdirSync(path.join(store, job), { recursive: true });
    fs.writeFileSync(path.join(store, job, 'closer.json'), JSON.stringify({ questions: [q] }));
  }
  fs.mkdirSync(path.join(fixture, 'home'), { recursive: true });

  const now = Date.now();
  const ping = (n, title, jobId, questionId, chatId) => ({
    id: `n${n}`,
    ts: now - n * 60000,
    title,
    body: `body ${n}`,
    url: '/notifications',
    tag: `t${n}`,
    chatId: chatId || null,
    jobId,
    questionId,
  });
  const lines = [
    ping(1, 'PING-OPEN', 'job_open', Q.open),
    ping(2, 'PING-DONE', 'job_done', Q.done),
    ping(3, 'PING-FAIL', 'job_fail', Q.fail),
    ping(4, 'PING-PLAIN', 'job_plain', null),
    ping(5, 'PING-CHAT', null, null, 'chat9'),
  ];
  // The oldest-first log: write reversed so n1 is newest.
  fs.writeFileSync(path.join(fixture, 'push-log.jsonl'), lines.reverse().map((l) => JSON.stringify(l)).join('\n') + '\n');

  const stub = path.join(fixture, 'stub.sh');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // Overlay: the live closer modules with each staged .next over its real name.
  const overlay = path.join(fixture, 'overlay');
  fs.mkdirSync(overlay);
  for (const f of fs.readdirSync(CLOSER)) {
    if (f.endsWith('.py') || f === 'unblock-brief.md') fs.copyFileSync(path.join(CLOSER, f), path.join(overlay, f));
  }
  for (const f of fs.readdirSync(CLOSER)) {
    if (f.endsWith('.py.next')) fs.copyFileSync(path.join(CLOSER, f), path.join(overlay, f.slice(0, -5)));
  }
  if (!fs.existsSync(path.join(overlay, 'closer_answer.py'))) throw new Error('closer_answer.py.next missing');
  return { store, stub, answerPy: path.join(overlay, 'closer_answer.py'), home: path.join(fixture, 'home') };
}

/** Compile the app's own session + store modules from the copy and mint the
 *  session cookie against the scratch home. Returns [{name, value}]. */
function mintCookie(home) {
  const out = path.join(copy, '.mint'); // inside the copy so jose resolves
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const cfg = path.join(copy, 'tsconfig.mint.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      extends: './tsconfig.test.json',
      compilerOptions: { outDir: out, rootDir: 'src/lib/server/auth', noEmit: false },
      include: ['src/lib/server/auth/session.ts', 'src/lib/server/auth/store.ts'],
    }),
  );
  run(path.join(copy, 'node_modules/.bin/tsc'), ['-p', cfg], { cwd: copy });
  const code = `
    (async () => {
      const store = require(${JSON.stringify(path.join(out, 'store.js'))});
      await store.getCredentialStore().add({
        credentialId: 'check-credential', publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0,
        transports: ['internal'], deviceName: 'check', createdAt: new Date().toISOString(),
      });
      const auth = require(${JSON.stringify(path.join(out, 'session.js'))});
      const cookies = await auth.createSessionCookies({ sub: 'check-credential', device: 'pc', iat: 0 });
      const c = cookies.find((x) => x.startsWith(auth.SESSION_COOKIE + '='));
      const [name, ...rest] = c.split(';')[0].split('=');
      process.stdout.write(JSON.stringify({ name, value: rest.join('=') }));
    })().catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });
  `;
  const r = run('node', ['-e', code], { cwd: copy, env: { ...process.env, HOME: home } });
  return JSON.parse(r.stdout);
}

async function main() {
  let server = null;
  let browser = null;
  try {
    const fx = writeFixture();
    fs.rmSync(copy, { recursive: true, force: true });
    fs.mkdirSync(copy, { recursive: true });
    run('rsync', ['-a', '--exclude=node_modules', '--exclude=.next', '--exclude=.git', '--exclude=.test-build', repo + '/', copy + '/']);
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(copy, 'node_modules'));
    const from = process.env.CHECK_PAGE_FROM;
    if (from) {
      const rel = 'src/app/(app)/notifications/page.tsx';
      const src = run('git', ['show', `${from}:${rel}`], { cwd: repo }).stdout;
      fs.writeFileSync(path.join(copy, rel), src);
      console.log(`building with the notifications page from ${from}`);
    }
    console.log('building in the copy (slow)...');
    run('npm', ['run', 'build'], { cwd: copy, maxBuffer: 1 << 28 });

    const cookie = mintCookie(fx.home);

    server = spawn(path.join(copy, 'node_modules/.bin/next'), ['start', '-p', String(PORT), '-H', '127.0.0.1'], {
      cwd: copy,
      stdio: 'ignore',
      env: {
        ...process.env,
        HOME: fx.home,
        SAM_PUSH_LOG: path.join(fixture, 'push-log.jsonl'),
        SAM_JOB_STORE: fx.store,
        SAM_CLOSER_ANSWER_PY: fx.answerPy,
        SAM_DISPATCH_BIN: fx.stub,
        SAM_PUSH_BIN: fx.stub,
      },
    });
    const base = `http://127.0.0.1:${PORT}`;
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try {
        up = (await fetch(`${base}/sw.js`)).ok;
      } catch {}
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) throw new Error('server did not come up');

    const { chromium } = require('/home/col/3d-render/node_modules/playwright-core');
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await context.addCookies([{ name: cookie.name, value: cookie.value, url: base }]);
    const page = await context.newPage();
    const posts = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/questions/answer')) posts.push(r.postData());
    });
    await page.goto(`${base}/notifications`, { waitUntil: 'load' });
    await page.waitForSelector('text=PING-PLAIN', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__noReload = 'still-here'; });

    const row = (title) => page.locator('li', { hasText: title });
    const t = { timeout: 3000 };
    async function visible(loc) {
      try {
        await loc.first().waitFor({ state: 'visible', ...t });
        return true;
      } catch {
        return false;
      }
    }

    // 1. Open row: text, Accept and Decline (44 px or more).
    const open = row('PING-OPEN');
    const hasText = await visible(open.getByText(`Question text for ${Q.open}`));
    const accept = open.getByRole('button', { name: 'Accept' });
    const decline = open.getByRole('button', { name: 'Decline' });
    const hasAccept = await visible(accept);
    const hasDecline = await visible(decline);
    check('open row shows its question text', hasText);
    check('open row shows Accept and Decline', hasAccept && hasDecline);
    let tall = false;
    if (hasAccept && hasDecline) {
      const a = await accept.boundingBox();
      const d = await decline.boundingBox();
      tall = a.height >= 44 && a.width >= 44 && d.height >= 44 && d.width >= 44;
    }
    check('Accept and Decline tap targets are 44 px or more', tall);

    // 2. Press Accept: the row becomes Accepted, no reload, one POST.
    if (hasAccept) await accept.click();
    const accepted = await visible(open.locator('[data-question-state="accepted"]'));
    const marker = await page.evaluate(() => window.__noReload).catch(() => null);
    check('pressing Accept updates the row to Accepted', accepted && (await open.innerText()).includes('Accepted'));
    check('the page did not reload', marker === 'still-here');
    check('the endpoint received exactly one POST', posts.length === 1, `got ${posts.length}`);
    let body = {};
    try { body = JSON.parse(posts[0] || '{}'); } catch {}
    check(
      'the POST carried jobId, questionId and answer a',
      body.jobId === 'job_open' && body.questionId === Q.open && body.answer === 'a',
      JSON.stringify(body),
    );
    const onDisk = JSON.parse(fs.readFileSync(path.join(fx.store, 'job_open', 'closer.json'), 'utf8'));
    check('closer.json now says accepted', onDisk.questions[0].state === 'accepted', onDisk.questions[0].state);
    check('the answered row has no buttons after the update', (await open.getByRole('button').count()) === 0);

    // 3. Answered row: label, no buttons.
    const done = row('PING-DONE');
    check('an answered row shows Accepted', await visible(done.locator('[data-question-state="accepted"]')));
    check('an answered row has no buttons', (await done.getByRole('button').count()) === 0);

    // 4. Failed row: the reason, no buttons.
    const fail = row('PING-FAIL');
    check('a failed row shows its reason', await visible(fail.getByText('the seat guard refused it')));
    check('a failed row has no buttons', (await fail.getByRole('button').count()) === 0);

    // 5. Pings with no question: same link target as notificationTarget, no extras.
    const plain = row('PING-PLAIN');
    const plainHref = await plain.locator('a').first().getAttribute('href').catch(() => null);
    check('a ping with no question links to /jobs/<jobId>', plainHref === '/jobs/job_plain', String(plainHref));
    const chat = row('PING-CHAT');
    const chatHref = await chat.locator('a').first().getAttribute('href').catch(() => null);
    check('a chat ping links to /chat?c=<id>', chatHref === '/chat?c=chat9', String(chatHref));
    check(
      'a ping with no question has no buttons or question block',
      (await plain.getByRole('button').count()) === 0 && (await plain.locator('[data-question-state]').count()) === 0,
    );
    check('answered, open and plain rows keep their links', (await open.locator('a').count()) === 1 && (await done.locator('a').count()) === 1);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGTERM');
    fs.rmSync(copy, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log(failures ? `FAILED ${failures}` : 'ALL PASS');
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.log(`FAIL  script error: ${e.message}`);
  process.exitCode = 1;
});
