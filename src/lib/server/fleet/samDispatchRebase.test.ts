/**
 * SAM — the staged `sam-dispatch.next` keeps the live tier-to-model pins
 * (ux-fixes, rebase of the staged fleet tools).
 *
 * The staged copy was cut before the live `sam-dispatch` re-pinned Sonnet to
 * `claude-sonnet-5-5`, so installing it as-is would have silently reverted
 * that on Colin's go. This compares every `<tier>) MODEL=<id>` line in both
 * files, so any future live re-pin that the staged copy has not picked up
 * fails here instead of at install time. Once the staged copy is installed
 * the two files are identical and the test keeps passing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';

const LIVE = '/home/col/.local/bin/sam-dispatch';
const STAGED = '/home/col/.local/bin/sam-dispatch.next';

const SKIP = boxOnlySkip('the live sam-dispatch and its staged .next copy', [LIVE, STAGED]);

function modelPins(file: string): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(fable|opus|sonnet|haiku)\)\s*MODEL=(\S+)/.exec(line);
    if (m) pins[m[1]] = m[2].replace(/;;$/, '');
  }
  return pins;
}

test('sam-dispatch.next pins every tier to the same model as the live sam-dispatch', { skip: SKIP }, () => {
  const live = modelPins(LIVE);
  const staged = modelPins(STAGED);

  assert.ok(Object.keys(live).length >= 3, 'live sam-dispatch should pin at least three tiers');
  assert.deepEqual(staged, live);
});
