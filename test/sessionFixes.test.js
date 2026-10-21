import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Regression tests for: full-Quran skip, idle auto-leave vs listeners, join retry, radio reconnect.
const sm = await import('../src/managers/sessionManager.js');
const { getSurahByNumber } = await import('../src/data/surahs.js');

const guild   = (id = 'g1') => ({ id, name: 'Test Guild', client: {} });
const voiceCh = (id) => ({ id, name: id });
const flush   = () => new Promise(r => setImmediate(r));
const client  = { channels: { cache: { get: () => undefined } } };
const station = { name: 'Radio X', url: 'http://radio.example/stream' };

beforeEach(() => { globalThis.__players = []; globalThis.__player = {}; globalThis.__urls = undefined; });
afterEach(async () => { await sm.destroySession('g1'); });

const join = () => sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'ar', client);

// ── full Quran ───────────────────────────────────────────────────────────────
test('fullQuran: a surah without any URL is skipped, the khatma continues with the next one', async () => {
  const looked = [];
  globalThis.__urls = (_r, n) => { looked.push(n); return n === 6 ? [] : [{ url: `u${n}`, riwaya: 'x' }]; };
  const s = await join();
  s.fullQuran = true; s.status = 'playing';
  s.current = { surah: getSurahByNumber(5), reciter: 'r', reciterObj: {}, riwaya: 'x', startedAt: Date.now() };
  await sm.playNext('g1');
  assert.deepEqual(looked, [6, 7]);
  assert.equal(s.status, 'playing');
  assert.equal(s.current.surah.number, 7);
});

// ── auto-leave timers vs. listeners ──────────────────────────────────────────
test('a listener joining does NOT extend or cancel an idle auto-leave timer', async () => {
  const s = await join();
  s.status = 'idle';
  sm.startAutoLeaveTimer('g1');
  const timer = s.autoLeaveTimer;
  assert.equal(s.autoLeaveKind, 'state');
  sm.onListenerArrived('g1');
  assert.equal(s.autoLeaveTimer, timer, 'same timer, same deadline');
});

test('a listener joining replaces the "room is empty" timer: idle → idle timer, paused → paused timer, playing → none', async () => {
  const s = await join();
  for (const [status, expectTimer] of [['idle', true], ['paused', true], ['playing', false]]) {
    s.status = status;
    sm.startAutoLeaveTimer('g1', undefined, { empty: true });
    const emptyTimer = s.autoLeaveTimer;
    assert.equal(s.autoLeaveKind, 'empty');
    sm.onListenerArrived('g1');
    assert.equal(!!s.autoLeaveTimer, expectTimer, status);
    if (expectTimer) { assert.notEqual(s.autoLeaveTimer, emptyTimer); assert.equal(s.autoLeaveKind, 'state'); }
    sm.clearAutoLeaveTimer('g1');
  }
});

// ── join race ────────────────────────────────────────────────────────────────
test('if the first join fails, the waiting caller in the same channel joins by itself', async () => {
  let failFirst, n = 0;
  globalThis.__player.connect = () => (n++ === 0 ? new Promise((_, rej) => { failFirst = rej; }) : Promise.resolve());
  const pA = join();
  const pB = join();
  await flush();
  failFirst(new Error('boom'));
  await assert.rejects(pA, /boom/);
  const sB = await pB;
  assert.equal(sm.getSession('g1'), sB);
  assert.equal(globalThis.__players.length, 2);
});

// ── radio ────────────────────────────────────────────────────────────────────
test('radio drop: retries with growing delays, then gives up, goes idle and starts the idle timer', async (t) => {
  const s = await join();
  assert.equal(await sm.playRadio('g1', station), true);
  let plays = 0;
  globalThis.__player.play = async () => { plays++; throw new Error('stream down'); };
  s.current.startedAt = Date.now() - 60_000;            // it had been running fine → fresh failure count

  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.__players[0].emit('end', { reason: 'finished' });
  for (const delay of [3_000, 10_000, 30_000, 60_000, 120_000]) {
    assert.ok(s.radioTimer, `a reconnect is scheduled before the ${delay}ms step`);
    t.mock.timers.tick(delay); await flush(); await flush();
  }
  assert.equal(plays, 5, 'five reconnect attempts');
  assert.equal(s.radio, null);
  assert.equal(s.radioTimer, null);
  assert.equal(s.status, 'idle');
  assert.ok(s.autoLeaveTimer, 'idle auto-leave timer is running, the bot does not sit in the room forever');
});

test('radio drop, then a surah is requested: the pending reconnect is cancelled and never cuts the surah off', async (t) => {
  const s = await join();
  await sm.playRadio('g1', station);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  s.current.startedAt = Date.now() - 60_000;
  globalThis.__players[0].emit('end', { reason: 'finished' });
  assert.ok(s.radioTimer);

  globalThis.__urls = () => [{ url: 'surah-url', riwaya: 'x' }];
  const urls = [];
  globalThis.__player.play = async (u) => { urls.push(u); };
  sm.enqueue('g1', { surah: getSurahByNumber(1), reciter: 'r', reciterObj: {} });
  await sm.playNext('g1');
  t.mock.timers.tick(200_000); await flush();

  assert.equal(s.radioTimer, null);
  assert.equal(s.radio, null);
  assert.deepEqual(urls, ['surah-url'], 'only the surah was played, the radio did not come back');
  assert.equal(s.current.surah.number, 1);
});

test('radio that fails to start leaves a clean idle session (not a stale "playing" one)', async () => {
  const s = await join();
  s.status = 'playing';
  globalThis.__player.play = async () => { throw new Error('404'); };
  assert.equal(await sm.playRadio('g1', station), false);
  assert.equal(s.radio, null);
  assert.equal(s.status, 'idle');
  assert.equal(s.current, null);
  assert.ok(s.autoLeaveTimer);
});

test('a stream that keeps dying right after it starts is treated as failing, not reset every time', async (t) => {
  const s = await join();
  await sm.playRadio('g1', station);            // startedAt = now → the drop below is "unstable"
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.__players[0].emit('end', { reason: 'finished' });
  assert.equal(s.radioFails, 1);
  t.mock.timers.tick(10_000);                    // second backoff step (10s), not the first (3s)
  await flush();
  assert.equal(s.radio?.name ?? null, 'Radio X');
});

// ── skip while a track is still loading ──────────────────────────────────────
const item = (n) => ({ surah: getSurahByNumber(n), reciter: 'r', reciterObj: {} });
function slowLoads() {
  const played = []; const gates = [];
  globalThis.__urls = (_r, n) => [{ url: `s${n}`, riwaya: 'x' }];
  globalThis.__player.play = (u) => { played.push(u); return new Promise(res => gates.push(res)); };
  return { played, gates };
}

test('skip pressed while a surah is still loading is honoured: it is skipped as soon as it has loaded', async () => {
  const s = await join();
  const { played, gates } = slowLoads();
  sm.enqueue('g1', item(1)); sm.enqueue('g1', item(2));
  const loading = sm.playNext('g1');           // surah 1 is downloading…
  await flush();
  assert.equal(sm.skipSession('g1'), true);    // …and the user presses skip
  gates[0]();                                  // surah 1 finished loading
  await flush(); await flush();
  gates[1]?.();
  await loading;
  assert.deepEqual(played, ['s1', 's2'], 'surah 1 was replaced by surah 2');
  assert.equal(s.current.surah.number, 2);
  assert.equal(s.skipPending, false);
});

test('skip while the LAST queued surah is loading ends the session as idle', async () => {
  const s = await join();
  const { gates } = slowLoads();
  sm.enqueue('g1', item(1));
  const loading = sm.playNext('g1');
  await flush();
  sm.skipSession('g1');
  gates[0](); await loading;
  assert.equal(s.status, 'idle');
  assert.equal(s.current, null);
});

test('a second /recite while the first is loading is queued after it, not played over it', async () => {
  const s = await join();
  const { played, gates } = slowLoads();
  sm.enqueue('g1', item(1));
  const loading = sm.playNext('g1');
  await flush();
  sm.enqueue('g1', item(2)); await sm.playNext('g1');   // second user, lock held
  gates[0](); await loading;
  assert.deepEqual(played, ['s1']);
  assert.equal(s.current.surah.number, 1);
  assert.equal(s.queue.length, 1, 'surah 2 waits its turn');
});

test('memorize delay: the first playNext must not release a lock another playNext took meanwhile', async () => {
  const s = await join();
  const { played, gates } = slowLoads();
  s.status = 'playing';
  s.current = { surah: getSurahByNumber(1), reciter: 'r', reciterObj: {}, riwaya: 'x', startedAt: Date.now() };
  s.memorize = { repeatCount: 3, delayMs: 60, currentRep: 0 };
  const a = sm.playNext('g1');                              // repeating: lets go of the lock while it waits 60 ms
  await new Promise(r => setTimeout(r, 15));
  sm.enqueue('g1', item(2));
  const b = sm.playNext('g1');                              // takes the lock and starts loading surah 2 (gated)
  await flush();
  assert.equal(played.length, 1, 'B is loading');
  await a;                                                  // A wakes up, finds the lock taken and gives up
  sm.enqueue('g1', item(3));
  await sm.playNext('g1');                                  // C: must still be refused — B still owns the lock
  assert.equal(played.length, 1, 'C did not start a second load over B');
  gates.forEach(g => g()); await b;
});
