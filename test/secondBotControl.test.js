import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecondBotControl } from '../src/services/secondBotControl.js';

function rig({ configured = true, running = true } = {}) {
  const log = [];
  let st = { configured, id: '222222222222222222', running, paused: false, pid: 4242, startedAt: Date.now() - 5000, failures: 0 };
  const handle = {
    status: () => st,
    pause: async () => { log.push('pause'); st = { ...st, running: false, paused: true, pid: null, startedAt: 0 }; return true; },
    resume: () => { log.push('resume'); st = { ...st, running: true, paused: false, pid: 5151, startedAt: Date.now() }; return true; }
  };
  const c = createSecondBotControl({
    getHandle: () => handle, readPaused: async () => false,
    writePaused: async (v) => log.push(`save:${v}`), cleanup: async (id) => log.push(`cleanup:${id}`), readRamMb: async () => 96
  });
  return { c, log };
}

test('stop: the OFF choice is saved first, the process ended, then the registry and pending commands cleaned', async () => {
  const { c, log } = rig();
  const r = await c.stop('owner');
  assert.deepEqual(log, ['save:true', 'pause', 'cleanup:222222222222222222']);
  assert.equal(r.ok, true); assert.equal(r.running, false); assert.equal(r.paused, true);
});

test('start: the ON choice is saved and the process comes back', async () => {
  const { c, log } = rig({ running: false });
  const r = await c.start('owner');
  assert.deepEqual(log, ['save:false', 'resume']);
  assert.equal(r.ok, true); assert.equal(r.running, true);
});

test('a second bot that this project does not start cannot be switched, and nothing is saved', async () => {
  const { c, log } = rig({ configured: false });
  assert.deepEqual(await c.stop(), { ok: false, error: 'not_managed' });
  assert.deepEqual(await c.start(), { ok: false, error: 'not_managed' });
  assert.deepEqual(log, []);
  assert.equal((await c.status()).managed, false);
});

test('status shows its memory only while it runs', async () => {
  const { c } = rig();
  assert.equal((await c.status()).ramMb, 96);
  await c.stop();
  assert.equal((await c.status()).ramMb, undefined);
});

test('a failing database does not stop the switch from working', async () => {
  const log = [];
  let st = { configured: true, id: '1', running: true, paused: false };
  const h = { status: () => st, pause: async () => { st = { ...st, running: false, paused: true }; log.push('pause'); }, resume: () => true };
  const c = createSecondBotControl({ getHandle: () => h, readPaused: async () => false, writePaused: async () => { throw new Error('db down'); }, cleanup: async () => { throw new Error('db down'); } });
  const r = await c.stop();
  assert.equal(r.ok, true); assert.deepEqual(log, ['pause']);
});
