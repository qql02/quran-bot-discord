// The MAIN bot's side of the two-bot setup: when it cannot serve a member's room it hands the request to the voice-only bot
// through the shared database, waits for the answer and tells the member. The database is replaced by in-memory fakes.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const MAIN = '999999999999999999', W = '444444444444444444', G = 'g1', V = '222222222222222222', V2 = '555555555555555555', U = '333333333333333333';
process.env.NODE_ENV = 'test';
process.env.BOT_ROLE = 'primary';
process.env.DISCORD_TOKEN = `${Buffer.from(MAIN).toString('base64').replace(/=+$/, '')}.GabcDe.${'x'.repeat(27)}`;
process.env.MONGODB_URI = 'mongodb://localhost/test';
process.env.SESSION_SECRET = 'x'.repeat(40);

const { default: mongoose } = await import('mongoose');
const { BotInstance } = await import('../src/models/BotInstance.js');
const { PlayerJob } = await import('../src/models/PlayerJob.js');
const { WorkerCommand } = await import('../src/models/WorkerCommand.js');
for (const m of ['GuildSettings', 'Statistics', 'Favorites', 'ReligiousEvent', 'CustomStation', 'WirdSubscription', 'SessionSnapshot']) await import(`../src/models/${m}.js`);
Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });   // "connected" — only after every model is compiled
const sib = await import('../src/services/siblingService.js');
const J = await import('../src/services/playerJobs.js');
const { tryDelegate } = await import('../src/utils/delegation.js');
const { ensureSession } = await import('../src/utils/ensureSession.js');

let siblings, jobs, created;
BotInstance.updateOne = async () => ({});
BotInstance.deleteOne = async () => ({});
BotInstance.find = () => ({ lean: async () => siblings });
BotInstance.exists = async (q) => (siblings.some(s => s._id !== q._id.$ne && s.guildIds.includes(q.guildIds)) ? { _id: 1 } : null);
PlayerJob.exists = async (q) => (jobs.some(j => j.guildId === q.guildId && j.targetBotId === q.targetBotId && ['pending', 'claimed'].includes(j.status)) ? { _id: 1 } : null);
PlayerJob.create = async (d) => { const doc = { _id: `job${jobs.length + 1}`, status: 'pending', ...d }; jobs.push(doc); created = doc; return doc; };
PlayerJob.findById = (id) => ({ lean: async () => jobs.find(j => j._id === id) ?? null });
PlayerJob.updateOne = async (q, u) => { const j = jobs.find(x => x._id === q._id && (!q.status || x.status === q.status)); if (j) Object.assign(j, u.$set); return { modifiedCount: j ? 1 : 0 }; };

sib.startSiblingSync({ user: { id: MAIN, tag: 'main#1' }, guilds: { cache: new Map([[G, {}]]) } }, () => []);
const worker = (room = null) => ({ _id: W, role: 'secondary', guildIds: [G], sessions: room ? [{ guildId: G, channelId: room, channelName: 'r' }] : [] });

function interaction({ voice = V, deferred = true } = {}) {
  const log = [];
  return {
    guildId: G, channelId: '777777777777777777', user: { id: U }, client: { user: { id: MAIN } },
    member: { voice: { channel: voice ? { id: voice, type: 2 } : null } },
    deferred, replied: false,
    deferReply: async function () { this.deferred = true; log.push('defer'); },
    editReply: async (p) => log.push({ via: 'editReply', text: p.embeds[0].data.setDescription }),
    reply: async (p) => log.push({ via: 'reply', text: p.embeds[0].data.setDescription }),
    followUp: async (p) => log.push({ via: 'followUp', text: p.embeds[0].data.setDescription }),
    log
  };
}
/** The worker "answers" after the first poll. */
const answerWith = (patch) => { const t = setInterval(() => { const j = jobs[0]; if (j && j.status === 'pending') { Object.assign(j, patch); clearInterval(t); } }, 5); t.unref(); };

beforeEach(() => {
  siblings = []; jobs = []; created = null;
  globalThis.__reported = []; globalThis.__lang = 'en'; globalThis.__sessions = new Map();
});

test('no voice-only sibling known → nothing is delegated (the normal flow continues)', async () => {
  const i = interaction();
  assert.equal(await tryDelegate(i, 'en'), false);
  assert.deepEqual(i.log, []);
  assert.equal(jobs.length, 0);
});

test('a free worker takes over: the job names the right bot, room, member and intent, and the member is told', async () => {
  siblings = [worker()];
  answerWith({ status: 'done', panel: true });
  const i = interaction({ deferred: false });
  assert.equal(await tryDelegate(i, 'en', { kind: 'recite', surah: 18, reciter: 'X', reciterId: '7' }), true);
  assert.equal(i.log[0], 'defer', 'Discord is answered first (the wait can take seconds)');
  assert.deepEqual(
    { to: created.targetBotId, from: created.fromBotId, guild: created.guildId, room: created.voiceChannelId, user: created.userId, kind: created.intent.kind, surah: created.intent.surah },
    { to: W, from: MAIN, guild: G, room: V, user: U, kind: 'recite', surah: 18 });
  assert.match(i.log.at(-1).text, new RegExp(`<@${W}> joined <#${V}>`));
});

test('the worker\'s refusal is shown to the member in their language, with the cause', async () => {
  siblings = [worker()];
  answerWith({ status: 'failed', error: { key: 'no_permission_speak', vars: {} } });
  const i = interaction();
  assert.equal(await tryDelegate(i, 'en'), true);
  assert.match(i.log.at(-1).text, /Speak/);
  siblings = [worker()]; jobs = [];
  answerWith({ status: 'failed', error: { key: 'no_permission_speak', vars: {} } });
  const a = interaction();
  await tryDelegate(a, 'ar');
  assert.match(a.log.at(-1).text, /[؀-ۿ]/);
});

test('an unexpected worker error reaches the member only as a code', async () => {
  siblings = [worker()];
  answerWith({ status: 'failed', error: { code: 'E-ABC123' } });
  const i = interaction();
  await tryDelegate(i, 'en');
  assert.match(i.log.at(-1).text, /E-ABC123/);
});

test('a worker that is busy elsewhere is not a candidate; one in the member\'s room is, even when others are free', async () => {
  siblings = [worker(V2)];
  assert.equal(await tryDelegate(interaction(), 'en'), false);
  siblings = [worker(V)];
  answerWith({ status: 'done', panel: true });
  assert.equal(await tryDelegate(interaction(), 'en'), true);
});

test('onlyHere: the main bot, with no session of its own, delegates only to a worker already in the member\'s room', async () => {
  siblings = [worker()];
  assert.equal(await tryDelegate(interaction(), 'en', { kind: 'join' }, { onlyHere: true }), false);
  siblings = [worker(V)];
  answerWith({ status: 'done', panel: true });
  assert.equal(await tryDelegate(interaction(), 'en', { kind: 'join' }, { onlyHere: true }), true);
});

test('a second request while one is still open for this server is not queued up', async () => {
  siblings = [worker()];
  jobs.push({ _id: 'old', targetBotId: W, guildId: G, status: 'claimed' });
  const i = interaction();
  assert.equal(await tryDelegate(i, 'en'), true);
  assert.equal(jobs.length, 1, 'no second job');
  assert.match(i.log.at(-1).text, /already being called/);
});

test('no answer in time → the job is cancelled (it can never start playing later) and the member is told', async () => {
  siblings = [worker()];
  const r = await (async () => {
    const d = await J.dispatchJob({ targetBotId: W, guildId: G, voiceChannelId: V, userId: U, lang: 'en', intent: { kind: 'join' } });
    return J.waitForJob(d.id, { timeoutMs: 20, stepMs: 5, sleep: (ms) => new Promise(r => setTimeout(r, ms)) });
  })();
  assert.equal(r.status, 'cancelled');
  assert.equal(jobs[0].status, 'cancelled');
});

test('a claimed job that is still running at the deadline is NOT cancelled (it may still finish)', async () => {
  const d = await J.dispatchJob({ targetBotId: W, guildId: G, voiceChannelId: V, userId: U, lang: 'en', intent: { kind: 'join' } });
  jobs[0].status = 'claimed';
  const r = await J.waitForJob(d.id, { timeoutMs: 15, stepMs: 5, sleep: (ms) => new Promise(r => setTimeout(r, ms)) });
  assert.equal(r.status, 'timeout');
  assert.equal(r.claimed, true, 'the caller can tell "still joining" from "never answered"');
  assert.equal(jobs[0].status, 'claimed');
});

test('an intent from a command is cleaned before it is stored', async () => {
  await J.dispatchJob({ targetBotId: W, guildId: G, voiceChannelId: V, userId: U, intent: { kind: 'recite', surah: 500, evil: '$where' } });
  assert.deepEqual(created.intent, { kind: 'join' });
});

test('ensureSession: this bot is busy in another room and a worker is free → handed over, no join here', async () => {
  siblings = [worker()];
  answerWith({ status: 'done', panel: true });
  globalThis.__sessions.set(G, { voiceChannelId: V2 });
  let joined = 0; globalThis.__createAndJoin = async () => { joined++; return {}; };
  const i = interaction();
  i.guild = { members: { me: {} } };
  i.member.voice.channel.permissionsFor = () => ({ has: () => true });
  const r = await ensureSession(i, 'en', { kind: 'join' });
  assert.deepEqual([r.ok, r.delegated, joined], [false, true, 0]);
});

test('ensureSession: a worker already reciting in the member\'s room gets the request instead of "use that bot"', async () => {
  siblings = [worker(V)];
  answerWith({ status: 'done', panel: true });
  let joined = 0; globalThis.__createAndJoin = async () => { joined++; return {}; };
  const i = interaction();
  i.guild = { members: { me: {} } };
  i.member.voice.channel.permissionsFor = () => ({ has: () => true });
  const r = await ensureSession(i, 'en', { kind: 'recite', surah: 1, reciter: 'X' });
  assert.deepEqual([r.ok, r.delegated, joined], [false, true, 0]);
});

test('ensureSession: this bot is free → it serves the member itself, nothing is delegated', async () => {
  siblings = [worker()];
  let joined = 0; globalThis.__createAndJoin = async (g, ch) => { joined++; return { voiceChannelId: ch.id }; };
  const i = interaction();
  i.guild = { members: { me: {} } };
  i.member.voice.channel.permissionsFor = () => ({ has: () => true });
  const r = await ensureSession(i, 'en', { kind: 'join' });
  assert.deepEqual([r.ok, joined, jobs.length], [true, 1, 0]);
});

// ── shared database: the main bot's own cleanup when it is removed from a server ─────────────────────────────────────

async function runGuildDelete() {
  const calls = [];
  const rec = (name) => async () => { calls.push(name); return {}; };
  for (const [m, fn] of Object.entries({ GuildSettings: 'deleteOne', Statistics: 'deleteOne', Favorites: 'deleteMany', ReligiousEvent: 'deleteMany', CustomStation: 'deleteMany', WirdSubscription: 'updateMany' })) {
    (await import(`../src/models/${m}.js`))[m][fn] = rec(`${m}.${fn}`);
  }
  (await import('../src/models/SessionSnapshot.js')).SessionSnapshot.remove = rec('SessionSnapshot.remove');
  await (await import('../src/events/guildDelete.js')).default.execute({ id: G, name: 'G', client: {} });
  return calls;
}

test('the main bot removed while the voice-only bot is still in the server → shared data is kept', async () => {
  siblings = [worker()];
  assert.deepEqual(await runGuildDelete(), ['SessionSnapshot.remove']);
});

test('the main bot removed and no other bot is left → the server\'s data is cleaned up as before', async () => {
  siblings = [];
  const calls = await runGuildDelete();
  assert.ok(calls.includes('GuildSettings.deleteOne') && calls.includes('Favorites.deleteMany') && calls.includes('SessionSnapshot.remove'), calls.join());
});

// ── owner dashboard → voice-only bot ──────────────────────────────────────────────────────────────────────────────────
let cmds;
WorkerCommand.create = async (d) => { const doc = { _id: `c${cmds.length + 1}`, status: 'pending', ...d }; cmds.push(doc); return doc; };
WorkerCommand.findById = (id) => ({ lean: async () => cmds.find(c => c._id === id) ?? null });
WorkerCommand.updateOne = async (q, u) => { const c = cmds.find(x => x._id === q._id && (!q.status || x.status === q.status)); if (c) Object.assign(c, u.$set); return {}; };
const quick = { timeoutMs: 30, stepMs: 5, sleep: (ms) => new Promise(r => setTimeout(r, ms)) };

test('worker sessions are listed with what the dashboard shows, only for live voice-only bots', async () => {
  siblings = [{ ...worker(V), sessions: [{ guildId: G, channelId: V, channelName: 'r', status: 'playing', surahAr: 'الكهف', reciter: 'X', queueSize: 2, loop: true, volume: 90 }] },
              { _id: '888888888888888888', role: 'primary', guildIds: [G], sessions: [{ guildId: G, channelId: V2 }] }];
  BotInstance.find = (q) => ({ lean: async () => siblings.filter(s => !q.role || s.role === q.role) });
  const list = await sib.getWorkerSessions();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].botId, list[0].status, list[0].surahAr, list[0].volume], [W, 'playing', 'الكهف', 90]);
  BotInstance.find = () => ({ lean: async () => siblings });
});

test('a dashboard command is stored for the right bot, and its answer comes back', async () => {
  cmds = [];
  const t = setInterval(() => { if (cmds[0]?.status === 'pending') { Object.assign(cmds[0], { status: 'done', loop: true }); clearInterval(t); } }, 5);
  const r = await J.sendWorkerCommand({ targetBotId: W, guildId: G, action: 'loop', by: U }, quick);
  assert.deepEqual(r, { ok: true, loop: true });
  assert.deepEqual([cmds[0].targetBotId, cmds[0].action, cmds[0].by], [W, 'loop', U]);
});

test('a refusal is passed on; a bot that never answers gets the command cancelled so it cannot run later', async () => {
  cmds = [];
  const t = setInterval(() => { if (cmds[0]?.status === 'pending') { Object.assign(cmds[0], { status: 'failed', error: 'bad_state' }); clearInterval(t); } }, 5);
  assert.deepEqual(await J.sendWorkerCommand({ targetBotId: W, guildId: G, action: 'pause' }, quick), { ok: false, error: 'bad_state' });
  cmds = [];
  assert.deepEqual(await J.sendWorkerCommand({ targetBotId: W, guildId: G, action: 'pause' }, quick), { ok: false, error: 'timeout' });
  assert.equal(cmds[0].status, 'cancelled');
});
