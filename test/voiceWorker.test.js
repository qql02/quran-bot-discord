// The voice-only second bot (BOT_ROLE=secondary): no slash commands, takes its work from the main bot through the shared database.
// This file runs in its own process, so the environment can be set before the config is first loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ID = '123456789012345678';
process.env.BOT_ROLE = 'secondary';
process.env.NODE_ENV = 'test';
process.env.DISCORD_TOKEN = `${Buffer.from(ID).toString('base64').replace(/=+$/, '')}.GabcDe.${'x'.repeat(27)}`;
process.env.MONGODB_URI = 'mongodb://localhost/test';
process.env.SESSION_SECRET = 'x'.repeat(40);

const { config, configIssues } = await import('../src/config.js');
const J = await import('../src/services/playerJobs.js');
const { pickDelegate } = await import('../src/services/siblingService.js');
const { envLine } = await import('../src/utils/envFile.js');
const { UserError } = await import('../src/utils/errors.js');

const G = '111111111111111111', V = '222222222222222222', V2 = '555555555555555555', U = '333333333333333333', B = '444444444444444444';
const SURAHS = [{ number: 1, arabic: 'الفاتحة', english: 'Al-Fatiha' }, { number: 18, arabic: 'الكهف', english: 'Al-Kahf' }];
const ALL = 11n;   // View(8) + Connect(1) + Speak(2) in the discord.js stub

const job = (over = {}) => ({ targetBotId: B, guildId: G, voiceChannelId: V, textChannelId: null, userId: U, lang: 'ar', intent: { kind: 'join' }, createdAt: new Date(), ...over });

/** A tiny world: one server, one voice room, a member in it, and fake player functions that record what happened. */
function world({ inRoom = true, perms = ALL, existing = null, type = 2, banned = false, synced = false, panelSent = true, joinFails = null, live = true } = {}) {
  const log = { joined: 0, enq: [], played: 0, cleared: 0, skipped: 0, radio: [], panel: 0 };
  let session = existing;
  const vc = { id: V, type, isVoiceBased: () => true, userLimit: 0, members: { size: 1 }, permissionsFor: () => ({ has: (b) => (perms & b) === b }) };
  const guild = {
    id: G, members: { me: {} },
    channels: { cache: { get: (id) => (id === V ? vc : null) } },
    voiceStates: { cache: { get: (id) => (id === U && inRoom ? { channelId: V } : undefined) } }
  };
  const client = { user: { id: B }, guilds: { cache: { get: (id) => (id === G ? guild : undefined) } } };
  const reciter = { id: 7, displayName: 'Reciter', moshaf: [{}] };
  const deps = {
    isBanned: async () => banned,
    getSession: () => session,
    createAndJoin: async () => { if (joinFails) throw joinFails; log.joined++; session = { voiceChannelId: V, status: 'idle', current: null }; return session; },
    enqueue: (gid, item) => { log.enq.push(item); return true; },
    playNext: async () => { log.played++; },
    clearQueue: () => { log.cleared++; },
    skipSession: () => { log.skipped++; },
    playRadio: async (gid, st) => { log.radio.push(st); },
    findReciterById: async (id) => (String(id) === '7' ? reciter : null),
    findReciter: async (n) => (n === 'Reciter' ? reciter : null),
    findDefaultReciter: async () => reciter,
    getPlayableUrls: async () => ['http://x/1.mp3'],
    resolveStation: async () => ({ id: 's', name: 'Radio', url: 'https://r/stream' }),
    stationIsLive: async () => live,
    syncPanel: async () => synced,
    sendVoicePanel: async () => { log.panel++; return panelSent ? { message: {}, channel: vc } : null; },
    surahs: SURAHS, surahByNumber: (n) => SURAHS.find(s => s.number === n) ?? null
  };
  return { client, deps, log, getSession: () => session };
}

// ── config / no commands ───────────────────────────────────────────────────────────────────────────────────────────

test('BOT_ROLE=secondary is read from the environment', () => {
  assert.equal(config.bot.role, 'secondary');
});

test('the voice-only bot starts cleanly without any dashboard settings (no client secret, no admin list, no public URL)', () => {
  assert.deepEqual(configIssues.errors, []);
  assert.ok(!configIssues.warnings.some(w => /DISCORD_CLIENT_SECRET|ADMIN_IDS|API_BASE_URL/.test(w)), configIssues.warnings.join(' | '));
});

test('the voice-only bot loads NO slash commands and skips the private-chat listener', async () => {
  const { loadCommands } = await import('../src/handlers/commandHandler.js');
  const { skipsEvent } = await import('../src/handlers/eventHandler.js');
  const client = {};
  await loadCommands(client);
  assert.equal(client.commands.size, 0, 'nothing to register with Discord');
  assert.equal(skipsEvent('messageCreate.js'), true);
  for (const f of ['interactionCreate.js', 'voiceStateUpdate.js', 'guildCreate.js', 'guildDelete.js', 'ready.js']) assert.equal(skipsEvent(f), false, f);
  assert.equal(skipsEvent('messageCreate.js', 'primary'), false, 'the main bot still answers private chats');
});

// ── pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

test('normalizeIntent: only known, well-formed intents survive', () => {
  assert.deepEqual(J.normalizeIntent(undefined), { kind: 'join' });
  assert.deepEqual(J.normalizeIntent({ kind: 'nope' }), { kind: 'join' });
  assert.deepEqual(J.normalizeIntent({ kind: 'recite', surah: 18, reciter: ' Reciter ', reciterId: 7 }), { kind: 'recite', surah: 18, reciter: 'Reciter', reciterId: '7' });
  assert.equal(J.normalizeIntent({ kind: 'recite', surah: null }).surah, null, 'null = the whole Quran');
  assert.deepEqual(J.normalizeIntent({ kind: 'recite', surah: 115 }), { kind: 'join' });
  assert.deepEqual(J.normalizeIntent({ kind: 'recite', surah: '18; drop' }), { kind: 'join' });
  assert.deepEqual(J.normalizeIntent({ kind: 'live', station: '' }), { kind: 'join' });
  assert.equal(J.normalizeIntent({ kind: 'live', station: 'x'.repeat(999) }).station.length, 300);
});

test('isValidJob: real snowflakes only, and never a stale job', () => {
  assert.equal(J.isValidJob(job()), true);
  assert.equal(J.isValidJob(job({ guildId: 'abc' })), false);
  assert.equal(J.isValidJob(job({ userId: '1' })), false);
  assert.equal(J.isValidJob(job({ textChannelId: 'x' })), false);
  assert.equal(J.isValidJob(job({ createdAt: new Date(Date.now() - J.JOB_MAX_AGE_MS - 1000) })), false);
  assert.equal(J.isValidJob(null), false);
});

test('pickDelegate: only voice-only siblings qualify; one already in the member\'s room wins', () => {
  const w = (id, room) => ({ id, role: 'secondary', busyChannelId: room });
  assert.deepEqual(pickDelegate([w('B', V)], V), { id: 'B', kind: 'here' });
  assert.deepEqual(pickDelegate([w('B', null)], V), { id: 'B', kind: 'free' });
  assert.deepEqual(pickDelegate([w('B', V2), w('C', null)], V), { id: 'C', kind: 'free' });
  assert.equal(pickDelegate([w('B', V2)], V), null, 'busy elsewhere → nobody');
  assert.equal(pickDelegate([{ id: 'P', role: 'primary', busyChannelId: null }], V), null, 'a full bot is not a worker');
  assert.equal(pickDelegate([], V), null);
});

test('envLine: quotes what dotenv would cut, and refuses anything that could inject another line', () => {
  assert.equal(envLine('A', 'abc.def'), 'A=abc.def');
  assert.equal(envLine('A', 'p#ss word'), "A='p#ss word'");
  assert.equal(envLine('A', "it's #x"), 'A="it\'s #x"');
  assert.throws(() => envLine('A', 'x\nBOT_ROLE=primary'), /line break/);
  assert.throws(() => envLine('A', 'x\r'), /line break/);
  assert.throws(() => envLine('a b', 'x'), /bad variable name/);
  assert.throws(() => envLine('A', `a'b"c d`), /quote/);
});

test('describeOutcome: what the member is told', () => {
  const at = { botId: B, channelId: V };
  assert.equal(J.describeOutcome({ status: 'done', panel: true }, at).key, 'misc.worker_joined');
  assert.equal(J.describeOutcome({ status: 'done', panel: false }, at).key, 'misc.worker_joined_nopanel');
  const f = J.describeOutcome({ status: 'failed', error: { key: 'no_permission_speak', vars: {} } }, at);
  assert.deepEqual([f.ok, f.key], [false, 'errors.no_permission_speak']);
  assert.deepEqual(J.describeOutcome({ status: 'failed', error: { code: 'E-ABCDEF' } }, at).vars, { code: 'E-ABCDEF' });
  assert.equal(J.describeOutcome({ status: 'timeout' }, at).key, 'errors.worker_timeout');
  assert.equal(J.describeOutcome({ status: 'cancelled' }, at).key, 'errors.worker_timeout');
});

// ── the worker ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('join: the bot enters the member\'s room and posts its own panel', async () => {
  const w = world();
  const r = await J.executeJob(job(), w.client, w.deps);
  assert.deepEqual(r, { ok: true, panel: true });
  assert.equal(w.log.joined, 1);
  assert.equal(w.log.panel, 1);
});

test('an existing panel is edited, not duplicated', async () => {
  const w = world({ synced: true });
  assert.equal((await J.executeJob(job(), w.client, w.deps)).ok, true);
  assert.equal(w.log.panel, 0);
});

test('joined but no place to write → still ok, flagged so the main bot can say so', async () => {
  const w = world({ panelSent: false });
  assert.deepEqual(await J.executeJob(job(), w.client, w.deps), { ok: true, panel: false });
});

test('the member who asked is not in that room (any more) → refused, the bot does not join', async () => {
  const w = world({ inRoom: false });
  const r = await J.executeJob(job(), w.client, w.deps);
  assert.deepEqual([r.ok, r.error.key], [false, 'not_in_voice']);
  assert.equal(w.log.joined, 0);
});

test('stale, forged or malformed jobs never run', async () => {
  for (const bad of [job({ createdAt: new Date(Date.now() - 120_000) }), job({ guildId: 'x' }), job({ voiceChannelId: '9' })]) {
    const w = world();
    assert.equal((await J.executeJob(bad, w.client, w.deps)).ok, false);
    assert.equal(w.log.joined, 0);
  }
});

test('a server this bot is not in, a banned server and a Stage channel are refused', async () => {
  let w = world();
  assert.equal((await J.executeJob(job({ guildId: '999999999999999999' }), w.client, w.deps)).error.key, 'bot_no_access');
  w = world({ banned: true });
  assert.equal((await J.executeJob(job(), w.client, w.deps)).error.key, 'bot_no_access');
  w = world({ type: 13 });
  assert.equal((await J.executeJob(job(), w.client, w.deps)).error.key, 'stage_unsupported');
  assert.equal(w.log.joined, 0);
});

test('missing permissions in THIS bot\'s own view of the room are explained', async () => {
  for (const [perms, key] of [[ALL & ~8n, 'no_permission_view'], [ALL & ~1n, 'no_permission_connect'], [ALL & ~2n, 'no_permission_speak']]) {
    const w = world({ perms });
    assert.equal((await J.executeJob(job(), w.client, w.deps)).error.key, key);
    assert.equal(w.log.joined, 0);
  }
});

test('already reciting in ANOTHER room → refused, never moved; same room → reused without a second join', async () => {
  let w = world({ existing: { voiceChannelId: V2, status: 'playing', current: {} } });
  assert.equal((await J.executeJob(job(), w.client, w.deps)).error.key, 'worker_busy');
  assert.equal(w.log.joined, 0);
  w = world({ existing: { voiceChannelId: V, status: 'idle', current: null } });
  assert.equal((await J.executeJob(job(), w.client, w.deps)).ok, true);
  assert.equal(w.log.joined, 0);
});

test('recite: a surah is queued and started; while something plays it is only queued', async () => {
  let w = world();
  await J.executeJob(job({ intent: { kind: 'recite', surah: 18, reciterId: '7' } }), w.client, w.deps);
  assert.deepEqual([w.log.enq.length, w.log.enq[0].surah.number, w.log.enq[0].reciter, w.log.played], [1, 18, 'Reciter', 1]);
  w = world({ existing: { voiceChannelId: V, status: 'playing', current: { surah: {} } } });
  await J.executeJob(job({ intent: { kind: 'recite', surah: 18, reciter: 'Reciter' } }), w.client, w.deps);
  assert.deepEqual([w.log.enq.length, w.log.played], [1, 0]);
});

test('recite without a surah = the whole Quran from Al-Fatiha, like /recite', async () => {
  const w = world();
  await J.executeJob(job({ intent: { kind: 'recite', surah: null, reciterId: '7' } }), w.client, w.deps);
  assert.equal(w.getSession().fullQuran, true);
  assert.deepEqual([w.log.cleared, w.log.enq[0].surah.number, w.log.played], [1, 1, 1]);
});

test('recite with a reciter this bot cannot find falls back to the server\'s default (the room still gets its recitation)', async () => {
  const w = world();
  assert.equal((await J.executeJob(job({ intent: { kind: 'recite', surah: 18, reciter: 'Unknown', reciterId: '999' } }), w.client, w.deps)).ok, true);
  assert.equal(w.log.enq[0].reciter, 'Reciter');
});

test('live: starts the station only if it is on the air', async () => {
  let w = world();
  assert.equal((await J.executeJob(job({ intent: { kind: 'live', station: 'api:1' } }), w.client, w.deps)).ok, true);
  assert.equal(w.log.radio.length, 1);
  w = world({ live: false });
  assert.equal((await J.executeJob(job({ intent: { kind: 'live', station: 'api:1' } }), w.client, w.deps)).error.key, 'worker_start_failed');
});

test('errors: a fixable cause keeps its key; anything else is a code, with no technical text in the answer', async () => {
  let w = world({ joinFails: new UserError('voice_full', { limit: 5 }) });
  let r = await J.executeJob(job(), w.client, w.deps);
  assert.deepEqual([r.error.key, r.error.vars], ['voice_full', { limit: '5' }]);
  w = world({ joinFails: new Error('secret internal detail') });
  r = await J.executeJob(job(), w.client, w.deps);
  assert.match(r.error.code, /^E-[0-9A-F]{6}$/);
  assert.ok(!JSON.stringify(r).includes('secret internal detail'));
  w = world({ joinFails: Object.assign(new Error('x'), { code: 'CAPACITY' }) });
  assert.equal((await J.executeJob(job(), w.client, w.deps)).error.key, 'busy');
});

// ── shared database: leaving a server must not wipe the other bot's data ───────────────────────────────────────────

test('guildDelete on the voice-only bot keeps ALL shared server data (and only drops its own snapshot)', async () => {
  const calls = [];
  const rec = (name) => async () => { calls.push(name); return {}; };
  const models = {
    GuildSettings: ['deleteOne'], Statistics: ['deleteOne'], Favorites: ['deleteMany'], ReligiousEvent: ['deleteMany'], CustomStation: ['deleteMany'], WirdSubscription: ['updateMany']
  };
  for (const [m, fns] of Object.entries(models)) {
    const mod = await import(`../src/models/${m}.js`);
    for (const fn of fns) mod[m][fn] = rec(`${m}.${fn}`);
  }
  const { SessionSnapshot } = await import('../src/models/SessionSnapshot.js');
  SessionSnapshot.remove = rec('SessionSnapshot.remove');
  const ev = (await import('../src/events/guildDelete.js')).default;
  await ev.execute({ id: G, name: 'G', client: {} });
  assert.deepEqual(calls, ['SessionSnapshot.remove']);
});

// ── owner dashboard → voice-only bot ──────────────────────────────────────────────────────────────────────────────────

function cmdDeps(has = true) {
  const calls = [];
  const rec = (n, r = true) => (...a) => { calls.push([n, ...a]); return r; };
  return { calls, deps: { getSession: () => (has ? {} : null), pauseSession: rec('pause'), resumeSession: rec('resume'), skipSession: rec('skip'), toggleLoop: rec('loop', true), setVolume: async (...a) => { calls.push(['volume', ...a]); return true; }, destroySession: async (...a) => { calls.push(['stop', ...a]); } } };
}
const cmd = (over = {}) => ({ guildId: G, action: 'pause', value: null, createdAt: new Date(), ...over });

test('dashboard commands: each action reaches this bot\'s own session', async () => {
  for (const [action, expect] of [['pause', ['pause', G]], ['resume', ['resume', G]], ['skip', ['skip', G]], ['stop', ['stop', G]]]) {
    const { calls, deps } = cmdDeps();
    assert.deepEqual(await J.executeCommand(cmd({ action }), deps), { ok: true });
    assert.deepEqual(calls, [expect]);
  }
  const { deps, calls } = cmdDeps();
  assert.deepEqual(await J.executeCommand(cmd({ action: 'loop' }), deps), { ok: true, loop: true });
  assert.deepEqual(await J.executeCommand(cmd({ action: 'volume', value: 80 }), deps), { ok: true });
  assert.deepEqual(calls.at(-1), ['volume', G, 80]);
});

test('dashboard commands: bad volume, unknown action, no session, stale or malformed → refused, nothing touched', async () => {
  let { calls, deps } = cmdDeps();
  for (const bad of [cmd({ action: 'volume', value: 151 }), cmd({ action: 'volume', value: -1 }), cmd({ action: 'volume', value: 1.5 }), cmd({ action: 'volume', value: null }),
    cmd({ action: 'format' }), cmd({ guildId: 'x' }), cmd({ createdAt: new Date(Date.now() - 60_000) })]) {
    assert.equal((await J.executeCommand(bad, deps)).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(calls, []);
  ({ calls, deps } = cmdDeps(false));
  assert.deepEqual(await J.executeCommand(cmd(), deps), { ok: false, error: 'no_session' });
});

test('dashboard commands: a state the action cannot apply to is reported, an exception never escapes', async () => {
  const { deps } = cmdDeps();
  deps.pauseSession = () => false;
  assert.deepEqual(await J.executeCommand(cmd(), deps), { ok: false, error: 'bad_state' });
  deps.skipSession = () => { throw new Error('boom'); };
  assert.deepEqual(await J.executeCommand(cmd({ action: 'skip' }), deps), { ok: false, error: 'failed' });
});

// ── /pull: the second bot moves itself, or continues a copy ─────────────────────────────────────────────────────────────
test('normalizeIntent: "move" and "resume" (with a valid state) are known; a bad state becomes a plain join', () => {
  assert.deepEqual(J.normalizeIntent({ kind: 'move' }), { kind: 'move' });
  const r = J.normalizeIntent({ kind: 'resume', state: { surah: 18, positionMs: 5000 } });
  assert.equal(r.kind, 'resume');
  assert.equal(r.state.positionMs, 5000);
  assert.deepEqual(J.normalizeIntent({ kind: 'resume', state: { surah: 500 } }), { kind: 'join' });
  assert.deepEqual(J.normalizeIntent({ kind: 'resume' }), { kind: 'join' });
});

test('move job: the worker moves its OWN session to the member\'s room; no session → refused', async () => {
  const w = world({ existing: { voiceChannelId: V2, status: 'playing', current: {} } });
  const moved = [];
  w.deps.moveSession = async (a) => { moved.push(a.voiceChannel.id); };
  const r = await J.executeJob(job({ intent: { kind: 'move' } }), w.client, w.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(moved, [V]);
  assert.equal(w.log.joined, 0, 'it did not start a second session');

  const none = world();
  assert.equal((await J.executeJob(job({ intent: { kind: 'move' } }), none.client, none.deps)).error.key, 'pull_no_session');
});

test('move job: a refusal from the move reaches the member with its own message', async () => {
  const w = world({ existing: { voiceChannelId: V2 } });
  w.deps.moveSession = async () => { throw new UserError('other_bot_in_voice', { bots: '<@1>', channel: '<#2>' }); };
  const r = await J.executeJob(job({ intent: { kind: 'move' } }), w.client, w.deps);
  assert.deepEqual([r.ok, r.error.key], [false, 'other_bot_in_voice']);
});

test('resume job: a free worker joins and continues the copy; a busy one refuses; a copy that cannot start leaves the room', async () => {
  const state = { surah: 18, positionMs: 65_000, queue: [], volume: 100 };
  const w = world();
  w.deps.applyState = async (gid, st) => { w.log.applied = st; return true; };
  const r = await J.executeJob(job({ intent: { kind: 'resume', state } }), w.client, w.deps);
  assert.equal(r.ok, true);
  assert.equal(w.log.joined, 1);
  assert.equal(w.log.applied.positionMs, 65_000);

  const busy = world({ existing: { voiceChannelId: V2 } });
  assert.equal((await J.executeJob(job({ intent: { kind: 'resume', state } }), busy.client, busy.deps)).error.key, 'worker_busy');

  const bad = world();
  let destroyed = 0;
  bad.deps.applyState = async () => false;
  bad.deps.destroySession = async () => { destroyed++; };
  const r3 = await J.executeJob(job({ intent: { kind: 'resume', state } }), bad.client, bad.deps);
  assert.equal(r3.error.key, 'pull_resume_failed');
  assert.equal(destroyed, 1);
});

test('dashboard command "export": the worker reports its state as plain JSON', async () => {
  const { deps } = cmdDeps();
  deps.exportSession = () => ({ surah: 18, positionMs: 1234, queue: [], _reciterObj: { big: 'object' } });
  const r = await J.executeCommand(cmd({ action: 'export' }), deps);
  assert.equal(r.ok, true);
  assert.equal(r.result.positionMs, 1234);
  assert.ok(!('_reciterObj' in r.result));
  deps.exportSession = () => null;
  assert.deepEqual(await J.executeCommand(cmd({ action: 'export' }), deps), { ok: false, error: 'no_session' });
});
