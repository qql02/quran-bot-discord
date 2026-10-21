import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Same stubbed voice engine as sessionManager.test.js (see test-helpers/hooks.mjs); the queue code itself is real.
const sm = await import('../src/managers/sessionManager.js');

const guild = (id = 'g1') => ({ id, name: 'Test Guild', client: {} });
const item  = (n) => ({ surah: { number: n, arabic: `s${n}` }, reciter: 'r' });
const nums  = () => sm.getSession('g1').queue.map(q => q.surah.number);

beforeEach(async () => {
  globalThis.__players = []; globalThis.__player = {}; globalThis.__control = undefined;
  await sm.createAndJoin(guild(), { id: 'A', name: 'A' }, 'u1');
  for (const n of [1, 2, 3, 4]) sm.enqueue('g1', item(n));
});
afterEach(async () => { await sm.destroySession('g1'); globalThis.__control = undefined; });

test('removeQueueItem removes exactly that entry and returns it; bad index → null', () => {
  assert.equal(sm.removeQueueItem('g1', 1).surah.number, 2);
  assert.deepEqual(nums(), [1, 3, 4]);
  assert.equal(sm.removeQueueItem('g1', 9), null);
  assert.equal(sm.removeQueueItem('g1', -1), null);
  assert.equal(sm.removeQueueItem('nope', 0), null);
  assert.deepEqual(nums(), [1, 3, 4]);
});

test('moveQueueItem reorders, accepts same position, and refuses positions outside the queue', () => {
  assert.equal(sm.moveQueueItem('g1', 3, 0), true);
  assert.deepEqual(nums(), [4, 1, 2, 3]);
  assert.equal(sm.moveQueueItem('g1', 0, 2), true);
  assert.deepEqual(nums(), [1, 2, 4, 3]);
  assert.equal(sm.moveQueueItem('g1', 1, 1), true);
  assert.deepEqual(nums(), [1, 2, 4, 3]);
  for (const [a, b] of [[0, 4], [4, 0], [-1, 1], [1, -1], [0.5, 1], ['1', 2], [NaN, 0]]) assert.equal(sm.moveQueueItem('g1', a, b), false, `${a}→${b}`);
  assert.deepEqual(nums(), [1, 2, 4, 3]);
  assert.equal(sm.moveQueueItem('nope', 0, 1), false);
});

test('shuffleQueue keeps every entry (a permutation) and needs at least 2', async () => {
  for (let i = 5; i <= 30; i++) sm.enqueue('g1', item(i));
  const before = nums().slice();
  assert.equal(sm.shuffleQueue('g1'), true);
  assert.deepEqual(nums().slice().sort((a, b) => a - b), before.slice().sort((a, b) => a - b));
  sm.clearQueue('g1');
  assert.equal(sm.shuffleQueue('g1'), false);
  sm.enqueue('g1', item(1));
  assert.equal(sm.shuffleQueue('g1'), false);
  assert.equal(sm.shuffleQueue('nope'), false);
});

test("the owner's global queue limit applies to every server (and a server's own limit can only be shorter)", () => {
  const s = sm.getSession('g1');
  assert.equal(sm.queueLimit(s), sm.MAX_QUEUE);
  globalThis.__control = { maxQueue: 5 };
  assert.equal(sm.queueLimit(s), 5);
  assert.equal(sm.enqueue('g1', item(5)), true);            // 5th
  assert.equal(sm.enqueue('g1', item(6)), false);           // refused
  s.queueCap = 3;
  assert.equal(sm.queueLimit(s), 3);
  globalThis.__control = { maxQueue: 2 };
  assert.equal(sm.queueLimit(s), 2);
  globalThis.__control = { maxQueue: 500 };                 // never above the real maximum
  s.queueCap = null;
  assert.equal(sm.queueLimit(s), sm.MAX_QUEUE);
});
