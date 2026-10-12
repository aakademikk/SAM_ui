/**
 * SAM — ticketJob.test: the ticket-job resolver (job ticket panel T3).
 * Temp folders shaped like a real job folder (brief.md plus meta.json).
 *
 * Spec: must-do 1, 9, 10; check 7.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

import { resolveTicketJob } from './ticketJob.js';

const BRIEF = 'Build every ticket in implementation/demo-tickets.md, one at a time.\n';

function makeJob(opts: { brief?: string; briefInMeta?: string; task?: string; withFile?: boolean; noCwd?: boolean }) {
  const root = tempDir('ticketjob-');
  const cwd = join(root, 'wt');
  mkdirSync(join(cwd, 'implementation'), { recursive: true });
  if (opts.withFile) writeFileSync(join(cwd, 'implementation', 'demo-tickets.md'), '## T1: A\nStatus: TODO\n');
  const jobDir = join(root, 'job');
  mkdirSync(jobDir);
  if (opts.brief !== undefined) writeFileSync(join(jobDir, 'brief.md'), opts.brief);
  const closerCtx: Record<string, string> = { task: opts.task ?? 'build' };
  if (!opts.noCwd) closerCtx.cwd = cwd;
  if (opts.briefInMeta !== undefined) {
    const original = join(root, 'original-brief.md');
    writeFileSync(original, opts.briefInMeta);
    closerCtx.brief = original;
  }
  writeFileSync(join(jobDir, 'meta.json'), JSON.stringify({ closerCtx }));
  return { jobDir, cwd };
}

test('brief names an existing tickets file in the cwd: ok with the resolved path', async () => {
  const { jobDir, cwd } = makeJob({ brief: BRIEF, withFile: true });
  assert.deepEqual(await resolveTicketJob(jobDir), {
    kind: 'ok',
    ticketsPath: join(cwd, 'implementation', 'demo-tickets.md'),
  });
});

test('brief mentions no tickets file: none', async () => {
  const { jobDir } = makeJob({ brief: 'Fix the header colour.\n', withFile: true });
  assert.deepEqual(await resolveTicketJob(jobDir), { kind: 'none' });
});

test('mentioned file absent and task is build: missing', async () => {
  const { jobDir, cwd } = makeJob({ brief: BRIEF, task: 'build' });
  assert.deepEqual(await resolveTicketJob(jobDir), {
    kind: 'missing',
    ticketsPath: join(cwd, 'implementation', 'demo-tickets.md'),
  });
});

test('mentioned file absent and task is tickets: none', async () => {
  const { jobDir } = makeJob({ brief: BRIEF, task: 'tickets' });
  assert.deepEqual(await resolveTicketJob(jobDir), { kind: 'none' });
});

test('brief.md absent: falls back to the brief closerCtx.brief points at', async () => {
  const { jobDir, cwd } = makeJob({ briefInMeta: BRIEF, withFile: true });
  assert.deepEqual(await resolveTicketJob(jobDir), {
    kind: 'ok',
    ticketsPath: join(cwd, 'implementation', 'demo-tickets.md'),
  });
});

test('brief.md wins over closerCtx.brief when both exist', async () => {
  const { jobDir } = makeJob({ brief: 'No tickets here.\n', briefInMeta: BRIEF, withFile: true });
  assert.deepEqual(await resolveTicketJob(jobDir), { kind: 'none' });
});

test('first mentioned path that exists wins over an earlier missing one', async () => {
  const { jobDir, cwd } = makeJob({
    brief: 'See implementation/old-tickets.md then implementation/demo-tickets.md.\n',
    withFile: true,
  });
  assert.deepEqual(await resolveTicketJob(jobDir), {
    kind: 'ok',
    ticketsPath: join(cwd, 'implementation', 'demo-tickets.md'),
  });
});

test('no brief anywhere, or no meta: none', async () => {
  const { jobDir } = makeJob({});
  assert.deepEqual(await resolveTicketJob(jobDir), { kind: 'none' });
  assert.deepEqual(await resolveTicketJob(join(jobDir, 'nope')), { kind: 'none' });
});
