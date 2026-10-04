'use strict';

/**
 * SAM — `npm test` runner with a temp-leak gate.
 *
 * On 2026-10-04 the suite had left ~100 directories per run in /tmp
 * (chatstore-home-*, transcripts-home-*, sam-stage-job-*, fake-claude-*,
 * notifications-* ...) until 6.4 GB of RAM-backed /tmp had piled up. Cleaning
 * up in a global teardown would hide that; instead the suite runs with TMPDIR
 * pointed at a fresh private directory, and FAILS if anything is still in it
 * when the tests finish. A test that makes a temp dir must remove it itself
 * (after / afterEach / t.after).
 *
 * The private directory is removed whatever the outcome.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-ui-test-'));

let status = 1;
try {
  const result = spawnSync(
    process.execPath,
    [
      '--require', path.join(__dirname, 'test-alias.cjs'),
      '--test',
      ...(process.argv.length > 2 ? process.argv.slice(2) : ['.test-build/**/*.test.js']),
    ],
    { cwd: root, stdio: 'inherit', env: { ...process.env, TMPDIR: priv } },
  );
  status = result.status ?? 1;

  const left = fs.readdirSync(priv);
  if (left.length > 0) {
    process.stderr.write(
      `\nTEMP LEAK: the test run left ${left.length} entr${left.length === 1 ? 'y' : 'ies'} in its private TMPDIR.\n` +
        'A test that creates a temp directory or file must remove it (after / afterEach / t.after). Left behind:\n' +
        left.sort().map((name) => {
          const isDir = fs.lstatSync(path.join(priv, name)).isDirectory();
          return `  ${name}${isDir ? '/' : ''}`;
        }).join('\n') +
        '\n',
    );
    status = 1;
  }
} finally {
  fs.rmSync(priv, { recursive: true, force: true });
}
process.exit(status);
