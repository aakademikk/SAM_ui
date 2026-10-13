import test from 'node:test';
import assert from 'node:assert/strict';

import { enterFull, leaveFull, onPop, isFullState, type HistoryLike } from './fullScreen.js';

function fake() {
  const stack: unknown[] = [{ next: 1 }];
  let pushes = 0;
  let backs = 0;
  const h: HistoryLike & { pushes: () => number; backs: () => number; length: () => number } = {
    get state() {
      return stack[stack.length - 1];
    },
    pushState(s: unknown) {
      pushes++;
      stack.push(s);
    },
    back() {
      backs++;
      stack.pop();
    },
    pushes: () => pushes,
    backs: () => backs,
    length: () => stack.length,
  };
  return h;
}

test('enter pushes once, even if called twice', () => {
  const h = fake();
  assert.equal(enterFull(h), true);
  assert.equal(enterFull(h), false);
  assert.equal(h.pushes(), 1);
  assert.equal(h.length(), 2);
  assert.equal(isFullState(h.state), true);
});

test('pop of the marker leaves full screen, pop to the chat entry does not stay full', () => {
  const h = fake();
  enterFull(h);
  assert.equal(onPop(h.state), true);
  h.back();
  assert.equal(onPop(h.state), false);
  assert.equal(h.length(), 1);
  assert.equal(onPop(null), false);
  assert.equal(onPop(undefined), false);
});

test('leaving by button pops exactly once and leaves no stray entry', () => {
  const h = fake();
  enterFull(h);
  assert.equal(leaveFull(h), true);
  assert.equal(leaveFull(h), false);
  assert.equal(h.backs(), 1);
  assert.equal(h.length(), 1);
});
