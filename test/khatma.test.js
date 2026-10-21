import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const sm = await import('../src/managers/sessionManager.js');
const { SURAHS } = await import('../src/data/surahs.js');
const client = { channels: { cache: { get: () => undefined } } };
const flush = () => new Promise(r => setImmediate(r));
beforeEach(() => { globalThis.__players = []; globalThis.__player = {}; globalThis.__urls = undefined; });
afterEach(async () => { await sm.destroySession('g1'); });

async function startKhatma(urlFor = (_r, n) => [{ url: `s${n}`, riwaya: 'x' }]) {
  const played = [];
  globalThis.__urls = urlFor;
  globalThis.__player.play = async (u) => { played.push(u); };
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'ar', client);
  sm.clearQueue('g1'); s.fullQuran = true; s.loop = false; s.memorize = null;
  sm.enqueue('g1', { surah: SURAHS[0], reciter: 'R', reciterObj: {} });
  await sm.playNext('g1');
  return { s, played };
}
async function finishTrack() { globalThis.__players[0].emit('end', { reason: 'finished' }); await flush(); await flush(); }

test('khatma plays all 114 surahs in order, then stops cleanly', async () => {
  const { s, played } = await startKhatma();
  for (let i = 0; i < 130 && s.status === 'playing'; i++) await finishTrack();
  assert.deepEqual(played, Array.from({ length: 114 }, (_, i) => `s${i + 1}`));
  assert.equal(s.status, 'idle');
  assert.equal(s.current?.surah?.number ?? null, 114 === s.current?.surah?.number ? 114 : null);
  console.log(`KHATMA: played=${played.length} first=${played[0]} last=${played.at(-1)} status=${s.status} fullQuran_after=${s.fullQuran} queue=${s.queue.length}`);
});

test('after the khatma ends, a later single surah does NOT silently continue into a new khatma', async () => {
  const { s, played } = await startKhatma();
  for (let i = 0; i < 130 && s.status === 'playing'; i++) await finishTrack();
  assert.equal(s.fullQuran, false, 'fullQuran must be switched off when the khatma finishes');
  played.length = 0;
  sm.enqueue('g1', { surah: SURAHS[1], reciter: 'R', reciterObj: {} });   // someone plays Al-Baqarah on its own
  await sm.playNext('g1');
  await finishTrack();
  assert.deepEqual(played, ['s2'], 'only the requested surah is played');
});

test('khatma survives surahs that have no URL (skipped) and still reaches 114', async () => {
  const { s, played } = await startKhatma((_r, n) => (n === 10 || n === 50 || n === 51 ? [] : [{ url: `s${n}`, riwaya: 'x' }]));
  for (let i = 0; i < 130 && s.status === 'playing'; i++) await finishTrack();
  assert.equal(played.length, 111);
  assert.equal(played.at(-1), 's114');
  assert.ok(!played.includes('s10') && !played.includes('s50'));
});
