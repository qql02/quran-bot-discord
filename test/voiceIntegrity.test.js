// Two bots, one server: never in the same voice room, and nothing of ours left in the voice chat after we leave.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ME = '999999999999999999', SIB = '444444444444444444';
process.env.NODE_ENV = 'test';
process.env.BOT_ROLE = 'primary';
process.env.DISCORD_TOKEN = `${Buffer.from(ME).toString('base64').replace(/=+$/, '')}.GabcDe.${'x'.repeat(27)}`;
process.env.MONGODB_URI = 'mongodb://localhost/test';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.LEAVE_FOR_OTHER_BOTS = 'off';   // the sibling rule must not depend on this switch

const { default: mongoose } = await import('mongoose');
const { BotInstance } = await import('../src/models/BotInstance.js');
Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
const sib = await import('../src/services/siblingService.js');
const sm = await import('../src/managers/sessionManager.js');
const voiceEvent = (await import('../src/events/voiceStateUpdate.js')).default;

let siblings = [];
BotInstance.updateOne = async () => ({});
BotInstance.find = () => ({ lean: async () => siblings });
const client = { user: { id: ME, tag: 'main#1' }, guilds: { cache: new Map([['gA', {}]]) }, channels: { cache: new Map() } };
sib.startSiblingSync(client, () => []);
beforeEach(async () => { siblings = []; await sm.destroySession('gA'); });

const sibDoc = (room) => ({ _id: SIB, role: 'secondary', guildIds: ['gA'], sessions: room ? [{ guildId: 'gA', channelId: room, channelName: 'r' }] : [] });
const guildOf = () => ({ id: 'gA', name: 'G', client: {}, members: { me: { id: ME } } });
const room = (id, memberIds = []) => ({ id, name: id, members: new Map(memberIds.map(m => [m, { user: { bot: true } }])) });

test('shouldYield: the voice-only bot gives way to the main bot; equal roles → the higher ID gives way; both sides agree', () => {
  const a = { id: '2', role: 'secondary' }, b = { id: '1', role: 'primary' };
  assert.equal(sib.shouldYield(a, b), true);
  assert.equal(sib.shouldYield(b, a), false);
  const c = { id: '5', role: 'primary' }, d = { id: '7', role: 'primary' };
  assert.deepEqual([sib.shouldYield(c, d), sib.shouldYield(d, c)], [false, true]);
});

test('a bot never joins the room the other Quran bot is in (registry says so)', async () => {
  siblings = [sibDoc('roomX')];
  await assert.rejects(() => sm.createAndJoin(guildOf(), room('roomX'), 'u1', 'en', client), (e) => e.key === 'busy_sibling_here');
  assert.equal(sm.getSession('gA'), null);
});

test('…or when the other Quran bot is visibly in the room, even before it has published (and with LEAVE_FOR_OTHER_BOTS off)', async () => {
  siblings = [sibDoc(null)];
  await assert.rejects(() => sm.createAndJoin(guildOf(), room('roomX', [SIB]), 'u1', 'en', client), (e) => e.key === 'busy_sibling_here');
  assert.equal(sm.getSession('gA'), null);
});

test('a free room is joined normally even when the other bot is busy elsewhere', async () => {
  siblings = [sibDoc('roomY')];
  const s = await sm.createAndJoin(guildOf(), room('roomX'), 'u1', 'en', client);
  assert.equal(s.voiceChannelId, 'roomX');
});

test('both joined at the same instant: the main bot stays, and it is the OTHER bot that leaves', async () => {
  await sm.createAndJoin(guildOf(), room('roomX'), 'u1', 'en', client);
  siblings = [sibDoc('roomX')];
  await voiceEvent.execute({ channelId: null }, { channelId: 'roomX', member: { id: SIB, user: { bot: true, tag: 's#1' } }, guild: { id: 'gA' } }, client);
  assert.equal(sm.getSession('gA')?.voiceChannelId, 'roomX', 'the main bot keeps its session');
});

// ── nothing left behind in the voice chat ──────────────────────────────────────────────────────────────────────────────

function chat(authors) {
  const deleted = [], sent = [];
  const msgs = new Map(authors.map((a, i) => [`m${i}`, { id: `m${i}`, author: { id: a }, delete: async () => { deleted.push(`m${i}`); } }]));
  return { deleted, sent, ch: { id: 'roomX', guild: { members: { me: {} } }, permissionsFor: () => ({ has: () => true }), messages: { fetch: async () => msgs, delete: async () => {} }, send: async (m) => { sent.push(m); }, isTextBased: () => true } };
}

test('sweepOwnMessages deletes everything this bot wrote in the voice chat, and nothing of anyone else', async () => {
  const c = chat([ME, 'human', ME, SIB, ME]);
  const n = await sm.sweepOwnMessages({ _client: { user: { id: ME }, channels: { cache: new Map([['roomX', c.ch]]) } }, voiceChannelId: 'roomX', guildId: 'gA' });
  assert.equal(n, 3);
  assert.deepEqual(c.deleted.sort(), ['m0', 'm2', 'm4']);
});

test('no permission to read the chat → nothing happens, nothing throws', async () => {
  const c = chat([ME]);
  c.ch.permissionsFor = () => ({ has: () => false });
  assert.equal(await sm.sweepOwnMessages({ _client: { user: { id: ME }, channels: { cache: new Map([['roomX', c.ch]]) } }, voiceChannelId: 'roomX', guildId: 'gA' }), 0);
  assert.deepEqual(c.deleted, []);
});

test('leaving (stop, idle, kicked…) sweeps the voice chat; a restart (keepSnapshot) does not', async () => {
  const c = chat([ME, 'human', ME]);
  const mk = async () => { const s = await sm.createAndJoin(guildOf(), room('roomX'), 'u1', 'en', client); s._client = { user: { id: ME }, channels: { cache: new Map([['roomX', c.ch]]) } }; return s; };
  await mk(); await sm.destroySession('gA', { keepSnapshot: true });
  assert.deepEqual(c.deleted, []);
  await mk(); await sm.destroySession('gA');
  assert.deepEqual(c.deleted.sort(), ['m0', 'm2']);
});

test('the "I left" notice is never posted into the voice chat itself', async () => {
  const c = chat([]);
  const s = await sm.createAndJoin(guildOf(), room('roomX'), 'u1', 'en', client);
  s._client = { user: { id: ME }, channels: { cache: new Map([['roomX', c.ch]]) } };
  s.panelMessage = { channelId: 'roomX', messageId: 'p' };
  sm.startAutoLeaveTimer('gA', 5);
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(c.sent, []);
  assert.equal(sm.getSession('gA'), null, 'it did leave');
});
