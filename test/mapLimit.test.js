import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../src/utils/mapLimit.js';

test('mapLimit: never exceeds the limit, keeps result order, processes every item', async () => {
  let running = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5 * (8 - n)));
    running--; return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(peak, 3);
});
test('mapLimit: empty input and limit larger than the list', async () => {
  assert.deepEqual(await mapLimit([], 10, async x => x), []);
  assert.deepEqual(await mapLimit([1, 2], 10, async x => x + 1), [2, 3]);
});
