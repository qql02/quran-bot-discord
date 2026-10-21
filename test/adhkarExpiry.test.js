import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryHoursOf, nextExpiryChoice, expiryLabel, buildExpiry, isPermanentDeleteError, EXPIRY_CHOICES } from '../src/utils/adhkarExpiry.js';
const { runExpirySweep } = await import('../src/services/adhkarService.js');

test('a server that never chose (old document) gets 2 hours; an explicit 0 means "keep"', () => {
  assert.equal(expiryHoursOf({}), 2);
  assert.equal(expiryHoursOf(undefined), 2);
  assert.equal(expiryHoursOf({ deleteAfterHours: 0 }), 0);
  assert.equal(expiryHoursOf({ deleteAfterHours: 6 }), 6);
  assert.equal(expiryHoursOf({ deleteAfterHours: 99 }), 2);       // garbage → default
});

test('the panel button cycles through every choice and comes back', () => {
  let v = 2; const seen = [];
  for (let i = 0; i < EXPIRY_CHOICES.length; i++) { v = nextExpiryChoice(v); seen.push(v); }
  assert.deepEqual([...seen].sort((a, b) => a - b), [...EXPIRY_CHOICES].sort((a, b) => a - b));
  assert.equal(v, 2);
  assert.equal(nextExpiryChoice(7), 2);                            // an unknown value restarts the cycle at the default
});

test('labels in Arabic', () => {
  assert.equal(expiryLabel(0), 'متوقف'); assert.equal(expiryLabel(2), 'بعد ساعتين'); assert.equal(expiryLabel(3), 'بعد 3 ساعات'); assert.equal(expiryLabel(12), 'بعد 12 ساعة');
});

test('buildExpiry: two hours after sending; nothing when off or when no ids', () => {
  const now = Date.UTC(2026, 9, 19, 6, 0, 0);
  const e = buildExpiry({}, 'c1', ['m1', 'm2'], now);
  assert.equal(e.deleteAt.getTime(), now + 2 * 3_600_000);
  assert.deepEqual(e.ids, ['m1', 'm2']); assert.equal(e.channelId, 'c1'); assert.equal(e.tries, 0);
  assert.equal(buildExpiry({ deleteAfterHours: 0 }, 'c1', ['m1'], now), null);
  assert.equal(buildExpiry({}, 'c1', [], now), null);
  assert.equal(buildExpiry({}, null, ['m1'], now), null);
});

test('permanent Discord errors', () => {
  for (const code of [10003, 10008, 50001, 50013]) assert.equal(isPermanentDeleteError({ code }), true);
  assert.equal(isPermanentDeleteError({ code: 500 }), false); assert.equal(isPermanentDeleteError(new Error('network')), false);
});

// ── the sweep, with an in-memory stand-in for the database and Discord ──
function rig(entries, { deleteImpl } = {}) {
  const docs = [{ guildId: 'g1', adhkar: { pendingDelete: entries } }];
  const calls = [];
  const model = {
    find: () => ({ lean: async () => docs.filter(d => d.adhkar.pendingDelete.some(e => new Date(e.deleteAt) <= new Date(rig.now))) }),
    updateOne: async (filter, update) => {
      calls.push(update);
      const d = docs.find(x => x.guildId === filter.guildId);
      if (update.$pull) d.adhkar.pendingDelete = d.adhkar.pendingDelete.filter(e => e._id !== update.$pull['adhkar.pendingDelete']._id);
      if (update.$inc) d.adhkar.pendingDelete.find(e => e._id === filter['adhkar.pendingDelete._id']).tries += 1;
    }
  };
  const deleted = [];
  const channel = { messages: { delete: async (id) => { if (deleteImpl) await deleteImpl(id); deleted.push(id); } } };
  const client = { channels: { cache: new Map([['c1', channel]]), fetch: async () => channel } };
  return { docs, model, client, deleted, calls };
}
rig.now = 0;

test('sweep: deletes what is due, leaves what is not, and removes the finished entry', async () => {
  const now = Date.now(); rig.now = now;
  const x = rig([
    { _id: 'a', channelId: 'c1', ids: ['m1', 'm2'], deleteAt: new Date(now - 1000), tries: 0 },
    { _id: 'b', channelId: 'c1', ids: ['m3'], deleteAt: new Date(now + 3_600_000), tries: 0 }
  ]);
  const r = await runExpirySweep(x.client, { now, model: x.model });
  assert.deepEqual(x.deleted, ['m1', 'm2']);
  assert.equal(r.deleted, 1);
  assert.deepEqual(x.docs[0].adhkar.pendingDelete.map(e => e._id), ['b']);
});

test('sweep: a message that is already gone counts as done', async () => {
  const now = Date.now(); rig.now = now;
  const x = rig([{ _id: 'a', channelId: 'c1', ids: ['m1'], deleteAt: new Date(now - 1), tries: 0 }], { deleteImpl: async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); } });
  const r = await runExpirySweep(x.client, { now, model: x.model });
  assert.equal(r.deleted, 1); assert.equal(x.docs[0].adhkar.pendingDelete.length, 0);
});

test('sweep: a temporary failure is retried on the next sweep, and dropped after the last try', async () => {
  const now = Date.now(); rig.now = now;
  const x = rig([{ _id: 'a', channelId: 'c1', ids: ['m1'], deleteAt: new Date(now - 1), tries: 0 }], { deleteImpl: async () => { throw new Error('network'); } });
  let r = await runExpirySweep(x.client, { now, model: x.model });
  assert.equal(r.retried, 1); assert.equal(x.docs[0].adhkar.pendingDelete[0].tries, 1);
  for (let i = 0; i < 5; i++) r = await runExpirySweep(x.client, { now, model: x.model });
  assert.equal(x.docs[0].adhkar.pendingDelete.length, 0);          // gave up, not stuck forever
});

test('sweep: a post that is overdue by days (the bot was offline) is deleted at the next sweep', async () => {
  const now = Date.now(); rig.now = now;
  const x = rig([{ _id: 'a', channelId: 'c1', ids: ['m1'], deleteAt: new Date(now - 3 * 86_400_000), tries: 0 }]);
  await runExpirySweep(x.client, { now, model: x.model });
  assert.deepEqual(x.deleted, ['m1']);
});

test('sweep never throws, even when the database does', async () => {
  const r = await runExpirySweep({}, { model: { find: () => { throw new Error('db down'); } } });
  assert.deepEqual(r, { deleted: 0, retried: 0, dropped: 0 });
});
