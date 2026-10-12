/**
 * SAM — sweepBuilds.test: the job-folder pruner leaves ~/.sam/builds alone
 * (job ticket panel T9, spec must-do 16).
 *
 * T1 recorded the pruner as JobManager.sweepDisk() in manager.ts, so that is
 * what runs here. Scratch HOME is set before the dynamic import because
 * manager.ts reads os.homedir() at module load.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

type ManagerModule = typeof import('./manager.js');

const home = tempDir('sweep-builds-');
let manager: ManagerModule;

const AGED = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const OLD_ID = 'job_old_20240101-000000';

before(async () => {
  process.env.HOME = home;
  const oldJob = path.join(home, '.sam', 'jobs', OLD_ID);
  fs.mkdirSync(oldJob, { recursive: true });
  fs.writeFileSync(path.join(oldJob, 'meta.json'), JSON.stringify({ id: OLD_ID, status: 'exited' }));
  fs.utimesSync(oldJob, AGED, AGED);

  const builds = path.join(home, '.sam', 'builds');
  fs.mkdirSync(path.join(builds, 'subdir'), { recursive: true });
  fs.writeFileSync(path.join(builds, 'anything.jsonl'), `{"kind":"dispatch","jobId":"${OLD_ID}"}\n`);
  fs.utimesSync(path.join(builds, 'anything.jsonl'), AGED, AGED);
  fs.utimesSync(path.join(builds, 'subdir'), AGED, AGED);

  manager = await import('./manager.js');
});

after(() => {
  manager?.getJobManager().stopSweep();
});

test('boot sweep removes an aged job folder and leaves ~/.sam/builds untouched', async () => {
  const jm = manager.getJobManager(); // the constructor starts the boot sweep
  jm.stopSweep();

  const oldJob = path.join(home, '.sam', 'jobs', OLD_ID);
  const deadline = Date.now() + 10_000;
  while (fs.existsSync(oldJob) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(fs.existsSync(oldJob), false, 'aged job folder should be pruned');

  const builds = path.join(home, '.sam', 'builds');
  const log = path.join(builds, 'anything.jsonl');
  assert.equal(fs.existsSync(log), true, 'builds log must survive');
  assert.equal(fs.existsSync(path.join(builds, 'subdir')), true, 'builds subfolder must survive');
  assert.ok(Math.abs(fs.statSync(log).mtimeMs - AGED.getTime()) < 1, 'builds log mtime unchanged');
  assert.equal(fs.readFileSync(log, 'utf8'), `{"kind":"dispatch","jobId":"${OLD_ID}"}\n`);
});
