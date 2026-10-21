// /pull — moving a recitation to another voice room without losing the place.
// The voice player, models, logger and Quran API are stubs (test-helpers/hooks.mjs); the session manager, the transfer code and the
// decision logic are the real code.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const sm = await import('../src/managers/sessionManager.js');
const tr = await import('../src/managers/sessionTransfer.js');
const { runPull, describePulled, _resetPullGate } = await import('../src/services/pullService.js');
const { getSurahByNumber } = await import('../src/data/surahs.js');

const flush = () => new Promise(r => setImmediate(r));
const reciter = { id: 7, displayName: 'Reciter', moshaf: [{ name: 'Hafs' }] };
const guild = (id = 'g1', rooms = {}) => ({ id, name: 'Guild', client: {}, channels: { cache: { get: (c) => rooms[c], }, fetch: async (c) => rooms[c] ?? null }, members: { me: {} } });
const room = (id, extra = {}) => ({ id, name: `room-${id}`, ...extra });
const deps = { surahByNumber: getSurahByNumber, findReciterById: async (id) => (String(id) === '7' ? structuredClone(reciter) : null), findReciter: async (n) => (n === 'Reciter' ? structuredClone(reciter) : null), findDefaultReciter: async () => structuredClone(reciter) };

let plays;
beforeEach(() => {
  plays = [];
  _resetPullGate();
  globalThis.__players = [];
  globalThis.__urls = (r, n) => [{ url: `https://x/${String(n).padStart(3, '0')}.mp3`, riwaya: 'Hafs' }, { url: `https://y/${n}.mp3`, riwaya: 'Other' }];
  globalThis.__player = { play: (url, opts, p) => { plays.push({ url, opts, player: p }); } };
});
afterEach(async () => { await sm.destroySession('g1'); await sm.destroySession('g2'); });

/** A running recitation of surah 18 that has been playing for `playedMs`, with something queued. */
async function listening({ playedMs = 65_000, channel = 'A', extra } = {}) {
  const g = guild('g1');
  const s = await sm.createAndJoin(g, room(channel), 'u1', 'ar', {});
  sm.enqueue('g1', { surah: getSurahByNumber(18), reciter: 'Reciter', reciterObj: structuredClone(reciter) });
  sm.enqueue('g1', { surah: getSurahByNumber(36), reciter: 'Reciter', reciterObj: structuredClone(reciter) });
  await sm.playNext('g1');
  s.player.pos = playedMs;
  if (extra) extra(s);
  plays.length = 0;
  return { g, s };
}

// ── starting from a position ──────────────────────────────────────────────────────────────────────────────────────────────
test('a track started with a position tells the player where to begin and remembers the offset', async () => {
  const g = guild('g1');
  const s = await sm.createAndJoin(g, room('A'), 'u1', 'ar', {});
  sm.enqueue('g1', { surah: getSurahByNumber(18), reciter: 'R', reciterObj: reciter, startMs: 123_000 });
  await sm.playNext('g1');
  assert.deepEqual(plays[0].opts, { startMs: 123_000 });
  assert.equal(s.current.offsetMs, 123_000);
  assert.equal(tr.exportSession('g1').positionMs, 123_000, 'position = offset + what has played since (0 here)');
  s.player.pos = 7_000;
  assert.equal(tr.exportSession('g1').positionMs, 130_000);
});

test('a normal track has no offset and no seek option; the recording it was on is tried first when asked', async () => {
  await sm.createAndJoin(guild('g1'), room('A'), 'u1', 'ar', {});
  sm.enqueue('g1', { surah: getSurahByNumber(18), reciter: 'R', reciterObj: reciter });
  await sm.playNext('g1');
  assert.equal(plays[0].opts, undefined);
  assert.equal(sm.getSession('g1').current.offsetMs, 0);

  plays.length = 0;
  sm.enqueue('g1', { surah: getSurahByNumber(36), reciter: 'R', reciterObj: reciter, startMs: 5_000, preferUrl: 'https://y/36.mp3' });
  sm.skipSession('g1');
  await flush(); await flush();
  assert.equal(plays[0].url, 'https://y/36.mp3', 'the same recording as before, so the position still matches');
});

test('a position past the end of the recording is treated as "finished": the next item plays, the surah is not replayed', async () => {
  globalThis.__player.play = (url, opts, p) => { plays.push({ url, opts }); if (opts?.startMs) throw new Error('seek-past-end'); };
  await sm.createAndJoin(guild('g1'), room('A'), 'u1', 'ar', {});
  sm.enqueue('g1', { surah: getSurahByNumber(18), reciter: 'R', reciterObj: reciter, startMs: 9_999_999 });
  sm.enqueue('g1', { surah: getSurahByNumber(36), reciter: 'R', reciterObj: reciter });
  await sm.playNext('g1');
  assert.equal(sm.getSession('g1').current.surah.number, 36);
  assert.equal(plays.filter(p => p.opts?.startMs).length, 1, 'tried once, not once per recording');
});

// ── moving the same bot ───────────────────────────────────────────────────────────────────────────────────────────────────
test('alone in the old room: the bot moves and continues the same surah from the same second, with the same queue', async () => {
  const { g } = await listening({ playedMs: 65_000 });
  const oldPlayer = globalThis.__players[0];
  const B = room('B');
  const { state, fromChannelId, session } = await tr.moveSession({ guild: g, voiceChannel: B, userId: 'u1', lang: 'ar', client: {} }, deps);

  assert.equal(fromChannelId, 'A');
  assert.equal(state.positionMs, 65_000);
  assert.equal(oldPlayer.destroyed, true, 'left the old room');
  assert.equal(session.voiceChannelId, 'B');
  assert.equal(sm.getSession('g1'), session);
  assert.equal(plays.length, 1);
  assert.equal(plays[0].opts.startMs, 65_000, 'resumed at the exact second');
  assert.equal(plays[0].url, 'https://x/018.mp3', 'same recording');
  assert.equal(session.current.surah.number, 18);
  assert.deepEqual(session.queue.map(q => q.surah.number), [36], 'what comes next is kept');
});

test('modes, volume and pause survive the move', async () => {
  const { g } = await listening({ extra: (s) => { s.fullQuran = true; s.volume = 70; s.memorize = { repeatCount: 5, delayMs: 1000, currentRep: 2 }; sm.pauseSession('g1'); } });
  await tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, deps);
  const s = sm.getSession('g1');
  assert.equal(s.fullQuran, true);
  assert.equal(s.volume, 70);
  assert.deepEqual(s.memorize, { repeatCount: 5, delayMs: 1000, currentRep: 2 });
  assert.equal(s.status, 'paused', 'a paused recitation stays paused');
});

test('a live radio station tunes in again in the new room; an idle bot just joins', async () => {
  const g = guild('g1');
  await sm.createAndJoin(g, room('A'), 'u1', 'en', {});
  await sm.playRadio('g1', { id: 's', name: 'Makkah', url: 'https://r/stream' });
  plays.length = 0;
  await tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, deps);
  assert.equal(plays[0].url, 'https://r/stream');
  assert.deepEqual(plays[0].opts, { live: true });
  assert.equal(sm.getSession('g1').current.isRadio, true);

  await sm.destroySession('g1');
  await sm.createAndJoin(g, room('A'), 'u1', 'en', {});
  const { session } = await tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, deps);
  assert.equal(session.voiceChannelId, 'B');
  assert.equal(session.current, null);
});

test('the sleep timer keeps its remaining time in the new room', async (t) => {
  const { g } = await listening({ extra: () => sm.setSleepTimer('g1', 600_000) });
  await tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, deps);
  const s = sm.getSession('g1');
  assert.ok(s.sleepTimer, 'timer re-armed');
  assert.ok(s.sleepEndsAt - Date.now() > 590_000 && s.sleepEndsAt - Date.now() <= 600_000);
  t.mock.timers?.reset?.();
});

test('refusals: nothing running, already in that room', async () => {
  const g = guild('g1');
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('B'), client: {} }, deps), e => e.key === 'pull_no_session');
  await listening();
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('A'), client: {} }, deps), e => e.key === 'pull_already_here');
});

test('refused BEFORE leaving (another bot in the new room): the old session is untouched, nothing is torn down', async () => {
  const { g, s } = await listening();
  const player = globalThis.__players[0];
  const busyRoom = room('B', { members: new Map([['m1', { id: 'm1', user: { bot: true, tag: 'Music#1' } }]]) });
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: busyRoom, client: {} }, deps), e => e.key === 'other_bot_in_voice');
  assert.equal(sm.getSession('g1'), s);
  assert.equal(player.destroyed, false);
  assert.equal(globalThis.__players.length, 1, 'no second player was created');
});

test('the new room cannot be joined: the bot goes back to the old room and continues from where it was', async () => {
  const { g } = await listening({ playedMs: 65_000 });
  let first = true;
  globalThis.__player.connect = async () => { if (first) { first = false; throw new Error('voice join timeout'); } };
  g.channels.cache.get = (c) => (c === 'A' ? room('A') : undefined);
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, deps), /voice join timeout/);
  // (the first connect() belongs to the failed attempt in B; the next one is the way back)
  const back = sm.getSession('g1');
  assert.ok(back, 'a session exists again');
  assert.equal(back.voiceChannelId, 'A');
  assert.equal(back.current.surah.number, 18);
  assert.equal(plays.at(-1).opts.startMs, 65_000, 'continues at the same second');
});

test('the recitation cannot be started in the new room: reported as a user-facing error, bot goes back', async () => {
  const { g } = await listening();
  const badDeps = { ...deps, findReciterById: async () => null, findReciter: async () => null, findDefaultReciter: async () => null };
  g.channels.cache.get = (c) => (c === 'A' ? room('A') : undefined);
  // the live reciter objects are kept for a local move, so break playback instead: nothing playable
  globalThis.__urls = () => [];
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, badDeps), e => e.key === 'pull_resume_failed');
});

// ── a copy for another bot ────────────────────────────────────────────────────────────────────────────────────────────────
test('applyState on a state that came through the database: reciter looked up by id, queue rebuilt, position honoured', async () => {
  const { toWire, normalizeWire } = await import('../src/services/transferState.js');
  await listening({ playedMs: 200_000 });
  const wire = JSON.parse(JSON.stringify(toWire(tr.exportSession('g1'))));
  await sm.destroySession('g1');

  const g2 = guild('g2');
  await sm.createAndJoin(g2, room('C'), 'u2', 'ar', {});
  plays.length = 0;
  assert.equal(await tr.applyState('g2', normalizeWire(wire), deps), true);
  const at = plays[0].opts.startMs;
  assert.ok(at >= 200_000 && at < 205_000, `position honoured (plus the few ms the hand-over took): ${at}`);
  const s = sm.getSession('g2');
  assert.equal(s.current.surah.number, 18);
  assert.deepEqual(s.queue.map(q => q.surah.number), [36]);
});

test('applyState: unknown reciter falls back to the default one; nothing playable → false', async () => {
  const g = guild('g1');
  await sm.createAndJoin(g, room('A'), 'u1', 'ar', {});
  const noLookup = { ...deps, findReciterById: async () => null, findReciter: async () => null };
  assert.equal(await tr.applyState('g1', { surah: 18, reciterId: '999', reciter: 'Nobody', positionMs: 1000, queue: [], volume: 100 }, noLookup), true);
  assert.equal(sm.getSession('g1').current.surah.number, 18);

  await sm.destroySession('g1');
  await sm.createAndJoin(g, room('A'), 'u1', 'ar', {});
  globalThis.__urls = () => [];
  assert.equal(await tr.applyState('g1', { surah: 18, positionMs: 1000, queue: [], volume: 100 }, deps), false);
});

// ── the whole command flow (runPull) ──────────────────────────────────────────────────────────────────────────────────────
const U = 'u1';
function world({ own = null, workers = [], listenersIn = {}, perms = true, exported = null, canView = true, left = ['A'], manager = false } = {}) {
  const log = { moved: [], jobs: [], commands: [], joined: [], applied: [], panels: 0, destroyed: 0 };
  const rooms = {};
  for (const [id, n] of Object.entries(listenersIn)) rooms[id] = { id, permissionsFor: () => ({ has: () => canView }), members: new Map(Array.from({ length: n }, (_, i) => [`h${id}${i}`, { id: `h${id}${i}`, user: { bot: false } }]).concat([['bot1', { id: 'bot1', user: { bot: true } }]])) };
  const voice = { id: 'B', type: 2, userLimit: 0, members: { size: 1 }, permissionsFor: () => ({ has: () => perms }) };
  const guild = { id: 'g1', members: { me: {} }, channels: { cache: { get: (c) => rooms[c] } } };
  const client = { user: { id: 'main' } };
  const d = {
    getSiblings: async () => workers,
    getSession: () => own,
    exportSession: () => exported,
    moveSession: async (a) => { log.moved.push(a.voiceChannel.id); return { state: { surah: 18, positionMs: 65_000, queue: [] }, fromChannelId: own.voiceChannelId }; },
    applyState: async (gid, st) => { log.applied.push(st); return true; },
    createAndJoin: async (...a) => { log.joined.push(a[1].id); },
    destroySession: async () => { log.destroyed++; },
    dispatchJob: async (j) => { log.jobs.push(j); return { id: `job${log.jobs.length}` }; },
    waitForJob: async () => ({ status: 'done', panel: true }),
    sendWorkerCommand: async (c) => { log.commands.push(c); return { ok: true, result: exported }; },
    sendVoicePanel: async () => { log.panels++; return {}; },
    quran: {}
  };
  for (const id of [own?.voiceChannelId, ...workers.map(x => x.busyChannelId)]) if (id && !rooms[id]) rooms[id] = { id, members: new Map(), permissionsFor: () => ({ has: () => canView }) };
  return { ctx: { guild, client, userId: U, voice, lang: 'ar', hintChannelId: null, member: { id: U }, leftChannelIds: left, isManager: manager }, deps: d, log };
}
const ownIn = (channel) => ({ voiceChannelId: channel });
const worker = (id, busy = null) => ({ id, role: 'secondary', busyChannelId: busy });
const stateOf = { surah: 18, positionMs: 65_000, volume: 100, fullQuran: false, loop: false, queue: [], reciter: 'R' };

test('/pull alone, main bot: it moves itself and posts its panel in the new room', async () => {
  const w = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.ok, true);
  assert.deepEqual([r.kind, r.botId, r.fromChannelId], ['move', 'main', 'A']);
  assert.deepEqual(w.log.moved, ['B']);
  assert.equal(w.log.panels, 1);
  assert.equal(w.log.jobs.length, 0, 'no second bot involved');
  assert.deepEqual(describePulled(r.state, 'ar').time, '1:05');
});

test('/pull alone, recitation belongs to the second bot: it is asked (through the database) to move itself', async () => {
  const w = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.ok, true);
  assert.deepEqual([r.kind, r.botId], ['move', 'w1']);
  assert.deepEqual(w.log.jobs.map(j => [j.targetBotId, j.intent.kind, j.voiceChannelId, j.userId]), [['w1', 'move', 'B', U]]);
  assert.equal(w.log.moved.length, 0);
});

test('/pull with people staying behind: a free second bot continues a copy from the same second; the first one stays', async () => {
  const w = world({ own: ownIn('A'), workers: [worker('w1')], listenersIn: { A: 2 }, exported: stateOf });
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.ok, true);
  assert.deepEqual([r.kind, r.botId, r.fromBotId, r.fromChannelId], ['clone', 'w1', 'main', 'A']);
  const [job] = w.log.jobs;
  assert.equal(job.targetBotId, 'w1');
  assert.equal(job.intent.kind, 'resume');
  assert.equal(job.intent.state.surah, 18);
  assert.equal(job.intent.state.positionMs, 65_000);
  assert.equal(w.log.moved.length, 0, 'the main bot did NOT leave the people in the old room');
});

test('/pull with people staying behind, the recitation is on a second bot and the main bot is free: the main bot is the copy', async () => {
  const w = world({ workers: [worker('w1', 'A')], listenersIn: { A: 1 }, exported: stateOf });
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.ok, true);
  assert.deepEqual([r.kind, r.botId, r.fromBotId], ['clone', 'main', 'w1']);
  assert.deepEqual(w.log.commands.map(c => [c.targetBotId, c.action]), [['w1', 'export']], 'asked the second bot where exactly it is');
  assert.deepEqual(w.log.joined, ['B']);
  assert.equal(w.log.applied[0].positionMs, 65_000);
  assert.equal(w.log.panels, 1);
});

test('/pull with people staying behind and no free bot: told why, nobody is moved', async () => {
  const w = world({ own: ownIn('A'), listenersIn: { A: 2 }, exported: stateOf });
  const r = await runPull(w.ctx, w.deps);
  assert.deepEqual([r.ok, r.key], [false, 'pull_no_free_bot']);
  assert.equal(w.log.moved.length + w.log.jobs.length + w.log.joined.length, 0);
});

test('/pull errors: not in voice, already here, nothing running, no permission, second bot silent / failing', async () => {
  const _r = _resetPullGate;
  const w0 = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  _r();assert.equal((await runPull({ ...w0.ctx, voice: null }, w0.deps)).key, 'not_in_voice');

  const w1 = world({ own: ownIn('B') });
  _r();assert.equal((await runPull(w1.ctx, w1.deps)).key, 'pull_already_here');

  const w2 = world();
  _r();assert.equal((await runPull(w2.ctx, w2.deps)).key, 'pull_no_session');

  const w3 = world({ own: ownIn('A'), listenersIn: { A: 0 }, perms: false });
  _r();assert.equal((await runPull(w3.ctx, w3.deps)).key, 'no_permission_view', 'the main bot checks it can really join the member\'s room BEFORE leaving its own');
  assert.equal(w3.log.moved.length, 0);

  const w4 = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  w4.deps.waitForJob = async () => ({ status: 'timeout' });
  _r();assert.equal((await runPull(w4.ctx, w4.deps)).key, 'worker_timeout');

  const w5 = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  w5.deps.waitForJob = async () => ({ status: 'failed', error: { key: 'no_permission_connect', vars: {} } });
  _r();const r5 = await runPull(w5.ctx, w5.deps);
  assert.deepEqual([r5.ok, r5.key], [false, 'no_permission_connect']);

  const w6 = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  w6.deps.dispatchJob = async () => ({ busy: true });
  _r();assert.equal((await runPull(w6.ctx, w6.deps)).key, 'worker_pending');
});

test('/pull: an unexpected failure becomes "unexpected error + code", a refusal keeps its own message', async () => {
  const { UserError } = await import('../src/utils/errors.js');
  const w = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  w.deps.moveSession = async () => { throw new UserError('other_bot_in_voice', { bots: '<@1>', channel: '<#B>' }); };
  const r = await runPull(w.ctx, w.deps);
  assert.deepEqual([r.ok, r.key], [false, 'other_bot_in_voice']);

  w.deps.moveSession = async () => { throw new Error('boom'); };
  _resetPullGate();
  const r2 = await runPull(w.ctx, w.deps);
  assert.deepEqual([r2.ok, r2.key], [false, 'unexpected']);
  assert.match(r2.vars.code, /^E-[0-9A-F]{6}$/);
});

test('/pull: a copy that cannot start does not leave a silent bot in the room', async () => {
  const w = world({ workers: [worker('w1', 'A')], listenersIn: { A: 1 }, exported: stateOf });
  w.deps.applyState = async () => false;
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.key, 'pull_resume_failed');
  assert.equal(w.log.destroyed, 1);
});

test('describePulled: surah + time, radio name, nothing', () => {
  assert.deepEqual(describePulled({ surah: 18, positionMs: 754_000 }, 'en'), { what: '18. Al-Kahf · الكهف', time: '12:34' });
  assert.deepEqual(describePulled({ radio: { name: 'Makkah' } }, 'en'), { what: 'Makkah', time: null });
  assert.deepEqual(describePulled({ surah: null }, 'en'), { what: null, time: null });
  assert.deepEqual(describePulled(null, 'en'), { what: null, time: null });
});

// ── security: who may pull, what they may see, how often ───────────────────────────────────────────────────────────────────
test('a stranger who never was in that room cannot drag its recitation (or a free bot) away', async () => {
  const w = world({ own: ownIn('A'), workers: [worker('w1')], listenersIn: { A: 3 }, exported: stateOf, left: [] });
  const r = await runPull(w.ctx, w.deps);
  assert.deepEqual([r.ok, r.key], [false, 'pull_not_allowed']);
  assert.equal(w.log.jobs.length + w.log.moved.length + w.log.joined.length, 0);

  _resetPullGate();
  const other = world({ own: ownIn('A'), listenersIn: { A: 0 }, left: ['Z'] });   // left some OTHER room
  assert.equal((await runPull(other.ctx, other.deps)).key, 'pull_not_allowed');
});

test('who may pull: the room they just left, the session starter, or a server manager', async () => {
  const mgr = world({ own: ownIn('A'), listenersIn: { A: 0 }, left: [], manager: true });
  assert.equal((await runPull(mgr.ctx, mgr.deps)).ok, true);
  _resetPullGate();
  const starter = world({ own: { voiceChannelId: 'A', ownerId: U }, listenersIn: { A: 0 }, left: [] });
  assert.equal((await runPull(starter.ctx, starter.deps)).ok, true);
});

test('rooms the member cannot see are never pulled from and never named', async () => {
  const w = world({ own: ownIn('A'), listenersIn: { A: 0 }, canView: false });
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.key, 'pull_no_session', 'as if nothing were running');
  assert.ok(!JSON.stringify(r.vars).includes('<#A>'), 'the hidden room is not named');
  assert.equal(w.log.moved.length, 0);
});

test('pulls are rate limited per server and never overlap', async () => {
  const w = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  assert.equal((await runPull(w.ctx, w.deps)).ok, true);
  assert.equal((await runPull(w.ctx, w.deps)).key, 'pull_too_fast', 'immediately again');

  _resetPullGate();
  let release;
  const slow = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  slow.deps.moveSession = () => new Promise(r => { release = () => r({ state: { surah: 1, positionMs: 0, queue: [] }, fromChannelId: 'A' }); });
  const first = runPull(slow.ctx, slow.deps);
  await flush();
  const other = { ...slow.ctx, userId: 'someone-else' };
  assert.equal((await runPull(other, slow.deps)).key, 'pull_too_fast', 'while the first is still running');
  release();
  assert.equal((await first).ok, true);
});

test('one member spamming /pull cannot block other members (the cooldown is per member)', async () => {
  const stranger = world({ own: ownIn('A'), listenersIn: { A: 0 }, left: [] });
  assert.equal((await runPull(stranger.ctx, stranger.deps)).key, 'pull_not_allowed');
  const legit = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  const r = await runPull({ ...legit.ctx, userId: 'u-legit' }, legit.deps);
  assert.equal(r.ok, true);
});

test('A → C → B: the room they passed through does not hide the room they listened in', async () => {
  const w = world({ own: ownIn('A'), listenersIn: { A: 0 }, left: ['C', 'A'] });
  assert.equal((await runPull(w.ctx, w.deps)).ok, true);
});

test('waiting for a second bot allows time for a long surah to be decoded', async () => {
  const w = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  let asked;
  w.deps.waitForJob = async (id, o) => { asked = o; return { status: 'done', panel: true }; };
  await runPull(w.ctx, w.deps);
  assert.ok(asked.timeoutMs >= 60_000);
});

// ── fixes: re-check before moving, catch-up time, pull window ─────────────────────────────────────────────────────────────
const { resumeLagMs, normalizeWire, exportState, toWire } = await import('../src/services/transferState.js');
const { normalizeIntent } = await import('../src/services/playerJobs.js');
const human = (id) => [id, { id, user: { bot: false } }];

test('move with requireEmpty: somebody who walked into the old room meanwhile keeps the bot — nothing is torn down', async () => {
  const { g, s } = await listening();
  const player = globalThis.__players[0];
  g.channels.cache.get = (c) => (c === 'A' ? room('A', { members: new Map([human('late-comer'), human('u1')]) }) : undefined);
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {}, requireEmpty: true }, deps), e => e.key === 'pull_someone_joined');
  assert.equal(sm.getSession('g1'), s);
  assert.equal(player.destroyed, false);
});

test('move with requireEmpty: the member who is pulling (and bots) do not count as people staying', async () => {
  const { g } = await listening();
  g.channels.cache.get = (c) => (c === 'A' ? room('A', { members: new Map([human('u1'), ['b', { id: 'b', user: { bot: true } }]]) }) : undefined);
  const r = await tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {}, requireEmpty: true }, deps);
  assert.equal(r.fromChannelId, 'A');
  assert.equal(sm.getSession('g1').voiceChannelId, 'B');
});

test('/pull alone asks for that re-check, locally and through the second bot', async () => {
  const local = world({ own: ownIn('A'), listenersIn: { A: 0 } });
  let seen;
  local.deps.moveSession = async (a) => { seen = a; return { state: { surah: 18, positionMs: 0, queue: [] }, fromChannelId: 'A' }; };
  await runPull(local.ctx, local.deps);
  assert.equal(seen.requireEmpty, true);

  _resetPullGate();
  const remote = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  await runPull(remote.ctx, remote.deps);
  assert.deepEqual(remote.log.jobs[0].intent, { kind: 'move', requireEmpty: true });
});

test('normalizeIntent: requireEmpty survives only on a move, and only when it is literally true', () => {
  assert.deepEqual(normalizeIntent({ kind: 'move', requireEmpty: true }), { kind: 'move', requireEmpty: true });
  assert.deepEqual(normalizeIntent({ kind: 'move', requireEmpty: 'yes' }), { kind: 'move' });
  assert.deepEqual(normalizeIntent({ kind: 'move' }), { kind: 'move' });
  assert.deepEqual(normalizeIntent({ kind: 'join', requireEmpty: true }), { kind: 'join' });
});

test('resumeLagMs: time since the export for a playing copy; nothing when paused / idle / unknown; capped', () => {
  const st = (o) => ({ surah: 18, paused: false, exportedAt: 1_000_000, ...o });
  assert.equal(resumeLagMs(st(), 1_007_000), 7_000);
  assert.equal(resumeLagMs(st({ paused: true }), 1_007_000), 0);
  assert.equal(resumeLagMs(st({ surah: null }), 1_007_000), 0, 'idle: no position to correct');
  assert.equal(resumeLagMs(st({ exportedAt: null }), 1_007_000), 0);
  assert.equal(resumeLagMs(st({ exportedAt: undefined }), 1_007_000), 0);
  assert.equal(resumeLagMs(st({ exportedAt: 2_000_000 }), 1_007_000), 0, 'clock ahead of ours → never negative');
  assert.equal(resumeLagMs(st(), 1_000_000 + 3_600_000), 120_000, 'capped');
  assert.equal(resumeLagMs(null), 0);
});

test('exportedAt travels through the wire format and a garbage value is dropped', () => {
  const s = exportState({ ownerId: null, language: 'ar', volume: 100, status: 'playing', queue: [], player: { positionMs: () => 0 },
    current: { surah: { number: 18 }, reciter: 'R', reciterObj: reciter, startedAt: 1 } });
  assert.ok(Number.isInteger(s.exportedAt));
  assert.equal(normalizeWire(toWire(s)).exportedAt, s.exportedAt);
  assert.equal(normalizeWire({ ...toWire(s), exportedAt: 'soon' }).exportedAt, null);
  assert.equal(normalizeWire({ ...toWire(s), exportedAt: -5 }).exportedAt, null);
});

test('a copy that is started late skips the time the hand-over took; a paused one does not; a move adds nothing', async () => {
  await sm.createAndJoin(guild('g1'), room('A'), 'u1', 'ar', {});
  const base = { surah: 18, positionMs: 10_000, queue: [], volume: 100 };
  assert.equal(await tr.applyState('g1', { ...base, exportedAt: Date.now() - 5_000 }, deps), true);
  const lagged = plays.at(-1).opts.startMs;
  assert.ok(lagged >= 14_900 && lagged <= 16_000, `startMs ${lagged}`);

  await sm.destroySession('g1'); await sm.createAndJoin(guild('g1'), room('A'), 'u1', 'ar', {});
  await tr.applyState('g1', { ...base, paused: true, exportedAt: Date.now() - 5_000 }, deps);
  assert.equal(plays.at(-1).opts.startMs, 10_000);

  await sm.destroySession('g1');
  const { g } = await listening({ playedMs: 65_000 });
  await new Promise(r => setTimeout(r, 30));
  await tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {} }, deps);
  assert.equal(plays.at(-1).opts.startMs, 65_000, 'exactly where it stopped');
});

test('the pull window is not cut short when a surah ends in the empty room during it', async (t) => {
  const s = await sm.createAndJoin(guild('g1'), room('A'), 'u1', 'ar', {});
  s._client = { guilds: { cache: { get: () => ({ channels: { cache: { get: () => ({ members: { some: () => false } }) } } }) } } };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  sm.startAutoLeaveTimer('g1', 90_000, { empty: true, graceMs: 90_000 });   // the last listener moved to another room
  t.mock.timers.tick(40_000);
  sm.startAutoLeaveTimer('g1');                                             // what the end of the queue does
  t.mock.timers.tick(40_000);                                               // 80 s: used to be gone after 70 s
  await flush();
  assert.ok(sm.getSession('g1'), 'still here, /pull can still reach it');
  t.mock.timers.tick(11_000);                                               // 91 s: the window is over
  await flush(); await flush();
  assert.equal(sm.getSession('g1'), null);
});

test('someone coming back ends the pull window (it must not extend a later empty-room timer)', async () => {
  const s = await sm.createAndJoin(guild('g1'), room('A'), 'u1', 'ar', {});
  sm.startAutoLeaveTimer('g1', 90_000, { empty: true, graceMs: 90_000 });
  assert.ok(s.pullGraceUntil > Date.now());
  sm.onListenerArrived('g1');
  assert.equal(s.pullGraceUntil, null);
});

// ── fixes: per-room locks, still-joining message, panel after roll-back ───────────────────────────────────────────────────
test('pulls of DIFFERENT recitations in one server do not wait for each other; the same recitation is never pulled twice at once', async () => {
  const w = world({ own: ownIn('A'), workers: [worker('w1', 'C')], listenersIn: { A: 0, C: 0 }, left: ['A', 'C'] });
  let release;
  w.deps.moveSession = () => new Promise(r => { release = () => r({ state: { surah: 1, positionMs: 0, queue: [] }, fromChannelId: 'A' }); });
  const first = runPull({ ...w.ctx, hintChannelId: 'A', explicit: true }, w.deps);          // main bot's recitation in A, still running
  await flush(); await flush();
  const other = await runPull({ ...w.ctx, userId: 'u9', hintChannelId: 'C', explicit: true }, w.deps);   // the second bot's recitation in C
  assert.equal(other.ok, true, 'another room is not held up');
  const same = await runPull({ ...w.ctx, userId: 'u8', hintChannelId: 'A', explicit: true }, w.deps);
  assert.equal(same.key, 'pull_too_fast', 'the same recitation is taken');
  release();
  assert.equal((await first).ok, true);
});

test('a second bot that took the job but has not finished: "still joining", not "did not answer"', async () => {
  const w = world({ workers: [worker('w1', 'A')], listenersIn: { A: 0 } });
  w.deps.waitForJob = async () => ({ status: 'timeout', claimed: true });
  const r = await runPull(w.ctx, w.deps);
  assert.equal(r.key, 'worker_still_joining');
  const { describeOutcome } = await import('../src/services/playerJobs.js');
  assert.equal(describeOutcome({ status: 'timeout', claimed: true }, { botId: 'w1', channelId: 'B' }).key, 'errors.worker_still_joining');
  assert.equal(describeOutcome({ status: 'timeout' }, { botId: 'w1', channelId: 'B' }).key, 'errors.worker_timeout');
});

test('after a failed move the panel of the old room is put back', async () => {
  const { g } = await listening({ playedMs: 65_000 });
  let first = true;
  globalThis.__player.connect = async () => { if (first) { first = false; throw new Error('voice join timeout'); } };
  g.channels.cache.get = (c) => (c === 'A' ? room('A') : undefined);
  const panelFor = [];
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {}, afterRollBack: async (r) => { panelFor.push(r.id); } }, deps), /voice join timeout/);
  assert.deepEqual(panelFor, ['A']);
});

test('who may pull: a stay of a few seconds does not make someone that room\'s listener', async () => {
  const { rememberJoinedRoom, rememberLeftRoom, recentLeftRooms, _clearRecentRooms, MIN_STAY_MS } = await import('../src/utils/recentRooms.js');
  _clearRecentRooms();
  const t = 1_000_000;
  rememberJoinedRoom('g', 'u', 'A', t);               rememberLeftRoom('g', 'u', 'A', t + 2_000);               // 2 s: walked through
  rememberJoinedRoom('g', 'u', 'C', t + 3_000);       rememberLeftRoom('g', 'u', 'C', t + 3_000 + MIN_STAY_MS); // listened
  rememberLeftRoom('g', 'u', 'D', t + 100_000);                                                                  // no join record (bot restarted): benefit of the doubt
  const now = t + 110_000;
  assert.deepEqual(recentLeftRooms('g', 'u', now), ['D', 'C', 'A'], 'without a filter nothing changes');
  assert.deepEqual(recentLeftRooms('g', 'u', now, { minStayMs: MIN_STAY_MS }), ['D', 'C']);
  _clearRecentRooms();
});

test('a panel helper that throws never undoes a successful return to the old room', async () => {
  const { g } = await listening({ playedMs: 65_000 });
  let first = true;
  globalThis.__player.connect = async () => { if (first) { first = false; throw new Error('voice join timeout'); } };
  g.channels.cache.get = (c) => (c === 'A' ? room('A') : undefined);
  await assert.rejects(tr.moveSession({ guild: g, voiceChannel: room('B'), userId: 'u1', client: {}, afterRollBack: () => { throw new Error('no panel'); } }, deps), /voice join timeout/);
  assert.equal(sm.getSession('g1')?.voiceChannelId, 'A', 'still back in the old room');
});
