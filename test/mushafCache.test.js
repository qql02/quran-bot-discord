import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { fetchMushafPage, clearMushafCache, prefetchMushafPage, mushafCacheStats } from '../src/services/mushafService.js';

const payload = (page) => ({ data: { data: { number: page, ayahs: [{ number: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', surah: { number: 1 }, numberInSurah: 1, juz: 1 }] } } });

test('an expired page is still served when the API is down (stale-if-error); a never-seen page is null', async (t) => {
  clearMushafCache();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });   // a real-looking clock: from 0 the "failed recently" guard would misfire
  let calls = 0, down = false;
  axios.get = async () => { calls++; if (down) throw new Error('API down'); return payload(1); };   // the test stub has no .get of its own

  assert.equal((await fetchMushafPage(1)).page, 1);
  assert.equal((await fetchMushafPage(1)).page, 1);
  assert.equal(calls, 1, 'second read comes from the cache');

  t.mock.timers.tick(25 * 60 * 60 * 1000);                  // cache expired
  down = true;
  const p = fetchMushafPage(1);
  for (let i = 0; i < 5; i++) { await Promise.resolve(); t.mock.timers.tick(1000); }   // lets the retry delay pass
  const stale = await p;
  assert.equal(stale?.page, 1, 'stale copy served instead of an error');

  const p2 = fetchMushafPage(2);
  for (let i = 0; i < 5; i++) { await Promise.resolve(); t.mock.timers.tick(1000); }
  assert.equal(await p2, null, 'no copy at all → null (the reader shows its retry screen)');
  delete axios.get;
});

test('prefetch warms the cache without throwing, and ignores bad pages', async () => {
  clearMushafCache();
  let calls = 0;
  axios.get = async () => { calls++; return payload(6); };
  prefetchMushafPage(6); prefetchMushafPage(0); prefetchMushafPage(605); prefetchMushafPage(NaN);
  await new Promise(r => setImmediate(r));
  assert.equal(mushafCacheStats().size, 1);
  assert.equal(calls, 1);
  delete axios.get;
});
