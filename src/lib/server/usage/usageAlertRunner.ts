/**
 * Usage alerts: glue between the tile's readings, `decideAlerts` and the
 * phone push. A ping is recorded in `~/.sam/quota/alerts.json` only after the
 * push command exits 0, so a failed push is retried on the next call. It never
 * throws: a chat turn must not fail because an alert did.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { pushBin } from '@/lib/server/chat/turnPing';
import { quotaAlertsPath } from '@/lib/server/livePaths';
import { decideAlerts, type AlertState, type UsagePing } from '@/lib/server/usage/usageAlerts';
import { getUsage } from '@/lib/server/usage/usageRuns';

const PUSH_TIMEOUT_MS = 10_000;

function loadState(): AlertState {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(quotaAlertsPath(), 'utf8'));
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as AlertState;
  } catch {
    // Missing or corrupt: start again.
  }
  return {};
}

/** Tmp file then rename, so a crash never leaves half a file. */
function saveState(state: AlertState): void {
  const file = quotaAlertsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

/** Runs the push command and resolves true only if it exits 0 in time. */
function push(ping: UsagePing): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let child: ReturnType<typeof spawn> | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      child?.kill('SIGKILL');
      finish(false);
    }, PUSH_TIMEOUT_MS);
    try {
      child = spawn(
        pushBin(),
        ['--title', ping.title, '--body', ping.body, '--url', '/', '--tag', ping.tag],
        { stdio: 'ignore' },
      );
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}

async function run(now: number): Promise<UsagePing[]> {
  try {
    const state = loadState();
    const { pings } = decideAlerts(getUsage(now), state, now);
    const sent: UsagePing[] = [];
    const next: AlertState = {};
    for (const [seat, windows] of Object.entries(state)) next[seat] = { ...windows };
    for (const ping of pings) {
      if (!(await push(ping))) continue;
      sent.push(ping);
      next[ping.seat] = { ...next[ping.seat], [ping.window]: Date.parse(ping.resetsAt) };
    }
    if (sent.length > 0) saveState(next);
    return sent;
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();

/** Sends any new 80% pings. Calls are serialised so two turns ending together
 *  cannot double-ping. Resolves with the pings actually sent. */
export function runUsageAlerts(now: number = Date.now()): Promise<UsagePing[]> {
  const result = chain.then(() => run(now));
  chain = result.catch(() => {});
  return result;
}
