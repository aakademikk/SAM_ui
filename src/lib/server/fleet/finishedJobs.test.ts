/**
 * SAM: finished-jobs store scan test (completed-jobs lists, T4).
 *
 * Every case builds a fixture store under a throwaway HOME
 * (`<home>/.sam/jobs/<dir>/meta.json`, plus `cmd.sh` for sam-job directories)
 * and never reads the real `~/.sam/jobs`. The module resolves its store from
 * `os.homedir()` at call time, so each test points HOME at its own store and
 * resets the cache. File access is counted by spying on `fs.promises`, the
 * object the module calls through.
 *
 * The verdict cases (T5) drop `closer.json` records into fixture directories
 * and move the clock with mocked `Date`, so "past the memo" is real elapsed
 * time to the module, for the scan memo and the verdict memory alike.
 *
 * Spec: must-dos 7, 8, 10, 13, 14, 15, 16; checks 1, 2, 5, 6, 8, 9.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';
import type { FinishedJob } from '@/types/finishedJobs';
import type { GeneralId } from '@/types/floor';

import { CLOSER_FILE, MAX_READ_BYTES } from './closerRecord.js';
import {
  MAX_INFLIGHT_OPENS,
  MEMO_TTL_MS,
  finishedJobsTestHooks,
  getFleetFinished,
  getGeneralFinished,
  resetFinishedJobsCache,
  scanFinishedJobs,
} from './finishedJobs.js';

const GENERALS: readonly GeneralId[] = ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'];
const T0 = Date.parse('2026-10-20T08:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/** A fresh, empty store under a new HOME, with the module's memory cleared. */
function freshStore(prefix: string): string {
  const home = tempDir(prefix);
  process.env.HOME = home;
  resetFinishedJobsCache();
  const root = path.join(home, '.sam', 'jobs');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Points HOME at an existing store and clears the module's memory. */
function pointAtStore(root: string): void {
  process.env.HOME = path.dirname(path.dirname(root));
  resetFinishedJobsCache();
}

/** A sam-job directory: `cmd.sh`, `meta.json`, plus output files the scan must never open. */
function samJob(root: string, id: string, meta: Record<string, unknown>): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cmd.sh'), `${String(meta.command ?? 'true')}\n`);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, ...meta }));
  fs.writeFileSync(path.join(dir, 'stdout.log'), 'output\n');
  fs.writeFileSync(path.join(dir, 'claude-stream.jsonl'), '{}\n');
}

/** A chat-turn directory: `meta.json` and output, no `cmd.sh`. */
function chatTurn(root: string, id: string, meta: Record<string, unknown>): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, ...meta }));
  fs.writeFileSync(path.join(dir, 'stdout.log'), 'output\n');
}

function done(
  general: unknown,
  status: string,
  exitCode: number | null,
  endedMin: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    command: 'claude -p "work"',
    status,
    exitCode,
    createdAt: at(endedMin - 5),
    startedAt: at(endedMin - 5),
    endedAt: at(endedMin),
    summary: null,
    ...extra,
  };
  if (general !== undefined) meta.general = general;
  return meta;
}

function running(general: unknown, status = 'running'): Record<string, unknown> {
  return {
    command: 'claude -p "work"',
    status,
    exitCode: null,
    createdAt: at(0),
    startedAt: status === 'running' ? at(0) : null,
    endedAt: null,
    general,
  };
}

/** A sam-job style id with a UTC `_YYYYMMDD-HHMMSS` tail. */
function stampId(slug: string, ms: number): string {
  const iso = new Date(ms).toISOString();
  return `job_${slug}_${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

const ids = (rows: FinishedJob[]) => rows.map((r) => r.id);

interface FsLog {
  readdirs: number;
  /** Paths passed to `open`, one per call. */
  opens: string[];
  readFiles: string[];
  /** Paths passed to `access` or `stat`. */
  probes: string[];
  /** Bytes read through each opened file, by path. */
  bytes: Map<string, number>;
  inFlight: number;
  highWater: number;
  clear(): void;
}

/** Spies on every `fs.promises` call the module could use to touch the store. */
function spyFs(t: TestContext): FsLog {
  const log: FsLog = {
    readdirs: 0,
    opens: [],
    readFiles: [],
    probes: [],
    bytes: new Map(),
    inFlight: 0,
    highWater: 0,
    clear() {
      log.readdirs = 0;
      log.opens = [];
      log.readFiles = [];
      log.probes = [];
      log.bytes = new Map();
      log.highWater = log.inFlight;
    },
  };

  const realOpen = fsp.open;
  const realReaddir = fsp.readdir;
  const realReadFile = fsp.readFile;
  const realAccess = fsp.access;
  const realStat = fsp.stat;

  t.mock.method(fsp, 'open', (async (...args: Parameters<typeof fsp.open>) => {
    const file = String(args[0]);
    log.opens.push(file);
    log.inFlight += 1;
    log.highWater = Math.max(log.highWater, log.inFlight);
    let handle: fsp.FileHandle;
    try {
      handle = await realOpen(...args);
    } catch (err) {
      log.inFlight -= 1;
      throw err;
    }
    const realRead = handle.read.bind(handle) as (...a: unknown[]) => Promise<{ bytesRead: number }>;
    const realClose = handle.close.bind(handle);
    const wrapped = handle as unknown as {
      read: (...a: unknown[]) => Promise<{ bytesRead: number }>;
      close: () => Promise<void>;
    };
    wrapped.read = async (...a: unknown[]) => {
      const res = await realRead(...a);
      log.bytes.set(file, (log.bytes.get(file) ?? 0) + res.bytesRead);
      return res;
    };
    wrapped.close = async () => {
      log.inFlight -= 1;
      return realClose();
    };
    return handle;
  }) as typeof fsp.open);
  t.mock.method(fsp, 'readdir', ((...args: Parameters<typeof fsp.readdir>) => {
    log.readdirs += 1;
    return realReaddir(...args);
  }) as typeof fsp.readdir);
  t.mock.method(fsp, 'readFile', ((...args: Parameters<typeof fsp.readFile>) => {
    log.readFiles.push(String(args[0]));
    return realReadFile(...args);
  }) as typeof fsp.readFile);
  t.mock.method(fsp, 'access', ((...args: Parameters<typeof fsp.access>) => {
    log.probes.push(String(args[0]));
    return realAccess(...args);
  }) as typeof fsp.access);
  t.mock.method(fsp, 'stat', ((...args: Parameters<typeof fsp.stat>) => {
    log.probes.push(String(args[0]));
    return realStat(...args);
  }) as typeof fsp.stat);

  return log;
}

const meta = (root: string, id: string) => path.join(root, id, 'meta.json');

test('check 1: only finished jobs of the five Generals and SAM, newest finish first, at most 10', async () => {
  const root = freshStore('finished-check1-');

  // Twelve counted finished jobs; the oldest two fall off the fleet list.
  samJob(root, 'job_sam-old_20261020-080100', done('sam', 'exited', 0, 1));
  samJob(root, 'job_hermes-old_20261020-080200', done('hermes', 'exited', 0, 2));
  samJob(root, 'job_calliope-a_20261020-080300', done('calliope', 'failed', 1, 3));
  samJob(root, 'job_prometheus-a_20261020-080400', done('prometheus', 'exited', 0, 4));
  samJob(root, 'job_sam-b_20261020-080500', done('sam', 'stopped', null, 5));
  samJob(root, 'job_h-stopped_20261020-080600', done('hephaestus', 'stopped', null, 6));
  samJob(root, 'job_h-killed_20261020-080700', done('hephaestus', 'killed', null, 7));
  samJob(root, 'job_h-failed_20261020-080800', done('hephaestus', 'failed', 1, 8));
  samJob(root, 'job_h-failnull_20261020-080900', done('hephaestus', 'exited', null, 9));
  samJob(root, 'job_h-fail1_20261020-081000', done('hephaestus', 'exited', 1, 10));
  samJob(
    root,
    'job_h-pass_20261020-081100',
    done('hephaestus', 'exited', 0, 11, {
      summary: 'Build the kitchen site',
      command: 'claude -p "RECOGNISABLE-COMMAND-TEXT"',
    }),
  );
  // Started before every other job, finished after all of them.
  samJob(
    root,
    'job_early-late_20261020-050000',
    done('cerberus', 'exited', 0, 20, { createdAt: at(-180), startedAt: at(-180) }),
  );

  // None of these may appear, though most finished after every counted job.
  samJob(root, 'job_h-running_20261020-081200', running('hephaestus'));
  samJob(root, 'job_c-queued_20261020-081300', running('cerberus', 'queued'));
  samJob(root, 'job_null-general_20261020-083000', done(null, 'exited', 0, 30));
  samJob(root, 'job_absent-general_20261020-083100', done(undefined, 'exited', 0, 31));
  samJob(root, 'job_zeus_20261020-083200', done('zeus', 'exited', 0, 32));
  samJob(root, 'job_bad-ended_20261020-083300', done('hephaestus', 'exited', 0, 33, { endedAt: 'nonsense' }));
  chatTurn(root, 'job_mgturn1_0123456789abcdef_1', done('hephaestus', 'exited', 0, 34));
  chatTurn(root, 'job_mgturn2_0123456789abcdef_2', done(undefined, 'exited', 0, 35));
  chatTurn(root, 'job_mgturn3_0123456789abcdef_3', done('sam', 'failed', 1, 36));
  samJob(root, 'notes', done('hephaestus', 'exited', 0, 37)); // not a `job_` directory

  const { fleet, byGeneral } = await scanFinishedJobs();

  assert.deepEqual(ids(fleet), [
    'job_early-late_20261020-050000',
    'job_h-pass_20261020-081100',
    'job_h-fail1_20261020-081000',
    'job_h-failnull_20261020-080900',
    'job_h-failed_20261020-080800',
    'job_h-killed_20261020-080700',
    'job_h-stopped_20261020-080600',
    'job_sam-b_20261020-080500',
    'job_prometheus-a_20261020-080400',
    'job_calliope-a_20261020-080300',
  ]);
  assert.deepEqual(
    fleet.map((r) => r.outcome),
    ['passed', 'passed', 'failed', 'failed', 'failed', 'stopped', 'stopped', 'stopped', 'passed', 'failed'],
  );
  assert.deepEqual(
    fleet.map((r) => r.general),
    ['cerberus', 'hephaestus', 'hephaestus', 'hephaestus', 'hephaestus', 'hephaestus', 'hephaestus', 'sam', 'prometheus', 'calliope'],
  );
  assert.ok(fleet.every((r) => r.verdict === null));
  assert.equal(fleet[0].endedAt, at(20)); // verbatim from meta.json

  // Name: the summary, else the slug; never the command.
  assert.equal(fleet[1].name, 'Build the kitchen site');
  assert.equal(fleet[2].name, 'h-fail1');
  assert.ok(!JSON.stringify(fleet).includes('RECOGNISABLE-COMMAND-TEXT'));

  // A General's last five, never SAM's jobs; older than the fleet's ten is fine.
  assert.deepEqual(ids(byGeneral('hephaestus')), [
    'job_h-pass_20261020-081100',
    'job_h-fail1_20261020-081000',
    'job_h-failnull_20261020-080900',
    'job_h-failed_20261020-080800',
    'job_h-killed_20261020-080700',
  ]);
  assert.deepEqual(ids(byGeneral('hermes')), ['job_hermes-old_20261020-080200']);
  assert.deepEqual(ids(byGeneral('cerberus')), ['job_early-late_20261020-050000']);
  for (const general of GENERALS) {
    const rows = byGeneral(general);
    assert.ok(rows.length <= 5, general);
    assert.ok(rows.every((r) => r.general === general), general);
  }
});

test('ties on endedAt are broken by id, descending', async () => {
  const root = freshStore('finished-ties-');
  samJob(root, 'job_a_20261020-080000', done('hermes', 'exited', 0, 1));
  samJob(root, 'job_c_20261020-080000', done('hermes', 'exited', 0, 1));
  samJob(root, 'job_b_20261020-080000', done('hermes', 'exited', 0, 1));
  const { fleet } = await scanFinishedJobs();
  assert.deepEqual(ids(fleet), ['job_c_20261020-080000', 'job_b_20261020-080000', 'job_a_20261020-080000']);
});

// The 30 sam-job directories of checks 2 and 8: 3 running, 2 with no General,
// 25 counted finished jobs spread over the five Generals and SAM.
const RUNNING_30 = ['job_run-a_20261021-090000', 'job_run-b_20261021-090100', 'job_run-c_20261021-090200'];

function write30(root: string): void {
  samJob(root, RUNNING_30[0], running('hephaestus'));
  samJob(root, RUNNING_30[1], running('sam'));
  samJob(root, RUNNING_30[2], running(null));
  samJob(root, 'job_none-a_20261021-080000', done(null, 'exited', 0, 500));
  samJob(root, 'job_none-b_20261021-080100', done(null, 'failed', 1, 501));
  const owners = [...GENERALS, 'sam'];
  for (let i = 0; i < 25; i++) {
    const id = `job_work-${String(i).padStart(2, '0')}_20261021-07${String(i).padStart(2, '0')}00`;
    // Finish order deliberately unlike id order.
    samJob(root, id, done(owners[i % owners.length], i % 4 === 0 ? 'failed' : 'exited', 0, (i * 7) % 25));
  }
}

let big: string | null = null;

/** The 30 sam-job directories plus 5000 chat-turn directories, built once. */
function bigStore(): string {
  if (big !== null) {
    pointAtStore(big);
    return big;
  }
  const root = freshStore('finished-big-');
  write30(root);
  for (let i = 0; i < 5000; i++) {
    chatTurn(root, `job_mg${i.toString(36)}_0123456789abcdef_${i}`, done(undefined, 'exited', 0, 600 + (i % 50)));
  }
  big = root;
  return root;
}

const isChat = (file: string) => path.basename(path.dirname(file)).startsWith('job_mg');

test('check 2: 5000 chat turns plus 30 sam-job directories give the same 10 jobs, each chat meta.json opened once', async (t) => {
  const small = freshStore('finished-30-');
  write30(small);
  const alone = await scanFinishedJobs();
  assert.equal(alone.fleet.length, 10);

  bigStore();
  const log = spyFs(t);
  const withChat = await scanFinishedJobs();

  assert.deepEqual(withChat.fleet, alone.fleet);
  for (const general of GENERALS) assert.deepEqual(withChat.byGeneral(general), alone.byGeneral(general));

  const chatOpens = new Map<string, number>();
  for (const file of log.opens.filter(isChat)) chatOpens.set(file, (chatOpens.get(file) ?? 0) + 1);
  assert.equal(chatOpens.size, 5000);
  assert.ok([...chatOpens.values()].every((n) => n === 1));
  assert.ok([...chatOpens.keys()].every((file) => path.basename(file) === 'meta.json'));
});

test('check 8: a cold scan of 5000 directories, then polls that open only running and new directories', async (t) => {
  const root = bigStore();
  const dirCount = fs.readdirSync(root).length;
  const log = spyFs(t);

  // First call: one listing, at most one meta.json open per directory, no
  // output files, at most 16 open at once and nothing read past 16 KB.
  const first = await scanFinishedJobs();
  assert.equal(log.readdirs, 1);
  assert.equal(log.opens.length, dirCount);
  assert.equal(new Set(log.opens).size, dirCount);
  assert.ok(log.opens.every((file) => path.basename(file) === 'meta.json'));
  assert.ok(!log.opens.some((file) => /stdout\.log|claude-stream\.jsonl/.test(file)));
  assert.deepEqual(log.readFiles, []);
  assert.ok(log.highWater <= MAX_INFLIGHT_OPENS, `high-water ${log.highWater}`);
  assert.ok(log.highWater > 1, 'reads overlap');
  assert.equal(log.inFlight, 0);
  assert.ok([...log.bytes.values()].every((n) => n <= MAX_READ_BYTES));
  // A chat turn costs its meta.json open and nothing more.
  assert.ok(!log.probes.some(isChat));
  assert.equal(finishedJobsTestHooks.cacheSize(), dirCount);

  // Second call, nothing changed: one listing and the running directories only.
  finishedJobsTestHooks.expireMemo();
  log.clear();
  const second = await scanFinishedJobs();
  assert.equal(log.readdirs, 1);
  assert.deepEqual([...log.opens].sort(), RUNNING_30.map((id) => meta(root, id)).sort());
  assert.deepEqual(log.readFiles, []);
  assert.deepEqual(second.fleet, first.fleet);

  // One new directory: that one additional open, and it lands on top.
  const fresh = 'job_fresh_20261021-100000';
  samJob(root, fresh, done('calliope', 'exited', 0, 9000));
  finishedJobsTestHooks.expireMemo();
  log.clear();
  const third = await scanFinishedJobs();
  assert.equal(log.readdirs, 1);
  assert.deepEqual([...log.opens].sort(), [...RUNNING_30, fresh].map((id) => meta(root, id)).sort());
  assert.equal(third.fleet[0].id, fresh);
  assert.equal(finishedJobsTestHooks.cacheSize(), dirCount + 1);
  fs.rmSync(path.join(root, fresh), { recursive: true });
});

test('check 9: a directory deleted between polls is forgotten', async (t) => {
  const root = freshStore('finished-prune-');
  samJob(root, 'job_keep_20261020-080000', done('hermes', 'exited', 0, 1));
  samJob(root, 'job_gone_20261020-080100', done('hermes', 'exited', 0, 2));
  samJob(root, 'job_run_20261020-080200', running('hermes'));
  chatTurn(root, 'job_mgkeep_0123456789abcdef_1', done(undefined, 'exited', 0, 3));
  chatTurn(root, 'job_mggone_0123456789abcdef_2', done(undefined, 'exited', 0, 4));
  fs.mkdirSync(path.join(root, 'not-a-job'));

  const jobDirs = () => fs.readdirSync(root).filter((name) => name.startsWith('job_')).length;
  const before = await scanFinishedJobs();
  assert.deepEqual(ids(before.fleet), ['job_gone_20261020-080100', 'job_keep_20261020-080000']);
  assert.equal(finishedJobsTestHooks.cacheSize(), jobDirs());

  fs.rmSync(path.join(root, 'job_gone_20261020-080100'), { recursive: true });
  fs.rmSync(path.join(root, 'job_mggone_0123456789abcdef_2'), { recursive: true });
  fs.rmSync(path.join(root, 'job_run_20261020-080200'), { recursive: true });
  finishedJobsTestHooks.expireMemo();
  const log = spyFs(t);
  const after = await scanFinishedJobs();
  assert.deepEqual(ids(after.fleet), ['job_keep_20261020-080000']);
  assert.equal(finishedJobsTestHooks.cacheSize(), jobDirs());
  assert.equal(finishedJobsTestHooks.cacheSize(), 2);
  assert.deepEqual(log.opens, []);
});

test('memo: a call within the memo window, or alongside a scan in flight, does not touch the disk again', async (t) => {
  const root = freshStore('finished-memo-');
  samJob(root, 'job_one_20261020-080000', done('prometheus', 'exited', 0, 1));
  const log = spyFs(t);

  const [a, b] = await Promise.all([scanFinishedJobs(), scanFinishedJobs()]);
  assert.equal(a, b);
  assert.equal(log.readdirs, 1);

  log.clear();
  const c = await scanFinishedJobs();
  assert.equal(c, a);
  assert.equal(log.readdirs, 0);
  assert.deepEqual(log.opens, []);
});

test('a running job is re-read each poll, then listed once finished and not read again', async (t) => {
  const root = freshStore('finished-running-');
  const id = 'job_slow_20261020-080000';
  samJob(root, id, running('hephaestus'));
  const log = spyFs(t);

  assert.deepEqual((await scanFinishedJobs()).fleet, []);
  samJob(root, id, done('hephaestus', 'exited', 0, 10, { summary: 'Slow build' }));
  finishedJobsTestHooks.expireMemo();
  const { fleet, byGeneral } = await scanFinishedJobs();
  assert.deepEqual(ids(fleet), [id]);
  assert.equal(byGeneral('hephaestus')[0].name, 'Slow build');

  finishedJobsTestHooks.expireMemo();
  log.clear();
  await scanFinishedJobs();
  assert.deepEqual(log.opens, []);
  // cmd.sh was checked once, while running, and never again.
  assert.ok(log.probes.length === 0);
});

test('an unreadable meta.json is retried while the job is young, and skipped for good when old', async (t) => {
  const root = freshStore('finished-unreadable-');
  const young = stampId('half-written', Date.now() - 60_000);
  const oldBad = 'job_broken_20261001-080000';
  const oldBig = 'job_huge_20261001-090000';

  fs.mkdirSync(path.join(root, young));
  fs.writeFileSync(path.join(root, young, 'cmd.sh'), 'true\n'); // sam-job writes this before meta.json
  fs.mkdirSync(path.join(root, oldBad));
  fs.writeFileSync(path.join(root, oldBad, 'cmd.sh'), 'true\n');
  fs.writeFileSync(path.join(root, oldBad, 'meta.json'), '{"status": "exi');
  // Valid JSON, but over the read cap: it is cut short and so unreadable.
  samJob(root, oldBig, done('hermes', 'exited', 0, 1, { summary: 'x'.repeat(MAX_READ_BYTES + 4000) }));

  const log = spyFs(t);
  assert.deepEqual((await scanFinishedJobs()).fleet, []);
  assert.deepEqual([...log.opens].sort(), [meta(root, oldBad), meta(root, oldBig), meta(root, young)].sort());
  assert.ok((log.bytes.get(meta(root, oldBig)) ?? 0) <= MAX_READ_BYTES);

  // Next poll: only the young directory is tried again.
  finishedJobsTestHooks.expireMemo();
  log.clear();
  await scanFinishedJobs();
  assert.deepEqual(log.opens, [meta(root, young)]);

  // Once its meta.json is complete it is listed.
  fs.writeFileSync(path.join(root, young, 'meta.json'), JSON.stringify(done('cerberus', 'exited', 0, 5)));
  finishedJobsTestHooks.expireMemo();
  assert.deepEqual(ids((await scanFinishedJobs()).fleet), [young]);
  assert.equal(finishedJobsTestHooks.cacheSize(), 3);
});

test('a missing store gives empty lists and does not throw', async () => {
  const root = freshStore('finished-nostore-');
  fs.rmSync(path.dirname(root), { recursive: true });
  const { fleet, byGeneral } = await scanFinishedJobs();
  assert.deepEqual(fleet, []);
  assert.deepEqual(byGeneral('hermes'), []);
  assert.equal(finishedJobsTestHooks.cacheSize(), 0);
});

// ---- Closer verdicts (T5) ----

const V = {
  a: 'job_v-a_20261020-080100',
  b: 'job_v-b_20261020-080200',
  c: 'job_v-c_20261020-080300',
  d: 'job_v-d_20261020-080400',
  e: 'job_v-e_20261020-080500',
} as const;

/** Five finished jobs (two of Hephaestus's, one SAM's), a running job and a chat turn. */
function verdictStore(prefix: string): string {
  const root = freshStore(prefix);
  samJob(root, V.a, done('hephaestus', 'exited', 0, 1));
  samJob(root, V.b, done('hephaestus', 'failed', 1, 2));
  samJob(root, V.c, done('cerberus', 'exited', 0, 3));
  samJob(root, V.d, done('sam', 'killed', null, 4));
  samJob(root, V.e, done('hermes', 'exited', 0, 5));
  samJob(root, 'job_v-run_20261020-080600', running('hephaestus'));
  chatTurn(root, 'job_mgv_0123456789abcdef_1', done(undefined, 'exited', 0, 6));
  return root;
}

/** A closer record, as the Job Closer writes it. */
const closed = (id: string, verdict: string) => ({ jobId: id, status: 'closed', verdictKind: 'x', verdict });

let mtimeSeq = 1_800_000_000;

/** Writes `<dir>/closer.json` with a distinct mtime, so a replaced record is always seen as changed. */
function writeCloser(root: string, id: string, record: unknown): void {
  const file = path.join(root, id, CLOSER_FILE);
  fs.writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record));
  mtimeSeq += 10;
  fs.utimesSync(file, mtimeSeq, mtimeSeq);
}

/** Every path under the store with its size and mtime, to show the calls write nothing. */
function listing(root: string): string[] {
  return (fs.readdirSync(root, { recursive: true }) as string[])
    .map((rel) => {
      const st = fs.statSync(path.join(root, rel));
      return `${rel} ${st.isDirectory() ? 'dir' : st.size} ${st.mtimeMs}`;
    })
    .sort();
}

/** The clock, mocked, so a poll can be moved past the memo. */
function mockClock(t: TestContext): () => void {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  return () => t.mock.timers.tick(MEMO_TTL_MS + 1);
}

const verdictById = (rows: FinishedJob[]) => Object.fromEntries(rows.map((r) => [r.id, r.verdict]));
const closerOpens = (log: FsLog) => log.opens.filter((file) => path.basename(file) === CLOSER_FILE);

test('check 6: with no closer record anywhere every row has verdict null, on every poll', async (t) => {
  const root = verdictStore('finished-v-none-');
  const advance = mockClock(t);
  const before = listing(root);

  for (let poll = 0; poll < 3; poll++) {
    const fleet = await getFleetFinished();
    assert.deepEqual(ids(fleet), [V.e, V.d, V.c, V.b, V.a]);
    assert.ok(fleet.every((r) => r.verdict === null));
    assert.deepEqual(
      fleet.map((r) => r.outcome),
      ['passed', 'stopped', 'passed', 'failed', 'passed'],
    );
    const heph = await getGeneralFinished('hephaestus');
    assert.deepEqual(ids(heph), [V.b, V.a]);
    assert.ok(heph.every((r) => r.verdict === null));
    advance();
  }
  assert.deepEqual(listing(root), before);
});

test('check 6: a record dropped in after the job finished shows on the next poll past the memo, on that row only', async (t) => {
  const root = verdictStore('finished-v-appear-');
  const advance = mockClock(t);
  assert.ok((await getFleetFinished()).every((r) => r.verdict === null));
  assert.deepEqual(await getGeneralFinished('cerberus'), [
    { id: V.c, name: 'v-c', general: 'cerberus', endedAt: at(3), outcome: 'passed', verdict: null },
  ]);

  writeCloser(root, V.c, closed(V.c, 'PASS (3/3 checks)'));
  // A verdict that disagrees with the job's own outcome: both are kept on the row.
  writeCloser(root, V.a, closed(V.a, '  FAIL: tests  '));
  const before = listing(root);
  advance();

  const fleet = await getFleetFinished();
  assert.deepEqual(verdictById(fleet), {
    [V.e]: null,
    [V.d]: null,
    [V.c]: 'PASS (3/3 checks)',
    [V.b]: null,
    [V.a]: 'FAIL: tests',
  });
  assert.equal(fleet.find((r) => r.id === V.a)?.outcome, 'passed');
  assert.deepEqual(verdictById(await getGeneralFinished('cerberus')), { [V.c]: 'PASS (3/3 checks)' });
  assert.deepEqual(verdictById(await getGeneralFinished('hephaestus')), { [V.b]: null, [V.a]: 'FAIL: tests' });

  // The scan's own rows are left as they were: verdicts go on copies.
  assert.ok((await scanFinishedJobs()).fleet.every((r) => r.verdict === null));
  assert.deepEqual(listing(root), before);
});

test('check 6: a record that is not a valid closed record changes nothing and never rejects', async (t) => {
  const root = verdictStore('finished-v-invalid-');
  const advance = mockClock(t);
  const baseline = await getFleetFinished();

  writeCloser(root, V.a, { jobId: V.a, status: 'unclosed', verdict: 'PASS (1/1 checks)' });
  writeCloser(root, V.b, { jobId: V.b, verdict: 'FAIL: tests' }); // no status
  writeCloser(root, V.d, closed(V.d, 'pass (1/1 checks)')); // lower case
  writeCloser(root, V.e, '{"status": "closed", "verdict": "PA');
  fs.mkdirSync(path.join(root, V.c, CLOSER_FILE)); // a directory, not a file
  const before = listing(root);

  for (let poll = 0; poll < 2; poll++) {
    advance();
    assert.deepEqual(await getFleetFinished(), baseline);
    assert.ok((await getGeneralFinished('hephaestus')).every((r) => r.verdict === null));
  }
  assert.deepEqual(listing(root), before);
});

test('a replaced record shows its new verdict; an unchanged one costs one stat and no read', async (t) => {
  const root = verdictStore('finished-v-change-');
  const advance = mockClock(t);
  const file = path.join(root, V.a, CLOSER_FILE);
  writeCloser(root, V.a, closed(V.a, 'FAIL: tests'));
  assert.equal(verdictById(await getFleetFinished())[V.a], 'FAIL: tests');

  // Unchanged: a stat of the one valid record, no closer.json opened.
  const log = spyFs(t);
  advance();
  assert.equal(verdictById(await getFleetFinished())[V.a], 'FAIL: tests');
  assert.deepEqual(log.probes.filter((p) => path.basename(p) === CLOSER_FILE), [file]);
  assert.deepEqual(closerOpens(log).filter((p) => p === file), []);

  // Replaced with a different verdict: re-read on the next poll.
  writeCloser(root, V.a, closed(V.a, 'PASS (4/4 checks)'));
  advance();
  log.clear();
  const fleet = await getFleetFinished();
  assert.equal(verdictById(fleet)[V.a], 'PASS (4/4 checks)');
  assert.deepEqual(closerOpens(log).filter((p) => p === file), [file]);
  assert.ok(fleet.filter((r) => r.id !== V.a).every((r) => r.verdict === null));

  // Removed: back to "no record", learnt from the stat alone.
  fs.rmSync(file);
  advance();
  log.clear();
  assert.equal(verdictById(await getFleetFinished())[V.a], null);
  assert.deepEqual(closerOpens(log).filter((p) => p === file), []);

  // A job directory that goes is forgotten by the verdict memory too.
  assert.equal(finishedJobsTestHooks.verdictCacheSize(), 5);
  fs.rmSync(path.join(root, V.a), { recursive: true });
  advance();
  assert.deepEqual(ids(await getFleetFinished()), [V.e, V.d, V.c, V.b]);
  assert.equal(finishedJobsTestHooks.verdictCacheSize(), 4);
});

test('closer.json is opened once per returned row only, on a store of 30 finished jobs', async (t) => {
  const root = freshStore('finished-v-30-');
  const advance = mockClock(t);
  const owners = [...GENERALS, 'sam'];
  const all: string[] = [];
  for (let i = 0; i < 30; i++) {
    const id = `job_fin-${String(i).padStart(2, '0')}_20261021-07${String(i).padStart(2, '0')}00`;
    samJob(root, id, done(owners[i % owners.length], 'exited', 0, i));
    all.push(id);
  }
  // Valid records on the newest job and on one that falls off the fleet list.
  writeCloser(root, all[29], closed(all[29], 'PASS (2/2 checks)'));
  writeCloser(root, all[0], closed(all[0], 'FAIL: tests'));
  const before = listing(root);
  const log = spyFs(t);

  const fleet = await getFleetFinished();
  assert.equal(fleet.length, 10);
  assert.deepEqual(
    closerOpens(log).sort(),
    fleet.map((r) => path.join(root, r.id, CLOSER_FILE)).sort(),
  );
  assert.equal(fleet[0].verdict, 'PASS (2/2 checks)');
  assert.ok(!log.opens.some((file) => /stdout\.log|claude-stream\.jsonl|cmd\.sh/.test(file)));
  assert.ok(log.highWater <= MAX_INFLIGHT_OPENS);

  advance();
  log.clear();
  const hermes = await getGeneralFinished('hermes');
  assert.equal(hermes.length, 5);
  assert.deepEqual(
    closerOpens(log).sort(),
    hermes.map((r) => path.join(root, r.id, CLOSER_FILE)).sort(),
  );
  assert.equal(hermes[4].id, all[0]);
  assert.equal(hermes[4].verdict, 'FAIL: tests');
  assert.deepEqual(listing(root), before);
});
