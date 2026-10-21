import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIdFromToken, inviteUrl, inspectBot, isInGuild, guildPermissionGaps, waitUntilInGuild, NEEDED_PERMS, looksLikeTokenText, listGlobalCommands, clearGlobalCommands, VOICE_WORKER_PERMS, VOICE_WORKER_INVITE_PERMISSIONS } from '../src/utils/botToken.js';

const ID = '123456789012345678';
const TOKEN = `${Buffer.from(ID).toString('base64').replace(/=+$/, '')}.GabcDe.${'x'.repeat(27)}`;

// Fake Discord: routes → { status, body }
const fakeFetch = (routes) => async (url) => {
  const path = url.replace('https://discord.com/api/v10', '');
  const r = routes[path] ?? { status: 404, body: {} };
  const rr = typeof r === 'function' ? r() : r;
  return { status: rr.status, json: async () => rr.body };
};

test('client ID is the first part of the token', () => {
  assert.equal(clientIdFromToken(TOKEN), ID);
  assert.equal(clientIdFromToken(`  ${TOKEN}  `), ID);
});

test('malformed tokens give null', () => {
  for (const bad of [undefined, null, '', 'abc', 'a.b', `${Buffer.from('notanumber').toString('base64')}.x.y`, 42]) assert.equal(clientIdFromToken(bad), null);
});

test('invite link carries the derived ID and can pre-select the server', () => {
  const u = inviteUrl(ID, '37047312', '999999999999999999');
  assert.match(u, new RegExp(`client_id=${ID}`));
  assert.match(u, /guild_id=999999999999999999&disable_guild_select=true/);
  assert.ok(!inviteUrl(ID).includes('guild_id'));
});

test('inspectBot: valid bot, wrong token, user account, malformed, network', async () => {
  assert.deepEqual(await inspectBot(TOKEN, fakeFetch({ '/users/@me': { status: 200, body: { id: ID, username: 'Quran2', bot: true } } })), { ok: true, id: ID, name: 'Quran2' });
  assert.equal((await inspectBot(TOKEN, fakeFetch({ '/users/@me': { status: 401, body: {} } }))).reason, 'invalid_token');
  assert.equal((await inspectBot(TOKEN, fakeFetch({ '/users/@me': { status: 200, body: { id: ID, username: 'u' } } }))).reason, 'not_a_bot');
  assert.equal((await inspectBot(TOKEN, fakeFetch({ '/users/@me': { status: 200, body: { id: '987654321098765432', bot: true } } }))).reason, 'not_a_bot');
  assert.equal((await inspectBot('garbage')).reason, 'format');
  assert.equal((await inspectBot(TOKEN, async () => { throw new Error('offline'); })).reason, 'network');
});

test('the token is only ever sent as the Authorization header, never in the URL', async () => {
  let seen;
  await inspectBot(TOKEN, async (url, opts) => { seen = { url, opts }; return { status: 200, json: async () => ({ id: ID, bot: true, username: 'x' }) }; });
  assert.ok(!seen.url.includes(TOKEN));
  assert.equal(seen.opts.headers.Authorization, `Bot ${TOKEN}`);
});

test('isInGuild follows the status code', async () => {
  assert.equal(await isInGuild(TOKEN, 'g', fakeFetch({ '/guilds/g': { status: 200, body: {} } })), true);
  assert.equal(await isInGuild(TOKEN, 'g', fakeFetch({ '/guilds/g': { status: 403, body: {} } })), false);
});

test('permission gaps: reports what is missing, Administrator passes everything', async () => {
  const all = Object.values(NEEDED_PERMS).reduce((a, b) => a | b, 0n);
  const mk = (everyone, extra, roles = []) => fakeFetch({
    '/guilds/g/roles': { status: 200, body: [{ id: 'g', permissions: String(everyone) }, { id: 'r1', permissions: String(extra) }] },
    [`/guilds/g/members/${ID}`]: { status: 200, body: { roles } }
  });
  assert.deepEqual(await guildPermissionGaps(TOKEN, 'g', ID, mk(all, 0n)), { missing: [] });
  const g = await guildPermissionGaps(TOKEN, 'g', ID, mk(NEEDED_PERMS.ViewChannel, 0n));
  assert.deepEqual(g.missing.sort(), ['Connect', 'EmbedLinks', 'SendMessages', 'Speak']);
  assert.deepEqual(await guildPermissionGaps(TOKEN, 'g', ID, mk(0n, 1n << 3n, ['r1'])), { missing: [] });
  assert.equal(await guildPermissionGaps(TOKEN, 'g', ID, fakeFetch({})), null);
});

test('waitUntilInGuild: succeeds once the bot joins, times out otherwise', async () => {
  let calls = 0;
  const f = fakeFetch({ '/guilds/g': () => (++calls >= 3 ? { status: 200, body: {} } : { status: 403, body: {} }) });
  assert.equal(await waitUntilInGuild(TOKEN, 'g', { fetchImpl: f, sleep: async () => {}, intervalMs: 1, timeoutMs: 50 }), true);
  assert.equal(calls, 3);
  assert.equal(await waitUntilInGuild(TOKEN, 'g', { fetchImpl: fakeFetch({}), sleep: async () => {}, intervalMs: 10, timeoutMs: 30 }), false);
});

test('voice-only invite: bot scope only (no slash commands) and no Manage Channels', () => {
  const u = inviteUrl(ID, VOICE_WORKER_INVITE_PERMISSIONS, '999999999999999999', { commands: false });
  assert.match(u, /scope=bot(&|$)/);
  assert.ok(!u.includes('applications.commands'));
  assert.ok(inviteUrl(ID).includes('scope=bot+applications.commands'), 'the main bot keeps its commands scope');
  const bits = BigInt(VOICE_WORKER_INVITE_PERMISSIONS);
  assert.equal(bits & (1n << 4n), 0n, 'Manage Channels is only for the main bot\'s /setup');
  for (const bit of Object.values(VOICE_WORKER_PERMS)) assert.ok(bits & bit, 'the invite grants everything the installer checks');
  assert.ok(bits & (1n << 16n), 'Read Message History: the bot edits its own panel');
});

test('permission gaps for the voice-only bot also require Read Message History', async () => {
  const all = Object.values(NEEDED_PERMS).reduce((a, b) => a | b, 0n);
  const f = fakeFetch({
    '/guilds/g/roles': { status: 200, body: [{ id: 'g', permissions: String(all) }] },
    [`/guilds/g/members/${ID}`]: { status: 200, body: { roles: [] } }
  });
  assert.deepEqual(await guildPermissionGaps(TOKEN, 'g', ID, f), { missing: [] });
  assert.deepEqual(await guildPermissionGaps(TOKEN, 'g', ID, f, VOICE_WORKER_PERMS), { missing: ['ReadMessageHistory'] });
});

test('looksLikeTokenText rejects anything that could break a .env line', () => {
  assert.equal(looksLikeTokenText(TOKEN), true);
  for (const bad of [`${TOKEN}\nBOT_ROLE=primary`, `${TOKEN} x`, `${TOKEN}"`, '', 5, null]) assert.equal(looksLikeTokenText(bad), false);
});

test('leftover slash commands of the second app are listed and can be cleared', async () => {
  assert.deepEqual(await listGlobalCommands(TOKEN, ID, fakeFetch({ [`/applications/${ID}/commands`]: { status: 200, body: [{ name: 'recite' }, { name: 'live' }] } })), ['recite', 'live']);
  assert.equal(await listGlobalCommands(TOKEN, ID, fakeFetch({})), null);
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { status: 200, json: async () => [] }; };
  assert.equal(await clearGlobalCommands(TOKEN, ID, f), true);
  assert.equal(seen.opts.method, 'PUT');
  assert.equal(seen.opts.body, '[]');
  assert.ok(!seen.url.includes(TOKEN));
  assert.equal(await clearGlobalCommands(TOKEN, ID, async () => { throw new Error('offline'); }), false);
});

test('inspectApplication: public / private / code grant / Discord not answering (never throws, never guesses)', async () => {
  const { inspectApplication } = await import('../src/utils/botToken.js');
  const ok = (body) => fakeFetch({ '/applications/@me': { status: 200, body } });
  assert.deepEqual(await inspectApplication(TOKEN, ok({ bot_public: true, bot_require_code_grant: false })), { ok: true, public: true, codeGrant: false });
  assert.deepEqual(await inspectApplication(TOKEN, ok({ bot_public: false })), { ok: true, public: false, codeGrant: false });
  assert.deepEqual(await inspectApplication(TOKEN, ok({ bot_public: true, bot_require_code_grant: true })), { ok: true, public: true, codeGrant: true });
  assert.deepEqual(await inspectApplication(TOKEN, fakeFetch({ '/applications/@me': { status: 401, body: {} } })), { ok: false });
  assert.deepEqual(await inspectApplication(TOKEN, async () => { throw new Error('net'); }), { ok: false });
});

test('voice-only invite: exactly what the worker uses (View, Send, Embed, History, External emojis, Connect, Speak, Voice activity) and nothing powerful', () => {
  const bits = BigInt(VOICE_WORKER_INVITE_PERMISSIONS);
  const want = [10, 11, 14, 16, 18, 20, 21, 25].reduce((a, i) => a | (1n << BigInt(i)), 0n);
  assert.equal(bits, want, 'the permission integer is exactly this set');
  for (const i of [1, 2, 3, 4, 5, 13, 17, 22, 23, 24, 28, 29]) assert.equal(bits & (1n << BigInt(i)), 0n, `bit ${i} (Kick/Ban/Admin/Manage…/Mention everyone/Mute/Deafen/Move) is not granted`);
});
