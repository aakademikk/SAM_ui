import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsage, type QuotaRow } from './usageReadings.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const secs = (ms: number) => Math.floor(ms / 1000);

function row(over: Partial<QuotaRow>): QuotaRow {
  return {
    endedAt: iso(NOW - 10 * 60_000),
    seat: 'main',
    fiveHour: null,
    sevenDay: null,
    ...over,
  };
}

const main = (rows: QuotaRow[], now = NOW) => buildUsage(rows, now).seats[0];

test('current 5h and weekly readings carry pct and ISO reset', () => {
  const s = main([
    row({
      fiveHour: 0.42,
      sevenDay: 0.57,
      fiveHourResetsAt: secs(NOW + 2 * H),
      sevenDayResetsAt: secs(NOW + 48 * H),
    }),
  ]);
  assert.equal(s.fiveHour?.pct, 42);
  assert.equal(s.fiveHour?.state, 'current');
  assert.equal(s.fiveHour?.resetsAt, iso(secs(NOW + 2 * H) * 1000));
  assert.equal(s.sevenDay?.pct, 57);
  assert.equal(s.sevenDay?.state, 'current');
  assert.equal(s.sevenDay?.resetsAt, iso(secs(NOW + 48 * H) * 1000));
  assert.equal(s.fiveHour?.readAt, iso(NOW - 10 * 60_000));
});

test('payload lists main then max2 and stamps generatedAt', () => {
  const p = buildUsage([], NOW);
  assert.deepEqual(
    p.seats.map((s) => s.id),
    ['main', 'max2'],
  );
  assert.equal(p.generatedAt, iso(NOW));
});

test('5h reading past its reset is reset with no pct, readAt kept', () => {
  const readAt = iso(NOW - 3 * H);
  const s = main([
    row({
      endedAt: readAt,
      fiveHour: 0.9,
      fiveHourResetsAt: secs(NOW - H),
    }),
  ]);
  assert.equal(s.fiveHour?.state, 'reset');
  assert.equal(s.fiveHour?.pct, null);
  assert.equal(s.fiveHour?.readAt, readAt);
});

test('reset at exactly now counts as reset', () => {
  const s = main([row({ fiveHour: 0.9, fiveHourResetsAt: secs(NOW) })]);
  assert.equal(s.fiveHour?.state, 'reset');
  assert.equal(s.fiveHour?.pct, null);
});

test('weekly reading past its reset is reset with no pct', () => {
  const readAt = iso(NOW - 30 * H);
  const s = main([
    row({
      endedAt: readAt,
      sevenDay: 0.7,
      sevenDayResetsAt: secs(NOW - H),
    }),
  ]);
  assert.equal(s.sevenDay?.state, 'reset');
  assert.equal(s.sevenDay?.pct, null);
  assert.equal(s.sevenDay?.readAt, readAt);
});

test('legacy 5h row: 2 h old is unknown-reset with pct, 6 h old is reset', () => {
  const young = main([row({ endedAt: iso(NOW - 2 * H), fiveHour: 0.33 })]);
  assert.equal(young.fiveHour?.state, 'unknown-reset');
  assert.equal(young.fiveHour?.pct, 33);
  assert.equal(young.fiveHour?.resetsAt, null);
  const old = main([row({ endedAt: iso(NOW - 6 * H), fiveHour: 0.33 })]);
  assert.equal(old.fiveHour?.state, 'reset');
  assert.equal(old.fiveHour?.pct, null);
});

test('newest row per window wins, even if a newer row has null for the other', () => {
  const s = main([
    row({
      endedAt: iso(NOW - 3 * H),
      fiveHour: 0.1,
      sevenDay: 0.2,
      fiveHourResetsAt: secs(NOW + H),
      sevenDayResetsAt: secs(NOW + 24 * H),
    }),
    row({
      endedAt: iso(NOW - 60_000),
      fiveHour: 0.5,
      sevenDay: null,
      fiveHourResetsAt: secs(NOW + 2 * H),
    }),
  ]);
  assert.equal(s.fiveHour?.pct, 50);
  assert.equal(s.sevenDay?.pct, 20);
  assert.equal(s.sevenDay?.readAt, iso(NOW - 3 * H));
});

test('row order does not matter, endedAt does', () => {
  const a = row({ endedAt: iso(NOW - H), sevenDay: 0.1, sevenDayResetsAt: secs(NOW + H) });
  const b = row({ endedAt: iso(NOW - 60_000), sevenDay: 0.3, sevenDayResetsAt: secs(NOW + H) });
  assert.equal(main([b, a]).sevenDay?.pct, 30);
  assert.equal(main([a, b]).sevenDay?.pct, 30);
});

test('rows with seat null or unknown are ignored', () => {
  const p = buildUsage(
    [
      row({ seat: null, fiveHour: 0.9 }),
      row({ seat: 'other', fiveHour: 0.9 }),
    ],
    NOW,
  );
  for (const s of p.seats) {
    assert.equal(s.fiveHour, null);
    assert.equal(s.sevenDay, null);
  }
});

test('a seat with no rows has both windows null; seats are independent', () => {
  const p = buildUsage(
    [row({ seat: 'max2', sevenDay: 0.4, sevenDayResetsAt: secs(NOW + H) })],
    NOW,
  );
  assert.equal(p.seats[0].fiveHour, null);
  assert.equal(p.seats[0].sevenDay, null);
  assert.equal(p.seats[1].sevenDay?.pct, 40);
});

test('rounding: 0.795 gives 80 and 0.804 gives 80', () => {
  const r = (u: number) =>
    main([row({ sevenDay: u, sevenDayResetsAt: secs(NOW + H) })]).sevenDay?.pct;
  assert.equal(r(0.795), 80);
  assert.equal(r(0.804), 80);
});

test('junk rows are skipped and never throw', () => {
  const junk = [
    null,
    undefined,
    42,
    'x',
    {},
    { seat: 'main' },
    row({ endedAt: 'not a date', fiveHour: 0.9 }),
    row({ endedAt: null, fiveHour: 0.9 }),
    row({ fiveHour: Number.NaN }),
    row({ fiveHour: '0.5' as unknown as number }),
  ] as unknown as QuotaRow[];
  const good = row({ fiveHour: 0.25, fiveHourResetsAt: secs(NOW + H) });
  const s = main([...junk, good]);
  assert.equal(s.fiveHour?.pct, 25);
  assert.equal(s.sevenDay, null);
  assert.doesNotThrow(() => buildUsage(junk, NOW));
  assert.doesNotThrow(() => buildUsage(null as unknown as QuotaRow[], NOW));
});
