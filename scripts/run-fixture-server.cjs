'use strict';

/**
 * SAM: throwaway app server over a fixture HOME (completed-jobs checks, T13).
 *
 * Usage:
 *   node scripts/run-fixture-server.cjs <HOME dir> <port>    start, wait until it answers, exit 0
 *   node scripts/run-fixture-server.cjs <HOME dir> --stop    SIGTERM the server started for <HOME dir>
 *
 * Starts the already-built app (`next start`, as the existing checks and the
 * local proof harness do) from this repo on 127.0.0.1:<port>, with HOME set
 * to <HOME dir>, so the app's job store is `<HOME dir>/.sam/jobs` (make one
 * with scripts/make-fixture-store.cjs). It never builds: with no
 * `<repo>/.next/BUILD_ID` it stops and says to run `npx next build` first, and
 * it warns when a non-test file under src/ is newer than the build.
 *
 * Once `/api/health` answers it prints `URL ...` and `PID ...` and writes the
 * pid to `<HOME dir>/.server.pid`; the server keeps running, detached, with its
 * output in `<HOME dir>/.server.log`. The pid is the node process that serves
 * the app (node runs Next's own bin directly, no npm or npx wrapper), and the
 * script checks it owns the listening socket, printing the listener's pid as
 * well if it ever differs. Stop it with `--stop` or `kill -TERM <pid>`.
 *
 * Refuses port 3000 (the live sam-ui service), any port already in use, a
 * <HOME dir> that is the real home or whose `.sam` (or any link under it)
 * resolves into the real `~/.sam`, and a second server for the same dir.
 * It never touches sam-ui.service. Isolation of the child:
 *   - HOME is the fixture dir; the env overrides the proof harness sets
 *     (task, money and operations state) point inside it; SAM_PUSH_BIN is
 *     /bin/true so no push notification is sent; every other SAM_* in the
 *     caller's environment is dropped, so the vault, upload and question
 *     paths follow HOME and a caller's own SAM_JOB_* never reaches the child.
 *   - XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS are dropped, so the child
 *     cannot reach the user's systemd bus at all. As a side effect the boot
 *     reconcile sees a fixture job's unit as 'unknown' and leaves `running`
 *     jobs running, instead of filing them as killed.
 *
 * Known app behaviour (not changed here): the app's boot retention sweep
 * deletes chat-turn directories beyond the newest 128 (MAX_JOBS in
 * src/lib/server/jobs/manager.ts), so a large `--chat` fixture shrinks to 128
 * chat turns within moments of the server starting. Sam-job directories are
 * kept.
 *
 * Exit codes: 0 started or stopped, 1 failed to start or stop, 2 bad usage or
 * refused (port 3000, port in use, unsafe dir, already running), 3 no build.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const NEXT_BIN = path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next');
const HOST = '127.0.0.1';
const LIVE_PORT = 3000;
const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 15_000;

function fail(code, message) {
  console.error(`run-fixture-server: ${message}`);
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The fixture dir, refused when it is, or could reach, the real home's `.sam`. */
function guardHome(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(2, `${dir} is not a directory`);
  const home = fs.realpathSync(dir);
  const realHome = fs.realpathSync(os.userInfo().homedir);
  const realSam = path.join(realHome, '.sam');
  if (home === realHome) fail(2, `refusing the real home ${realHome}`);
  const inside = (p) => p === realSam || p.startsWith(`${realSam}${path.sep}`);
  const sam = path.join(home, '.sam');
  if (fs.existsSync(sam) && inside(fs.realpathSync(sam))) fail(2, `refusing: ${sam} resolves into the real ${realSam}`);
  // Same guard as the proof harness: no link under the fixture may lead into the real store.
  const walk = (d, depth) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = fs.realpathSync(p);
        } catch {
          continue; // dangling link
        }
        if (inside(target)) fail(2, `refusing: ${p} resolves to ${target} (real ~/.sam)`);
      } else if (entry.isDirectory() && !(d.endsWith(`${path.sep}jobs`) && entry.name.startsWith('job_'))) {
        walk(p, depth + 1); // job dirs hold only files; skipping them keeps a 5000-dir store quick
      }
    }
  };
  walk(home, 0);
  if (!fs.existsSync(path.join(home, '.sam', 'jobs'))) {
    console.warn(`run-fixture-server: warning: ${path.join(home, '.sam', 'jobs')} does not exist (no fixture store)`);
  }
  return home;
}

/** True when something accepts connections on the port, or it cannot be bound. */
async function portInUse(port) {
  const connects = await new Promise((resolve) => {
    const s = net.connect({ host: HOST, port });
    // A connect that neither succeeds nor is refused (seen under a sandboxed
    // shell) is not a listener; the bind below is the deciding test.
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
  if (connects) return true;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.listen(port, HOST, () => srv.close(() => resolve(false)));
  });
}

function checkBuild() {
  const buildId = path.join(REPO, '.next', 'BUILD_ID');
  if (!fs.existsSync(buildId)) {
    fail(3, `no production build in ${path.join(REPO, '.next')}; run \`npx next build\` in ${REPO} first`);
  }
  const builtAt = fs.statSync(buildId).mtimeMs;
  let newest = null;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (!/\.test\.tsx?$/.test(entry.name)) {
        const m = fs.statSync(p).mtimeMs;
        if (m > builtAt && (newest === null || m > newest.m)) newest = { p, m };
      }
    }
  };
  walk(path.join(REPO, 'src'));
  console.log(`build ${fs.readFileSync(buildId, 'utf-8').trim()} from ${new Date(builtAt).toISOString()}`);
  if (newest) {
    console.warn(`run-fixture-server: warning: ${path.relative(REPO, newest.p)} is newer than the build; run \`npx next build\` to serve current source`);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * True when `pid` is a Next server run from this repo with HOME `home`, so a
 * reused pid is never signalled. Next renames its process to `next-server
 * (v...)`, which replaces the command line, hence the cwd and HOME checks.
 */
function isOurServer(pid, home) {
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8').split('\0');
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    const isNext = cmd.startsWith('next-server') || cmd.includes(path.join('next', 'dist', 'bin', 'next'));
    return isNext && cwd === fs.realpathSync(REPO) && env.includes(`HOME=${home}`);
  } catch {
    return false;
  }
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function getStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/health', timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Pids listening on the port, from `ss` (own processes only). */
function listenerPids(port) {
  const r = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf-8' });
  return [...new Set([...(r.stdout || '').matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
}

async function start(home, portArg) {
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(2, `port must be a whole number from 1 to 65535, got ${portArg}`);
  if (port === LIVE_PORT) fail(2, `refusing port ${LIVE_PORT}: it is the live sam-ui service; pick a free port above 3100 (ss -ltn)`);
  if (await portInUse(port)) fail(2, `port ${port} is already in use; pick a free port above 3100 (ss -ltn)`);

  const pidFile = path.join(home, '.server.pid');
  const prior = readPid(pidFile);
  if (prior !== null && alive(prior) && isOurServer(prior, home)) {
    fail(2, `a server for ${home} is already running (pid ${prior}); stop it with --stop`);
  }
  checkBuild();

  // Every inherited SAM_* is dropped first: a run from inside a sam-job job
  // would otherwise carry that job's SAM_JOB_* paths into the real store.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SAM_')));
  Object.assign(env, {
    HOME: home,
    SAM_TASK_STATE_PATH: path.join(home, '.sam', 'daily-tasks-state.json'),
    SAM_MONEY_STATE_PATH: path.join(home, '.sam', 'money-state.json'),
    SAM_OPERATIONS_PATH: path.join(home, '.sam', 'Named Operations.md'),
    SAM_PUSH_BIN: '/bin/true',
  });
  for (const key of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'PORT']) delete env[key];

  const logFile = path.join(home, '.server.log');
  const log = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [NEXT_BIN, 'start', REPO, '-H', HOST, '-p', String(port)], {
    cwd: REPO,
    env,
    detached: true,
    stdio: ['ignore', log, log],
  });
  fs.closeSync(log);
  let exited = null;
  child.once('exit', (code, signal) => {
    exited = signal ?? code;
  });
  const abort = () => {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    process.exit(1);
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let status = null;
  while (Date.now() < deadline && exited === null) {
    status = await getStatus(port);
    if (status !== null) break;
    await sleep(500);
  }
  if (status === null) {
    if (exited === null) process.kill(child.pid, 'SIGTERM');
    const tail = fs.readFileSync(logFile, 'utf-8').split('\n').slice(-20).join('\n');
    fail(1, `server did not answer on ${HOST}:${port} (${exited === null ? 'timed out' : `exited ${exited}`}); last of ${logFile}:\n${tail}`);
  }

  fs.writeFileSync(pidFile, `${child.pid}\n`);
  const listeners = listenerPids(port);
  console.log(`URL http://${HOST}:${port}`);
  console.log(`PID ${child.pid}`);
  if (listeners.length > 0 && !(listeners.length === 1 && listeners[0] === child.pid)) {
    console.log(`LISTENER PID ${listeners.join(' ')}`);
  }
  console.log(`HOME ${home}`);
  console.log(`health HTTP ${status}; log ${logFile}; pid file ${pidFile}`);
  child.unref();
  process.exit(0);
}

async function stop(home) {
  const pidFile = path.join(home, '.server.pid');
  const pid = readPid(pidFile);
  if (pid === null) fail(1, `no pid in ${pidFile}`);
  if (!alive(pid)) {
    fs.rmSync(pidFile, { force: true });
    console.log(`pid ${pid} is not running; removed ${pidFile}`);
    return;
  }
  if (!isOurServer(pid, home)) fail(1, `pid ${pid} is not a next start with HOME=${home}; not signalled`);
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (alive(pid) && Date.now() < deadline) await sleep(200);
  if (alive(pid)) fail(1, `pid ${pid} still running ${STOP_TIMEOUT_MS / 1000} s after SIGTERM`);
  fs.rmSync(pidFile, { force: true });
  console.log(`stopped pid ${pid}`);
}

async function main() {
  const [dir, second, ...rest] = process.argv.slice(2);
  if (!dir || !second || rest.length > 0) {
    fail(2, 'usage: node scripts/run-fixture-server.cjs <HOME dir> <port> | <HOME dir> --stop');
  }
  const home = guardHome(path.resolve(dir));
  if (second === '--stop') await stop(home);
  else await start(home, second);
}

main().catch((err) => fail(1, err instanceof Error ? err.message : String(err)));
