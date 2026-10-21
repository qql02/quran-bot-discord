import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPositionMs, exportState, toWire, normalizeWire, planPull, formatPosition, MAX_TRANSFER_QUEUE } from '../src/services/transferState.js';
import { rememberLeftRoom, recentLeftRooms, _clearRecentRooms } from '../src/utils/recentRooms.js';

const reciterObj = { id: 7, displayName: 'Reciter', moshaf: [{}] };
const live = (over = {}) => ({
  ownerId: '111111111111111111', language: 'ar', volume: 80, status: 'playing', loop: false, fullQuran: true, memorize: null,
  sleepTimer: null, sleepEndsAt: null, radio: null,
  queue: [{ surah: { number: 36 }, reciter: 'Reciter', reciterObj }],
  player: { positionMs: () => 5_000 },
  current: { surah: { number: 18 }, reciter: 'Reciter', reciterObj, riwaya: 'Hafs', url: 'https://x/018.mp3', offsetMs: 60_000, startedAt: 1 },
  ...over
});

test('position = where the recording was started + how long it has played (never negative, never NaN)', () => {
  assert.equal(getPositionMs(live()), 65_000);
  assert.equal(getPositionMs(live({ player: { positionMs: () => NaN } })), 60_000);
  assert.equal(getPositionMs(live({ player: {} })), 60_000, 'a player that cannot tell → just the start offset');
  assert.equal(getPositionMs(live({ current: { ...live().current, offsetMs: undefined } })), 5_000);
  assert.equal(getPositionMs(live({ current: { isRadio: true } })), 0, 'a live stream has no position');
  assert.equal(getPositionMs({ current: null }), 0);
  assert.equal(getPositionMs(null), 0);
});

test('exportState captures the surah, the exact position, the queue and the modes', () => {
  const s = exportState(live({ status: 'paused', loop: true }));
  assert.equal(s.surah, 18);
  assert.equal(s.positionMs, 65_000);
  assert.equal(s.reciterId, '7');
  assert.equal(s.riwaya, 'Hafs');
  assert.equal(s.url, 'https://x/018.mp3');
  assert.equal(s.paused, true);
  assert.equal(s.loop, true);
  assert.equal(s.fullQuran, true);
  assert.equal(s.volume, 80);
  assert.equal(s.language, 'ar');
  assert.deepEqual(s.queue.map(q => q.surah), [36]);
  assert.equal(s._reciterObj, reciterObj, 'a local move keeps the live reciter');
});

test('exportState: sleep timer (remaining time or "end of surah"), memorize, radio, idle', () => {
  const t = Date.now();
  const s = exportState(live({ sleepTimer: {}, sleepEndsAt: t + 600_000 }));
  assert.ok(s.sleep > 590_000 && s.sleep <= 600_000);
  assert.equal(exportState(live({ sleepTimer: 'end_of_track' })).sleep, 'end_of_track');
  assert.equal(exportState(live({ sleepTimer: {}, sleepEndsAt: null })).sleep, null);
  assert.deepEqual(exportState(live({ memorize: { repeatCount: 5, delayMs: 2000, currentRep: 2 } })).memorize, { repeatCount: 5, delayMs: 2000, currentRep: 2 });
  const radio = exportState(live({ current: { isRadio: true, reciter: 'Makkah', surah: { number: 0 } }, radio: { name: 'Makkah', url: 'https://r/stream' } }));
  assert.deepEqual(radio.radio, { name: 'Makkah', url: 'https://r/stream' });
  assert.equal(radio.surah, null);
  const idle = exportState(live({ current: null, status: 'idle' }));
  assert.equal(idle.surah, null);
  assert.equal(idle.radio, null);
  assert.equal(exportState(null), null);
});

test('toWire is plain JSON with no live objects; normalizeWire gives the same state back', () => {
  const state = exportState(live());
  const wire = toWire(state);
  assert.doesNotThrow(() => JSON.stringify(wire));
  assert.ok(!('_reciterObj' in wire));
  assert.ok(wire.queue.every(q => !('reciterObj' in q)));
  const back = normalizeWire(JSON.parse(JSON.stringify(wire)));
  assert.equal(back.surah, 18);
  assert.equal(back.positionMs, 65_000);
  assert.equal(back.url, 'https://x/018.mp3');
  assert.equal(back.volume, 80);
  assert.equal(back.fullQuran, true);
  assert.deepEqual(back.queue, [{ surah: 36, reciter: 'Reciter', reciterId: '7' }]);
  assert.equal(back.ownerId, '111111111111111111');
});

test('normalizeWire never trusts the database: bad documents are refused, bad fields are cleaned', () => {
  assert.equal(normalizeWire(null), null);
  assert.equal(normalizeWire('x'), null);
  assert.equal(normalizeWire({ surah: 115 }), null, 'not a surah');
  assert.equal(normalizeWire({ surah: 'abc' }), null);
  assert.equal(normalizeWire({ radio: { name: 'x', url: 'file:///etc/passwd' } }), null, 'a radio hand-over needs an http(s) address');

  const s = normalizeWire({
    surah: 18, positionMs: -5, volume: 9999, memorize: { repeatCount: 0 }, sleep: -1, url: 'javascript:alert(1)', ownerId: 'nope', language: 'fr',
    queue: [{ surah: 2, reciter: 'x'.repeat(500) }, { surah: 0 }, { surah: 200 }, null]
  });
  assert.equal(s.positionMs, 0);
  assert.equal(s.volume, 100, 'an out-of-range volume falls back to the default, it never mutes or blasts');
  assert.equal(s.memorize, null);
  assert.equal(s.sleep, null);
  assert.equal(s.url, null, 'only http(s) addresses are kept');
  assert.equal(s.ownerId, null);
  assert.equal(s.language, 'en');
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].reciter.length, 120);

  const many = normalizeWire({ surah: 1, queue: Array.from({ length: 500 }, () => ({ surah: 2 })) });
  assert.equal(many.queue.length, MAX_TRANSFER_QUEUE);
  assert.equal(normalizeWire({ surah: 1, positionMs: 10 ** 12 }).positionMs, 0, 'an absurd position is dropped');
  assert.equal(normalizeWire({ surah: null }).surah, null, 'idle is a valid state');
  assert.equal(normalizeWire({ surah: 1, sleep: 'end_of_track' }).sleep, 'end_of_track');
});

test('formatPosition: m:ss and h:mm:ss', () => {
  assert.equal(formatPosition(0), '0:00');
  assert.equal(formatPosition(65_000), '1:05');
  assert.equal(formatPosition(3_725_000), '1:02:05');
  assert.equal(formatPosition(-1), '0:00');
  assert.equal(formatPosition('x'), '0:00');
});

// ── the decision ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const P = (id, ch, local = false) => ({ botId: id, role: local ? 'primary' : 'secondary', channelId: ch, local });
const none = () => 0;

test('planPull: alone in the old room → the same bot moves', () => {
  const plan = planPull({ userChannelId: 'B', sessions: [P('main', 'A', true)], listeners: none });
  assert.equal(plan.kind, 'move');
  assert.equal(plan.source.botId, 'main');
});

test('planPull: people stay behind → a different free bot is the copy; never the bot that is already reciting', () => {
  const plan = planPull({ userChannelId: 'B', sessions: [P('main', 'A', true)], freeBotIds: ['main', 'w1'], listeners: (c) => (c === 'A' ? 2 : 0) });
  assert.deepEqual([plan.kind, plan.targetBotId, plan.listeners], ['clone', 'w1', 2]);
  const toMain = planPull({ userChannelId: 'B', sessions: [P('w1', 'A')], freeBotIds: ['main', 'w2'], listeners: () => 1 });
  assert.equal(toMain.targetBotId, 'main', 'the main bot is preferred when it is free');
});

test('planPull: nobody free to come → a clear error, not a silent move that would cut off the others', () => {
  const plan = planPull({ userChannelId: 'B', sessions: [P('main', 'A', true)], freeBotIds: ['main'], listeners: () => 3 });
  assert.equal(plan.kind, 'error');
  assert.equal(plan.key, 'pull_no_free_bot');
});

test('planPull: already in the bot\'s room / nothing running / several recitations', () => {
  assert.equal(planPull({ userChannelId: 'A', sessions: [P('main', 'A', true)], listeners: none }).key, 'pull_already_here');
  assert.equal(planPull({ userChannelId: 'B', sessions: [], listeners: none }).key, 'pull_no_session');

  const two = [P('main', 'A', true), P('w1', 'C')];
  const ambiguous = planPull({ userChannelId: 'B', sessions: two, listeners: none });
  assert.equal(ambiguous.key, 'pull_ambiguous');
  assert.deepEqual(ambiguous.vars.channelIds, ['A', 'C']);
  assert.equal(planPull({ userChannelId: 'B', sessions: two, listeners: none, hintChannelId: 'C' }).source.botId, 'w1', 'the room the member just left decides');
  assert.equal(planPull({ userChannelId: 'B', sessions: two, listeners: none, hintChannelId: 'ZZ' }).key, 'pull_ambiguous', 'an unrelated hint does not guess');
  assert.equal(planPull({ userChannelId: 'B', sessions: two, listeners: none, hintChannelId: 'ZZ', explicit: true }).key, 'pull_no_bot_there', 'a room the member NAMED is an error when no bot is there');
  assert.equal(planPull({ userChannelId: 'B', sessions: [P('main', 'A', true)], listeners: none, hintChannelId: 'ZZ' }).kind, 'move', 'one recitation: no need to ask');
});

test('recent rooms: the last few rooms a member left, newest first, for 15 minutes (A → C → B still counts A)', () => {
  _clearRecentRooms();
  const t = 1_000_000;
  rememberLeftRoom('g', 'u', 'A', t);
  rememberLeftRoom('g', 'u', 'C', t + 1_000);
  assert.deepEqual(recentLeftRooms('g', 'u', t + 2_000), ['C', 'A']);
  assert.deepEqual(recentLeftRooms('g', 'u', t + 16 * 60_000), []);
  assert.deepEqual(recentLeftRooms('g', 'other', t), []);
  rememberLeftRoom('g', 'u', 'A', t + 3_000);
  assert.deepEqual(recentLeftRooms('g', 'u', t + 4_000), ['A', 'C'], 'no duplicates, latest first');
  for (const r of ['1', '2', '3', '4', '5']) rememberLeftRoom('g', 'u', r, t + 5_000);
  assert.equal(recentLeftRooms('g', 'u', t + 6_000).length, 4, 'bounded');
  rememberLeftRoom('', 'u', 'A'); rememberLeftRoom('g', '', 'A'); rememberLeftRoom('g', 'u', '');
  assert.equal(recentLeftRooms('g', 'u', t + 6_000)[0], '5', 'incomplete calls are ignored');
});
