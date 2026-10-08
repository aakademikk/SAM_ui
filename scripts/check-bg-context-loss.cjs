'use strict';
/**
 * SAM — real-GPU regression check for the ambient background (2026-10-08).
 *
 * Loads /chat at the kiosk size, SIGKILLs this probe's OWN Chromium GPU process
 * twice 5 s apart (the effect of an NVIDIA Xid; Chrome then blocks WebGL for
 * the page), waits 3 s and reads the screen. Before the fix the lost canvas is
 * composited white: pixel (600,860) reads (255,255,255). After it, the canvas
 * is hidden and the dark ground shows. Exit 0 = pass (pixel channels all below 40 and the canvas not rendered).
 *
 * Usage: node scripts/check-bg-context-loss.cjs [url]   (default http://127.0.0.1:3000/chat)
 * Based on ~/.sam/work/samui-background/crash-probe.js. Never touches any
 * process it did not start.
 */
const fs = require('node:fs');
const { chromium } = require('/home/col/3d-render/node_modules/playwright-core');

const URL = process.argv[2] || 'http://127.0.0.1:3000/chat';
const CHROME = '/home/col/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

const ppidOf = (pid) => { try { return +fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]; } catch { return 0; } };
const isMine = (pid) => { for (let x = pid, i = 0; x > 1 && i < 10; x = ppidOf(x), i++) if (x === process.pid) return true; return false; };
const myGpuPids = () => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number).filter((pid) => {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--type=gpu-process') && isMine(pid); } catch { return false; }
});

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  let ok = false;
  try {
    const p = await (await b.newContext({ viewport: { width: 1899, height: 1070 } })).newPage();
    await p.goto(URL);
    await p.waitForTimeout(12000);
    for (let n = 1; n <= 2; n++) {
      const pids = myGpuPids();
      if (!pids.length) throw new Error(`no GPU process of our own to kill (kill ${n})`);
      pids.forEach((pid) => process.kill(pid, 'SIGKILL'));
      console.log(`kill ${n}: gpu pid ${pids.join(',')}`);
      if (n === 1) await p.waitForTimeout(5000);
    }
    await p.waitForTimeout(3000);
    const shot = await p.screenshot();
    // Read one pixel from the PNG via a canvas in the page (no image library needed).
    const px = await p.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(600, 860, 1, 1).data.slice(0, 3));
    }, shot.toString('base64'));
    const display = await p.evaluate(() => {
      const c = document.querySelector('[data-testid="vault-graph-visualiser"] canvas');
      // R3F puts Canvas's style on a wrapper div, so test whether the canvas renders at all.
      return c ? (c.getClientRects().length === 0 ? 'none' : 'shown') : 'no canvas';
    });
    console.log(`pixel (600,860) = (${px.join(',')}), canvas rendered = ${display === 'none' ? 'no' : display}`);
    ok = px.every((v) => v < 40) && display === 'none';
    console.log(ok ? 'PASS: dark ground after two GPU crashes' : 'FAIL: lost canvas still painted (white wash)');
  } finally {
    await b.close();
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
