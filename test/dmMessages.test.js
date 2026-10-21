import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// The database is not used here: every lookup answers "nothing stored".
const none = (v) => { const p = Promise.resolve(v); const c = { lean: () => c, then: (a, b) => p.then(a, b), catch: (f) => p.catch(f) }; return c; };
mongoose.Model.findOne = () => none(null);
mongoose.Model.updateOne = () => none({});

const { default: ev } = await import('../src/events/messageCreate.js');
const { config } = await import('../src/config.js');
const P = config.bot.prefix;
const BOT = '999';
const say = (m) => m.embeds?.[0]?.data?.setDescription ?? m.embeds?.[0]?.data?.description ?? m.content ?? '';   // the test stub of discord.js keeps what was set under the setter's name

/** A private chat: the history (newest first) and Discord's rule that a bot may not delete the member's own messages. */
function chat(userId, history = [], { refuseOthers = true } = {}) {
  const msgs = history.map(([id, who]) => ({ id, author: { id: who === 'bot' ? BOT : userId }, deleted: false,
    delete: async function () { if (this.author.id !== BOT && refuseOthers) throw Object.assign(new Error('Cannot execute action on a DM channel'), { code: 50003 }); this.deleted = true; } }));
  const dm = { messages: { fetch: async ({ limit = 50, before } = {}) => {
    const live = msgs.filter(m => !m.deleted);
    const page = live.slice(before ? live.findIndex(m => m.id === before) + 1 : 0).slice(0, limit);
    return Object.assign(new Map(page.map(m => [m.id, m])), { last: () => page.at(-1) });
  } } };
  const sent = []; const reactions = [];
  const author = { id: userId, bot: false, createDM: async () => dm };
  const channel = { isDMBased: () => true, sendTyping: async () => {}, send: async (p) => { sent.push(p); return { id: 'r' + sent.length }; } };
  return { msgs, sent, reactions, mk: (text) => ({ author, guildId: null, content: text, channel, react: async (e) => { reactions.push(e); } }) };
}
const client = { user: { id: BOT } };

test('punctuation or emoji after the prefix is ordinary chat: no "I do not know `!`" reply', async () => {
  for (const text of ['!!!', '!?', '!👍', '!!', '!...']) {
    const c = chat('u-' + text); await ev.execute(c.mk(text), client);
    assert.equal(c.sent.length, 0, text);
  }
});

test('a real unknown word still gets the friendly answer, with a suggestion', async () => {
  const c = chat('u-unknown'); await ev.execute(c.mk(`${P}helpp`), client);
  assert.equal(c.sent.length, 1); assert.match(say(c.sent[0]), /help/);
});

test('a command sent too fast is not silent: the member gets an hourglass reaction', async () => {
  const c = chat('u-fast');
  await ev.execute(c.mk(`${P}help`), client);
  assert.equal(c.sent.length, 1); assert.deepEqual(c.reactions, []);
  await ev.execute(c.mk(`${P}help`), client);                  // immediately again
  assert.equal(c.sent.length, 1); assert.deepEqual(c.reactions, ['⏳']);
});

test('a reaction that fails (blocked, closed chat) never breaks the handler', async () => {
  const c = chat('u-fast2');
  await ev.execute(c.mk(`${P}help`), client);
  const m = c.mk(`${P}help`); m.react = () => Promise.reject(new Error('nope'));
  await assert.doesNotReject(ev.execute(m, client));
});

test('!clear: every bot message goes; when Discord refuses the member\'s own, the reply says so', async () => {
  const c = chat('u-clear', [['5', 'bot'], ['4', 'me'], ['3', 'bot'], ['2', 'me'], ['1', 'bot']]);
  await ev.execute(c.mk(`${P}clear`), client);
  assert.equal(c.msgs.filter(m => m.author.id === BOT && !m.deleted).length, 0);
  assert.equal(c.msgs.filter(m => m.author.id !== BOT && !m.deleted).length, 2);   // Discord kept them
  assert.match(say(c.sent[0]), /Deleted \*\*3\*\*/);
  assert.match(say(c.sent[0]), /your own/);
});

test('!clear: when Discord allows it, the member\'s messages go too and no excuse is shown', async () => {
  const c = chat('u-clear2', [['3', 'bot'], ['2', 'me'], ['1', 'bot']], { refuseOthers: false });
  await ev.execute(c.mk(`${P}clear`), client);
  assert.equal(c.msgs.filter(m => !m.deleted).length, 0);
  assert.match(say(c.sent[0]), /Deleted \*\*3\*\*/);
  assert.doesNotMatch(say(c.sent[0]), /your own/);
});

test('the help text for clear tells the truth about the member\'s messages', async () => {
  const { DM_HELP } = await import('../src/utils/dmCommands.js');
  assert.match(DM_HELP.en('!'), /if Discord allows/); assert.match(DM_HELP.ar('!'), /إن سمح ديسكورد/);
});
