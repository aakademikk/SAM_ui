/**
 * SAM — preferencesBoot.ts: the inline `<head>` script that puts the saved
 * theme, background intensity and grid onto `<html>` before first paint
 * (floor-fixes Must 11, 24), and the helpers `PreferencesApplier` shares.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import {
  AMBIENT_THEME_IDS,
  PREFERENCES_KEY,
  bootScript,
  clampIntensity,
  gridAlphaFor,
  isAmbientTheme,
} from './preferencesBoot.js';
import { AMBIENT_THEMES } from '@/types/dashboard';

interface Result {
  dataset: Record<string, string>;
  props: Record<string, string>;
}

/** Run `bootScript` against a fake `<html>` and a fake localStorage holding `stored`. */
function runBoot(stored: string | null, { throwing = false } = {}): Result {
  const dataset: Record<string, string> = { ambient: 'toxic' };
  const props: Record<string, string> = {};
  const localStorage = {
    getItem(key: string) {
      if (throwing) throw new Error('SecurityError: storage disabled');
      return key === PREFERENCES_KEY ? stored : null;
    },
  };
  const document = {
    documentElement: {
      dataset,
      style: { setProperty: (name: string, value: string) => { props[name] = value; } },
    },
  };
  vm.runInNewContext(bootScript, { window: { localStorage }, document });
  return { dataset, props };
}

const blob = (state: Record<string, unknown>) => JSON.stringify({ state, version: 1 });

test('ember saved gives ember, with the stored intensity and grid', () => {
  const r = runBoot(blob({ ambientTheme: 'ember', backgroundIntensity: 0.75, gridOverlay: true }));
  assert.equal(r.dataset.ambient, 'ember');
  assert.equal(r.props['--sam-bg-intensity'], '0.75');
  assert.equal(r.props['--sam-grid-alpha'], gridAlphaFor(0.75, true));
});

test('every one of the six theme ids is applied', () => {
  for (const id of AMBIENT_THEME_IDS) assert.equal(runBoot(blob({ ambientTheme: id })).dataset.ambient, id);
});

test('intensity 0.2 with the grid off', () => {
  const r = runBoot(blob({ ambientTheme: 'plasma', backgroundIntensity: 0.2, gridOverlay: false }));
  assert.equal(r.props['--sam-bg-intensity'], '0.20');
  assert.equal(r.props['--sam-grid-alpha'], '0');
});

test('intensity outside 0..1 is clamped', () => {
  assert.equal(runBoot(blob({ backgroundIntensity: 4 })).props['--sam-bg-intensity'], '1.00');
  assert.equal(runBoot(blob({ backgroundIntensity: -1 })).props['--sam-bg-intensity'], '0.00');
});

test('nothing saved, garbage JSON, or no state change nothing', () => {
  for (const stored of [null, '', '{not json', 'null', '42', JSON.stringify({ version: 1 })]) {
    const r = runBoot(stored);
    assert.deepEqual(r.dataset, { ambient: 'toxic' }, `stored=${stored}`);
    assert.deepEqual(r.props, {}, `stored=${stored}`);
  }
});

test('an unknown theme id leaves the server default', () => {
  for (const ambientTheme of ['lava', 'TOXIC', '', 7, null, { id: 'ember' }]) {
    assert.equal(runBoot(blob({ ambientTheme })).dataset.ambient, 'toxic', `theme=${String(ambientTheme)}`);
  }
});

test('a missing intensity takes the store default, as the store merge does', () => {
  const r = runBoot(blob({ ambientTheme: 'ghost' }));
  assert.equal(r.props['--sam-bg-intensity'], '0.75');
  assert.equal(r.props['--sam-grid-alpha'], gridAlphaFor(0.75, true));
  assert.equal(runBoot(blob({ backgroundIntensity: 'high' })).props['--sam-bg-intensity'], '0.75');
});

test('a throwing localStorage does not throw and changes nothing', () => {
  let r: Result | undefined;
  assert.doesNotThrow(() => { r = runBoot(null, { throwing: true }); });
  assert.deepEqual(r!.dataset, { ambient: 'toxic' });
  assert.deepEqual(r!.props, {});
});

test('the boot script and gridAlphaFor agree over the whole range', () => {
  for (let n = 0; n <= 100; n++) {
    const i = n / 100;
    for (const grid of [true, false]) {
      const r = runBoot(blob({ backgroundIntensity: i, gridOverlay: grid }));
      assert.equal(r.props['--sam-grid-alpha'], gridAlphaFor(i, grid), `i=${i} grid=${grid}`);
      assert.equal(r.props['--sam-bg-intensity'], clampIntensity(i).toFixed(2), `i=${i}`);
    }
  }
});

test('gridAlphaFor keeps the DashboardShell formula', () => {
  assert.equal(gridAlphaFor(0, true), '0.020');
  assert.equal(gridAlphaFor(0.75, true), '0.058');
  assert.equal(gridAlphaFor(1, true), '0.070');
  assert.equal(gridAlphaFor(0.2, true), '0.030');
  assert.equal(gridAlphaFor(0.75, false), '0');
  assert.equal(gridAlphaFor(0, false), '0');
});

test('clampIntensity and isAmbientTheme', () => {
  assert.equal(clampIntensity(0.4), 0.4);
  assert.equal(clampIntensity(2), 1);
  assert.equal(clampIntensity(-3), 0);
  assert.equal(clampIntensity(Number.NaN), 0.75);
  assert.equal(clampIntensity(undefined), 0.75);
  assert.deepEqual([...AMBIENT_THEME_IDS], ['void', 'plasma', 'toxic', 'ember', 'ghost', 'emerald']);
  // The picker's list and the boot script's list must never drift apart.
  assert.deepEqual([...AMBIENT_THEME_IDS], AMBIENT_THEMES.map((t) => t.id));
  assert.ok(isAmbientTheme('emerald'));
  assert.ok(!isAmbientTheme('lava'));
  assert.ok(!isAmbientTheme(undefined));
});

test('the boot script is plain ES5 (no arrow functions, let/const or template literals)', () => {
  assert.doesNotMatch(bootScript, /=>|\blet\b|\bconst\b|`/);
  assert.doesNotThrow(() => new vm.Script(bootScript));
});
