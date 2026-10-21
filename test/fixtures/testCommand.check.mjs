// Run by test/testCommand.test.js in a plain Node process (real discord.js, no test stubs).
import assert from 'node:assert/strict';

const OWNER = '111111111111111111';
process.env.ADMIN_IDS = OWNER;                       // must be set before config.js is first imported
const cmd = (await import('../../src/commands/test.js')).default;

const sent = [];
const mk = (userId, sub, opts = {}) => ({
  user: { id: userId }, guildId: '222', channelId: '333',
  client: { ws: { ping: 40 }, guilds: { cache: { size: 1, get: () => undefined } } },
  guild: { members: { me: {} } },
  channel: { permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(['channel.send', p]); return { id: 'm' }; } },
  member: { voice: { channel: null } },
  options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getBoolean: (k) => opts[k] ?? null },
  reply: async (p) => { sent.push(['reply', p]); }, deferReply: async () => {},
  editReply: async (p) => { sent.push(['editReply', p]); }, followUp: async (p) => { sent.push(['followUp', p]); }
});

// 1) owner only, hidden from regular members
sent.length = 0;
await cmd.execute(mk('999', 'khatma'));
assert.equal(sent.length, 1);
assert.equal(sent[0][0], 'reply');
assert.match(sent[0][1].content, /لمالك البوت/);
assert.equal(cmd.data.toJSON().default_member_permissions, '8');     // Administrator
assert.equal(cmd.data.toJSON().dm_permission, false);

// 2) khatma: post:true really sends the announcement, pinging only the caller
sent.length = 0;
await cmd.execute(mk(OWNER, 'khatma', { number: 4, days: 31, post: true }));
const posted = sent.find(s => s[0] === 'channel.send')[1];
assert.match(posted.content, /الختمة رقم \*\*4\*\*/);
assert.match(posted.content, /\*\*31\*\* يوماً/);
assert.deepEqual(posted.allowedMentions, { users: [OWNER] });

// 3) adhkar / event previews and every wird view build; wird previews carry no live buttons
for (const [sub, opts] of [['adhkar', { kind: 'morning' }], ['adhkar', { kind: 'evening', style: 'compact' }], ['event', {}]]) {
  sent.length = 0; await cmd.execute(mk(OWNER, sub, opts));
  assert.ok(sent[0][1].embeds?.length, `${sub} preview has embeds`);
}
for (const view of ['reminder', 'status', 'reading', 'khatma', 'expiring', 'inactive']) {
  sent.length = 0; await cmd.execute(mk(OWNER, 'wird', { view }));
  const preview = sent.at(-1)[1];
  assert.ok(preview.embeds?.length, `wird ${view} has an embed`);
  assert.deepEqual(preview.components, [], `wird ${view} must not keep real buttons`);
}
console.log('ALL OK');
process.exit(0);
