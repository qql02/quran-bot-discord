import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { pingableRoleId } from '../src/utils/roles.js';

const guild = (roles, canMentionAny = false) => ({
  id: 'G',
  roles: { cache: new Map(roles.map(r => [r.id, r])) },
  members: { me: { permissions: { has: f => canMentionAny && f === PermissionFlagsBits.MentionEveryone } } }
});

test('pingableRoleId: mentionable role is allowed', () => {
  assert.equal(pingableRoleId(guild([{ id: 'R', mentionable: true }]), 'R'), 'R');
});
test('pingableRoleId: a role turned non-mentionable stops being pinged', () => {
  assert.equal(pingableRoleId(guild([{ id: 'R', mentionable: false }]), 'R'), null);
});
test('pingableRoleId: bot with Mention Everyone may ping any role', () => {
  assert.equal(pingableRoleId(guild([{ id: 'R', mentionable: false }], true), 'R'), 'R');
});
test('pingableRoleId: deleted role, @everyone and empty input give null', () => {
  const g = guild([{ id: 'G', mentionable: true }]);
  assert.equal(pingableRoleId(g, 'gone'), null);
  assert.equal(pingableRoleId(g, 'G'), null);
  assert.equal(pingableRoleId(g, null), null);
  assert.equal(pingableRoleId(null, 'R'), null);
});
