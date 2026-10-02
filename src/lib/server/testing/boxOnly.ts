/**
 * boxOnly — the skip gate for tests that can only run on Colin's box.
 *
 * A handful of the push/notification tests prove their subject by spawning
 * the REAL scripts out of `~/.local/bin` and `~/.sam` (`sam-push`,
 * `sam-dispatch`, `sam-job`, `run.sh`), or by running turns through
 * `systemd-run --user`. Those paths exist only on the box. On a
 * GitHub-hosted runner they are simply absent, and a test that spawns a
 * missing binary does not get the exit code it asserts against — it gets
 * `status: null` — so it fails for a reason that has nothing to do with the
 * code under test.
 *
 * Measured cost of not gating this: from 2026-10-01 CI went permanently red
 * (nine failures that no code change could fix, one timing flake), and every
 * hourly auto-checkpoint push emailed Colin a failure. A red gate that
 * cannot be turned green by fixing code is worse than no gate, because it
 * trains the reader to ignore the one failure that matters.
 *
 * So a box-only test carries `{ skip: boxOnlySkip(...) }`. When the
 * prerequisites are present (on the box) it returns false and the test runs
 * exactly as before. When they are not (a hosted runner) it returns a reason
 * string, and node reports the test as SKIPPED with that reason — never as a
 * silent pass. That distinction matters: turnPing's "an internal turn never
 * pings" asserted zero pings, and zero pings is exactly what a missing
 * script produces, so on the runner it passed while proving nothing.
 *
 * The box is the gate for these. `./deploy.sh` runs the full suite before it
 * builds, so a box-only regression still blocks a deploy. CI additionally
 * fails if more than the known ten ever report skipped, so a portable test
 * cannot be silenced to dodge a failure.
 */

import fs from 'node:fs';

/**
 * Returns a skip reason when any of `paths` is missing, else `false` so the
 * caller's test runs.
 *
 * Pass every path the test needs to be meaningful. Callers that resolve a
 * staged-or-live binary should pass the RESOLVED path: if neither the staged
 * copy nor the live one exists, the resolved value is the (missing) live
 * path, which is exactly the condition worth skipping on.
 *
 * @param what  what the test needs, in the reader's terms, for the reason
 * @param paths the filesystem paths that must all exist
 */
export function boxOnlySkip(what: string, paths: string[]): string | false {
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length === 0) return false;
  return (
    `box-only: needs ${what}. Missing here: ${missing.join(', ')}. ` +
    'Proved on the box, where ./deploy.sh runs the full suite before building.'
  );
}
