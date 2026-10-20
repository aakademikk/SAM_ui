/**
 * SAM — ambientGate.test: the fleet views register themselves so the shell can
 * unmount the ambient background nobody can see under them (audit D-01).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AmbientBackgroundGate, fleetViewMounted, registerFleetView } from './ambientGate.js';

const bg = createElement('div', { id: 'bg' });
const render = (booting = false) => renderToStaticMarkup(createElement(AmbientBackgroundGate, { booting }, bg));

test('store is false, true after one register, true with two, false after both unregister', () => {
  assert.equal(fleetViewMounted(), false);
  const a = registerFleetView();
  assert.equal(fleetViewMounted(), true);
  const b = registerFleetView();
  a();
  assert.equal(fleetViewMounted(), true);
  b();
  assert.equal(fleetViewMounted(), false);
});

test('unregister is idempotent', () => {
  const a = registerFleetView();
  const b = registerFleetView();
  a();
  a();
  assert.equal(fleetViewMounted(), true);
  b();
  assert.equal(fleetViewMounted(), false);
});

test('gate renders the background normally, omits it while a fleet view is registered or booting', () => {
  assert.match(render(), /id="bg"/);
  const un = registerFleetView();
  assert.doesNotMatch(render(), /id="bg"/);
  un();
  assert.match(render(), /id="bg"/);
  assert.doesNotMatch(render(true), /id="bg"/);
});
