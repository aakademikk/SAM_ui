/**
 * SAM — figureHit.test: the 44px figure hit area and its precedence over a
 * General's column (floor-fixes T11, Must 17, 18). No DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIGURE_HIT_PX, hitFigure, pickAt } from './figureHit.js';

const fig = (jobId: string, x: number, y: number, extra: { returned?: boolean; vis?: number } = {}) => ({
  jobId, x, y, returned: false, vis: 1, ...extra,
});

test('figure hit: 22px away hits, 23px does not', () => {
  assert.equal(FIGURE_HIT_PX, 44);
  const figs = [fig('j1', 100, 100)];
  assert.equal(hitFigure(figs, 122, 100), 'j1');
  assert.equal(hitFigure(figs, 100, 78), 'j1');
  assert.equal(hitFigure(figs, 123, 100), null);
  assert.equal(hitFigure(figs, 100, 123), null);
  assert.equal(hitFigure(figs, 122, 122), 'j1', 'the corner of the square counts');
});

test('figure hit: the nearest of two figures wins, ties go to list order', () => {
  const figs = [fig('far', 100, 100), fig('near', 120, 100)];
  assert.equal(hitFigure(figs, 115, 100), 'near');
  assert.equal(hitFigure(figs, 105, 100), 'far');
  assert.equal(hitFigure(figs, 110, 100), 'far', 'an exact tie keeps the first');
});

test('figure hit: a returned (fading) or invisible figure is ignored', () => {
  assert.equal(hitFigure([fig('gone', 50, 50, { returned: true })], 50, 50), null);
  assert.equal(hitFigure([fig('unborn', 50, 50, { vis: 0 })], 50, 50), null);
  assert.equal(hitFigure([fig('gone', 50, 50, { returned: true }), fig('live', 60, 50)], 50, 50), 'live');
});

test('figure hit: a phone-small figure still has the 44px area', () => {
  // the hit area is in canvas px and does not shrink with the figure's scale `k`
  const small = { ...fig('tiny', 200, 300), k: 0.3 };
  assert.equal(hitFigure([small], 221, 321), 'tiny');
  assert.equal(hitFigure([small], 200, 323), null);
});

test('pick: a figure inside a General column wins over the General', () => {
  assert.deepEqual(pickAt([fig('j1', 100, 100)], 'hermes', 105, 100), { kind: 'job', jobId: 'j1' });
});

test('pick: elsewhere in the column gives the General', () => {
  assert.deepEqual(pickAt([fig('j1', 100, 100)], 'hermes', 100, 200), { kind: 'general', id: 'hermes' });
});

test('pick: an empty floor, or empty space, gives null', () => {
  assert.equal(pickAt([], null, 10, 10), null);
  assert.equal(pickAt([fig('j1', 100, 100)], null, 300, 300), null);
});

test('pick: a returned figure falls through to the General', () => {
  assert.deepEqual(pickAt([fig('gone', 100, 100, { returned: true })], 'cerberus', 100, 100), { kind: 'general', id: 'cerberus' });
});
