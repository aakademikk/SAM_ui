import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { stagedOrLive } from '@/lib/server/testing/stagedOrLive';
import { tempDir } from '@/lib/server/testing/tempDir';

function withEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.SAM_TEST_STAGED;
  if (value === undefined) delete process.env.SAM_TEST_STAGED;
  else process.env.SAM_TEST_STAGED = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.SAM_TEST_STAGED;
    else process.env.SAM_TEST_STAGED = prev;
  }
}

const dir = tempDir('staged-or-live-');
const staged = path.join(dir, 'tool.next');
const live = path.join(dir, 'tool');
fs.writeFileSync(staged, '');
fs.writeFileSync(live, '');

test('env unset: returns live even when staged exists', () => {
  withEnv(undefined, () => assert.equal(stagedOrLive(staged, live), live));
});

test('SAM_TEST_STAGED=0: returns live', () => {
  withEnv('0', () => assert.equal(stagedOrLive(staged, live), live));
});

test('SAM_TEST_STAGED=1: returns staged when it exists', () => {
  withEnv('1', () => assert.equal(stagedOrLive(staged, live), staged));
});

test('SAM_TEST_STAGED=1 but staged missing: returns live', () => {
  withEnv('1', () => assert.equal(stagedOrLive(path.join(dir, 'missing.next'), live), live));
});
