import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, globalBlockedBy, normalizeControl } from '../src/utils/botControl.js';
import { GuildSettings } from '../src/models/GuildSettings.js';

// discord.js is stubbed by test-helpers/hooks.mjs; the session manager is the real one (its dependencies are fakes).
const sm  = await import('../src/managers/sessionManager.js');
const reg = await import('../src/utils/panelRegistry.js');
const { startPlayerPanel } = await import('../src/utils/startPanel.js');
GuildSettings.getLanguage = async () => 'en';

const client = { user: { id: 'bot' }, channels: { cache: { get: () => undefined } } };
const live = (guildId, channelId) => sm.createAndJoin({ id: guildId, name: 'G', client: {} }, { id: channelId, name: channelId }, 'u1', 'en', client);
afterEach(async () => { await sm.destroySession('gA'); await sm.destroySession('gW'); });

test('a stranger in ANOTHER voice room cannot move the live panel by pressing /start', async () => {
  await live('gA', 'voiceA');
  const log = { deferred: 0, replies: [] };
  const i = {
    guildId: 'gA', user: { id: 'u9' }, channelId: 't1', channel: { id: 't1' }, guild: { id: 'gA' }, client,
    member: { voice: { channel: { id: 'voiceB', type: 2 } } },
    reply: async (p) => { log.replies.push(p); }, deferReply: async () => { log.deferred++; }
  };
  await startPlayerPanel(i);
  assert.equal(log.replies.length, 1, 'told privately why');
  assert.equal(log.replies[0].ephemeral, true);
  assert.equal(log.deferred, 0, 'no panel was posted');
});

test('the "wait for voice" join does not replace the panel of a room that is already being recited in', async () => {
  await live('gW', 'voiceA');
  const sent = [];
  const ch = { id: 'voiceB', name: 'B', permissionsFor: () => ({ has: () => true }), send: async () => { sent.push('x'); return { id: 'm1', channelId: 'voiceB' }; }, messages: { delete: async () => {} } };
  const guild = { id: 'gW', members: { me: {} }, channels: { cache: { get: () => ch } } };
  reg.waitForVoiceJoin('gW', 'u1', 'voiceB');
  assert.equal(await reg.onVoiceJoin({ guild, id: 'u1', channel: ch }, client), false);
  assert.deepEqual(sent, []);
});

test('owner switches hold for the sub-pages of /setup too (wird room, verse of the day)', () => {
  const off = (key) => normalizeControl({ disabledFeatures: [key] });
  assert.ok(FEATURES.wird.prefixes.includes('hub:wird:'));
  assert.equal(globalBlockedBy(off('wird'), { kind: 'component', customId: 'hub:wird:repost' }), 'global-feature');
  assert.equal(globalBlockedBy(off('ayah'), { kind: 'component', customId: 'adhkar:ayah:toggle' }), 'global-feature');
  // the other pages are untouched
  assert.equal(globalBlockedBy(off('ayah'), { kind: 'component', customId: 'adhkar:toggle' }), null);
  assert.equal(globalBlockedBy(off('wird'), { kind: 'component', customId: 'hub:lang:ar' }), null);
});
