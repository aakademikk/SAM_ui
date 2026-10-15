/**
 * The switch re-reads the phone when screening changes elsewhere. There is no
 * component test setup in this repo, so the listener logic lives in
 * screeningEvents.ts and is tested here with a fake osBridge reader.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { SCREENING_CHANGED_EVENT, announceScreeningChanged, subscribeScreeningChanged } from './screeningEvents';

const g = globalThis as unknown as { window?: EventTarget };

describe('screening-changed event', () => {
  beforeEach(() => {
    g.window = new EventTarget();
  });
  afterEach(() => {
    delete g.window;
  });

  it('has the agreed name', () => {
    assert.equal(SCREENING_CHANGED_EVENT, 'sam:screening-changed');
  });

  it('makes the listener call getScreening again, and stops after unsubscribe', async () => {
    let reads = 0;
    const getScreening = async () => {
      reads += 1;
      return true;
    };
    const off = subscribeScreeningChanged(() => void getScreening());
    announceScreeningChanged();
    assert.equal(reads, 1);
    off();
    announceScreeningChanged();
    assert.equal(reads, 1);
  });

  it('is a no-op outside a browser', () => {
    delete g.window;
    assert.doesNotThrow(() => announceScreeningChanged());
    assert.doesNotThrow(() => subscribeScreeningChanged(() => {})());
  });
});
