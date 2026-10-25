/**
 * SAM: finished-job row rules test (completed-jobs lists, T2).
 *
 * Pure functions, so no temp HOME or job store is needed; each case feeds a
 * hand-built `meta` value straight in.
 *
 * Spec: must-dos 4, 5, 7, 9, 10; check 3.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countedGeneral,
  isFinishedMeta,
  nameOf,
  outcomeOf,
  slugOf,
} from './finishedJobRules.js';

const ENDED = '2026-10-08T20:59:12.000Z';
const SAMPLE_ID = 'job_kitchen-r4-implement-t20_20261008-205319';

test('isFinishedMeta: each of the four finished statuses with an endedAt is finished', () => {
  for (const status of ['exited', 'failed', 'killed', 'stopped']) {
    assert.equal(isFinishedMeta({ status, endedAt: ENDED }), true, status);
  }
});

test('isFinishedMeta: queued, running, created, missing and numeric statuses are not finished', () => {
  for (const status of ['queued', 'running', 'created', undefined, 5]) {
    assert.equal(isFinishedMeta({ status, endedAt: ENDED }), false, String(status));
  }
  assert.equal(isFinishedMeta({ endedAt: ENDED }), false, 'no status key at all');
});

test('isFinishedMeta: a missing, empty or unparseable endedAt is not finished', () => {
  assert.equal(isFinishedMeta({ status: 'exited', exitCode: 0 }), false, 'missing');
  assert.equal(isFinishedMeta({ status: 'exited', endedAt: 'nonsense' }), false, 'nonsense');
  assert.equal(isFinishedMeta({ status: 'exited', endedAt: '' }), false, 'empty');
  assert.equal(isFinishedMeta({ status: 'exited', endedAt: 1760000000 }), false, 'number');
});

test('isFinishedMeta: malformed meta values never throw and are not finished', () => {
  for (const meta of [null, undefined, 'exited', 42, [], ['exited']]) {
    assert.equal(isFinishedMeta(meta), false, JSON.stringify(meta));
  }
});

test('outcomeOf: exited 0 passed; exited 1 or null, and failed, are failed; killed and stopped are stopped', () => {
  assert.equal(outcomeOf({ status: 'exited', exitCode: 0 }), 'passed');
  assert.equal(outcomeOf({ status: 'exited', exitCode: 1 }), 'failed');
  assert.equal(outcomeOf({ status: 'exited', exitCode: null }), 'failed');
  assert.equal(outcomeOf({ status: 'exited' }), 'failed', 'no exitCode');
  assert.equal(outcomeOf({ status: 'exited', exitCode: '0' }), 'failed', 'string "0" is not 0');
  assert.equal(outcomeOf({ status: 'failed', exitCode: 0 }), 'failed');
  assert.equal(outcomeOf({ status: 'killed' }), 'stopped');
  assert.equal(outcomeOf({ status: 'stopped' }), 'stopped');
});

test('outcomeOf: malformed meta never throws and is never passed', () => {
  for (const meta of [null, undefined, 7, 'exited', []]) {
    assert.equal(outcomeOf(meta), 'failed', JSON.stringify(meta));
  }
});

test('countedGeneral: null, absent, unknown and non-string generals do not count', () => {
  assert.equal(countedGeneral({ general: null }), null, 'null');
  assert.equal(countedGeneral({}), null, 'absent');
  assert.equal(countedGeneral({ general: 'zeus' }), null, 'zeus');
  assert.equal(countedGeneral({ general: 5 }), null, 'number');
  assert.equal(countedGeneral({ general: 'Hephaestus' }), null, 'wrong case');
  assert.equal(countedGeneral(null), null, 'null meta');
});

test('countedGeneral: each of the five Generals and sam count as themselves', () => {
  for (const id of ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus', 'sam']) {
    assert.equal(countedGeneral({ general: id }), id);
  }
});

test('countedGeneral: a fleet: command is never used as a fallback', () => {
  assert.equal(countedGeneral({ general: null, command: 'fleet:hermes (sonnet) brief' }), null);
});

test('slugOf: strips the job_ prefix and the timestamp tail', () => {
  assert.equal(slugOf(SAMPLE_ID), 'kitchen-r4-implement-t20');
});

test('slugOf: an id with no timestamp tail keeps everything after the prefix', () => {
  assert.equal(slugOf('job_quick-fix'), 'quick-fix');
  assert.equal(slugOf('job_build_2026'), 'build_2026', 'a short numeric tail is not a timestamp');
});

test('nameOf: uses summary and never any text from command', () => {
  const command = 'CMDMARKER-xyzzy sam-job --general hephaestus';
  const name = nameOf(SAMPLE_ID, {
    summary: 'Kitchen R4 implement T20',
    command,
    general: 'hephaestus',
  });
  assert.equal(name, 'Kitchen R4 implement T20');
  assert.ok(!name.includes('CMDMARKER'), 'command text leaked into the name');
  assert.ok(!name.includes('xyzzy'), 'command text leaked into the name');
});

test('nameOf: no summary falls back to the slug, never the command', () => {
  const name = nameOf(SAMPLE_ID, { command: 'CMDMARKER-xyzzy' });
  assert.equal(name, 'kitchen-r4-implement-t20');
  assert.ok(!name.includes('CMDMARKER'));
});

test('nameOf: a whitespace-only or non-string summary falls back to the slug', () => {
  assert.equal(nameOf(SAMPLE_ID, { summary: '   \n\t' }), 'kitchen-r4-implement-t20');
  assert.equal(nameOf(SAMPLE_ID, { summary: 12 }), 'kitchen-r4-implement-t20');
  assert.equal(nameOf(SAMPLE_ID, null), 'kitchen-r4-implement-t20');
});
