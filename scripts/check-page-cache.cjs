#!/usr/bin/env node
'use strict';

/**
 * SAM — live check: app pages are never cacheable, static chunks still are.
 *
 * 2026-10-14: the prerendered /chat went out `Cache-Control: s-maxage=31536000`
 * with no `no-store`, and the A16, reopening the app from the home screen,
 * restored a pre-13-Oct copy from its HTTP cache for two days. The fix is
 * `dynamic = 'force-dynamic'` in src/app/(app)/layout.tsx; this proves it on
 * the running server. deploy.sh runs it after the health wait.
 *
 * Usage: node scripts/check-page-cache.cjs [base-url]   (default http://127.0.0.1:3000)
 * Exit 0 = pass, 1 = a page is cacheable or a check failed.
 */

const base = (process.argv[2] || `http://127.0.0.1:${process.env.SAM_UI_PORT || 3000}`).replace(/\/$/, '');
const PAGES = ['/', '/chat', '/fleet', '/jobs', '/notifications', '/settings'];

async function main() {
  let failed = 0;
  let chunk = null;

  for (const p of PAGES) {
    const res = await fetch(base + p, { redirect: 'manual' });
    const cc = res.headers.get('cache-control') || '(none)';
    const ok = /no-store/i.test(cc);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}  ${res.status}  cache-control: ${cc}`);
    if (!ok) failed++;
    if (!chunk && res.status === 200) {
      const html = await res.text();
      const m = html.match(/\/_next\/static\/chunks\/[^"']+\.js/);
      if (m) chunk = m[0];
    }
  }

  // Chunks are content-hashed per build, so they must keep their long cache.
  if (!chunk) {
    console.log('FAIL  no /_next/static chunk found in any page');
    failed++;
  } else {
    const res = await fetch(base + chunk);
    const cc = res.headers.get('cache-control') || '(none)';
    const ok = res.status === 200 && /immutable/i.test(cc);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${chunk}  ${res.status}  cache-control: ${cc}`);
    if (!ok) failed++;
  }

  // The build endpoint BuildWatch polls.
  const b = await fetch(base + '/api/build');
  let id = null;
  try { id = (await b.json())?.data?.buildId ?? null; } catch { /* not JSON */ }
  const okB = b.status === 200 && typeof id === 'string' && id.length > 0;
  console.log(`${okB ? 'PASS' : 'FAIL'}  /api/build  ${b.status}  buildId: ${id}`);
  if (!okB) failed++;

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`check-page-cache: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
