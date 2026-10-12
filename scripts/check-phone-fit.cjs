'use strict';

/**
 * SAM — browser check that the phone top bar and the gear Settings panel fit the screen.
 *
 * Usage: node scripts/check-phone-fit.cjs <dir>
 *   <dir> is a directory that already holds a production build (<dir>/.next). It is
 *   served through the local proof harness (127.0.0.1:4950 behind the TLS proxy on
 *   4951, isolated HOME, a throwaway passkey that is revoked at the end). This
 *   script never builds and never writes to <dir>/.next of its own accord.
 *
 * At 360x800, 384x832, 390x844 and 412x915 (touch, mobile) on `/`:
 *   - no horizontal overflow (scrollWidth <= innerWidth)
 *   - every top bar control (health chip, sync badge, UTC clock, gear) is fully on screen
 *   - with the gear open, the whole panel is on screen and its last control is reachable
 *   - the same at 384 with the root font size at 130% (stands in for Android text scaling)
 *   - the More sheet at 360 and 384 does not overflow sideways
 *
 * Prints one PASS or FAIL line per assertion and a last line `RESULT PASS` or `RESULT FAIL`.
 * Exit codes: 0 = pass, 1 = fail, 2 = blocked (port 4950 already taken).
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const HARNESS = '/home/col/delivery/ux-audits/samui-local-harness';
const COMMON = '/home/col/delivery/ux-audits/floor-fixes-proofs/common.mjs';
const PORT = 4950;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? ` (${detail})` : ''}`);
}

function portTaken(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

const stopHarness = () => spawnSync('bash', [path.join(HARNESS, 'stop.sh')], { stdio: 'ignore' });

// Runs in the page. Rects are rounded to whole pixels so sub-pixel rounding never fails a fit.
function topBarReport() {
  const header = document.querySelector('.fp-top > header') || document.querySelector('header');
  const W = window.innerWidth;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const off = [];
  for (const el of header.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (Math.round(r.left) < 0 || Math.round(r.right) > W) {
      off.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 16)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
  }
  const hr = header.getBoundingClientRect();
  const gear = header.querySelector('button[aria-label="Console settings"]');
  const gr = gear && gear.getBoundingClientRect();
  const labels = [...header.querySelectorAll('.label')].filter(vis);
  const health = labels.find((l) => /health/i.test(l.textContent));
  const clock = [...header.querySelectorAll('span')].find((s) => vis(s) && /UTC/.test(s.textContent) && !s.querySelector('span span'));
  const sync = header.querySelector('span[title]');
  return {
    W,
    scrollW: document.documentElement.scrollWidth,
    headerRight: Math.round(hr.right),
    headerLeft: Math.round(hr.left),
    off,
    gear: gr ? { left: Math.round(gr.left), right: Math.round(gr.right), w: Math.round(gr.width), h: Math.round(gr.height) } : null,
    health: !!health,
    clock: !!clock,
    sync: !!(sync && vis(sync)),
  };
}

function panelReport() {
  const gear = document.querySelector('button[aria-label="Console settings"]');
  const panel = gear && gear.nextElementSibling;
  if (!panel) return null;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const p = panel.getBoundingClientRect();
  const buttons = [...panel.querySelectorAll('button')];
  const last = buttons[buttons.length - 1];
  // Scroll the last control into view inside the panel (scrolling inside the panel is allowed).
  last.scrollIntoView({ block: 'nearest' });
  const l = last.getBoundingClientRect();
  const p2 = panel.getBoundingClientRect();
  const overflowing = [];
  for (const el of panel.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (Math.round(r.right) > W || Math.round(r.left) < 0)) overflowing.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 14)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return {
    W, H,
    panel: { left: Math.round(p2.left), right: Math.round(p2.right), top: Math.round(p2.top), bottom: Math.round(p2.bottom) },
    last: { text: last.textContent.trim().slice(0, 24), top: Math.round(l.top), bottom: Math.round(l.bottom), left: Math.round(l.left), right: Math.round(l.right) },
    lastInPanel: Math.round(l.top) >= Math.round(p2.top) && Math.round(l.bottom) <= Math.round(p2.bottom),
    overflowing,
    scrollW: document.documentElement.scrollWidth,
  };
}

async function main() {
  const dir = process.argv[2] && path.resolve(process.argv[2]);
  if (!dir || !fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) {
    console.log(`FAIL  script error: ${dir || '(no dir)'} has no production build (.next/BUILD_ID); this check never builds`);
    console.log('RESULT FAIL');
    process.exitCode = 1;
    return;
  }
  if (await portTaken(PORT)) {
    console.log(`BLOCKED: port ${PORT} is already taken; unblock: stop the other harness run (bash ${HARNESS}/stop.sh) and retry`);
    process.exitCode = 2;
    return;
  }

  let browser = null;
  let state = null;
  let c = null;
  try {
    const start = spawnSync('bash', [path.join(HARNESS, 'start.sh')], {
      env: { ...process.env, SAMUI_WORKTREE: dir },
      encoding: 'utf8',
      timeout: 120000,
    });
    if (start.status !== 0) throw new Error(`harness start.sh exit ${start.status}`);
    console.log(`serving ${dir} through the harness on port ${PORT}`);

    c = await import(COMMON);
    browser = await c.launch();
    const enrolled = await c.enrol(browser);
    if (!enrolled.ok) throw new Error('throwaway passkey enrolment did not give a session');
    state = enrolled.state;

    async function open(vp, fontPct) {
      const ctx = await c.touchContext(browser, state, vp);
      const page = await ctx.newPage();
      const view = await c.openHome(page);
      if (fontPct) {
        await page.addStyleTag({ content: `html{font-size:${fontPct}% !important}` });
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(800);
      return { ctx, page, view };
    }

    async function checkPhone(vp, fontPct) {
      const tag = `${vp.width}x${vp.height}${fontPct ? ` text ${fontPct}%` : ''}`;
      const { ctx, page, view } = await open(vp, fontPct);
      try {
        check(`${tag}: phone view renders`, view === 'fp', `got ${view}`);
        const t = await page.evaluate(topBarReport);
        check(`${tag}: no horizontal overflow`, t.scrollW <= t.W, `scrollWidth ${t.scrollW} > ${t.W}`);
        check(`${tag}: health chip, sync badge, UTC clock and gear all present`, t.health && t.sync && t.clock && !!t.gear, `health ${t.health} sync ${t.sync} clock ${t.clock} gear ${!!t.gear}`);
        check(`${tag}: every top bar control inside the viewport`, t.off.length === 0 && t.headerRight <= t.W, `${t.off.join('; ')} header right ${t.headerRight}`);
        check(`${tag}: gear keeps its size (44x44 or more)`, !!t.gear && t.gear.w >= 44 && t.gear.h >= 44, JSON.stringify(t.gear));

        // A script click, so a gear that is off screen still opens its panel and the panel is measured too
        await page.evaluate(() => document.querySelector('button[aria-label="Console settings"]').click());
        await page.waitForTimeout(700);
        const p = await page.evaluate(panelReport);
        if (!p) {
          check(`${tag}: gear panel opens`, false, 'no panel after click');
          return;
        }
        check(`${tag}: gear panel inside the viewport`, p.panel.left >= 0 && p.panel.right <= p.W && p.panel.top >= 0 && p.panel.bottom <= p.H, JSON.stringify(p.panel));
        check(`${tag}: nothing in the gear panel past the screen edge`, p.overflowing.length === 0, p.overflowing.slice(0, 4).join('; '));
        check(`${tag}: gear panel last control reachable`, p.lastInPanel && p.last.bottom <= p.H && p.last.right <= p.W && p.last.left >= 0, `${JSON.stringify(p.last)} panel ${JSON.stringify(p.panel)}`);
        check(`${tag}: no horizontal overflow with the panel open`, p.scrollW <= p.W, `scrollWidth ${p.scrollW} > ${p.W}`);
      } finally {
        await ctx.close();
      }
    }

    async function checkMore(vp) {
      const tag = `${vp.width}x${vp.height}`;
      const { ctx, page } = await open(vp);
      try {
        await page.getByRole('button', { name: 'More', exact: true }).first().click();
        await page.waitForSelector('[data-sheet="more"]', { timeout: 10000 });
        await page.waitForTimeout(700);
        const m = await page.evaluate(() => {
          const sheet = document.querySelector('[data-sheet="more"]');
          const W = window.innerWidth;
          const s = sheet.getBoundingClientRect();
          const bad = [];
          for (const el of sheet.querySelectorAll('a,button')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (Math.round(r.left) < 0 || Math.round(r.right) > W)) bad.push(`${el.textContent.trim().slice(0, 14)} ${Math.round(r.left)}..${Math.round(r.right)}`);
          }
          return { W, left: Math.round(s.left), right: Math.round(s.right), links: sheet.querySelectorAll('a').length, bad, scrollW: document.documentElement.scrollWidth };
        });
        check(`${tag}: More sheet inside the viewport`, m.left >= 0 && m.right <= m.W, `${m.left}..${m.right} of ${m.W}`);
        check(`${tag}: More sheet links inside the viewport`, m.links > 0 && m.bad.length === 0, m.bad.join('; ') || 'no links');
        check(`${tag}: no horizontal overflow with the More sheet open`, m.scrollW <= m.W, `scrollWidth ${m.scrollW} > ${m.W}`);
      } finally {
        await ctx.close();
      }
    }

    const sizes = [
      { width: 360, height: 800 },
      { width: 384, height: 832 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
    ];
    const attempt = async (name, fn) => {
      try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, `script error: ${e.message.split('\n')[0]}`); }
    };
    for (const vp of sizes) await attempt(`${vp.width}x${vp.height}`, () => checkPhone(vp, 0));
    await attempt('384x832 text 130%', () => checkPhone({ width: 384, height: 832 }, 130));
    for (const vp of [sizes[0], sizes[1]]) await attempt(`${vp.width}x${vp.height} More`, () => checkMore(vp));
  } catch (e) {
    check('check ran to the end', false, `script error: ${e.message}`);
  } finally {
    if (browser) {
      if (state && c) await c.revoke(browser, state).catch(() => {});
      await browser.close().catch(() => {});
    }
    stopHarness();
  }
  console.log(failures ? 'RESULT FAIL' : 'RESULT PASS');
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  stopHarness();
  console.log(`FAIL  script error: ${e.message}`);
  console.log('RESULT FAIL');
  process.exitCode = 1;
});
