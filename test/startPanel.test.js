import { test } from 'node:test';
import assert from 'node:assert/strict';

const reg = await import('../src/utils/panelRegistry.js');

/** A fake text/voice channel that records what is sent and deleted. */
function fakeChannel(id, log, { canWrite = true } = {}) {
  return {
    id, name: id,
    permissionsFor: () => ({ has: () => canWrite }),
    messages: { delete: async (mid) => { log.deleted.push(`${id}/${mid}`); } },
    send: async () => { const m = { id: `m${++log.n}`, channelId: id }; log.sent.push(`${id}/${m.id}`); return m; }
  };
}
function fakeEnv() {
  const log = { n: 0, sent: [], deleted: [] };
  const channels = new Map();
  const add = (id, opts) => { const c = fakeChannel(id, log, opts); channels.set(id, c); return c; };
  const client = { channels: { cache: { get: (id) => channels.get(id) } } };
  const guild = { id: 'gStart', members: { me: {} }, channels: { cache: { get: (id) => channels.get(id) } } };
  return { log, add, client, guild };
}

test('only one panel per server: sending a new one deletes the previous one', async () => {
  const { log, add, client, guild } = fakeEnv();
  const voice = add('voice1'); const text = add('text1');
  const a = await reg.sendVoicePanel(client, guild, voice, text);
  assert.equal(a.channel.id, 'voice1');
  const b = await reg.sendVoicePanel(client, guild, text, null);
  assert.deepEqual(log.deleted, [`voice1/${a.message.id}`]);
  assert.equal(b.channel.id, 'text1');
});

test('the panel goes to the text channel when the bot may not write in the voice channel', async () => {
  const { add, client, guild } = fakeEnv();
  const voice = add('voice2', { canWrite: false }); const text = add('text2');
  assert.equal((await reg.sendVoicePanel(client, guild, voice, text)).channel.id, 'text2');
  assert.equal(await reg.sendVoicePanel(client, guild, voice, voice), null);
});

test('/start outside voice: the panel is sent to the voice channel the person joins next', async () => {
  const { log, add, client, guild } = fakeEnv();
  const voice = add('voice3'); const text = add('text3');
  reg.waitForVoiceJoin(guild.id, 'u1', 'text3');
  assert.equal(await reg.onVoiceJoin({ guild, id: 'u2', channel: voice }, client), false);   // someone else joining does nothing
  assert.equal(await reg.onVoiceJoin({ guild, id: 'u1', channel: voice }, client), true);
  assert.ok(log.sent.some(s => s.startsWith('voice3/')));
  assert.equal(await reg.onVoiceJoin({ guild, id: 'u1', channel: voice }, client), false);   // one panel per /start
  void text;
});

test('the idle panel explains its buttons (no slash commands to type) and the command set is small', async () => {
  const { buildPanelMessage } = await import('../src/utils/panel.js');
  for (const lang of ['ar', 'en']) {
    const card = JSON.stringify(buildPanelMessage(null, lang, 'g').components[0].toJSON());
    for (const c of ['/setup', '/help']) assert.ok(card.includes(c), c);
    for (const gone of ['/khatma', '/live', '/memorize']) assert.ok(!card.includes(gone), gone);
  }
  const fs = await import('node:fs');
  const names = fs.readdirSync(new URL('../src/commands/', import.meta.url)).map(f => f.replace('.js', '')).sort();
  assert.deepEqual(names, ['azkar', 'clear', 'clearqueue', 'continue', 'guide', 'hadith', 'help', 'hijri', 'hold', 'invite', 'journey', 'khatma', 'leave', 'live', 'memorize', 'mushaf', 'next', 'now', 'pull', 'queue', 'recite', 'setup', 'sleep', 'start', 'stats', 'test', 'volume']);   // files; /clear is named cleardm and /test is the owner command
});
