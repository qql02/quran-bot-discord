import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const sm = await import('../src/managers/sessionManager.js');
// sessionManager.js is wired to this fake model by test-helpers/hooks.mjs (same module instance)
const { SessionSnapshot } = await import('../test-helpers/stubs/models.mjs');
const { WirdSubscription } = await import('../src/models/WirdSubscription.js');
const { getSurahByNumber } = await import('../src/data/surahs.js');

const guild  = (id = 'g1') => ({ id, name: 'Test Guild', client: {} });
const client = { channels: { cache: { get: () => undefined } } };
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

beforeEach(() => { globalThis.__players = []; globalThis.__player = {}; globalThis.__urls = undefined; });
afterEach(async () => { await sm.destroySession('g1'); });

// ── 7. snapshot writes are ordered ───────────────────────────────────────────
test('a snapshot save that is still running cannot land after the remove of a stopped session', async (t) => {
  const log = [];
  t.mock.method(SessionSnapshot, 'save', async () => { log.push('save-start'); await sleep(60); log.push('save-end'); });
  t.mock.method(SessionSnapshot, 'remove', async () => { log.push('remove'); });
  globalThis.__urls = (_r, n) => [{ url: `s${n}`, riwaya: 'x' }];
  await sm.createAndJoin(guild(), { id: 'A', name: 'A' }, 'u1', 'ar', client);
  sm.enqueue('g1', { surah: getSurahByNumber(1), reciter: 'r', reciterObj: {} });
  await sm.playNext('g1');                                  // fires a snapshot save (slow)
  await sleep(10);
  await sm.destroySession('g1');                            // the user stops: remove must wait for that save
  await sleep(150);
  assert.deepEqual(log, ['save-start', 'save-end', 'remove']);
});

test('a save queued behind a stop is skipped (the session is gone)', async (t) => {
  const log = [];
  t.mock.method(SessionSnapshot, 'save', async () => { log.push('save'); await sleep(40); });
  t.mock.method(SessionSnapshot, 'remove', async () => { log.push('remove'); });
  globalThis.__urls = (_r, n) => [{ url: `s${n}`, riwaya: 'x' }];
  const s = await sm.createAndJoin(guild(), { id: 'A', name: 'A' }, 'u1', 'ar', client);
  sm.enqueue('g1', { surah: getSurahByNumber(1), reciter: 'r', reciterObj: {} });
  await sm.playNext('g1');                                  // save #1 starts
  s.status = 'playing';
  await sleep(5);
  await sm.destroySession('g1');
  await sleep(120);
  assert.equal(log.filter(x => x === 'remove').length, 1);
  assert.equal(log.at(-1), 'remove', 'nothing is saved after the remove');
});

// ── 8. paused time is not play time ──────────────────────────────────────────
test('resuming moves startedAt forward by the time spent paused', async () => {
  const s = await sm.createAndJoin(guild(), { id: 'A', name: 'A' }, 'u1', 'ar', client);
  const start = Date.now() - 20_000;
  s.status = 'playing';
  s.current = { surah: getSurahByNumber(1), reciter: 'r', reciterObj: {}, riwaya: 'x', startedAt: start };
  assert.equal(sm.pauseSession('g1'), true);
  assert.ok(s.pausedAt > 0);
  s.pausedAt -= 5_000;                                      // as if it had been paused for 5 s
  assert.equal(sm.resumeSession('g1'), true);
  assert.equal(s.pausedAt, null);
  const shifted = s.current.startedAt - start;
  assert.ok(shifted >= 5_000 && shifted < 5_500, `shifted by ${shifted} ms`);
});

// ── 9. the wird tick pages through subscribers ───────────────────────────────
test('the wird tick loads subscribers in pages by _id, never all at once', async (t) => {
  const { startWirdScheduler } = await import('../src/services/wirdService.js');
  const all = Array.from({ length: 1200 }, (_, i) => ({ _id: String(i).padStart(6, '0'), userId: `u${i}`, guildId: null, active: true, expiresAt: new Date(Date.now() - 86_400_000) }));
  const queries = [];
  t.mock.method(WirdSubscription, 'find', (q) => {
    queries.push(q);
    const after = q._id?.$gt;
    const rows = all.filter(r => !after || r._id > after);
    let lim = Infinity;
    const chain = { sort: () => chain, limit: (n) => { lim = n; return chain; }, lean: async () => rows.slice(0, lim) };
    return chain;
  });
  let claimed = 0;
  t.mock.method(WirdSubscription, 'findOneAndUpdate', () => ({ lean: async () => { claimed++; return null; } }));
  startWirdScheduler({});
  for (let i = 0; i < 100 && claimed < 1200; i++) await sleep(20);
  assert.equal(claimed, 1200, 'every subscriber was handled once');
  assert.equal(queries.length, 3, '500 + 500 + 200');
  assert.equal(queries[0]._id, undefined);
  assert.equal(queries[1]._id.$gt, '000499');
  assert.equal(queries[2]._id.$gt, '000999');
});
