/**
 * Usage collection (U9): run the quota harvester, then the 80% alerts.
 *
 * Called from the chat turn exit hook, so a reading reaches `runs.jsonl` (and
 * the tile) and can ping within seconds of the turn ending. The harvester only
 * reads the job store; it never runs `claude`. Nothing here throws: a chat
 * turn must not fail because the harvest did.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { runUsageAlerts } from '@/lib/server/usage/usageAlertRunner';

const HARVEST_TIMEOUT_MS = 60_000;

/** `SAM_QUOTA_LOG_BIN` (tests, the staged copy) else the live harvester. */
function harvesterBin(): string {
  return process.env.SAM_QUOTA_LOG_BIN || path.join(os.homedir(), 'bin', 'sam-quota-log.py');
}

/** Runs the harvester to completion; resolves whatever happens. */
function harvest(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const child = spawn('python3', [harvesterBin()], {
        stdio: 'ignore',
        timeout: HARVEST_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      child.on('error', (err) => {
        console.error('[usage] harvester failed to run:', err);
        finish();
      });
      child.on('close', (code) => {
        if (code !== 0) console.error('[usage] harvester exited with', code);
        finish();
      });
    } catch (err) {
      console.error('[usage] harvester failed to start:', err);
      finish();
    }
  });
}

let chain: Promise<unknown> = Promise.resolve();

/** Harvests new finished jobs, then sends any new alerts. Calls are serialised
 *  in-process, so two turns ending together run one after the other. */
export function collectUsage(): Promise<void> {
  const result = chain.then(async () => {
    await harvest();
    try {
      await runUsageAlerts();
    } catch (err) {
      console.error('[usage] alerts failed:', err);
    }
  });
  chain = result.catch(() => {});
  return result;
}
