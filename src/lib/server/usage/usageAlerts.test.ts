import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsage, type QuotaRow } from './usageReadings.js';
import { decideAlerts, type AlertState } from './usageAlerts.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const H = 3600_000;
const secs = (ms: number) => Math.floor(ms / 1000);

function row(over: Partial<QuotaRow>): QuotaRow {
  return {
    endedAt: new Date(NOW - 60_000).toISOString(),
    seat: 'main',
    fiveHour: null,
    sevenDay: null,
    ...over,
  };
}

const usage = (rows: QuotaRow[], now = NOW) => buildUsage(rows, now);
const fiveRow = (u: number, resetMs = NOW + 2 * H, seat = 'main') =>
  row({ seat, fiveHour: u, fiveHourResetsAt: secs(resetMs) });
const weekRow = (u: number, resetMs = NOW + 48 * H, seat = 'main') =>
  row({ seat, sevenDay: u, sevenDayResetsAt: secs(resetMs) });

test('check 4: 5-hour 0.80 pings once naming seat, percent and reset; 0.79 does not', () => {
  const hit = decideAlerts(usage([fiveRow(0.8, Date.parse('2026-10-05T17:40:00Z'))]), {}, NOW);
  assert.equal(hit.pings.length, 1);
  const p = hit.pings[0];
  assert.equal(p.seat, 'main');
  assert.equal(p.window, 'fiveHour');
  assert.equal(p.pct, 80);
  assert.equal(p.title, 'SAM usage');
  assert.equal(p.tag, 'usage-main-fiveHour');
  assert.equal(p.body, 'main seat: 5-hour limit at 80%, resets 18:40');
  assert.equal(decideAlerts(usage([fiveRow(0.79)]), {}, NOW).pings.length, 0);
});

test('check 5: weekly 0.80 pings once, 0.79 does not', () => {
  const hit = decideAlerts(usage([weekRow(0.8)]), {}, NOW);
  assert.equal(hit.pings.length, 1);
  assert.equal(hit.pings[0].window, 'sevenDay');
  assert.equal(hit.pings[0].tag, 'usage-main-sevenDay');
  assert.match(hit.pings[0].body, /^main seat: weekly limit at 80%, resets /);
  assert.equal(decideAlerts(usage([weekRow(0.79)]), {}, NOW).pings.length, 0);
});

test('check 21: once per window, again after the reset epoch changes', () => {
  for (const kind of ['fiveHour', 'sevenDay'] as const) {
    const mk = kind === 'fiveHour' ? fiveRow : weekRow;
    const first = NOW + 2 * H;
    const second = NOW + 9 * H;
    let state: AlertState = {};
    let total = 0;
    for (const u of [0.82, 0.9, 0.95]) {
      const r = decideAlerts(usage([mk(u, first)]), state, NOW);
      total += r.pings.length;
      state = r.next;
    }
    assert.equal(total, 1);
    const again = decideAlerts(usage([mk(0.83, second)]), state, NOW);
    assert.equal(again.pings.length, 1);
    assert.equal(total + again.pings.length, 2);
  }
});

test('one seat at 5-hour 85 and weekly 81 gives two pings in one call', () => {
  const u = usage([row({ fiveHour: 0.85, sevenDay: 0.81, fiveHourResetsAt: secs(NOW + H), sevenDayResetsAt: secs(NOW + 48 * H) })]);
  const r = decideAlerts(u, {}, NOW);
  assert.deepEqual(r.pings.map((p) => p.window).sort(), ['fiveHour', 'sevenDay']);
});

test('expired, legacy and unknown-reset windows never ping', () => {
  const expired = usage([fiveRow(0.95, NOW - H), weekRow(0.95, NOW - H)]);
  assert.equal(decideAlerts(expired, {}, NOW).pings.length, 0);
  const legacy = usage([row({ fiveHour: 0.95 })]);
  assert.equal(decideAlerts(legacy, {}, NOW).pings.length, 0);
  const noWeeklyReset = usage([row({ sevenDay: 0.95 })]);
  assert.equal(decideAlerts(noWeeklyReset, {}, NOW).pings.length, 0);
});

test('two seats are independent and the input state is not mutated', () => {
  const rows = [fiveRow(0.9, NOW + H, 'main'), fiveRow(0.9, NOW + H, 'max2')];
  const state: AlertState = { main: { fiveHour: secs(NOW + H) * 1000 } };
  const frozen = JSON.stringify(state);
  const r = decideAlerts(usage(rows), state, NOW);
  assert.deepEqual(r.pings.map((p) => p.seat), ['max2']);
  assert.equal(JSON.stringify(state), frozen);
  assert.equal(r.next.main.fiveHour, secs(NOW + H) * 1000);
  assert.equal(r.next.max2.fiveHour, secs(NOW + H) * 1000);
});
