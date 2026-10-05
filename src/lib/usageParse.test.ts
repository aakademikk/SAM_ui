import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from './dashboardService.js';
import type { UsagePayload } from '@/types/usage';

const good: UsagePayload = {
  generatedAt: '2026-10-05T12:00:00.000Z',
  seats: [
    {
      id: 'main',
      fiveHour: { pct: 42, resetsAt: '2026-10-05T15:00:00.000Z', readAt: '2026-10-05T11:46:00.000Z', state: 'current' },
      sevenDay: { pct: 80, resetsAt: '2026-10-09T09:00:00.000Z', readAt: '2026-10-05T11:46:00.000Z', state: 'current' },
    },
    {
      id: 'max2',
      fiveHour: { pct: null, resetsAt: '2026-10-05T10:00:00.000Z', readAt: '2026-10-05T09:00:00.000Z', state: 'reset' },
      sevenDay: null,
    },
  ],
};

const emptySeats = [
  { id: 'main', fiveHour: null, sevenDay: null },
  { id: 'max2', fiveHour: null, sevenDay: null },
];

test('parseUsage: a good payload round-trips', () => {
  assert.deepEqual(parseUsage(JSON.parse(JSON.stringify(good))), good);
});

test('parseUsage: garbage yields two seats with null windows and does not throw', () => {
  for (const raw of [null, undefined, 'x', 7, [], {}, { seats: 'nope' }, { seats: [null, 3, 'a'] }]) {
    const out = parseUsage(raw);
    assert.deepEqual(out.seats, emptySeats);
    assert.equal(typeof out.generatedAt, 'string');
  }
});

test('parseUsage: wrong-typed windows become null, bad fields fall back', () => {
  const out = parseUsage({
    seats: [
      { id: 'main', fiveHour: 'x', sevenDay: { pct: 'high', readAt: 5 } },
      { id: 'max2', fiveHour: { pct: '50', readAt: 'T', resetsAt: 9, state: 'weird' }, sevenDay: { readAt: 'T', pct: 250 } },
    ],
    generatedAt: 12,
  });
  assert.equal(out.seats[0].fiveHour, null);
  assert.equal(out.seats[0].sevenDay, null);
  assert.deepEqual(out.seats[1].fiveHour, { pct: null, resetsAt: null, readAt: 'T', state: 'current' });
  assert.equal(out.seats[1].sevenDay?.pct, 100);
});

test('parseUsage: seats are matched by id and always ordered main then max2', () => {
  const out = parseUsage({ seats: [good.seats[1], { id: 'other' }] });
  assert.deepEqual(out.seats.map((s) => s.id), ['main', 'max2']);
  assert.equal(out.seats[0].fiveHour, null);
  assert.equal(out.seats[1].fiveHour?.state, 'reset');
});
