/**
 * SAM — sweepRetention.test: the disk sweep keeps sam-job dirs for the full
 * 7-day window; the 128 count cap applies to chat-turn dirs only
 * (audit fixes 2026-10-19, T6, spec must-do 7 / check 8).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

type ManagerModule = typeof import('./manager.js');

const home = tempDir('sweep-retention-');
let manager: ManagerModule;

const DAY = 24 * 60 * 60 * 1000;
const jobs = path.join(home, '.sam', 'jobs');
const SAM_2D = 'job_x_20261018-120000';
const SAM_8D = 'job_y_20261012-120000';
const SAM_RUNNING = 'job_z_20260901-120000';
const CHAT_COUNT = 130;

function chatId(i: number): string {
  // i = 0 is the newest; all stay well inside the last hour.
  return `job_${(Date.now() - i * 1000 - 60_000).toString(36)}_c${i}`;
}

function mkdir(id: string, meta: Record<string, unknown>, ageMs: number) {
  const dir = path.join(jobs, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, ...meta }));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(dir, t, t);
}

const ids: string[] = [];

before(async () => {
  process.env.HOME = home;
  for (let i = 0; i < CHAT_COUNT; i++) {
    ids.push(chatId(i));
    mkdir(ids[i], { status: 'exited' }, 60_000);
  }
  mkdir(SAM_2D, { status: 'exited', unit: 'sam-job-a' }, 2 * DAY);
  mkdir(SAM_8D, { status: 'exited', unit: 'sam-job-b' }, 8 * DAY);
  mkdir(SAM_RUNNING, { status: 'running', unit: 'sam-job-c' }, 60_000);
  manager = await import('./manager.js');
});

after(() => {
  manager?.getJobManager().stopSweep();
});

test('count cap trims chat turns only; sam-job dirs live the full window', async () => {
  const jm = manager.getJobManager(); // constructor starts the boot sweep
  jm.stopSweep();

  const exists = (id: string) => fs.existsSync(path.join(jobs, id));
  const deadline = Date.now() + 10_000;
  while (exists(SAM_8D) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  // The sweep removes dirs in one pass; let the remaining rms finish.
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(exists(SAM_8D), false, 'sam-job dir older than 7 days is deleted');
  assert.equal(exists(SAM_2D), true, '2-day-old sam-job dir survives the count cap');
  assert.equal(exists(SAM_RUNNING), true, 'running sam-job dir touched in the window is kept');

  const kept = ids.filter(exists);
  assert.equal(kept.length, 128, 'only the newest 128 chat-turn dirs stay');
  assert.equal(exists(ids[0]), true, 'newest chat turn kept');
  assert.equal(exists(ids[129]), false, 'oldest chat turn trimmed');
});
