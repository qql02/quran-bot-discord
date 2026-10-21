import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAlerts, auditGuildHealth, summarizeHealth, normalizeTags, validateSchedule, scheduleDecision,
  escapeRegex, qs, MISSED_AFTER_MS, MIN_LEAD_MS, MAX_LEAD_MS
} from '../src/utils/ownerInsights.js';

const healthyGuild = () => ({
  id: '1', name: 'g', hasMe: true, announceChannel: true,
  adhkar: { enabled: true, channelId: 'c', channel: 'ok' }, ayah: { enabled: false, channelId: null, channel: 'none' },
  voiceTotal: 2, voiceJoinable: 2, locked: false
});

test('alerts: a healthy snapshot (or an empty one) raises nothing', () => {
  assert.deepEqual(evaluateAlerts({}), []);
  assert.deepEqual(evaluateAlerts({
    mongo: { state: 'connected', pingMs: 8 }, ws: { status: 0, ping: 60 }, lagMs: 5, heapRatio: 0.3, hostMemRatio: 0.5, cpuPct: 4,
    errorsLastHour: 0, uptimeSec: 9000, maintenance: false, health: { critical: 0, warn: 0, total: 40 }, scheduled: { overdue: 0, failed7d: 0, pending: 0 }
  }), []);
});

test('alerts: severity thresholds and ordering (critical first)', () => {
  const a = evaluateAlerts({
    mongo: { state: 'connected', pingMs: 700 },                 // warn
    ws: { status: 0, ping: 1200 },                               // critical
    lagMs: 150,                                                  // warn
    errorsLastHour: 12,                                          // warn
    maintenance: true,                                           // info
    health: { critical: 3, warn: 0, total: 10 }                  // critical
  });
  const levels = a.map(x => x.level);
  assert.deepEqual(levels, [...levels].sort((x, y) => ['critical', 'warn', 'info'].indexOf(x) - ['critical', 'warn', 'info'].indexOf(y)));
  const ids = a.map(x => x.id);
  for (const id of ['ws-ping-high', 'guild-critical', 'mongo-slow', 'loop-lag', 'errors', 'maintenance']) assert.ok(ids.includes(id), id);
  assert.equal(a.find(x => x.id === 'errors-many'), undefined);
});

test('alerts: database down, Discord not ready, and very many errors are critical; every alert links to a real page', () => {
  const a = evaluateAlerts({ mongo: { state: 'disconnected', pingMs: null }, ws: { status: 5 }, errorsLastHour: 80, heapRatio: 0.95, lagMs: 400 });
  for (const id of ['mongo-down', 'ws-down', 'errors-many', 'heap-high', 'loop-lag-high']) assert.equal(a.find(x => x.id === id)?.level, 'critical', id);
  assert.equal(a.find(x => x.id === 'mongo-silent'), undefined, 'a disconnected database is one alert, not two');
  const pages = new Set(['system', 'logs', 'health', 'broadcast', 'control']);
  for (const x of a) assert.ok(pages.has(x.page), `${x.id} → ${x.page}`);
  assert.equal(evaluateAlerts({ mongo: { state: 'connected', pingMs: null } })[0].id, 'mongo-silent');
});

test('alerts: scheduled-announcement problems and a fresh restart', () => {
  const a = evaluateAlerts({ scheduled: { overdue: 1, failed7d: 2, pending: 3 }, uptimeSec: 60 });
  assert.deepEqual(a.map(x => x.id).sort(), ['fresh-restart', 'sched-failed', 'sched-overdue', 'sched-pending']);
  assert.equal(a.find(x => x.id === 'sched-pending').level, 'info');
});

test('health: a fully working server is ok', () => {
  assert.deepEqual(auditGuildHealth(healthyGuild()), { level: 'ok', issues: [] });
});

test('health: lost / unwritable adhkar or verse channel is critical, but only when that feature is switched on', () => {
  const lost = auditGuildHealth({ ...healthyGuild(), adhkar: { enabled: true, channelId: 'x', channel: 'missing' } });
  assert.equal(lost.level, 'critical');
  assert.equal(lost.issues[0].code, 'adhkar_channel_lost');
  const noperm = auditGuildHealth({ ...healthyGuild(), ayah: { enabled: true, channelId: 'x', channel: 'noperm' } });
  assert.equal(noperm.issues[0].code, 'ayah_no_permission');
  const off = auditGuildHealth({ ...healthyGuild(), adhkar: { enabled: false, channelId: 'x', channel: 'missing' } });
  assert.equal(off.level, 'ok', 'a switched-off feature with a stale channel is not a problem');
});

test('health: warnings (no writable channel, no usable voice channel, locked) and the bot missing as a member', () => {
  const w = auditGuildHealth({ ...healthyGuild(), announceChannel: false, voiceJoinable: 0, locked: true });
  assert.equal(w.level, 'warn');
  assert.deepEqual(w.issues.map(i => i.code).sort(), ['locked', 'no_announce_channel', 'no_voice_access']);
  assert.equal(auditGuildHealth({ ...healthyGuild(), voiceTotal: 0, voiceJoinable: 0 }).issues[0].code, 'no_voice_channels');
  assert.equal(auditGuildHealth({ ...healthyGuild(), hasMe: false }).level, 'critical');
});

test('health: summary counts every level', () => {
  assert.deepEqual(summarizeHealth([{ level: 'ok' }, { level: 'warn' }, { level: 'critical' }, { level: 'critical' }]), { total: 4, critical: 2, warn: 1, ok: 1 });
  assert.deepEqual(summarizeHealth([]), { total: 0, critical: 0, warn: 0, ok: 0 });
});

test('tags: trimmed, de-duplicated (case-insensitive), # stripped, capped in length and count; junk ignored', () => {
  assert.deepEqual(normalizeTags(['  VIP ', 'vip', '#شريك', '', '   ', 42, null, { a: 1 }]), ['VIP', 'شريك']);
  assert.deepEqual(normalizeTags('a, b،c\nd,A'), ['a', 'b', 'c', 'd']);
  assert.equal(normalizeTags(['x'.repeat(50)])[0].length, 20);
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 8);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags({ $ne: 1 }), [], 'an object is not a tag list');
});

test('schedule: must be 1 minute to 90 days ahead and a real date', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0);
  assert.equal(validateSchedule(now + MIN_LEAD_MS + 1000, now).ok, true);
  assert.equal(validateSchedule(new Date(now + 3_600_000).toISOString(), now).ok, true);
  for (const bad of [now, now + MIN_LEAD_MS - 1, now + MAX_LEAD_MS + 1, 'not a date', '', undefined, null, {}, [], true]) {
    assert.equal(validateSchedule(bad, now).ok, false, String(JSON.stringify(bad)));
  }
  assert.match(validateSchedule('x', now).error, /\S/);
});

test('schedule: waits before the time, runs within 30 minutes after it, and never sends a stale announcement', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0);
  assert.equal(scheduleDecision(now + 1000, now), 'wait');
  assert.equal(scheduleDecision(now, now), 'run');
  assert.equal(scheduleDecision(now - MISSED_AFTER_MS, now), 'run');
  assert.equal(scheduleDecision(now - MISSED_AFTER_MS - 1, now), 'missed');
  assert.equal(scheduleDecision('garbage', now), 'missed');
});

test('regex / query helpers: user text can never become a regex, arrays and objects become empty', () => {
  const rx = new RegExp(escapeRegex('a.b(c)*[d]|^$\\'));
  assert.ok(rx.test('xx a.b(c)*[d]|^$\\ yy'));
  assert.ok(!rx.test('aXb(c)*[d]|^$\\'));
  assert.equal(qs('  hi  '), 'hi');
  assert.equal(qs(['a', 'b']), '');
  assert.equal(qs({ $gt: '' }), '');
  assert.equal(qs('x'.repeat(500), 10).length, 10);
});
