// Run by test/personalAdhkarService.test.js in a plain Node process: real mongoose model class, in-memory fake of its queries.
process.env.DISCORD_TOKEN ??= 'x'; process.env.CLIENT_ID ??= '123456789012345678'; process.env.MONGODB_URI ??= 'mongodb://x'; process.env.NODE_ENV ??= 'development';
import assert from 'node:assert/strict';
const { WirdSubscription } = await import('../../src/models/WirdSubscription.js');
const { processAdhkar } = await import('../../src/services/wirdService.js');

let docs = [];
const matches = (d, q) => Object.entries(q).every(([k, v]) => (v && typeof v === 'object' && '$ne' in v ? d[k] !== v.$ne : d[k] === v));
const lean = (x) => ({ lean: async () => x });
WirdSubscription.findOneAndUpdate = (q, upd) => { const d = docs.find(x => matches(x, q)); if (!d) return lean(null); const before = { ...d }; Object.assign(d, upd.$set); return lean(before); };
WirdSubscription.updateOne = async (q, upd) => { const d = docs.find(x => matches(x, q)); if (d) Object.assign(d, upd.$set); };

const sent = [];
const client = (behaviour = 'ok') => ({
  users: { fetch: async () => ({ send: async (p) => { if (behaviour === 'closed') throw Object.assign(new Error('x'), { code: 50007 }); if (behaviour === 'net') throw new Error('network'); sent.push(p); } }) },
  guilds: { cache: { get: () => { throw new Error('the room must never be touched for personal adhkar'); } } }
});
const embeds = (slot) => [{ title: `${slot} 1` }, { title: `${slot} 2` }];
const NOW = new Date('2026-10-09T05:30:00Z');                       // 06:30 in Algiers
const fresh = (o = {}) => ({ userId: '1', guildId: 'g1', active: true, timezone: 'Africa/Algiers', adhkarMorning: true, adhkarEvening: false, lastAdhkarMorning: null, lastAdhkarEvening: null, ...o });

// 1) due → every embed is sent as its own DM, once
docs = [fresh()];
await processAdhkar(client(), docs[0], NOW, embeds);
assert.equal(sent.length, 2); assert.equal(docs[0].lastAdhkarMorning, '2026-10-09');
// 2) a second tick the same day sends nothing (claimed)
await processAdhkar(client(), { ...docs[0] }, NOW, embeds);
assert.equal(sent.length, 2);
// 3) two processes racing: only one wins the claim
sent.length = 0; docs = [fresh()];
const snapshot = { ...docs[0] };
await Promise.all([processAdhkar(client(), snapshot, NOW, embeds), processAdhkar(client(), snapshot, NOW, embeds)]);
assert.equal(sent.length, 2, 'sent twice by two racing ticks');
// 4) network error → claim released so the next tick retries
sent.length = 0; docs = [fresh()];
await processAdhkar(client('net'), docs[0], NOW, embeds);
assert.equal(docs[0].lastAdhkarMorning, null); assert.equal(sent.length, 0);
await processAdhkar(client(), { ...docs[0] }, NOW, embeds);
assert.equal(sent.length, 2);
// 5) DMs closed → switched off (and the room is never used)
sent.length = 0; docs = [fresh({ adhkarEvening: true })];
await processAdhkar(client('closed'), docs[0], NOW, embeds);
assert.equal(docs[0].adhkarMorning, false); assert.equal(docs[0].adhkarEvening, false);
// 6) a paused / expired subscription is never served
docs = [fresh({ active: false })]; sent.length = 0;
await processAdhkar(client(), docs[0], NOW, embeds);
assert.equal(sent.length, 0);
console.log('ALL OK');
process.exit(0);
