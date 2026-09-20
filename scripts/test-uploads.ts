/**
 * Proves the upload path guard refuses, rather than asserting that it does.
 *
 * The guard is the only thing standing between `attachments: [...]` on the chat
 * route and an arbitrary-file read, so it gets a test that deliberately feeds it
 * the attacks. A check that has never fired is a comment.
 *
 * Run:  bash scripts/run-test-uploads.sh
 * (Compiled through the project's own tsc first — this box's node is not built
 * with type-stripping, and testing a hand-copied JS mirror would prove nothing
 * about the shipped source.)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import {
  resolveUploadPath,
  resolveAttachment,
  safeLabel,
  typeAllowed,
  generatedName,
  sweepUploads,
} from '../src/lib/server/uploads';

// Set before the first call: uploadsRoot() reads the environment at call time,
// not at import time, so a static import above is safe.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-uploads-test-'));
process.env.SAM_UPLOADS_DIR = ROOT;

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ---- fixtures ---------------------------------------------------------- */

const dayDir = path.join(ROOT, '2026-09-19');
fs.mkdirSync(dayDir, { recursive: true, mode: 0o700 });

const realUpload = path.join(dayDir, '1758300000000-ab12cd34.jpg');
fs.writeFileSync(realUpload, 'jpeg bytes');

// A sibling directory whose name shares a prefix with the root. This is the
// case a naive `startsWith(root)` check waves through.
const evilSibling = `${ROOT}-evil`;
fs.mkdirSync(evilSibling, { recursive: true });
const evilFile = path.join(evilSibling, 'secret.jpg');
fs.writeFileSync(evilFile, 'not yours');

const outsideFile = path.join(os.tmpdir(), 'sam-uploads-test-outside.txt');
fs.writeFileSync(outsideFile, 'outside');

/* ---- the guard --------------------------------------------------------- */

console.log('\nresolveUploadPath — must ACCEPT');

check('a real file inside the uploads root', () => {
  assert.equal(resolveUploadPath(realUpload), realUpload);
});

console.log('\nresolveUploadPath — must REFUSE');

check('a path outside the root entirely', () => {
  assert.equal(resolveUploadPath(outsideFile), null);
});

check('traversal out of the root', () => {
  assert.equal(resolveUploadPath(path.join(dayDir, '../../../../etc/passwd')), null);
});

check('a sibling directory sharing the root prefix', () => {
  assert.equal(resolveUploadPath(evilFile), null);
});

check('a relative path', () => {
  assert.equal(resolveUploadPath('2026-09-19/1758300000000-ab12cd34.jpg'), null);
});

check('the root directory itself', () => {
  assert.equal(resolveUploadPath(ROOT), null);
});

check('a directory inside the root, not a file', () => {
  assert.equal(resolveUploadPath(dayDir), null);
});

check('a file that does not exist', () => {
  assert.equal(resolveUploadPath(path.join(dayDir, 'nope.jpg')), null);
});

check('a non-string', () => {
  assert.equal(resolveUploadPath({ path: realUpload }), null);
  assert.equal(resolveUploadPath(undefined), null);
  assert.equal(resolveUploadPath(''), null);
});

check('a shell-style path with a null byte', () => {
  assert.equal(resolveUploadPath(`${realUpload}\u0000.png`), null);
});

/* ---- the attachment entry ---------------------------------------------- */

console.log('\nresolveAttachment');

check('keeps the name Colin picked, not the generated one', () => {
  const got = resolveAttachment({ path: realUpload, name: 'Q3 report (final).jpg' });
  assert.deepEqual(got, { path: realUpload, name: 'Q3 report (final).jpg' });
});

check('still accepts a bare string from a stale client chunk', () => {
  assert.deepEqual(resolveAttachment(realUpload), {
    path: realUpload,
    name: '1758300000000-ab12cd34.jpg',
  });
});

check('strips a traversal smuggled in through the name', () => {
  const got = resolveAttachment({ path: realUpload, name: '../../.ssh/id_rsa' });
  assert.equal(got?.name, 'id_rsa');
  assert.equal(got?.path, realUpload);
});

check('falls back to the basename when the name is unusable', () => {
  for (const name of [undefined, '', '   ', '..', '...', '///', 42, null]) {
    const got = resolveAttachment({ path: realUpload, name });
    assert.equal(got?.name, '1758300000000-ab12cd34.jpg', `name was ${String(name)}`);
  }
});

check('refuses an object pointing outside the root', () => {
  assert.equal(resolveAttachment({ path: outsideFile, name: 'ok.jpg' }), null);
});

check('refuses a directory dressed up as an attachment', () => {
  assert.equal(resolveAttachment({ path: dayDir, name: 'ok.jpg' }), null);
});

check('refuses an object with no path', () => {
  assert.equal(resolveAttachment({ name: 'ok.jpg' }), null);
  assert.equal(resolveAttachment({ path: 42, name: 'ok.jpg' }), null);
  assert.equal(resolveAttachment(null), null);
});

check('refuses a null byte in the path even with a good name', () => {
  assert.equal(resolveAttachment({ path: `${realUpload}\u0000.png`, name: 'ok.jpg' }), null);
});

/* ---- the label --------------------------------------------------------- */

console.log('\nsafeLabel');

check('strips directory traversal to a bare name', () => {
  assert.equal(safeLabel('../../.ssh/authorized_keys'), 'authorized_keys');
});

check('strips a windows-style path', () => {
  assert.equal(safeLabel('C:\\Users\\col\\.ssh\\id_rsa'), 'id_rsa');
});

check('removes control characters', () => {
  assert.equal(safeLabel('in\u001b[31mvoice\u0007.jpg'), 'in[31mvoice.jpg');
});

check('keeps ordinary punctuation', () => {
  assert.equal(safeLabel('Q3 report (final) — v2.pdf'.replace('—', '-')), 'Q3 report (final) - v2.pdf');
});

check('falls back when there is nothing left', () => {
  assert.equal(safeLabel(''), 'file');
  assert.equal(safeLabel('..'), 'file');
  assert.equal(safeLabel('   '), 'file');
});

check('honours a caller-supplied fallback', () => {
  assert.equal(safeLabel('..', ''), '');
});

/* ---- the type allow-list ---------------------------------------------- */

console.log('\ntypeAllowed');

check('accepts an iPhone photo and video by type', () => {
  assert.equal(typeAllowed('image/heic', 'IMG_0001.HEIC'), true);
  assert.equal(typeAllowed('video/quicktime', 'IMG_0002.MOV'), true);
});

check('accepts by extension when the browser sends no type', () => {
  assert.equal(typeAllowed('', 'notes.md'), true);
});

check('refuses executables and scripts', () => {
  assert.equal(typeAllowed('application/x-msdownload', 'setup.exe'), false);
  assert.equal(typeAllowed('', 'payload.sh'), false);
  assert.equal(typeAllowed('application/x-sh', 'run'), false);
});

/* ---- the generated name ------------------------------------------------ */

console.log('\ngeneratedName');

check('never carries the client name through', () => {
  const name = generatedName('holiday photo.jpg', 'image/jpeg');
  assert.match(name, /^\d+-[0-9a-f]{8}\.jpg$/);
});

check('supplies an extension when the client had none', () => {
  assert.match(generatedName('image', 'image/jpeg'), /\.jpg$/);
  assert.match(generatedName('clip', 'video/quicktime'), /\.mov$/);
});

check('refuses to carry an unrecognised extension through', () => {
  assert.match(generatedName('thing.exe', 'image/png'), /\.png$/);
});

/* ---- retention --------------------------------------------------------- */

async function retention() {
  console.log('\nsweepUploads');

  const oldFile = path.join(dayDir, 'old.jpg');
  fs.writeFileSync(oldFile, 'old');
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  fs.utimesSync(oldFile, new Date(old), new Date(old));

  const oldDay = path.join(ROOT, '2026-01-01');
  fs.mkdirSync(oldDay, { recursive: true });
  const oldDayFile = path.join(oldDay, 'ancient.jpg');
  fs.writeFileSync(oldDayFile, 'ancient');
  fs.utimesSync(oldDayFile, new Date(old), new Date(old));

  // A stray file in the root, which is not ours to delete.
  const stray = path.join(ROOT, 'not-a-day-folder.txt');
  fs.writeFileSync(stray, 'leave me');

  const removed = await sweepUploads(7);

  check('deletes a file past the window', () => {
    assert.equal(fs.existsSync(oldFile), false);
  });

  check('keeps a file inside the window', () => {
    assert.equal(fs.existsSync(realUpload), true);
  });

  check('removes a day folder it emptied', () => {
    assert.equal(fs.existsSync(oldDay), false);
  });

  check('leaves a non-day-folder entry alone', () => {
    assert.equal(fs.existsSync(stray), true);
  });

  check('reports what it removed', () => {
    assert.equal(removed, 2);
  });
}

/* ---- run --------------------------------------------------------------- */

retention()
  .catch((err: unknown) => {
    failed += 1;
    console.log(`  FAIL  sweepUploads threw: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.rmSync(evilSibling, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  });
