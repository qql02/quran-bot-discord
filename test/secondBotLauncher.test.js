import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { planSecondBot, restartDelayMs, startSecondBot } from '../src/services/secondBotLauncher.js';

const tok = (id) => `${Buffer.from(id).toString('base64').replace(/=+$/, '')}.AbCdEf.${'x'.repeat(30)}`;
const MAIN = '1511340095934824589', SECOND = '1522222222222222222';
const base = { DISCORD_TOKEN: tok(MAIN), CLIENT_ID: MAIN, MONGODB_URI: 'mongodb://a', ADMIN_IDS: '1', SECOND_BOT_TOKEN: tok(SECOND), ALT_BOT_ID: '' };

test('empty token: disabled, no problem', () => assert.deepEqual(planSecondBot({ ...base, SECOND_BOT_TOKEN: '' }, MAIN), { enabled: false }));
test('garbage token: problem', () => assert.ok(planSecondBot({ ...base, SECOND_BOT_TOKEN: 'abc' }, MAIN).problem));
test('same bot as main: problem', () => assert.ok(planSecondBot({ ...base, SECOND_BOT_TOKEN: tok(MAIN) }, MAIN).problem));
test('valid: child env is secondary, own token, no main identity', () => {
  const p = planSecondBot(base, MAIN);
  assert.equal(p.enabled, true); assert.equal(p.id, SECOND);
  assert.equal(p.childEnv.BOT_ROLE, 'secondary'); assert.equal(p.childEnv.DISCORD_TOKEN, tok(SECOND));
  for (const k of ['SECOND_BOT_TOKEN', 'CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'ALT_BOT_ID']) assert.ok(!(k in p.childEnv), k);
  assert.equal(p.childEnv.MONGODB_URI, 'mongodb://a');
});
test('backoff grows then caps at 60s', () => assert.deepEqual([1, 2, 3, 4, 5, 9].map(restartDelayMs), [5000, 10000, 20000, 40000, 60000, 60000]));

function harness() {
  const logs = [], children = [], timers = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(l => [l, (...a) => logs.push([l, a.join(' ')])]));
  let t = 0;
  const spawnFn = () => { const c = new EventEmitter(); c.kill = () => {}; children.push(c); return c; };
  const setTimer = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
  const h = startSecondBot({ logger, env: base, primaryId: MAIN, spawnFn, setTimer, now: () => t });
  return { logs, children, timers, h, advance: (ms) => { t += ms; } };
}
test('crash → restarts after backoff; stop() prevents restart', () => {
  const x = harness();
  assert.equal(x.children.length, 1);
  x.children[0].emit('exit', 1, null);
  assert.equal(x.timers[0].ms, 5000); x.timers[0].fn();
  assert.equal(x.children.length, 2);
  x.h.stop(); x.children[1].emit('exit', 0, null);
  assert.equal(x.timers.length, 1);
});
test('keeps crashing → gives up with a clear error', () => {
  const x = harness();
  for (let i = 0; i < 12; i++) { const c = x.children.at(-1); c.emit('exit', 1, null); if (x.timers.at(-1) && x.children.length === i + 1) x.timers.at(-1).fn(); }
  assert.ok(x.logs.some(([l, m]) => l === 'error' && /giving up/.test(m)));
  x.h.stop();
});
test('not configured → one info line, nothing spawned', () => {
  const logs = []; const r = startSecondBot({ logger: { info: (m) => logs.push(m), error: (m) => logs.push(m) }, env: { ...base, SECOND_BOT_TOKEN: '' }, primaryId: MAIN, spawnFn: () => { throw new Error('no'); } });
  assert.equal(r.plan.enabled, false); assert.match(logs[0], /not configured/);
});

import { watchParent } from '../src/utils/parentWatch.js';
test('watchParent: fires once when the parent disappears, not while it exists', async () => {
  let alive = true, gone = 0;
  const kill = () => { if (!alive) { const e = new Error('x'); e.code = 'ESRCH'; throw e; } };
  const t = watchParent(4242, () => { gone++; }, { intervalMs: 10, kill });
  await new Promise(r => setTimeout(r, 40)); assert.equal(gone, 0);
  alive = false; await new Promise(r => setTimeout(r, 50)); assert.equal(gone, 1);
  clearInterval(t);
});
test('watchParent: no parent configured → does nothing', () => assert.equal(watchParent(undefined, () => {}), null));
test('child env carries the parent pid', () => assert.equal(planSecondBot(base, MAIN).childEnv.SECOND_BOT_PARENT_PID, String(process.pid)));

// ── owner ON / OFF switch ──
test('pause(): the process is told to end, it is NOT restarted, and resume() starts a fresh one', async () => {
  const x = harness();
  const kills = []; x.children[0].kill = (sig) => kills.push(sig);
  const p = x.h.pause();
  assert.deepEqual(kills, ['SIGTERM']);
  assert.equal(x.h.status().paused, true);
  x.children[0].emit('exit', 0, 'SIGTERM');
  assert.equal(await p, true);
  assert.equal(x.children.length, 1); assert.equal(x.timers.filter(t => t.ms === 5000).length, 0);   // no crash-restart
  assert.equal(x.h.status().running, false);
  assert.equal(x.h.resume(), true);
  assert.equal(x.children.length, 2); assert.equal(x.h.status().running, true); assert.equal(x.h.status().paused, false);
  x.h.stop();
});
test('pause(): a child that ignores SIGTERM is killed after the grace period', async () => {
  const x = harness();
  const kills = []; x.children[0].kill = (sig) => kills.push(sig);
  const p = x.h.pause();
  const killer = x.timers.at(-1); assert.ok(killer.ms > 0);
  killer.fn();                                           // grace period over
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
  x.children[0].emit('exit', null, 'SIGKILL'); await p; x.h.stop();
});
test('pause() while waiting for a crash-restart cancels that restart', async () => {
  const x = harness();
  x.children[0].emit('exit', 1, null);                   // crashed: a restart is scheduled
  assert.equal(await x.h.pause(), true);
  assert.equal(x.children.length, 1);
  x.h.stop();
});
test('startPaused: nothing is spawned until resume()', () => {
  const children = [];
  const spawnFn = () => { const c = new EventEmitter(); c.kill = () => {}; children.push(c); return c; };
  const h = startSecondBot({ logger: { info() {}, warn() {}, error() {} }, env: base, primaryId: MAIN, spawnFn, startPaused: true });
  assert.equal(children.length, 0); assert.equal(h.status().paused, true);
  h.resume(); assert.equal(children.length, 1); h.stop();
});
test('resume() after the final stop() does nothing', () => {
  const x = harness(); x.h.stop();
  assert.equal(x.h.resume(), false);
});
