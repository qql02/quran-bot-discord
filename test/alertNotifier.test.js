import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAlertNotifications, ALERT_CONFIRM_TICKS, ALERT_RENOTIFY_MS } from '../src/utils/ownerInsights.js';
import { createAlertNotifier, buildAlertMessage } from '../src/services/alertNotifier.js';

const crit = (id, title = id) => ({ id, level: 'critical', title, detail: `${id} detail`, page: 'system' });
const warn = id => ({ id, level: 'warn', title: id, detail: '', page: 'system' });

test('plan: a critical alert fires only after it is confirmed on consecutive checks', () => {
  const st = new Map();
  assert.equal(ALERT_CONFIRM_TICKS, 2);
  assert.deepEqual(planAlertNotifications([crit('mongo-down')], st, 0).fire, []);
  assert.deepEqual(planAlertNotifications([crit('mongo-down')], st, 60_000).fire.map(a => a.id), ['mongo-down']);
});

test('plan: a blip that clears before confirmation is silent — no fire, no "recovered"', () => {
  const st = new Map();
  planAlertNotifications([crit('loop-lag-high')], st, 0);
  const r = planAlertNotifications([], st, 60_000);
  assert.deepEqual(r, { fire: [], resolved: [] });
  assert.equal(st.size, 0);
});

test('plan: warnings, info and excluded per-server alerts never notify', () => {
  const st = new Map();
  for (let i = 0; i < 4; i++) {
    const r = planAlertNotifications([warn('errors'), { id: 'x', level: 'info', title: 'x' }, crit('guild-critical')], st, i * 60_000);
    assert.deepEqual(r, { fire: [], resolved: [] });
  }
});

test('plan: no repeat while it stays critical, one reminder after the renotify window, "recovered" once when it clears', () => {
  const st = new Map(); let t = 0;
  const step = (alerts, dt = 60_000) => planAlertNotifications(alerts, st, (t += dt));
  step([crit('heap-high')]);
  assert.equal(step([crit('heap-high')]).fire.length, 1);
  for (let i = 0; i < 10; i++) assert.equal(step([crit('heap-high')]).fire.length, 0);
  assert.equal(step([crit('heap-high')], ALERT_RENOTIFY_MS).fire.length, 1);
  const done = step([]);
  assert.deepEqual(done.resolved.map(r => r.id), ['heap-high']);
  assert.deepEqual(step([]), { fire: [], resolved: [] });
});

test('plan: two alerts are tracked independently', () => {
  const st = new Map();
  planAlertNotifications([crit('a')], st, 0);
  const r = planAlertNotifications([crit('a'), crit('b')], st, 60_000);
  assert.deepEqual(r.fire.map(x => x.id), ['a']);
  assert.deepEqual(planAlertNotifications([crit('a'), crit('b')], st, 120_000).fire.map(x => x.id), ['b']);
});

test('message: lists the alerts, the recoveries and the dashboard link; stays under the embed limit', () => {
  const m = buildAlertMessage({ fire: [crit('a', 'قاعدة البيانات غير متصلة')], resolved: [{ id: 'b', title: 'الذاكرة' }], dashboardUrl: 'https://x.test/admin' }).embeds[0];
  assert.match(m.description, /قاعدة البيانات غير متصلة/);
  assert.match(m.description, /عاد للعمل: \*\*الذاكرة\*\*/);
  assert.match(m.description, /https:\/\/x\.test\/admin/);
  const big = buildAlertMessage({ fire: Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, title: 'T'.repeat(200), detail: 'D'.repeat(300) })) }).embeds[0];
  assert.ok(big.description.length <= 4000);
  assert.equal(buildAlertMessage({ resolved: [{ id: 'b', title: 'x' }] }).embeds[0].title, '✅ تعافى البوت');
});

function fakeClient(failFor = []) {
  const sent = [];
  return { sent, users: { fetch: async id => ({ send: async p => { if (failFor.includes(id)) throw new Error('DMs closed'); sent.push({ id, p }); } }) } };
}

test('notifier: grace period, confirmation, one DM per owner, a failing owner does not block the others', async () => {
  let t = 1_000_000; const client = fakeClient(['111']);
  let alerts = [crit('ws-down')];
  const n = createAlertNotifier({ client, ownerIds: ['111', '222'], getAlerts: async () => alerts, now: () => t, graceMs: 90_000, dashboardUrl: 'https://x.test/admin' });
  assert.equal((await n.tick()).fire, 0);                                  // inside the grace period
  t += 120_000; assert.equal((await n.tick()).fire, 0);                    // 1st confirmed sighting
  t += 60_000;  const r = await n.tick();                                  // 2nd → fire
  assert.deepEqual(r, { fire: 1, resolved: 0, sentTo: 1 });
  assert.deepEqual(client.sent.map(s => s.id), ['222']);
  t += 60_000;  assert.equal((await n.tick()).fire, 0);                    // no repeat
  alerts = [];  t += 60_000;
  assert.equal((await n.tick()).resolved, 1);                              // recovery message
  assert.equal(client.sent.length, 2);
});

test('notifier: never throws — a failing check is swallowed; no owners → does nothing', async () => {
  const n1 = createAlertNotifier({ client: fakeClient(), ownerIds: ['1'], getAlerts: async () => { throw new Error('boom'); }, graceMs: 0 });
  assert.deepEqual(await n1.tick(), { fire: 0, resolved: 0, sentTo: 0 });
  let called = false;
  const n2 = createAlertNotifier({ client: fakeClient(), ownerIds: [], getAlerts: async () => { called = true; return []; }, graceMs: 0 });
  await n2.tick(); assert.equal(called, false);
});
