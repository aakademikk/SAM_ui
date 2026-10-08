/**
 * SAM — the ambient graph hides itself while its WebGL context is lost
 * (Colin, 2026-10-08: "the background keeps failing"). After two GPU process
 * crashes close together Chrome never restores the context, and the dead
 * canvas is composited as an opaque white layer under every page. Diagnosis:
 * ~/.sam/work/samui-background/diagnosis-2026-10-08.md. The real-GPU proof is
 * scripts/check-bg-context-loss.cjs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { watchContextLoss } from './webglContextLoss.js';

test('lost reports true, restored reports false', () => {
  const target = new EventTarget();
  const seen: boolean[] = [];
  watchContextLoss(target, (lost) => seen.push(lost));
  target.dispatchEvent(new Event('webglcontextlost'));
  target.dispatchEvent(new Event('webglcontextrestored'));
  assert.deepEqual(seen, [true, false]);
});

test('after the remove function runs, nothing more is reported', () => {
  const target = new EventTarget();
  const seen: boolean[] = [];
  const remove = watchContextLoss(target, (lost) => seen.push(lost));
  remove();
  target.dispatchEvent(new Event('webglcontextlost'));
  target.dispatchEvent(new Event('webglcontextrestored'));
  assert.deepEqual(seen, []);
});

test('the visualiser hides its canvas while the context is lost, and keeps it mounted', () => {
  // React cannot be mounted here (no jsdom), so pin the wiring.
  const rel = 'components/visualiser/VaultGraphVisualiser.tsx';
  const src = fs.readFileSync(path.resolve(__dirname, '../../src', rel), 'utf8');
  assert.match(src, /watchContextLoss\(/, `${rel} must watch the canvas for context loss`);
  assert.match(src, /onCreated=\{/, `${rel} must attach the watcher when the canvas is created`);
  assert.match(src, /display: glLost \? 'none' : undefined/, `${rel} must hide, not unmount, a lost canvas`);
});
