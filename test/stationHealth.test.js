import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealth } from '../src/services/stationHealth.js';

const st = (n) => ({ url: `https://s${n}.example/live`, name: `S${n}` });
const probeFrom = (liveSet, calls = []) => async (url) => { calls.push(url); if (!liveSet.has(url)) throw new Error('down'); };

test('check: live and dead are told apart, and answers are cached (one probe, not one per question)', async () => {
  const calls = [];
  const h = createHealth({ probe: probeFrom(new Set([st(1).url]), calls) });
  assert.equal(await h.check(st(1).url), true);
  assert.equal(await h.check(st(2).url), false);
  assert.equal(await h.check(st(1).url), true);
  assert.equal(calls.length, 2);
  assert.equal(h.cached(st(1).url), true);
  assert.equal(h.cached(st(9).url), undefined);
});

test('two questions at the same time share one probe', async () => {
  let calls = 0; let release;
  const h = createHealth({ probe: () => { calls++; return new Promise((r) => { release = r; }); } });
  const a = h.check('https://x/'); const b = h.check('https://x/');
  await new Promise((r) => setTimeout(r, 5));      // the probe starts on the next tick
  release(); assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(calls, 1);
});

test('a dead station is retried sooner than a live one is re-checked', async () => {
  let t = 0; const calls = [];
  const live = new Set([st(1).url]);
  const h = createHealth({ probe: probeFrom(live, calls), now: () => t, ttlLiveMs: 1000, ttlDeadMs: 100 });
  await h.check(st(1).url); await h.check(st(2).url);
  t = 150;                                         // dead one expired, live one still fresh
  live.add(st(2).url);                             // station 2 came on the air
  assert.equal(await h.check(st(2).url), true);
  await h.check(st(1).url);
  assert.equal(calls.filter(u => u === st(1).url).length, 1);
  t = 1200;                                        // now the live one is stale too
  await h.check(st(1).url);
  assert.equal(calls.filter(u => u === st(1).url).length, 2);
});

test('liveOnly: only live stations, original order kept, at most `limit`', async () => {
  const items = [1, 2, 3, 4, 5, 6].map(st);
  const h = createHealth({ probe: probeFrom(new Set([st(2).url, st(3).url, st(5).url, st(6).url])) });
  assert.deepEqual((await h.liveOnly(items)).map(i => i.name), ['S2', 'S3', 'S5', 'S6']);
  assert.deepEqual((await h.liveOnly(items, { limit: 2 })).map(i => i.name), ['S2', 'S3']);
  assert.deepEqual(await h.liveOnly([]), []);
});

test('liveOnly: a station that never answers does not block the others, and is learned in the background', async () => {
  const hang = st(1); let finish;
  const h = createHealth({ probe: (url) => (url === hang.url ? new Promise((r) => { finish = r; }) : Promise.resolve()) });
  const out = await h.liveOnly([hang, st(2), st(3)], { budgetMs: 50 });
  assert.deepEqual(out.map(i => i.name), ['S2', 'S3']);
  assert.equal(h.cached(hang.url), undefined);     // still unknown
  finish();                                        // it answers later…
  await h.check(hang.url);
  assert.equal(h.cached(hang.url), true);          // …and the next question already knows
});

test('warm fills the cache without anyone waiting for it, and never throws', async () => {
  const h = createHealth({ probe: probeFrom(new Set([st(1).url])) });
  h.warm([st(1).url, st(2).url, st(1).url]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.cached(st(1).url), true);
  assert.equal(h.cached(st(2).url), false);
});
