// Owner panel phase 5 — the routes, run against fake models (no Express, no database, no Discord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerOwnerPhase5 } from '../src/api/ownerPhase5.js';
import { UserError } from '../src/utils/errors.js';
import { sessionRef } from '../src/utils/ownerFleet.js';

const OWNER = '123456789012345678', MOD = '223456789012345678', DEAD = '323456789012345678', BOT = '999999999999999999', W1 = '888888888888888888';
const now = Date.now();

/** A Mongoose-like query over an array: filters are recorded, not interpreted. */
const query = (arr, rec) => {
  const q = { sort: () => q, skip: () => q, limit: () => q, lean: () => q, select: () => q,
    cursor: () => ({ async *[Symbol.asyncIterator]() { for (const d of arr) yield d; } }),
    then: (res, rej) => Promise.resolve(arr).then(res, rej) };
  void rec; return q;
};
const model = (arr = [], over = {}) => {
  const m = {
    calls: [], docs: arr,
    find(f) { m.calls.push(['find', f]); return query(arr); },
    findOne(f) { m.calls.push(['findOne', f]); return query(arr[0] ?? null); },
    findById(id) { m.calls.push(['findById', id]); return query(arr.find(d => String(d._id) === String(id)) ?? null); },
    countDocuments(f) { m.calls.push(['count', f]); return Promise.resolve(arr.length); },
    aggregate(p) { m.calls.push(['aggregate', p]); return Promise.resolve([]); },
    updateOne(f, u) { m.calls.push(['updateOne', f, u]); return Promise.resolve({ modifiedCount: 1, matchedCount: 1 }); },
    updateMany(f, u) { m.calls.push(['updateMany', f, u]); return Promise.resolve({ modifiedCount: 2 }); },
    deleteOne(f) { m.calls.push(['deleteOne', f]); return Promise.resolve({ deletedCount: 1 }); },
    findOneAndUpdate(f, u) { m.calls.push(['findOneAndUpdate', f, u]); return query(arr[0] ?? null); },
    findOneAndDelete(f) { m.calls.push(['findOneAndDelete', f]); return query(arr[0] ?? null); },
    ...over
  };
  return m;
};

function setup({ models = {}, svcOver = {}, sessions = [], control = { hiddenReciters: [] } } = {}) {
  const routes = {};
  const reg = (method) => (path, ...h) => { routes[`${method} ${path}`] = h.at(-1); };
  const app = { get: reg('GET'), post: reg('POST') };
  const audit = [], failed = [], saved = [], sessionOps = [];
  const sessionsCol = { lastFilter: null, find(f) { sessionsCol.lastFilter = f; return { sort: () => ({ limit: () => ({ toArray: async () => sessions }) }) }; }, deleteOne: async (f) => { sessionOps.push(f._id); return { deletedCount: 1 }; } };
  const reciters = [{ id: 7, displayName: 'Reciter', arabicName: 'قارئ', moshaf: [{ surah_total: 114, server: 'https://x/' }] }, { id: 'qa5', displayName: 'Extra', moshaf: [] }];
  const svc = {
    addStation: async ({ name }) => ({ _id: 'a'.repeat(24), name, url: 'https://s/1', addedBy: OWNER, createdAt: new Date() }),
    removeStation: async () => ({ name: 'S' }), probeStream: async () => {}, listAllReciters: async () => reciters, getPlayableUrls: async () => [{ url: 'https://x/001.mp3' }],
    sendEvent: async () => ({ ok: true }), nextExpiry: () => new Date(now + 30 * 86_400_000),
    getControl: () => control, saveControl: async (p, by) => { saved.push([p, by]); }, botRole: 'primary', ownSessions: () => [], ...svcOver
  };
  registerOwnerPhase5(app, {
    client: { user: { id: BOT, tag: 'Main#1' }, ws: { ping: 42 }, guilds: { cache: new Map([['111111111111111111', { id: '111111111111111111', name: 'Guild A', memberCount: 9 }]]) }, users: { cache: new Map() } },
    requireAdmin: (_q, _s, n) => n(), pushActivity: (...a) => audit.push(a), fail: (res, err) => { failed.push(err); res.status(500).json({ error: 'Internal error' }); },
    models: { BotInstance: model(), PlayerJob: model(), PullLog: model(), CustomStation: model(), GuildSettings: model(), WirdSubscription: model([{ userId: OWNER, active: true, expiresAt: new Date(now + 86_400_000) }]), ReligiousEvent: model(), ActivityLog: model(), ...models },
    exportModels: { settings: model([{ guildId: '1', language: 'ar' }, { guildId: '2' }]), stations: model(), blacklist: model(), control: model(), notes: model(), events: model(), broadcasts: model() },
    svc,
    security: { adminIds: () => [OWNER], modIds: () => [MOD], roleOf: (id) => (id === OWNER ? 'owner' : id === MOD ? 'mod' : null), sessionsCollection: () => sessionsCol,
      info: () => ({ apiBaseHttps: true, trustProxy: 1, sessionDays: 2, absoluteDays: 7, adminCount: 1, modCount: 1, secretLength: 64, modCapsOn: 3, modCapsTotal: 7, modCaps: { play: 'x' } }) }
  });
  return { routes, audit, failed, saved, sessionOps, sessionsCol };
}

async function call(routes, key, { params = {}, query: qs = {}, body = {}, sessionID = 'S1', user = { id: OWNER } } = {}) {
  const h = routes[key];
  assert.ok(h, `route ${key} is registered`);
  const out = { status: 200, json: undefined, headers: {}, chunks: [], ended: false, destroyed: false };
  const res = {
    headersSent: false,
    status(c) { out.status = c; return res; }, json(b) { out.json = b; res.headersSent = true; return res; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, write(c) { res.headersSent = true; out.chunks.push(c); return true; },
    end(c) { if (c) out.chunks.push(c); out.ended = true; }, destroy() { out.destroyed = true; }
  };
  await h({ params, query: qs, body, sessionID, session: { user } }, res);
  return out;
}
const sess = (id, userId, extra = {}) => ({ _id: id, session: JSON.stringify({ user: { id: userId, username: 'u' + userId.slice(0, 3), at: now - 1000, ...extra } }), expires: new Date(now + 86_400_000) });

test('every phase-5 route is behind requireAdmin (owner only)', () => {
  const guarded = [];
  const app = { get: (p, ...h) => guarded.push([p, h.length]), post: (p, ...h) => guarded.push([p, h.length]) };
  registerOwnerPhase5(app, { client: { user: { id: BOT }, guilds: { cache: new Map() } }, requireAdmin: () => {}, pushActivity() {}, fail() {}, models: {}, svc: {}, security: {} });
  assert.ok(guarded.length >= 30, `${guarded.length} routes`);
  for (const [path, n] of guarded) assert.ok(n >= 2, `${path} has a guard before its handler`);
});

test('security: sessions are listed without their ids; the current one is marked', async () => {
  const s = setup({ sessions: [sess('S1', OWNER), sess('S2', OWNER), sess('S3', MOD), sess('S4', DEAD), { _id: 'junk', session: 'nope' }] });
  const r = await call(s.routes, 'GET /api/admin/security/sessions');
  assert.equal(r.json.rows.length, 4);
  assert.equal(r.json.rows.find(x => x.userId === DEAD).role, null);
  assert.equal(r.json.rows.filter(x => x.current).length, 1);
  assert.ok(!/S[1-4]"/.test(JSON.stringify(r.json).replace(/"ref":"[a-f0-9]+"/g, '')), 'no raw session id in the response');
});

test('security: the session list only asks the store for signed-in sessions (anonymous documents cannot crowd it out)', async () => {
  const s = setup({ sessions: [sess('S1', OWNER)] });
  await call(s.routes, 'GET /api/admin/security/sessions');
  const f = JSON.stringify(s.sessionsCol.lastFilter);
  assert.ok(f.includes('user'), 'filter mentions the user field');
  const rx = new RegExp(s.sessionsCol.lastFilter.$or[0].session.$regex);
  assert.ok(rx.test(JSON.stringify({ cookie: {}, user: { id: '1' } })), 'matches a signed-in JSON session');
  assert.ok(!rx.test(JSON.stringify({ cookie: {}, oauthState: { nonce: 'x' } })), 'does not match an anonymous one');
});

test('security: revoke — bad ref, own session, unknown, success', async () => {
  const s = setup({ sessions: [sess('S1', OWNER), sess('S2', MOD)] });
  assert.equal((await call(s.routes, 'POST /api/admin/security/sessions/revoke', { body: { ref: 'nope' } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/security/sessions/revoke', { body: { ref: { $ne: 1 } } })).status, 400);
  const own = await call(s.routes, 'POST /api/admin/security/sessions/revoke', { body: { ref: sessionRef('S1') } });
  assert.equal(own.status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/security/sessions/revoke', { body: { ref: 'a'.repeat(16) } })).status, 404);
  assert.deepEqual(s.sessionOps, [], 'nothing deleted so far');
  const ok = await call(s.routes, 'POST /api/admin/security/sessions/revoke', { body: { ref: sessionRef('S2') } });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.sessionOps, ['S2']);
  assert.equal(s.audit.length, 1);
});

test('security: revoke-all needs the confirm token, never touches the current session, can target moderators only', async () => {
  const mk = () => setup({ sessions: [sess('S1', OWNER), sess('S2', OWNER), sess('S3', MOD)] });
  let s = mk();
  assert.equal((await call(s.routes, 'POST /api/admin/security/sessions/revoke-all', { body: {} })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/security/sessions/revoke-all', { body: { confirm: 'yes' } })).status, 400);
  assert.deepEqual(s.sessionOps, []);
  const all = await call(s.routes, 'POST /api/admin/security/sessions/revoke-all', { body: { confirm: 'REVOKE' } });
  assert.equal(all.json.revoked, 2);
  assert.deepEqual(s.sessionOps.sort(), ['S2', 'S3']);
  s = mk();
  await call(s.routes, 'POST /api/admin/security/sessions/revoke-all', { body: { confirm: 'REVOKE', onlyMods: true } });
  assert.deepEqual(s.sessionOps, ['S3']);
});

test('security: overview carries the checklist, who may sign in and the moderator rights', async () => {
  const s = setup({ sessions: [sess('S1', OWNER)] });
  const r = await call(s.routes, 'GET /api/admin/security/overview');
  assert.equal(r.status, 200);
  assert.ok(r.json.checklist.length >= 6);
  assert.deepEqual(r.json.owners.map(o => o.id), [OWNER]);
  assert.deepEqual(r.json.mods.map(o => o.id), [MOD]);
  assert.equal(r.json.sessions.total, 1);
});

test('export: only whitelisted sets; the file is a JSON array with a safe name; the action is audited', async () => {
  const s = setup();
  assert.equal((await call(s.routes, 'GET /api/admin/security/export', { query: { set: 'wird' } })).status, 400);
  assert.equal((await call(s.routes, 'GET /api/admin/security/export', { query: { set: '__proto__' } })).status, 400);
  assert.equal((await call(s.routes, 'GET /api/admin/security/export', { query: { set: ['settings'] } })).status, 400);
  assert.equal(s.audit.length, 0);
  const r = await call(s.routes, 'GET /api/admin/security/export', { query: { set: 'settings' } });
  assert.match(r.headers['content-disposition'], /^attachment; filename="quran-bot-settings-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.deepEqual(JSON.parse(r.chunks.join('')), [{ guildId: '1', language: 'ar' }, { guildId: '2' }]);
  assert.equal(r.ended, true);
  assert.equal(s.audit.length, 1);
});

test('export: a failure in the middle destroys the connection (half a file never looks complete)', async () => {
  const s = setup();
  const boom = { find: () => ({ lean: () => ({ cursor: () => ({ async *[Symbol.asyncIterator]() { yield { a: 1 }; throw new Error('db'); } }) }) }) };
  const routes = {};
  registerOwnerPhase5({ get: (p, ...h) => { routes[`GET ${p}`] = h.at(-1); }, post() {} }, {
    client: { user: { id: BOT }, guilds: { cache: new Map() } }, requireAdmin: (_q, _s, n) => n(), pushActivity() {}, fail() {}, models: {}, exportModels: { settings: boom }, svc: {}, security: {} });
  const r = await call(routes, 'GET /api/admin/security/export', { query: { set: 'settings' } });
  assert.equal(r.destroyed, true);
  assert.equal(r.ended, false);
  void s;
});

test('reciters: hide validates the type and the reciter; show works for any id; the list goes through saveControl', async () => {
  const s = setup({ control: { hiddenReciters: ['qa5'] } });
  assert.equal((await call(s.routes, 'POST /api/admin/reciters/hide', { body: { id: '7', hidden: 'yes' } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/reciters/hide', { body: { id: '404', hidden: true } })).status, 404);
  assert.equal((await call(s.routes, 'POST /api/admin/reciters/hide', { body: { id: '$ne', hidden: false } })).status, 400, 'ids are validated before use');
  assert.equal((await call(s.routes, 'POST /api/admin/reciters/hide', { body: { id: 'zz9', hidden: false } })).status, 200, 'showing an id that is not in the list is harmless');
  const ok = await call(s.routes, 'POST /api/admin/reciters/hide', { body: { id: '7', hidden: true } });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.saved.at(-1)[0], { hiddenReciters: ['qa5', '7'] });
  assert.equal(s.saved.at(-1)[1], OWNER);
});

test('reciters: the catalogue shows hidden state, filters and pages', async () => {
  const s = setup({ control: { hiddenReciters: ['qa5'] } });
  const all = await call(s.routes, 'GET /api/admin/reciters/catalog');
  assert.deepEqual(all.json.rows.map(r => [r.id, r.hidden]), [['7', false], ['qa5', true]]);
  assert.equal(all.json.hiddenCount, 1);
  const hidden = await call(s.routes, 'GET /api/admin/reciters/catalog', { query: { hidden: '1' } });
  assert.deepEqual(hidden.json.rows.map(r => r.id), ['qa5']);
  const q = await call(s.routes, 'GET /api/admin/reciters/catalog', { query: { q: 'قار' } });
  assert.deepEqual(q.json.rows.map(r => r.id), ['7']);
  const bad = await call(s.routes, 'GET /api/admin/reciters/catalog', { query: { q: ['x'], limit: 'abc' } });
  assert.equal(bad.status, 200);
});

test('stations: a user-fixable error becomes a readable message, anything else is a 500 that is logged', async () => {
  let s = setup({ svcOver: { addStation: async () => { throw new UserError('station_unreachable'); } } });
  assert.equal((await call(s.routes, 'POST /api/admin/stations', { body: { name: '' } })).status, 400);
  const r = await call(s.routes, 'POST /api/admin/stations', { body: { name: 'Radio', url: 'https://x' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /تعذّر الوصول/);
  assert.ok(!/^[❌]/u.test(r.json.error), 'the leading emoji of the chat message is dropped');
  s = setup({ svcOver: { addStation: async () => { throw new Error('db down'); } } });
  const e = await call(s.routes, 'POST /api/admin/stations', { body: { name: 'Radio', url: 'https://x' } });
  assert.equal(e.status, 500);
  assert.equal(s.failed.length, 1);
  s = setup();
  const ok = await call(s.routes, 'POST /api/admin/stations', { body: { name: 'Radio', url: 'https://x' } });
  assert.equal(ok.json.station.name, 'Radio');
  assert.equal(s.audit.length, 1);
});

test('stations: ids are checked before they reach a query; guild stations can only be removed through the guild route', async () => {
  const CustomStation = model([{ _id: 'a'.repeat(24), name: 'Bad', guildId: '111111111111111111' }]);
  const s = setup({ models: { CustomStation } });
  assert.equal((await call(s.routes, 'POST /api/admin/stations/:sid/rename', { params: { sid: '{"$ne":1}' }, body: { name: 'xx' } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/stations/:sid/rename', { params: { sid: 'a'.repeat(24) }, body: { name: 'x' } })).status, 400, 'name too short');
  assert.equal((await call(s.routes, 'POST /api/admin/stations/guild/:sid/delete', { params: { sid: 'zz' } })).status, 400);
  const del = await call(s.routes, 'POST /api/admin/stations/guild/:sid/delete', { params: { sid: 'a'.repeat(24) } });
  assert.equal(del.status, 200);
  assert.deepEqual(CustomStation.calls.at(-1), ['findOneAndDelete', { _id: 'a'.repeat(24), scope: 'guild' }]);
  const ren = await call(s.routes, 'POST /api/admin/stations/:sid/rename', { params: { sid: 'a'.repeat(24) }, body: { name: 'New name' } });
  assert.equal(ren.status, 200);
  assert.deepEqual(CustomStation.calls.at(-1).slice(0, 2), ['updateOne', { _id: 'a'.repeat(24), scope: 'global' }]);
});

test('stations: searching guild stations turns text into an escaped regex, a snowflake into an exact match', async () => {
  const CustomStation = model();
  const s = setup({ models: { CustomStation } });
  await call(s.routes, 'GET /api/admin/stations/guild', { query: { q: 'a.b(c' } });
  const f1 = CustomStation.calls.find(c => c[0] === 'find')[1];
  assert.equal(f1.$or[0].name.$regex, 'a\\.b\\(c');
  await call(s.routes, 'GET /api/admin/stations/guild', { query: { q: '111111111111111111' } });
  const f2 = CustomStation.calls.filter(c => c[0] === 'find')[1][1];
  assert.equal(f2.guildId, '111111111111111111');
  await call(s.routes, 'GET /api/admin/stations/guild', { query: { q: { $ne: 'x' } } });
  assert.deepEqual(CustomStation.calls.filter(c => c[0] === 'find')[2][1], { scope: 'guild' });
});

test('stations: a probe reports live / the reason; "all" probes every global station', async () => {
  const CustomStation = model([{ _id: 'a'.repeat(24), url: 'https://a' }, { _id: 'b'.repeat(24), url: 'https://b' }]);
  const s = setup({ models: { CustomStation }, svcOver: { probeStream: async (url) => { if (url === 'https://b') throw new UserError('station_not_audio'); } } });
  const r = await call(s.routes, 'POST /api/admin/stations/check', { body: { all: true } });
  assert.deepEqual(r.json.results.map(x => [x.live, x.error]), [[true, null], [false, 'station_not_audio']]);
  assert.equal((await call(s.routes, 'POST /api/admin/stations/check', { body: { id: 'nope' } })).status, 400);
});

test('wird: actions are whitelisted, ids validated, renew re-arms the notices, delete needs the token', async () => {
  const WirdSubscription = model([{ userId: OWNER, active: true, expiresAt: new Date(now + 86_400_000), renewals: 1 }]);
  const s = setup({ models: { WirdSubscription } });
  assert.equal((await call(s.routes, 'POST /api/admin/content/wird/users/:uid/:action', { params: { uid: 'abc', action: 'pause' } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/content/wird/users/:uid/:action', { params: { uid: OWNER, action: 'drop' } })).status, 404);
  assert.equal(WirdSubscription.calls.length, 0);
  const r = await call(s.routes, 'POST /api/admin/content/wird/users/:uid/:action', { params: { uid: OWNER, action: 'renew' } });
  assert.equal(r.status, 200);
  const [, filter, update] = WirdSubscription.calls.at(-1);
  assert.deepEqual(filter, { userId: OWNER });
  assert.deepEqual(Object.keys(update.$set).sort(), ['active', 'expiredNoticed', 'expiresAt', 'failCount', 'renewWarned']);
  assert.deepEqual(update.$inc, { renewals: 1 });
  assert.equal((await call(s.routes, 'POST /api/admin/content/wird/users/:uid/delete', { params: { uid: OWNER }, body: {} })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/content/wird/users/:uid/delete', { params: { uid: OWNER }, body: { confirm: 'DELETE' } })).status, 200);
});

test('wird: the list only accepts a numeric id as text search and builds the state filters itself', async () => {
  const WirdSubscription = model();
  const s = setup({ models: { WirdSubscription } });
  assert.equal((await call(s.routes, 'GET /api/admin/content/wird/users', { query: { q: 'ahmed' } })).status, 400);
  await call(s.routes, 'GET /api/admin/content/wird/users', { query: { q: OWNER, state: 'expiring' } });
  const f = WirdSubscription.calls.find(c => c[0] === 'find')[1];
  assert.deepEqual(f.$or, [{ userId: OWNER }, { guildId: OWNER }]);
  assert.equal(f.active, true);
  assert.ok(f.expiresAt.$gt instanceof Date && f.expiresAt.$lte instanceof Date);
  await call(s.routes, 'GET /api/admin/content/wird/users', { query: { state: { $ne: 'x' } } });
  assert.deepEqual(WirdSubscription.calls.filter(c => c[0] === 'find')[1][1], {}, 'an unknown state is ignored, not passed on');
});

test('events: toggle needs a real boolean, test posts through the service and reports why it failed, delete needs the token', async () => {
  const ReligiousEvent = model([{ _id: 'c'.repeat(24), title: 'T', guildId: '111111111111111111', channelId: '5' }]);
  let s = setup({ models: { ReligiousEvent } });
  const id = 'c'.repeat(24);
  assert.equal((await call(s.routes, 'POST /api/admin/content/events/:eid/toggle', { params: { eid: id }, body: { enabled: 'false' } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/content/events/:eid/toggle', { params: { eid: 'x' }, body: { enabled: true } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/content/events/:eid/toggle', { params: { eid: id }, body: { enabled: false } })).status, 200);
  assert.deepEqual(ReligiousEvent.calls.at(-1), ['updateOne', { _id: id }, { $set: { enabled: false } }]);
  assert.equal((await call(s.routes, 'POST /api/admin/content/events/:eid/delete', { params: { eid: id }, body: {} })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/content/events/:eid/delete', { params: { eid: id }, body: { confirm: 'DELETE' } })).status, 200);
  s = setup({ models: { ReligiousEvent }, svcOver: { sendEvent: async () => ({ ok: false, reason: 'no_permission' }) } });
  const t = await call(s.routes, 'POST /api/admin/content/events/:eid/test', { params: { eid: id } });
  assert.deepEqual([t.status, t.json.error], [422, 'no_permission']);
});

test('fleet: forgetting a bot needs the token, refuses this bot and any bot that is still alive', async () => {
  const BotInstance = model([{ _id: W1, tag: 'W1#1', lastSeen: new Date(now - 10 * 60_000) }, { _id: '777777777777777777', tag: 'Live', lastSeen: new Date(now - 5000) }]);
  const s = setup({ models: { BotInstance } });
  const k = 'POST /api/admin/fleet/bots/:bid/forget';
  assert.equal((await call(s.routes, k, { params: { bid: W1 }, body: {} })).status, 400);
  assert.equal((await call(s.routes, k, { params: { bid: 'abc' }, body: { confirm: 'FORGET' } })).status, 400);
  assert.equal((await call(s.routes, k, { params: { bid: BOT }, body: { confirm: 'FORGET' } })).status, 400);
  assert.equal((await call(s.routes, k, { params: { bid: '777777777777777777' }, body: { confirm: 'FORGET' } })).status, 409);
  assert.equal((await call(s.routes, k, { params: { bid: W1 }, body: { confirm: 'FORGET' } })).status, 200);
  assert.deepEqual(BotInstance.calls.at(-1), ['deleteOne', { _id: W1 }]);
});

test('fleet: the jobs page and the cancel actions', async () => {
  const PlayerJob = model([{ _id: 'd'.repeat(24), status: 'pending', intent: { kind: 'move' }, targetBotId: W1, guildId: '111111111111111111', userId: OWNER, createdAt: new Date(now - 120_000) }]);
  const s = setup({ models: { PlayerJob } });
  const r = await call(s.routes, 'GET /api/admin/fleet/jobs');
  assert.equal(r.json.summary.stuck, 1);
  assert.equal(r.json.rows[0].stuck, true);
  assert.equal(r.json.rows[0].guildName, 'Guild A');
  assert.equal((await call(s.routes, 'POST /api/admin/fleet/jobs/:jid/cancel', { params: { jid: '{}' } })).status, 400);
  assert.equal((await call(s.routes, 'POST /api/admin/fleet/jobs/:jid/cancel', { params: { jid: 'd'.repeat(24) } })).status, 200);
  assert.deepEqual(PlayerJob.calls.at(-1)[1], { _id: 'd'.repeat(24), status: { $in: ['pending', 'claimed'] } });
  const all = await call(s.routes, 'POST /api/admin/fleet/jobs/cancel-stuck');
  assert.equal(all.json.cancelled, 4);
});

test('fleet: this process is always shown from live data, even when the registry has an old copy of it', async () => {
  const BotInstance = model([{ _id: BOT, tag: 'old', role: 'primary', lastSeen: new Date(now - 3_600_000), guildIds: [], sessions: [] }, { _id: W1, tag: 'W1#1', role: 'secondary', lastSeen: new Date(now - 1000), guildIds: ['1'], sessions: [] }]);
  const s = setup({ models: { BotInstance }, svcOver: { ownSessions: () => [{ guildId: '111111111111111111', channelId: '5', channelName: 'room', status: 'playing', surah: 'Al-Kahf', surahAr: 'الكهف', reciter: 'R', queueSize: 2 }] } });
  const r = await call(s.routes, 'GET /api/admin/fleet');
  const self = r.json.rows.find(x => x.self);
  assert.equal(self.alive, true);
  assert.equal(self.ping, 42);
  assert.equal(self.sessionList[0].guildName, 'Guild A');
  assert.equal(r.json.rows.filter(x => x.id === BOT).length, 1, 'no duplicate');
  assert.equal(r.json.totals.freeWorkers, 1);
});

test('phase5.js: no inline handlers or eval, every data-fn it renders is registered, every server string is escaped', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../dashboard/admin/phase5.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../dashboard/admin/index.html', import.meta.url), 'utf8');
  assert.ok(!/\son[a-z]+\s*=/.test(js.replace(/data-p5\w+/g, '')), 'no inline on* handlers');
  assert.ok(!/\beval\(|new Function|document\.write|insertAdjacentHTML/.test(js));
  const reg = js.match(/Object\.assign\(OWNER_FN, \{([^}]+)\}/)[1].split(',').map(x => x.trim()).filter(Boolean);
  const used = new Set([...js.matchAll(/p5btn\('(\w+)'/g)].map(m => m[1]));
  for (const f of used) assert.ok(reg.includes(f), `${f} is registered in OWNER_FN`);
  for (const f of [...js.matchAll(/data-p5(?:enter|change)="(\w+)"/g)].map(m => m[1])) assert.ok(reg.includes(f), `${f} (enter/change) is registered`);
  assert.ok(!/\.innerHTML\s*=\s*`[^`]*\$\{(?:x|s|r|d|u|k|c|g|t|j|a)\.(?:name|title|tag|url|username|ua|ip|guildName|channelName|surah|reciter|error|meta|action)\b/.test(js), 'no raw server text in a template');
  for (const k of ['fleet', 'stations', 'content', 'security']) {
    assert.ok(html.includes(`id="page-${k}"`) && html.includes(`id="p5-${k}-body"`) && html.includes(`data-page="${k}"`), `${k} page + nav exist`);
  }
  assert.ok(html.includes('/admin/phase5.js'));
});

test('fleet/second: coverage per server, a pinned bot-only invite link, nothing for a bot that is not set up', async () => {
  const BotInstance = model([{ _id: W1, tag: 'W1#1', role: 'secondary', lastSeen: new Date(now - 1000), guildIds: ['111111111111111111'] }]);
  let s = setup({ models: { BotInstance } });
  let r = await call(s.routes, 'GET /api/admin/fleet/second');
  assert.equal(r.status, 200);
  assert.equal(r.json.configured, true);
  assert.deepEqual([r.json.guildsTotal, r.json.covered, r.json.missing.length], [1, 1, 0]);
  assert.ok(r.json.invite.startsWith('https://discord.com/oauth2/authorize?client_id=' + W1) && !r.json.invite.includes('applications.commands') && !r.json.invite.includes('guild_id'));
  assert.ok(BotInstance.calls.some(c => c[0] === 'find' && c[1]?.role === 'secondary'), 'only voice-only bots are read');
  s = setup({ models: { BotInstance: model([{ _id: W1, tag: 'W1#1', role: 'secondary', lastSeen: new Date(now - 1000), guildIds: [] }]) } });
  r = await call(s.routes, 'GET /api/admin/fleet/second');
  assert.equal(r.json.missing.length, 1);
  assert.ok(r.json.missing[0].invite.includes('guild_id=111111111111111111') && r.json.missing[0].invite.includes('disable_guild_select=true'));
  s = setup({ models: { BotInstance: model([]) } });
  r = await call(s.routes, 'GET /api/admin/fleet/second');
  assert.deepEqual([r.json.configured, r.json.invite], [false, null]);
});
