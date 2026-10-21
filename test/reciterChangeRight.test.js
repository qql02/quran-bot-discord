import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { requireReciterChangeRight } from '../src/utils/permissions.js';

const fake = ({ voice = null, manage = false } = {}) => {
  const out = { replies: [] };
  return Object.assign(out, {
    deferred: false, replied: false,
    member: { voice: { channel: voice } },
    memberPermissions: { has: (f) => manage && f === PermissionFlagsBits.ManageGuild },
    reply: async (x) => { out.replies.push(x); }
  });
};

test('no session: someone outside voice without Manage Server cannot change the server reciter', async () => {
  const i = fake();
  assert.deepEqual(await requireReciterChangeRight(i, null, 'en'), { ok: false });
  assert.equal(i.replies.length, 1, 'told why, privately');
  assert.equal(i.replies[0].ephemeral, true);
});

test('no session: a member in a voice channel, or a Manage Server holder, may change it', async () => {
  assert.deepEqual(await requireReciterChangeRight(fake({ voice: { id: 'v1' } }), null, 'en'), { ok: true });
  assert.deepEqual(await requireReciterChangeRight(fake({ manage: true }), null, 'en'), { ok: true });
});

test('with a session: only people in the bot\'s room (unchanged behaviour)', async () => {
  const session = { voiceChannelId: 'v1' };
  assert.deepEqual(await requireReciterChangeRight(fake({ voice: { id: 'v2' } }), session, 'en'), { ok: false });
  assert.deepEqual(await requireReciterChangeRight(fake({ voice: { id: 'v1' } }), session, 'en'), { ok: true });
  assert.deepEqual(await requireReciterChangeRight(fake({ manage: true }), session, 'en'), { ok: false }, 'Manage Server does not bypass the room while playing');
});
