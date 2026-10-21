import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The voice player, models, logger and Quran API are stubs (see test-helpers/hooks.mjs);
// sessionManager.js itself, config, i18n and the surah data are the real code.
const sm = await import('../src/managers/sessionManager.js');

const guild   = (id = 'g1') => ({ id, name: 'Test Guild', client: {} });
const voiceCh = (id, name = id) => ({ id, name });
const flush   = () => new Promise(r => setImmediate(r));

/** Fake discord.js client with one text channel the bot may (or may not) post in. */
function makeClient({ canSend = true } = {}) {
  const sent = [];
  const channel = {
    isTextBased: () => true,
    guild: { members: { me: {} } },
    permissionsFor: () => ({ has: () => canSend }),
    send: async (payload) => { sent.push(payload); },
  };
  return { sent, client: { channels: { cache: { get: (id) => (id === 'text1' ? channel : undefined) } } } };
}

/** Only the FIRST connect() hangs (until released); any later one resolves at once — so a bug that lets a
 *  second caller proceed shows up as a clean assertion failure instead of a hung test. */
function blockFirstConnect(captureRelease) {
  let n = 0;
  return () => (n++ === 0 ? new Promise(captureRelease) : Promise.resolve());
}

beforeEach(() => {
  globalThis.__players = [];
  globalThis.__player  = {};
});
afterEach(async () => {
  await sm.destroySession('g1');
  await sm.destroySession('g2');
});

// ── sessions ────────────────────────────────────────────────────────────────
test('createAndJoin builds a session for the caller', async () => {
  const { client } = makeClient();
  const s = await sm.createAndJoin(guild(), voiceCh('A', 'Quran Room'), 'u1', 'ar', client);
  assert.equal(s.voiceChannelId, 'A');
  assert.equal(s.channelName, 'Quran Room');
  assert.equal(s.ownerId, 'u1');
  assert.equal(s.language, 'ar');
  assert.equal(s._client, client);
  assert.equal(sm.getSession('g1'), s);
  assert.equal(globalThis.__players[0].volume, 100, 'volume applied to the player');
});

test('destroySession stops and destroys the player, and is idempotent', async () => {
  await sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  const player = globalThis.__players[0];
  await sm.destroySession('g1');
  assert.equal(sm.getSession('g1'), null);
  assert.ok(player.stopped >= 1);
  assert.equal(player.destroyed, true);
  await assert.doesNotReject(sm.destroySession('g1'));
});

// ── join race (the "session hijack" fix) ─────────────────────────────────────
test('second caller in ANOTHER channel during a join is refused; first session is untouched', async () => {
  let release;
  globalThis.__player.connect = blockFirstConnect(r => { release = r; });

  const pA = sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  const pB = sm.createAndJoin(guild(), voiceCh('B'), 'u2');   // lock already held by A
  const rejected = assert.rejects(pB, e => e.name === 'UserError' && e.key === 'join_in_progress');
  await flush();
  release();

  const sA = await pA;
  await rejected;
  assert.equal(sm.getSession('g1'), sA);
  assert.equal(sA.voiceChannelId, 'A');
  assert.equal(globalThis.__players.length, 1, 'only one player was ever created');
  assert.equal(globalThis.__players[0].destroyed, false, 'first user\'s session was not torn down');
});

test('second caller in the SAME channel during a join shares the session', async () => {
  let release;
  globalThis.__player.connect = blockFirstConnect(r => { release = r; });

  const pA = sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  const pB = sm.createAndJoin(guild(), voiceCh('A'), 'u2');
  await flush();
  release();

  const [sA, sB] = await Promise.all([pA, pB]);
  assert.equal(sA, sB);
  assert.equal(globalThis.__players.length, 1);
});

test('a join that never finishes makes the waiting caller fail instead of stealing the bot', async (t) => {
  let release;
  globalThis.__player.connect = blockFirstConnect(r => { release = r; });
  const pA = sm.createAndJoin(guild(), voiceCh('A'), 'u1');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pB = sm.createAndJoin(guild(), voiceCh('B'), 'u2');
  const rejected = assert.rejects(pB, e => e.name === 'UserError' && e.key === 'join_in_progress');
  for (let i = 0; i < 12; i++) { t.mock.timers.tick(500); await flush(); }
  await rejected;
  t.mock.timers.reset();

  release();
  const sA = await pA;
  assert.equal(sm.getSession('g1'), sA);
  assert.equal(globalThis.__players.length, 1, 'the waiter never created a second player');
  assert.equal(globalThis.__players[0].destroyed, false);
});

// ── queue ───────────────────────────────────────────────────────────────────
test('enqueue refuses when there is no session', () => {
  assert.equal(sm.enqueue('g1', { surah: { number: 1 } }), false);
});

test('enqueue accepts items up to MAX_QUEUE, then refuses without growing the queue', async () => {
  await sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  assert.equal(sm.MAX_QUEUE, 100);
  for (let i = 0; i < sm.MAX_QUEUE; i++) assert.equal(sm.enqueue('g1', { surah: { number: 1 } }), true);
  assert.equal(sm.enqueue('g1', { surah: { number: 1 } }), false);
  assert.equal(sm.getSession('g1').queue.length, sm.MAX_QUEUE);
});

test('queues are per guild', async () => {
  await sm.createAndJoin(guild('g1'), voiceCh('A'), 'u1');
  await sm.createAndJoin(guild('g2'), voiceCh('B'), 'u2');
  sm.enqueue('g1', { surah: { number: 1 } });
  assert.equal(sm.getSession('g1').queue.length, 1);
  assert.equal(sm.getSession('g2').queue.length, 0);
});

test('clearQueue empties the queue', async () => {
  await sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  sm.enqueue('g1', { surah: { number: 1 } });
  sm.clearQueue('g1');
  assert.equal(sm.getSession('g1').queue.length, 0);
});

// ── language ────────────────────────────────────────────────────────────────
test('setSessionLanguage updates a running session and ignores guilds without one', async () => {
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en');
  sm.setSessionLanguage('g1', 'ar');
  assert.equal(s.language, 'ar');
  assert.doesNotThrow(() => sm.setSessionLanguage('nope', 'ar'));
});

// ── timers + "why did the bot leave" notice ──────────────────────────────────
test('auto-leave posts a localised notice, then destroys the session', async (t) => {
  const { client, sent } = makeClient();
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'ar', client);
  s.textChannelId = 'text1';

  t.mock.timers.enable({ apis: ['setTimeout'] });
  sm.startAutoLeaveTimer('g1', 1000);
  t.mock.timers.tick(1000);
  await flush(); await flush();

  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /[\u0600-\u06FF]/, 'Arabic session → Arabic notice');
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(sm.getSession('g1'), null);
});

test('sleep timer posts the English sleep notice', async (t) => {
  const { client, sent } = makeClient();
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en', client);
  s.textChannelId = 'text1';

  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(sm.setSleepTimer('g1', 2000), true);
  t.mock.timers.tick(2000);
  await flush(); await flush();

  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /Sleep timer finished/);
  assert.equal(sm.getSession('g1'), null);
});

test('no remembered channel, or no permission → no notice, but the session is still closed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let { client, sent } = makeClient();
  await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en', client);          // textChannelId never set
  sm.startAutoLeaveTimer('g1', 500);
  t.mock.timers.tick(500); await flush(); await flush();
  assert.equal(sent.length, 0);
  assert.equal(sm.getSession('g1'), null);

  ({ client, sent } = makeClient({ canSend: false }));
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en', client);
  s.textChannelId = 'text1';
  sm.startAutoLeaveTimer('g1', 500);
  t.mock.timers.tick(500); await flush(); await flush();
  assert.equal(sent.length, 0);
  assert.equal(sm.getSession('g1'), null);
});

test('clearAutoLeaveTimer prevents the leave', async (t) => {
  const { client, sent } = makeClient();
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en', client);
  s.textChannelId = 'text1';

  t.mock.timers.enable({ apis: ['setTimeout'] });
  sm.startAutoLeaveTimer('g1', 1000);
  sm.clearAutoLeaveTimer('g1');
  t.mock.timers.tick(5000); await flush();

  assert.equal(sent.length, 0);
  assert.ok(sm.getSession('g1'));
});

// ── capacity guard (RAM) ────────────────────────────────────────────────────
test('a NEW guild session is refused at MAX_SESSIONS, but a guild may replace its own session', async () => {
  const cap = sm.MAX_SESSIONS;
  const ids = Array.from({ length: cap }, (_, i) => `cap${i}`);
  try {
    for (const id of ids) await sm.createAndJoin(guild(id), voiceCh('A'), 'u1');
    await assert.rejects(
      sm.createAndJoin(guild('overflow'), voiceCh('A'), 'u2'),
      err => err.code === 'CAPACITY'
    );
    assert.equal(sm.getSession('overflow'), null, 'no session was created for the refused guild');
    await assert.doesNotReject(sm.createAndJoin(guild(ids[0]), voiceCh('B'), 'u3'));   // replace own → allowed
    assert.equal(sm.getSession(ids[0]).voiceChannelId, 'B');
  } finally {
    for (const id of ids) await sm.destroySession(id);
  }
});

// ── control panel cleanup ───────────────────────────────────────────────────
/** Fake client whose text channel records which messages were deleted. */
function makePanelClient({ failDelete = false } = {}) {
  const deleted = [];
  const channel = {
    messages: { delete: async (id) => { if (failDelete) throw new Error('Unknown Message'); deleted.push(id); } },
  };
  return { deleted, client: { channels: { cache: { get: (id) => (id === 'text1' ? channel : undefined) } } } };
}

test('deletePanel removes the panel message and forgets it', async () => {
  const { client, deleted } = makePanelClient();
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'm1' };
  await sm.deletePanel('g1');
  assert.deepEqual(deleted, ['m1']);
  assert.equal(s.panelMessage, null);
});

test('deletePanel is a no-op without a session or panel, and survives a failed delete', async () => {
  await assert.doesNotReject(sm.deletePanel('nope'));
  const { client } = makePanelClient({ failDelete: true });
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1', 'en', client);
  await assert.doesNotReject(sm.deletePanel('g1'));            // no panel yet
  s.panelMessage = { channelId: 'text1', messageId: 'gone' };
  await assert.doesNotReject(sm.deletePanel('g1'));            // Discord says the message is already gone
  assert.equal(s.panelMessage, null);
});

// ── modes that refill the queue ─────────────────────────────────────────────
test('setMemorizeMode switches the khatma off (otherwise surah+1 would play instead of the repeats)', async () => {
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  s.fullQuran = true; s.loop = true;
  assert.equal(sm.setMemorizeMode('g1', { repeatCount: 3, delayMs: 0 }), true);
  assert.equal(s.fullQuran, false);
  assert.equal(s.loop, false);
  assert.deepEqual(s.memorize, { repeatCount: 3, delayMs: 0, currentRep: 0 });
});

test('stopAutoModes reports whether a khatma / loop / memorize was running, and turns all of them off', async () => {
  const s = await sm.createAndJoin(guild(), voiceCh('A'), 'u1');
  assert.equal(sm.stopAutoModes('g1'), false, 'nothing was on');
  s.fullQuran = true;
  assert.equal(sm.stopAutoModes('g1'), true, 'an empty queue with a khatma running is still something to stop');
  assert.equal(s.fullQuran, false);
  s.memorize = { repeatCount: 2, delayMs: 0, currentRep: 0 }; s.loop = true;
  assert.equal(sm.stopAutoModes('g1'), true);
  assert.equal(s.memorize, null);
  assert.equal(s.loop, false);
  assert.equal(sm.stopAutoModes('nope'), false, 'no session');
});
