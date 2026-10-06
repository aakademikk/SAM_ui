/**
 * SAM — healthScore.test: the System Health score measures the machine
 * (services, CPU, memory), not fleet jobs. Colin, 2026-10-06: "failed jobs
 * aren't really anything to do with system". 18 of 19 failures that day were
 * seat-limit refusals, and they took about 38 points off the gauge.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const REAL_HOME = process.env.HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'health-score-'));
process.env.HOME = home;

after(() => {
  process.env.HOME = REAL_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

test('job failures do not lower the System Health score', async () => {
  const { getEstate } = await import('./telemetry.js');
  const estate = getEstate();

  estate.automationRuns24h = 100;
  estate.automationFailures24h = 0;
  const clean = estate.getSystem().overallScore;

  estate.automationFailures24h = 50;
  const failing = estate.getSystem();

  assert.equal(failing.overallScore, clean);
  // The failure rate is still reported in its own tile, just not in the score.
  assert.equal(failing.automationFailures24h, 50);
});
