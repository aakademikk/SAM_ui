/**
 * SAM — spendByHour.test: `aggregateFleetSpend`'s pure bucketing (T10).
 *
 * `/api/fleet/spend` has no per-hour or per-job timestamp in its response
 * shape (`FleetSpend`, `src/types/fleet.ts`) — only a total per persona over
 * its 7-day retention window, plus an optional `claude` figure folded into
 * `totalCostUsd` but kept outside `personas`. So `aggregateFleetSpend`
 * buckets the route's own per-entry data (by persona), per the foreman's
 * fallback note on this ticket, and this test checks that bucketing against
 * hand-computed totals for a small fixture — never calling the route or
 * `costFleetJob` itself (Must 15's "never a second implementation" half is
 * covered by `jobDetail.test.ts`'s direct `costFleetJob` comparison; this
 * test is the aggregation's own correctness, one step downstream of that
 * figure).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateFleetSpend } from './SpendByHourModule.js';
import type { FleetSpend } from '@/types/fleet.js';

function fixtureSpend(overrides: Partial<FleetSpend> = {}): FleetSpend {
  return {
    personas: {
      hermes: { jobs: 3, costUsd: 1.5 },
      calliope: { jobs: 2, costUsd: 0.5 },
      cerberus: { jobs: 1, costUsd: 0 },
    },
    totalCostUsd: 2,
    scannedJobs: 6,
    ...overrides,
  };
}

test('aggregateFleetSpend: null spend yields no bars and a zero total', () => {
  const result = aggregateFleetSpend(null);
  assert.deepEqual(result, { bars: [], personaTotalUsd: 0 });
});

test('aggregateFleetSpend: buckets by persona, highest spend first, matching hand-computed totals', () => {
  const result = aggregateFleetSpend(fixtureSpend());

  // Hand-computed: 1.5 + 0.5 + 0 = 2.
  assert.equal(result.personaTotalUsd, 2);
  assert.equal(result.bars.length, 3);

  // Sorted by costUsd descending: hermes (1.5), calliope (0.5), cerberus (0).
  assert.deepEqual(result.bars.map((b) => b.persona), ['hermes', 'calliope', 'cerberus']);

  const hermes = result.bars.find((b) => b.persona === 'hermes')!;
  assert.equal(hermes.jobs, 3);
  assert.equal(hermes.costUsd, 1.5);
  assert.equal(hermes.share, 0.75); // 1.5 / 2, hand-computed

  const calliope = result.bars.find((b) => b.persona === 'calliope')!;
  assert.equal(calliope.share, 0.25); // 0.5 / 2, hand-computed

  const cerberus = result.bars.find((b) => b.persona === 'cerberus')!;
  assert.equal(cerberus.costUsd, 0);
  assert.equal(cerberus.share, 0); // 0 / 2, hand-computed
});

test('aggregateFleetSpend: an empty personas map yields no bars and a zero persona total, even with claude spend present', () => {
  const result = aggregateFleetSpend(
    fixtureSpend({
      personas: {},
      totalCostUsd: 4.2,
      claude: { sessions: 2, costUsd: 4.2, tokens: 1000, projects: {}, scannedFiles: 2 },
    }),
  );
  assert.deepEqual(result.bars, []);
  assert.equal(result.personaTotalUsd, 0);
});

test('aggregateFleetSpend: personaTotalUsd excludes claude spend even when personas are present (claude is not a persona)', () => {
  const result = aggregateFleetSpend(
    fixtureSpend({
      totalCostUsd: 6.2, // 2 (personas) + 4.2 (claude) — hand-computed
      claude: { sessions: 2, costUsd: 4.2, tokens: 1000, projects: {}, scannedFiles: 2 },
    }),
  );
  assert.equal(result.personaTotalUsd, 2); // claude's 4.2 must not leak into the persona bucket total
});

test('aggregateFleetSpend: a single zero-spend persona gets a zero share, not NaN or division noise', () => {
  const result = aggregateFleetSpend(
    fixtureSpend({ personas: { prometheus: { jobs: 0, costUsd: 0 } }, totalCostUsd: 0 }),
  );
  assert.equal(result.personaTotalUsd, 0);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].share, 0);
});
