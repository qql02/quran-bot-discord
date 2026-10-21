import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCrashGuard } from '../src/utils/crashGuard.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('isolated exceptions never ask for an exit', () => {
  const c = clock();
  const g = createCrashGuard({ limit: 5, windowMs: 60_000, now: c.now });
  for (let i = 0; i < 20; i++) { assert.equal(g.record(), false); c.advance(61_000); }
});

test('a burst reaching the limit inside the window asks for an exit', () => {
  const c = clock();
  const g = createCrashGuard({ limit: 5, windowMs: 60_000, now: c.now });
  const results = [];
  for (let i = 0; i < 5; i++) { results.push(g.record()); c.advance(1_000); }
  assert.deepEqual(results, [false, false, false, false, true]);
});

test('old exceptions fall out of the window', () => {
  const c = clock();
  const g = createCrashGuard({ limit: 3, windowMs: 10_000, now: c.now });
  g.record(); c.advance(4_000); g.record(); c.advance(7_000);   // first one is now 11s old
  assert.equal(g.record(), false);
  assert.equal(g.count, 2);
});
