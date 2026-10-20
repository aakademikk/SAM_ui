import fs from 'node:fs';

/**
 * Test helper: which copy of a helper script a test runs.
 *
 * Returns the live script unless `SAM_TEST_STAGED=1` is set and the staged
 * (`.next`) file exists. A staged copy can lag the live script, so `npm test`
 * defaults to live; opt in to a staged copy explicitly.
 */
export function stagedOrLive(staged: string, live: string): string {
  return process.env.SAM_TEST_STAGED === '1' && fs.existsSync(staged) ? staged : live;
}
