import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyGuildOwner, buildOwnerNotice, resetOwnerNoticeThrottle } from '../src/services/ownerNotice.js';

const fakeClient = (sent, { dmClosed = false, inCache = true } = {}) => ({
  guilds: { cache: { get: (id) => (inCache ? { id, name: 'سيرفر الاختبار', fetchOwner: async () => ({ send: async (p) => { if (dmClosed) throw new Error('DMs closed'); sent.push(p); } }) } : undefined) } }
});

test('owner is told when the bot loses access, at most once a week per feature, and never for transient errors', async () => {
  resetOwnerNoticeThrottle();
  const sent = [];
  const c = fakeClient(sent);
  assert.equal(await notifyGuildOwner(c, '1', 'adhkar', 'send_failed'), false, 'a network hiccup is not the owner\'s problem');
  assert.equal(await notifyGuildOwner(c, '1', 'adhkar', 'api_failed'), false);
  assert.equal(await notifyGuildOwner(c, '1', 'adhkar', 'no_permission', '99'), true);
  assert.equal(await notifyGuildOwner(c, '1', 'adhkar', 'no_permission', '99'), false, 'throttled for a week');
  assert.equal(await notifyGuildOwner(c, '1', 'ayah', 'unknown_channel', '99'), true, 'another feature is a separate notice');
  assert.equal(await notifyGuildOwner(c, '2', 'adhkar', 'no_permission', '99'), true, 'another server too');
  assert.equal(sent.length, 3);
});

test('a closed DM or a missing server never throws, and is not retried every minute', async () => {
  resetOwnerNoticeThrottle();
  assert.equal(await notifyGuildOwner(fakeClient([], { dmClosed: true }), '5', 'event', 'no_permission', '1'), false);
  assert.equal(await notifyGuildOwner(fakeClient([], { inCache: false }), '6', 'event', 'no_permission', '1'), false);
  const sent = [];
  assert.equal(await notifyGuildOwner(fakeClient(sent), '5', 'event', 'no_permission', '1'), false, 'the failed DM still counts as the attempt for this week');
  assert.equal(sent.length, 0);
});

test('notice text: both languages, names the fix command and the channel', () => {
  for (const [feature, cmd] of [['adhkar', '/adhkar'], ['ayah', '/adhkar'], ['event', '/events']]) {
    for (const lang of ['ar', 'en']) for (const reason of ['no_permission', 'unknown_channel']) {
      const e = buildOwnerNotice({ guildName: 'S', feature, reason, channelId: '42', lang }).embeds[0].data;
      assert.ok(e.setDescription.includes(cmd) && e.setDescription.includes('<#42>'), `${feature}/${lang}/${reason}`);
    }
  }
});
