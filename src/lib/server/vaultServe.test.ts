import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '@/lib/server/testing/tempDir';

const home = tempDir('vs-home-');
const vault = tempDir('vs-vault-');
process.env.HOME = home;
process.env.SAM_VAULT_DIR = vault;
fs.mkdirSync(path.join(home, '.sam'), { recursive: true });

fs.writeFileSync(path.join(vault, 'a.md'), '# hello');
fs.writeFileSync(path.join(vault, 'page.html'), '<p>hi</p>');
fs.writeFileSync(path.join(vault, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
fs.writeFileSync(path.join(vault, 'doc.pdf'), '%PDF-1.4');
fs.writeFileSync(path.join(vault, 'x.png'), 'png');
fs.writeFileSync(path.join(vault, 'note.txt'), 'nope');

type Route = typeof import('../../app/api/vault/file/route.js');
let route: Route;
let cookie = '';

before(async () => {
  const store = await import('./auth/store.js');
  await store.getCredentialStore().add({
    credentialId: 'test-credential',
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test',
    createdAt: new Date().toISOString(),
  });
  const auth = await import('./auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const c = cookies.find((x) => x.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(c);
  cookie = c.split(';')[0];
  route = await import('../../app/api/vault/file/route.js');
});

function get(p: string, withCookie = true): Request {
  const headers: Record<string, string> = {};
  if (withCookie) headers.cookie = cookie;
  return new Request(`http://localhost/api/vault/file?path=${encodeURIComponent(p)}`, { headers });
}

test('no cookie gives 401 and no file name in the body', async () => {
  const res = await route.GET(get('a.md', false));
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes('a.md'));
});

test('serves markdown with the shared headers', async () => {
  const res = await route.GET(get('a.md'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '# hello');
  assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(res.headers.get('content-length'), '7');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('refused paths give identical 404 bodies and an audit line each', async () => {
  const bodies = new Set<string>();
  for (const p of ['nope.md', '../x', 'note.txt', '.git/config', '%2e%2e/x']) {
    const res = await route.GET(get(p));
    assert.equal(res.status, 404);
    bodies.add(await res.text());
  }
  assert.deepEqual([...bodies], ['{"error":"Not found"}']);
  const audit = fs.readFileSync(path.join(home, '.sam', 'audit.log'), 'utf-8');
  assert.equal(audit.split('\n').filter((l) => l.includes('vault-refused')).length, 5);
});

test('a missing path parameter is the same 404', async () => {
  const res = await route.GET(
    new Request('http://localhost/api/vault/file', { headers: { cookie } }),
  );
  assert.equal(res.status, 404);
  assert.equal(await res.text(), '{"error":"Not found"}');
});

test('html carries a sandbox CSP without the forbidden tokens', async () => {
  const res = await route.GET(get('page.html'));
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /sandbox/);
  assert.match(csp, /allow-scripts/);
  for (const bad of ['allow-same-origin', 'allow-popups', 'allow-forms', 'allow-top-navigation']) {
    assert.ok(!csp.includes(bad), bad);
  }
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('svg carries sandbox with no allow-scripts', async () => {
  const res = await route.GET(get('pic.svg'));
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /sandbox/);
  assert.ok(!csp.includes('allow-scripts'));
  assert.match(csp, /script-src 'none'/);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
});

test('pdf is sent as an attachment; every response is no-store', async () => {
  const pdf = await route.GET(get('doc.pdf'));
  assert.equal(pdf.headers.get('content-disposition'), 'attachment');
  for (const p of ['x.png', 'doc.pdf', 'page.html', 'pic.svg', 'a.md', 'nope.md']) {
    const res = await route.GET(get(p));
    assert.equal(res.headers.get('cache-control'), 'no-store', p);
  }
});

const video = Buffer.alloc(5000);
for (let i = 0; i < video.length; i++) video[i] = (i * 7 + 3) % 256;
fs.writeFileSync(path.join(vault, 'clip.mp4'), video);

function getRange(p: string, range: string): Request {
  return new Request(`http://localhost/api/vault/file?path=${encodeURIComponent(p)}`, {
    headers: { cookie, range },
  });
}

test('range bytes=0-1023 on an mp4 gives 206 and the first 1024 bytes', async () => {
  const res = await route.GET(getRange('clip.mp4', 'bytes=0-1023'));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-range'), 'bytes 0-1023/5000');
  assert.equal(res.headers.get('content-length'), '1024');
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.length, 1024);
  assert.ok(body.equals(video.subarray(0, 1024)));
});

test('range bytes=-100 gives the last 100 bytes', async () => {
  const res = await route.GET(getRange('clip.mp4', 'bytes=-100'));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 4900-4999/5000');
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.equals(video.subarray(4900)));
});

test('an unsatisfiable range gives 416 with Content-Range */size', async () => {
  const res = await route.GET(getRange('clip.mp4', 'bytes=9999-'));
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */5000');
  await res.arrayBuffer();
});

test('a multi-range header is answered 200 with the whole file', async () => {
  const res = await route.GET(getRange('clip.mp4', 'bytes=0-10,20-30'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.equals(video));
});

test('the module exports only GET', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((route as Record<string, unknown>)[m], undefined, m);
  }
});
