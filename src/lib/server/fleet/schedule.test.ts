/**
 * SAM — schedule.test: `readScheduledJobs` must parse `systemctl --user
 * list-timers --all --output=json` and `crontab -l` into one honest list,
 * entirely through the injectable `run` seam — never the real systemctl or
 * crontab (see the ticket's "Do not touch").
 *
 * Fixtures below use invented, generic timer/cron names only (never
 * Colin's real unit names or crontab lines — this repo is public).
 *
 * Spec: must-do 23 (data half), 25, 27 (detection half); check 27.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readScheduledJobs, type CommandRunner } from './schedule.js';

function toMicros(date: Date): number {
  return date.getTime() * 1000;
}

function showBlock(id: string, props: [string, string | string[]][]): string {
  const lines = [`Id=${id}`];
  for (const [key, value] of props) {
    if (Array.isArray(value)) for (const v of value) lines.push(`${key}=${v}`);
    else lines.push(`${key}=${value}`);
  }
  return lines.join('\n');
}

function joinBlocks(blocks: string[]): string {
  return blocks.join('\n\n') + '\n';
}

interface TimerFixture {
  unit: string;
  service: string;
  last: number | null; // epoch ms, null = never (entry.last = 0)
  next: number | null; // epoch ms, null = n/a (entry.next = 0)
  timerProps: [string, string | string[]][];
  serviceProps: [string, string | string[]][];
}

function buildRun(timers: TimerFixture[], cron: { output?: string; failWith?: string }): CommandRunner {
  const listJson = JSON.stringify(
    timers.map((t) => ({
      unit: t.unit,
      activates: t.service,
      last: t.last == null ? 0 : toMicros(new Date(t.last)),
      next: t.next == null ? 0 : toMicros(new Date(t.next)),
    })),
  );
  const timerShow = joinBlocks(timers.map((t) => showBlock(t.unit, t.timerProps)));
  const serviceShow = joinBlocks(timers.map((t) => showBlock(t.service, t.serviceProps)));

  return async (cmd: string, args: string[]) => {
    if (cmd === 'systemctl' && args[1] === 'list-timers') return listJson;
    if (cmd === 'systemctl' && args[1] === 'show') {
      const propsArg = args[args.indexOf('-p') + 1] ?? '';
      if (propsArg.includes('TimersCalendar')) return timerShow;
      if (propsArg.includes('Result')) return serviceShow;
      return '';
    }
    if (cmd === 'crontab' && args[0] === '-l') {
      if (cron.failWith) throw new Error(cron.failWith);
      return cron.output ?? '';
    }
    throw new Error(`unexpected stub command: ${cmd} ${args.join(' ')}`);
  };
}

const now = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('a daily timer parses to the right plain-words schedule and next run', async () => {
  const nextRun = new Date(now + 6 * HOUR);
  const lastRun = new Date(now - 18 * HOUR);
  const run = buildRun(
    [
      {
        unit: 'demo-vault-rebuild.timer',
        service: 'demo-vault-rebuild.service',
        last: lastRun.getTime(),
        next: nextRun.getTime(),
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* 06:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
          ['ExecStart', '{ path=/usr/bin/true ; argv[]=/usr/bin/true }'],
        ],
      },
    ],
    {},
  );

  const jobs = await readScheduledJobs(run);
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal(job.kind, 'timer');
  assert.equal(job.id, 'demo-vault-rebuild.timer');
  assert.equal(job.name, 'demo-vault-rebuild');
  assert.equal(job.schedulePlain, 'Daily at 06:00');
  assert.equal(job.cadence, 'daily');
  assert.equal(job.nextRun, nextRun.toISOString());
  assert.equal(job.lastRun, lastRun.toISOString());
  assert.equal(job.lastResult, 'ok');
  assert.equal(job.launchesFleetJob, false);
});

test('a frequent (every-N-minute) OnCalendar timer is classified frequent', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-quota-log.timer',
        service: 'demo-quota-log.service',
        last: now - 10 * 60_000,
        next: now + 5 * 60_000,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* *:02/15:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.cadence, 'frequent');
  assert.equal(job.schedulePlain, 'Every 15 min');
});

test('a monotonic (OnUnitActiveUSec) timer is classified by its interval', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-keepalive.timer',
        service: 'demo-keepalive.service',
        last: now - 3 * 60_000,
        next: now + 2 * 60_000,
        timerProps: [['TimersMonotonic', '{ OnUnitActiveUSec=5min ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.cadence, 'frequent');
  assert.equal(job.schedulePlain, 'Every 5 min');
});

test('a weekdays-only OnCalendar timer is classified weekday', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-outreach-send.timer',
        service: 'demo-outreach-send.service',
        last: now - DAY,
        next: now + DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=Mon..Fri *-*-* 09:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.cadence, 'weekday');
  assert.equal(job.schedulePlain, 'Weekdays at 09:00');
});

test('a single-weekday OnCalendar timer is classified weekly', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-dependency-scan.timer',
        service: 'demo-dependency-scan.service',
        last: now - 7 * DAY,
        next: now + 7 * DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=Mon *-*-* 11:20:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.cadence, 'weekly');
  assert.equal(job.schedulePlain, 'Mondays at 11:20');
});

test('a timer whose last Result is non-zero shows lastResult failed', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-lead-sweep.timer',
        service: 'demo-lead-sweep.service',
        last: now - 6 * HOUR,
        next: now + 18 * HOUR,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* 06:15:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'exit-code'],
          ['ExecMainStatus', '1'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.lastResult, 'failed');
});

test('a timer whose Result is success but ExecMainStatus is non-zero also shows failed', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-log-rotate.timer',
        service: 'demo-log-rotate.service',
        last: now - HOUR,
        next: now + DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* 00:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '2'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.lastResult, 'failed');
});

test('a timer currently running (ActiveState active/activating) shows lastResult running', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-backup-sync.timer',
        service: 'demo-backup-sync.service',
        last: now - 60_000,
        next: now + DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* *:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'activating'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.lastResult, 'running');
  assert.equal(job.cadence, 'frequent');
  assert.equal(job.schedulePlain, 'Hourly');
});

test('a timer that has never fired reports lastRun null and lastResult not recorded, honestly', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-first-run-pending.timer',
        service: 'demo-first-run-pending.service',
        last: null,
        next: now + DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* 03:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    {},
  );
  const [job] = await readScheduledJobs(run);
  assert.equal(job.lastRun, null);
  assert.equal(job.lastResult, 'not recorded');
});

test('a unit whose ExecStart contains sam-dispatch sets launchesFleetJob true', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-weekly-audit.timer',
        service: 'demo-weekly-audit.service',
        last: now - 7 * DAY,
        next: now + 7 * DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=Mon *-*-* 11:20:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
          [
            'ExecStart',
            '{ path=/home/demo/.local/bin/sam-dispatch ; argv[]=/home/demo/.local/bin/sam-dispatch --general cerberus }',
          ],
        ],
      },
      {
        unit: 'demo-ordinary.timer',
        service: 'demo-ordinary.service',
        last: now - DAY,
        next: now + DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* 02:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
          ['ExecStart', '{ path=/usr/bin/true ; argv[]=/usr/bin/true }'],
        ],
      },
    ],
    {},
  );
  const jobs = await readScheduledJobs(run);
  const audit = jobs.find((j) => j.id === 'demo-weekly-audit.timer');
  const ordinary = jobs.find((j) => j.id === 'demo-ordinary.timer');
  assert.ok(audit);
  assert.ok(ordinary);
  assert.equal(audit.launchesFleetJob, true);
  assert.equal(ordinary.launchesFleetJob, false);
});

test('a cron line shows lastRun "not recorded" and never guesses a result', async () => {
  const run = buildRun([], { output: '15 7 * * * /usr/bin/demo-task --flag\n' });
  const jobs = await readScheduledJobs(run);
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.kind, 'cron');
  assert.equal(job.lastRun, 'not recorded');
  assert.equal(job.lastResult, 'not recorded');
  assert.equal(job.schedulePlain, 'Daily at 07:15');
  assert.equal(job.cadence, 'daily');
  assert.ok(job.nextRun, 'a daily cron line must still compute a next run');
});

test('cron skips comments, blank lines and env assignments, and computes a near-term next run for "every minute"', async () => {
  const run = buildRun([], {
    output: ['# a comment', '', 'MAILTO=nobody@example.invalid', '* * * * * /usr/bin/demo-ping'].join('\n'),
  });
  const jobs = await readScheduledJobs(run);
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.cadence, 'frequent');
  assert.ok(job.nextRun);
  const nextMs = Date.parse(job.nextRun as string);
  assert.ok(nextMs > now && nextMs <= now + 70_000, 'every-minute cron must land within the next ~70s');
});

test('cron @reboot has no computable next run and is classified other', async () => {
  const run = buildRun([], { output: '@reboot /usr/bin/demo-startup-task\n' });
  const [job] = await readScheduledJobs(run);
  assert.equal(job.nextRun, null);
  assert.equal(job.cadence, 'other');
  assert.equal(job.schedulePlain, 'At reboot');
});

test('a sam-dispatch cron command sets launchesFleetJob true', async () => {
  const run = buildRun([], { output: '0 9 * * 1-5 /usr/bin/sam-dispatch --general hermes\n' });
  const [job] = await readScheduledJobs(run);
  assert.equal(job.launchesFleetJob, true);
  assert.equal(job.cadence, 'weekday');
});

test('a missing crontab ("no crontab for ...") is an empty list, not an error', async () => {
  const run = buildRun([], { failWith: 'Command failed: crontab -l\nno crontab for demo' });
  const jobs = await readScheduledJobs(run);
  assert.deepEqual(jobs, []);
});

test('systemctl list-timers failing entirely yields no timers, without throwing', async () => {
  const run: CommandRunner = async (cmd, args) => {
    if (cmd === 'systemctl' && args[1] === 'list-timers') throw new Error('systemctl: command not found');
    if (cmd === 'crontab') return '0 6 * * * /usr/bin/demo-task\n';
    throw new Error(`unexpected stub command: ${cmd} ${args.join(' ')}`);
  };
  const jobs = await readScheduledJobs(run);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'cron');
});

test('tick count equals timers plus cron entries (check 27)', async () => {
  const run = buildRun(
    [
      {
        unit: 'demo-a.timer',
        service: 'demo-a.service',
        last: now - HOUR,
        next: now + HOUR,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* *:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
      {
        unit: 'demo-b.timer',
        service: 'demo-b.service',
        last: now - DAY,
        next: now + DAY,
        timerProps: [['TimersCalendar', '{ OnCalendar=*-*-* 05:00:00 ; next_elapse=... }']],
        serviceProps: [
          ['Result', 'success'],
          ['ExecMainStatus', '0'],
          ['ActiveState', 'inactive'],
        ],
      },
    ],
    { output: ['0 6 * * * /usr/bin/demo-one', '30 18 * * * /usr/bin/demo-two'].join('\n') },
  );
  const jobs = await readScheduledJobs(run);
  assert.equal(jobs.length, 4);
  assert.equal(jobs.filter((j) => j.kind === 'timer').length, 2);
  assert.equal(jobs.filter((j) => j.kind === 'cron').length, 2);
});
