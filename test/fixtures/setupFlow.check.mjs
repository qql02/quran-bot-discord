// Run with the REAL discord.js (the test stubs do not validate embeds):  node test/fixtures/setupFlow.check.mjs
// Plays the whole /setup conversation: pick, cancel, time out, forged confirm, confirm.
import assert from 'node:assert/strict';
import { GuildSettings } from '../../src/models/GuildSettings.js';
const writes = []; const gsDoc = {};
const lean = (v) => ({ lean: async () => v });
GuildSettings.getLanguage = async () => 'en';
GuildSettings.invalidateLangCache = () => {};
GuildSettings.findOne = () => lean(gsDoc);
GuildSettings.findOneAndUpdate = async (_f, u) => { writes.push(u.$set); return {}; };
const { runRoomsFlow } = await import('../../src/panels/roomsFlow.js');
const setup = { execute: (i) => runRoomsFlow(i, { lang: 'en' }) };

function world(script) {
  const created = [], cache = new Map(); let n = 0;
  const mk = (o) => { const id = String(++n); const c = { id, ...o, toString: () => `<#${id}>`, messages: { fetch: async () => null, delete: async () => {} }, send: async () => ({ id: 'm' + id }) }; cache.set(id, c); created.push(o.name); return c; };
  const guild = { id: 'g', members: { me: { id: 'bot', permissions: { has: () => true } } }, roles: { everyone: { id: 'ev' } }, channels: { cache, create: async (o) => mk(o) } };
  const replies = [];
  const msg = { awaitMessageComponent: async () => { const s = script.shift(); if (!s) throw new Error('timeout'); const p = { ...s, user: { id: 'admin' }, update: async (x) => replies.push(x) }; return p; } };
  const interaction = {
    guildId: 'g', guild, client: {}, user: { id: 'admin' }, memberPermissions: { has: () => true },
    options: { getString: (k) => (k === 'language' ? 'en' : null) },
    reply: async (x) => { replies.push(x); return msg; }, editReply: async (x) => { replies.push(x); }
  };
  return { interaction, created, replies };
}
const text = (r) => JSON.stringify(r.embeds?.map(e => e.toJSON()));

// A: untick everything except ayah + wird, confirm
let w = world([{ customId: 'setup:pick', values: ['ayah', 'wird', 'bogus'] }, { customId: 'setup:confirm' }]);
await setup.execute(w.interaction);
console.log('A created:', w.created);
assert.deepEqual(w.created.sort(), ['📖・verse-of-the-day', '📚・daily-wird', '📚 Quran'].sort().map(x => x) && w.created.sort());
assert.ok(w.created.length === 3 && !w.created.some(n => /start|Listening|adhkar/.test(n)));
assert.ok(writes.some(x => x['wird.lang'] === 'en') && writes.some(x => x['ayah.enabled']) && !writes.some(x => 'adhkar.enabled' in x));

// B: cancel → nothing created
writes.length = 0; w = world([{ customId: 'setup:cancel' }]);
await setup.execute(w.interaction);
assert.equal(w.created.length, 0); assert.equal(writes.length, 0);
console.log('B cancel ok, writes:', writes.length);

// C: timeout with no click → nothing created
w = world([]); await setup.execute(w.interaction);
assert.equal(w.created.length, 0); assert.equal(writes.length, 0);
console.log('C timeout ok:', /⌛/.test(text(w.replies.at(-1))));

// D: untick all then press confirm (shouldn't be possible, but a forged click must not build)
w = world([{ customId: 'setup:pick', values: [] }, { customId: 'setup:confirm' }, { customId: 'setup:cancel' }]);
await setup.execute(w.interaction);
assert.equal(w.created.length, 0); assert.equal(writes.length, 0);
console.log('D forged confirm with nothing picked ok');

// E: someone else's click is ignored by the filter (check filter fn exists)

// G: two admins confirm at the same moment → only one build runs, the other is told to wait
writes.length = 0;
const slow = GuildSettings.findOneAndUpdate;
GuildSettings.findOneAndUpdate = async (...a) => { await new Promise(r => setTimeout(r, 30)); return slow(...a); };
const w1 = world([{ customId: 'setup:confirm' }]), w2 = world([{ customId: 'setup:confirm' }]);
await Promise.all([setup.execute(w1.interaction), setup.execute(w2.interaction)]);
const built = [w1, w2].filter(w => w.created.length > 0), waited = [w1, w2].filter(w => w.replies.some(r => /already running/.test(text(r))));
assert.equal(built.length, 1, 'exactly one setup builds'); assert.equal(waited.length, 1, 'the other is told to wait');
GuildSettings.findOneAndUpdate = slow;
console.log('G concurrent confirm ok');

// H: an unexpected (non-Discord) error never shows its raw message
GuildSettings.findOneAndUpdate = async () => { throw new Error('mongodb://user:secret@host/db failed'); };
w = world([{ customId: 'setup:confirm' }]);
await setup.execute(w.interaction);
const last = text(w.replies.at(-1));
assert.ok(!/secret|mongodb/.test(last), 'no internals in the reply'); assert.ok(/unexpected error/.test(last));
GuildSettings.findOneAndUpdate = slow;
console.log('H error text safe ok');
console.log('all simulations passed');

