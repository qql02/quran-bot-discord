// Owner panel phase 5 — the pure rules (fleet, jobs, /pull log, wird / event states, sessions, security checklist, hidden reciters).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pageParams, textParam, summarizeFleet, summarizeJobs, summarizePulls, normalizePullEntry, wirdState, eventStatus,
  sessionRef, parseSessionDoc, securityChecklist, exportFileName, EXPORT_SETS, visibleReciters, toggleHidden, STUCK_PENDING_MS, STUCK_CLAIMED_MS, DAY
} from '../src/utils/ownerFleet.js';

const now = 1_800_000_000_000;
const ago = (ms) => new Date(now - ms);

test('pageParams / textParam: bounded, never trust the query string', () => {
  assert.deepEqual(pageParams({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 });
  assert.deepEqual(pageParams({ page: '-1', limit: '9999' }, { def: 25, max: 50 }), { page: 1, limit: 25, skip: 0 });
  assert.deepEqual(pageParams({ page: ['1'], limit: { $gt: 1 } }), { page: 1, limit: 25, skip: 0 });
  assert.equal(textParam('  abc '), 'abc');
  assert.equal(textParam(['a']), '');
  assert.equal(textParam({ $ne: 1 }), '');
  assert.equal(textParam('x'.repeat(500), 10).length, 10);
});

test('summarizeFleet: alive / offline by heartbeat, this process first, free workers counted', () => {
  const docs = [
    { _id: '111111111111111111', tag: 'Main#1', role: 'primary', guildIds: ['1', '2'], sessions: [{ guildId: '1', channelId: '9', surahAr: 'الكهف' }], lastSeen: ago(1000) },
    { _id: '222222222222222222', tag: 'W1#1', role: 'secondary', guildIds: ['1'], sessions: [], lastSeen: ago(5000) },
    { _id: '333333333333333333', tag: 'W2#1', role: 'secondary', guildIds: ['1'], sessions: [{ guildId: '2', channelId: '8' }], lastSeen: ago(10 * 60_000) },
    { _id: '444444444444444444', role: 'weird', guildIds: 'x', sessions: 'y' }
  ];
  const f = summarizeFleet(docs, { now, selfId: '111111111111111111' });
  assert.equal(f.rows[0].id, '111111111111111111');
  assert.equal(f.rows[0].self, true);
  assert.deepEqual(f.totals, { bots: 4, alive: 2, offline: 2, workers: 1, sessions: 1, freeWorkers: 1 });
  const w2 = f.rows.find(r => r.id === '333333333333333333');
  assert.equal(w2.alive, false);
  const odd = f.rows.find(r => r.id === '444444444444444444');
  assert.deepEqual([odd.role, odd.guilds, odd.sessions, odd.alive], ['primary', 0, 0, false], 'garbage documents do not break the page');
});

test('summarizeJobs: counts, failure causes, durations, stuck jobs (pending too long, claimed and never finished)', () => {
  const jobs = [
    { _id: 'a', status: 'done', intent: { kind: 'move' }, createdAt: ago(10_000), finishedAt: ago(8_000) },
    { _id: 'b', status: 'done', intent: { kind: 'resume' }, createdAt: ago(20_000), finishedAt: ago(14_000) },
    { _id: 'c', status: 'failed', intent: { kind: 'join' }, createdAt: ago(30_000), error: { key: 'no_permission_connect' } },
    { _id: 'd', status: 'failed', intent: { kind: 'join' }, createdAt: ago(30_000), error: { code: 'E-AAAAAA' } },
    { _id: 'e', status: 'pending', intent: { kind: 'join' }, createdAt: ago(STUCK_PENDING_MS + 1000) },
    { _id: 'f', status: 'pending', intent: { kind: 'join' }, createdAt: ago(5_000) },
    { _id: 'g', status: 'claimed', intent: { kind: 'move' }, createdAt: ago(10 * 60_000), claimedAt: ago(STUCK_CLAIMED_MS + 1000) },
    { _id: 'h', status: 'claimed', intent: { kind: 'move' }, createdAt: ago(60_000), claimedAt: ago(20_000) }
  ];
  const s = summarizeJobs(jobs, now);
  assert.equal(s.total, 8);
  assert.deepEqual([s.byStatus.done, s.byStatus.failed, s.byStatus.pending, s.byStatus.claimed], [2, 2, 2, 2]);
  assert.deepEqual([s.byKind.move, s.byKind.resume, s.byKind.join], [3, 1, 4]);
  assert.deepEqual(s.errors, { no_permission_connect: 1, 'E-AAAAAA': 1 });
  assert.equal(s.failRate, 50);
  assert.equal(s.avgMs, 4000);
  assert.deepEqual(s.stuck.sort(), ['e', 'g']);
  assert.deepEqual(summarizeJobs([], now).failRate, null);
});

test('normalizePullEntry: only known fields, snowflakes, bounded; a failure keeps its key, a success has none', () => {
  const ok = normalizePullEntry({ guildId: '123456789012345678', userId: '223456789012345678', ok: true, kind: 'move', botId: '323456789012345678', ms: 1234.4, evil: '$where' }, now);
  assert.deepEqual([ok.ok, ok.kind, ok.key, ok.ms, 'evil' in ok], [true, 'move', null, 1234, false]);
  const bad = normalizePullEntry({ guildId: '123456789012345678', ok: false, key: 'pull_no_session<script>', kind: 'zzz', ms: -5 }, now);
  assert.deepEqual([bad.ok, bad.key, bad.kind, bad.ms], [false, 'pull_no_sessionscript', null, null]);
  assert.equal(normalizePullEntry({ ok: true }, now), null, 'no server, nothing to record');
  assert.equal(normalizePullEntry(null), null);
  assert.equal(normalizePullEntry({ guildId: '123456789012345678', ok: 'yes' }, now).ok, false, 'only a literal true is a success');
});

test('summarizePulls: success rate, kinds, top failures, per-day buckets', () => {
  const rows = [
    { ok: true, kind: 'move', ms: 1000, at: ago(1000) }, { ok: true, kind: 'clone', ms: 3000, at: ago(2000) },
    { ok: false, key: 'pull_no_session', at: ago(3000) }, { ok: false, key: 'pull_no_session', at: ago(4000) }, { ok: false, key: 'pull_not_allowed', at: ago(DAY) },
    { ok: true, kind: 'move', ms: 2000, at: ago(40 * DAY) }
  ];
  const s = summarizePulls(rows, now, 7);
  assert.deepEqual([s.total, s.ok, s.failed, s.rate], [6, 3, 3, 50]);
  assert.deepEqual(s.byKind, { move: 2, clone: 1 });
  assert.deepEqual(s.topFailures[0], { key: 'pull_no_session', count: 2 });
  assert.equal(s.avgMs, 2000);
  assert.equal(s.perDay.length, 7);
  assert.equal(s.perDay.reduce((n, d) => n + d.ok + d.failed, 0), 5, 'the 40-day-old row is outside the window');
  assert.deepEqual(summarizePulls([], now).rate, null);
});

test('wirdState and eventStatus', () => {
  const t = (over) => wirdState({ active: true, expiresAt: new Date(now + 20 * DAY), failCount: 0, ...over }, now);
  assert.equal(t({}), 'active');
  assert.equal(t({ expiresAt: new Date(now + 3 * DAY) }), 'expiring');
  assert.equal(t({ expiresAt: new Date(now - 1000) }), 'expired');
  assert.equal(t({ active: false }), 'paused');
  assert.equal(t({ active: false, failCount: 5 }), 'failing');
  assert.equal(wirdState(null, now), 'paused');
  const ev = (o) => eventStatus({ enabled: true, startDate: '2026-03-01', endDate: '2026-03-30', ...o }, '2026-03-15');
  assert.equal(ev({}), 'active');
  assert.equal(ev({ startDate: '2026-04-01', endDate: '2026-04-02' }), 'upcoming');
  assert.equal(ev({ endDate: '2026-03-10' }), 'finished');
  assert.equal(ev({ enabled: false }), 'disabled');
});

test('sessions: the id never leaves, expired / forged / foreign documents are dropped, the role is re-read', () => {
  const user = { id: '123456789012345678', username: 'Yousef\nX', avatar: 'https://cdn.discordapp.com/avatars/1/a.png', at: now - 1000, ip: '1.2.3.4', ua: 'UA' };
  const asString = { _id: 'SECRET-SID', session: JSON.stringify({ user }), expires: new Date(now + DAY) };
  const asObject = { _id: 'SECRET-SID-2', session: { user }, expires: new Date(now + DAY) };
  const roleOf = (id) => (id === user.id ? 'owner' : null);
  const a = parseSessionDoc(asString, { now, roleOf });
  assert.equal(a.userId, user.id);
  assert.equal(a.role, 'owner');
  assert.equal(a.username, 'Yousef?X', 'control characters cut');
  assert.equal(a.ref, sessionRef('SECRET-SID'));
  assert.ok(!JSON.stringify(a).includes('SECRET-SID'));
  assert.match(a.ref, /^[a-f0-9]{16}$/);
  assert.equal(parseSessionDoc(asObject, { now, roleOf }).userId, user.id);
  assert.equal(parseSessionDoc({ ...asString, expires: new Date(now - 1) }, { now, roleOf }), null, 'expired');
  assert.equal(parseSessionDoc({ _id: 'x', session: '{not json' }, { now, roleOf }), null);
  assert.equal(parseSessionDoc({ _id: 'x', session: JSON.stringify({ cart: [] }) }, { now, roleOf }), null, 'not a dashboard session');
  assert.equal(parseSessionDoc({ _id: 'x', session: JSON.stringify({ user: { id: 'abc' } }) }, { now, roleOf }), null, 'forged id');
  assert.equal(parseSessionDoc({ _id: 5, session: {} }, { now, roleOf }), null);
  assert.equal(parseSessionDoc({ _id: 'x', session: { user: { ...user, avatar: 'https://evil.example/a.png' } } }, { now, roleOf: () => null }).avatar, null, 'only Discord avatars are shown');
  assert.equal(parseSessionDoc(asString, { now, roleOf: () => null }).role, null, 'an id removed from ADMIN_IDS shows as dead');
});

test('securityChecklist: names the real problems and nothing else', () => {
  const good = securityChecklist({ apiBaseHttps: true, trustProxy: 1, sessionDays: 2, absoluteDays: 7, adminCount: 1, modCount: 2, secretLength: 64, modCapsOn: 3, modCapsTotal: 7 });
  assert.ok(good.every(i => i.level === 'ok'), JSON.stringify(good.filter(i => i.level !== 'ok')));
  const bad = securityChecklist({ apiBaseHttps: false, trustProxy: 1, sessionDays: 30, absoluteDays: 7, adminCount: 5, modCount: 1, secretLength: 10, modCapsOn: 7, modCapsTotal: 7 });
  const by = Object.fromEntries(bad.map(i => [i.id, i.level]));
  assert.deepEqual(by, { https: 'critical', secret: 'critical', proxy: 'warn', admins: 'warn', mods: 'warn', lifetime: 'warn' });
  assert.equal(securityChecklist({ adminCount: 0 }).find(i => i.id === 'admins').level, 'critical');
});

test('hidden reciters: filter keeps order and objects; toggle validates ids, de-duplicates and is bounded', () => {
  const list = [{ id: 1 }, { id: 'qa5' }, { id: 3 }];
  assert.deepEqual(visibleReciters(list, ['qa5']).map(r => r.id), [1, 3]);
  assert.equal(visibleReciters(list, []), list);
  assert.equal(visibleReciters(list, undefined), list);
  assert.deepEqual(toggleHidden(['1'], 'qa5', true), ['1', 'qa5']);
  assert.deepEqual(toggleHidden(['1', 'qa5'], 'qa5', true), ['1', 'qa5']);
  assert.deepEqual(toggleHidden(['1', 'qa5'], '1', false), ['qa5']);
  assert.equal(toggleHidden([], '$ne', true), null);
  assert.equal(toggleHidden([], 'x'.repeat(30), true), null);
  assert.equal(toggleHidden(Array.from({ length: 500 }, (_, i) => String(i)), '9999', true), null, 'the list is bounded');
  assert.deepEqual(toggleHidden(Array.from({ length: 500 }, (_, i) => String(i)), '3', true).length, 500, 'an id already there is not "new"');
});

test('export: only whitelisted sets, file name is plain ascii', () => {
  assert.deepEqual(Object.keys(EXPORT_SETS).sort(), ['blacklist', 'broadcasts', 'control', 'events', 'notes', 'settings', 'stations']);
  assert.ok(!('wird' in EXPORT_SETS), "members' personal progress is not exportable from the dashboard");
  assert.match(exportFileName('settings', now), /^quran-bot-settings-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(exportFileName('../../etc/passwd', now), /^quran-bot-[a-z]*-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(!exportFileName('a"b\r\nc', now).match(/["\r\n]/));
});

test('secondCoverage: which servers have a second bot, which have none (biggest first), liveness from the heartbeat', async () => {
  const { secondCoverage } = await import('../src/utils/ownerFleet.js');
  const now = Date.now();
  const bots = [{ _id: 'b1', tag: 'S#1', lastSeen: new Date(now - 5000), guildIds: ['g1', 'g2'] }, { _id: 'b2', tag: 'S#2', lastSeen: new Date(now - 600_000), guildIds: ['g3'] }];
  const guilds = [{ id: 'g1', name: 'A', members: 10 }, { id: 'g2', name: 'B', members: 5 }, { id: 'g3', name: 'C', members: 7 }, { id: 'g4', name: 'D', members: 50 }, { id: 'g5', name: 'E', members: 20 }];
  const c = secondCoverage(bots, guilds, { now });
  assert.deepEqual([c.guildsTotal, c.covered, c.coveredAlive], [5, 3, 2]);
  assert.deepEqual(c.missing.map(g => g.id), ['g4', 'g5'], 'biggest server first');
  assert.deepEqual(c.bots.map(b => [b.id, b.alive, b.guilds]), [['b1', true, 2], ['b2', false, 1]]);
  assert.ok(!('guildIds' in c.bots[0]), 'the raw guild list is not sent to the browser');
  assert.equal(secondCoverage(bots, guilds, { now, limit: 1 }).missing.length, 1);
  assert.deepEqual(secondCoverage([], guilds, { now }).covered, 0);
  assert.deepEqual(secondCoverage(null, null, { now }), { bots: [], guildsTotal: 0, covered: 0, coveredAlive: 0, missing: [] });
});
