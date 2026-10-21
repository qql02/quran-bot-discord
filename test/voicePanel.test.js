import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const sm    = await import('../src/managers/sessionManager.js');
const event = (await import('../src/events/voiceStateUpdate.js')).default;

afterEach(async () => { await sm.destroySession('g1'); });

/** Voice channel `A` containing the given members (Collection-like: only what the handler uses). */
function setup(members) {
  const deleted = [];
  const textChannel = { messages: { delete: async (id) => { deleted.push(id); } } };
  const voice = { id: 'A', members: { filter: (fn) => ({ size: members.filter(fn).length }) } };
  const client = { user: { id: 'bot' }, channels: { cache: { get: (id) => (id === 'text1' ? textChannel : undefined) } } };
  const guild = { id: 'g1', name: 'G', channels: { cache: { get: (id) => (id === 'A' ? voice : undefined), has: () => true } } };
  const state = (channelId) => ({ channelId, guild, member: { id: 'u1', user: { bot: false } }, channel: voice });
  return { deleted, client, guild, state };
}

test('panel is deleted when the last human leaves the voice channel', async () => {
  const { deleted, client, guild, state } = setup([]);                       // nobody left in the channel
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel1' };
  await event.execute(state('A'), state(null), client);
  assert.deepEqual(deleted, ['panel1']);
  assert.equal(s.panelMessage, null);
  assert.ok(s.autoLeaveTimer, 'auto-leave countdown still starts');
  assert.ok(guild);
});

test('panel stays while someone else is still listening', async () => {
  const listener = { user: { bot: false } };
  const { deleted, client, state } = setup([listener]);
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel1' };
  await event.execute(state('A'), state(null), client);
  assert.deepEqual(deleted, []);
  assert.deepEqual(s.panelMessage, { channelId: 'text1', messageId: 'panel1' });
});

// ─── the panel disappears whenever the bot leaves voice, however it leaves ───

test('panel is deleted when the bot is disconnected / kicked from voice', async () => {
  const { deleted, client, state } = setup([{ user: { bot: false } }]);
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel1' };
  const botState = (channelId) => ({ channelId, guild: state('A').guild, channel: { name: 'A' }, member: { id: 'bot', user: { bot: true } } });
  await event.execute(botState('A'), botState(null), client);
  assert.deepEqual(deleted, ['panel1']);
  assert.equal(sm.getSession('g1'), null);
});

test('panel is deleted when the session is stopped (/leave, stop button, dashboard, idle timeout)', async () => {
  const { deleted, client } = setup([]);
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel2' };
  await sm.destroySession('g1');
  assert.deepEqual(deleted, ['panel2']);
  assert.equal(s.panelMessage, null);
});

test('a restart (keepSnapshot) deletes the panel too: no dead buttons while the bot is down, the restored session posts a new one', async () => {
  const { deleted, client } = setup([]);
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel3' };
  await sm.destroySession('g1', { keepSnapshot: true });
  assert.deepEqual(deleted, ['panel3']);
  assert.equal(s.panelMessage, null);
});

// ─── every playback gets a panel automatically ───

// No database here: language and the saved reciter come from stubs (otherwise each lookup waits for a connection that never comes).
const { GuildSettings } = await import('../src/models/GuildSettings.js');
GuildSettings.getLanguage = async () => 'en';
GuildSettings.findOne = () => ({ lean: async () => null });

/** A client that can host a panel: the voice room's chat accepts messages, and remembers what was sent / deleted. */
function hostClient() {
  const sent = [], deleted = [];
  const voice = {
    id: 'A', name: 'A',
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { const m = { id: `auto${sent.length + 1}`, channelId: 'A' }; sent.push({ m, payload }); return m; },
    messages: { delete: async (id) => { deleted.push(id); }, fetch: async () => null }
  };
  const guild = { id: 'g1', name: 'G', members: { me: { id: 'bot' } }, channels: { cache: { get: (id) => (id === 'A' ? voice : undefined) } } };
  const client = { user: { id: 'bot' }, guilds: { cache: { get: () => guild } }, channels: { cache: { get: (id) => (id === 'A' ? voice : undefined) } } };
  return { sent, deleted, client, guild, voice };
}

test('ensurePanel posts the control panel of a session that has none, once', async () => {
  const reg = await import('../src/utils/panelRegistry.js');
  const h = hostClient();
  const s = await sm.createAndJoin(h.guild, h.voice, 'u1', 'en', h.client);
  assert.equal(s.panelMessage, null);
  const [a, b] = await Promise.all([reg.ensurePanel(h.client, 'g1'), reg.ensurePanel(h.client, 'g1')]);   // two triggers at once
  assert.equal(a, true); assert.equal(b, true);
  assert.equal(h.sent.length, 1, 'only one panel was sent');
  assert.deepEqual(s.panelMessage, { channelId: 'A', messageId: 'auto1' });
  assert.equal(await reg.ensurePanel(h.client, 'g1'), true);
  assert.equal(h.sent.length, 1, 'a session that has a panel does not get a second one');
  await sm.destroySession('g1');
  assert.deepEqual(h.deleted, ['auto1'], 'the panel goes away with the bot');
});

test('ensurePanel does nothing without a session, and never throws', async () => {
  const reg = await import('../src/utils/panelRegistry.js');
  const h = hostClient();
  assert.equal(await reg.ensurePanel(h.client, 'g1'), false);
  assert.equal(await reg.ensurePanel(null, 'g1'), false);
  assert.equal(h.sent.length, 0);
});

test('a listener coming back to a room whose panel was removed while it was empty brings the panel back', async () => {
  const h = hostClient();
  const s = await sm.createAndJoin(h.guild, h.voice, 'u1', 'en', h.client);
  assert.equal(s.panelMessage, null);
  sm.onListenerArrived('g1');
  for (let i = 0; i < 40 && !h.sent.length; i++) await new Promise(r => setTimeout(r, 25));   // the panel is sent in the background
  assert.equal(h.sent.length, 1);
  assert.deepEqual(s.panelMessage, { channelId: 'A', messageId: 'auto1' });
});

test('panel is still deleted when its channel is not in the cache (fetched instead)', async () => {
  const deleted = [];
  const textChannel = { messages: { delete: async (id) => { deleted.push(id); } } };
  const client = { user: { id: 'bot' }, channels: { cache: { get: () => undefined }, fetch: async (id) => (id === 'text1' ? textChannel : null) } };
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel3' };
  await sm.destroySession('g1');
  assert.deepEqual(deleted, ['panel3']);
});

test('a slow panel delete does not hold the bot in voice', async () => {
  let left = false;
  let release;
  const textChannel = { messages: { delete: () => new Promise(r => { release = r; }) } };
  const client = { user: { id: 'bot' }, channels: { cache: { get: () => textChannel } } };
  const s = await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  s.panelMessage = { channelId: 'text1', messageId: 'panel4' };
  const origDestroy = s.player.destroy.bind(s.player);
  s.player.destroy = async () => { left = true; return origDestroy(); };
  const done = sm.destroySession('g1');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(left, true, 'voice was left while the delete is still pending');
  release(); await done;
});

test('restorePanel hands the old panel to a restored session', async () => {
  const reg = await import('../src/utils/panelRegistry.js');
  const session = {};
  reg.restorePanel('g1', session, 'text1', 'panel5');
  assert.deepEqual(session.panelMessage, { channelId: 'text1', messageId: 'panel5' });
  reg.restorePanel('g1', session, null, null);   // nothing saved → untouched
  assert.deepEqual(session.panelMessage, { channelId: 'text1', messageId: 'panel5' });
  reg.forgetPanel('g1');
});

test('another bot joining the playing channel makes us leave at once; a human or a bot in another channel does not', async () => {
  const { client, guild, state } = setup([{ user: { bot: false } }]);
  await sm.createAndJoin({ id: 'g1', name: 'G', client: {} }, { id: 'A', name: 'A' }, 'u1', 'en', client);
  const botState = (channelId) => ({ channelId, guild, member: { id: 'music', user: { bot: true, tag: 'Music#1' } } });
  await event.execute(botState(null), botState('B'), client);            // a bot joins ANOTHER channel → stay
  assert.ok(sm.getSession('g1'));
  await event.execute(state(null), state('A'), client);                  // a human joins ours → stay
  assert.ok(sm.getSession('g1'));
  await event.execute(botState(null), botState('A'), client);            // a bot joins OUR channel → leave
  assert.equal(sm.getSession('g1'), null);
});

test('joining is refused with an explanation while another bot is in the voice channel', async () => {
  const { client } = setup([]);
  const other = { id: 'music', user: { bot: true, tag: 'Music#1' } };
  const me = { id: 'bot', user: { bot: true } };
  const voice = { id: 'A', name: 'A', members: new Map([['bot', me], ['music', other]]) };
  await assert.rejects(
    () => sm.createAndJoin({ id: 'g1', name: 'G', client: {}, members: { me } }, voice, 'u1', 'en', client),
    (e) => e.key === 'other_bot_in_voice' && e.vars.bots === '<@music>' && e.vars.channel === '<#A>');
  assert.equal(sm.getSession('g1'), null);
  voice.members.delete('music');                                           // the bot was removed → joining works again
  await sm.createAndJoin({ id: 'g1', name: 'G', client: {}, members: { me } }, voice, 'u1', 'en', client);
  assert.ok(sm.getSession('g1'));
});
