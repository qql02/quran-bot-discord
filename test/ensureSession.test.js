import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// discord.js and the session manager are replaced by stubs (see test-helpers/hooks.mjs);
// config, i18n, embeds and permissions below are the real code.
const { ensureSession } = await import('../src/utils/ensureSession.js');

const channel = (id) => ({ id });

/** Fake interaction. `voice` = the channel the user is in (or null); `perms` = bot permission bits there. */
function makeInteraction({ voice = null, perms = 11n, deferred = true } = {}) {
  const log = [];
  if (voice) voice.permissionsFor = () => ({ has: (bits) => (perms & bits) === bits });
  return {
    guildId: 'g1', user: { id: 'u1' }, client: { id: 'bot' }, guild: { members: { me: {} } },
    deferred, replied: false,
    member: { voice: { channel: voice } },
    editReply: async (p) => log.push({ via: 'editReply', text: p.embeds[0].data.setDescription }),
    reply:     async (p) => log.push({ via: 'reply', text: p.embeds[0].data.setDescription, ephemeral: p.ephemeral }),
    followUp:  async (p) => log.push({ via: 'followUp', text: p.embeds[0].data.setDescription }),
    log,
  };
}

let joinCalls;
beforeEach(() => {
  joinCalls = [];
  globalThis.__reported = [];
  globalThis.__lang = 'en';
  globalThis.__sessions = new Map();
  globalThis.__createAndJoin = async (guild, ch, ownerId, lang, client) => {
    joinCalls.push({ ch, ownerId, lang, client });
    const session = { voiceChannelId: ch.id };
    globalThis.__sessions.set('g1', session);
    return session;
  };
});

test('user not in a voice channel → refused with a reply, no join', async () => {
  const i = makeInteraction({ voice: null });
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.equal(joinCalls.length, 0);
  assert.equal(i.log.length, 1);
  assert.match(i.log[0].text, /voice channel/i);
});

test('bot lacks Speak permission → refused', async () => {
  const i = makeInteraction({ voice: channel('A'), perms: 9n });   // Connect + View, no Speak
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.equal(joinCalls.length, 0);
  assert.match(i.log[0].text, /speak/i);
});

test('no session yet → bot joins the user\'s channel with the right owner, language and client', async () => {
  const i = makeInteraction({ voice: channel('A') });
  const r = await ensureSession(i, 'ar');
  assert.equal(r.ok, true);
  assert.equal(r.session.voiceChannelId, 'A');
  assert.equal(r.channel.id, 'A');
  assert.deepEqual(
    { ch: joinCalls[0].ch.id, owner: joinCalls[0].ownerId, lang: joinCalls[0].lang, client: joinCalls[0].client.id },
    { ch: 'A', owner: 'u1', lang: 'ar', client: 'bot' }
  );
  assert.equal(i.log.length, 0, 'nothing is sent on success — the caller replies');
});

test('existing session + same channel → reused, no second join', async () => {
  globalThis.__sessions.set('g1', { voiceChannelId: 'A' });
  const i = makeInteraction({ voice: channel('A') });
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, true);
  assert.equal(r.session, globalThis.__sessions.get('g1'));
  assert.equal(joinCalls.length, 0);
});

test('existing session + DIFFERENT channel → refused (no hijacking)', async () => {
  globalThis.__sessions.set('g1', { voiceChannelId: 'A' });
  const i = makeInteraction({ voice: channel('B') });
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.equal(joinCalls.length, 0);
  assert.match(i.log[0].text, /same voice channel/i);
});

test('join failure → connection error; slash command (deferred) edits the reply', async () => {
  globalThis.__createAndJoin = async () => { throw new Error('boom'); };
  const i = makeInteraction({ voice: channel('A'), deferred: true });
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.equal(i.log[0].via, 'editReply');
  assert.match(i.log[0].text, /unexpected error/i);
  assert.match(i.log[0].text, /`E-[0-9A-F]{6}`/, 'the owner gets a code to search for');
  assert.ok(!/boom/.test(i.log[0].text), 'no technical detail is shown to the user');
  assert.equal(globalThis.__reported.at(-1).where, 'voice-join');
});

test('a cause the user can fix is explained, without a code', async () => {
  const { UserError } = await import('../src/utils/errors.js');
  globalThis.__createAndJoin = async () => { throw new UserError('voice_full', { limit: 5 }); };
  const i = makeInteraction({ voice: channel('A') });
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.match(i.log[0].text, /full \(5 users\)/);
  assert.match(i.log[0].text, /Move Members/);
  assert.ok(!/E-[0-9A-F]{6}/.test(i.log[0].text));
});

test('bot at capacity → explained as busy, no code', async () => {
  globalThis.__createAndJoin = async () => { throw Object.assign(new Error('Bot is at capacity'), { code: 'CAPACITY' }); };
  const i = makeInteraction({ voice: channel('A') });
  await ensureSession(i, 'en');
  assert.match(i.log[0].text, /maximum number/i);
});

test('join failure from a button (not deferred) → ephemeral reply', async () => {
  globalThis.__createAndJoin = async () => { throw new Error('boom'); };
  const i = makeInteraction({ voice: channel('A'), deferred: false });
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.equal(i.log[0].via, 'reply');
  assert.equal(i.log[0].ephemeral, true);
});

test('error messages are localised', async () => {
  const i = makeInteraction({ voice: null });
  await ensureSession(i, 'ar');
  assert.match(i.log[0].text, /[\u0600-\u06FF]/);
});

test('bot cannot see the voice channel → explained with the permission to give', async () => {
  const i = makeInteraction({ voice: channel('A'), perms: 3n });   // Connect + Speak, no ViewChannel
  const r = await ensureSession(i, 'en');
  assert.equal(r.ok, false);
  assert.match(i.log[0].text, /View Channel/);
});

test('full voice channel → explained (limit shown); Move Members lets the bot in', async () => {
  const full = { id: 'A', userLimit: 2, members: { size: 2 } };
  const i = makeInteraction({ voice: full });
  assert.equal((await ensureSession(i, 'en')).ok, false);
  assert.match(i.log[0].text, /full \(2 users\)/);
  const full2 = { id: 'A', userLimit: 2, members: { size: 2 } };
  const j = makeInteraction({ voice: full2, perms: 27n });         // + MoveMembers
  assert.equal((await ensureSession(j, 'en')).ok, true);
});

test('stage channel → explained as unsupported', async () => {
  const i = makeInteraction({ voice: { id: 'S', type: 13 } });
  assert.equal((await ensureSession(i, 'en')).ok, false);
  assert.match(i.log[0].text, /Stage channels/);
});
