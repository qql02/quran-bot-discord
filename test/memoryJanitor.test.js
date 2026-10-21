import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJanitor } from '../src/services/memoryJanitor.js';

const base = (over = {}) => ({
  getSessions: () => [], destroySession: async () => {}, pruners: [], ffmpegCount: () => 0, killStray: () => 0,
  rssMb: () => 100, pressureMb: 450, shedders: [], gc: undefined, ...over
});

test('janitor runs every pruner and adds up what they dropped; a failing pruner does not stop the others', async () => {
  const tick = createJanitor(base({ pruners: [() => 2, () => { throw new Error('x'); }, () => 3] }));
  assert.equal((await tick()).pruned, 5);
});

test('a zombie session (player already destroyed) is ended, a healthy one is left alone', async () => {
  const ended = [];
  const tick = createJanitor(base({
    getSessions: () => [{ guildId: 'z', player: { _destroyed: true } }, { guildId: 'ok', player: { _destroyed: false } }],
    destroySession: async (id) => { ended.push(id); }
  }));
  const r = await tick();
  assert.deepEqual(ended, ['z']);
  assert.equal(r.zombies, 1);
});

test('stray ffmpeg is killed only after two ticks in a row with no session at all', async () => {
  let killed = 0; const count = 1;
  const tick = createJanitor(base({ ffmpegCount: () => count, killStray: () => { killed += count; return count; } }));
  assert.equal((await tick()).ffmpegKilled, 0);                 // first strike: maybe a session is just being torn down
  assert.equal((await tick()).ffmpegKilled, 1);                 // second strike: it is stray
  assert.equal(killed, 1);
  const busy = createJanitor(base({ getSessions: () => [{ guildId: 'g', player: {} }], ffmpegCount: () => 1, killStray: () => { throw new Error('must not kill'); } }));
  await busy(); await busy(); await busy();                     // a live session owns its ffmpeg
});

test('memory pressure empties the page caches and runs GC; normal memory does not', async () => {
  let shed = 0, gcs = 0, rss = 600;
  const tick = createJanitor(base({ rssMb: () => rss, shedders: [() => { shed++; }], gc: () => { gcs++; } }));
  assert.equal((await tick()).pressure, true);
  assert.deepEqual([shed, gcs], [1, 1]);
  rss = 200;
  assert.equal((await tick()).pressure, false);
  assert.deepEqual([shed, gcs], [1, 1]);
});

test('the janitor never throws, whatever its inputs do', async () => {
  const tick = createJanitor(base({ getSessions: () => { throw new Error('boom'); } }));
  await assert.doesNotReject(tick());
});

test('under pressure the discord.js sweepers run too; critical memory also runs the critical shedders', async () => {
  let swept = 0, crit = 0, rss = 500;
  const tick = createJanitor(base({ rssMb: () => rss, sweepers: [() => { swept++; }], criticalShedders: [() => { crit++; }], criticalMb: 600, gc: () => {} }));
  const r1 = await tick();
  assert.deepEqual([r1.pressure, r1.critical, swept, crit], [true, false, 1, 0]);
  rss = 700;
  const r2 = await tick();
  assert.deepEqual([r2.critical, swept, crit], [true, 2, 1]);
});

test('a collection that frees nothing is backed off, shedding still runs; recovery resets the wait', async () => {
  let t = 0, gcs = 0, shed = 0, rss = 600;
  const tick = createJanitor(base({ rssMb: () => rss, now: () => t, shedders: [() => { shed++; }], gc: () => { gcs++; } }));
  await tick();                                  // gc #1, frees nothing → wait doubles to 40 s
  t = 30_000; await tick();                      // only 30 s later: no GC, but caches are still shed
  assert.deepEqual([gcs, shed], [1, 2]);
  t = 61_000; await tick();                      // past the 40 s gap: GC again
  assert.equal(gcs, 2);
  rss = 100; await tick();                       // back to normal → wait reset
  rss = 600; t = 200_000; await tick();
  assert.equal(gcs, 3);
});

test('a collection that really frees memory keeps the short wait', async () => {
  let t = 0, gcs = 0, rss = 600;
  const tick = createJanitor(base({ rssMb: () => rss, now: () => t, gc: () => { gcs++; rss = 300; } }));
  await tick(); rss = 600; t = 21_000; await tick();
  assert.equal(gcs, 2);
});

test('soft level: above the soft line only the discord.js sweepers run (no GC, no shedders)', async () => {
  let swept = 0, shed = 0, gcs = 0;
  const tick = createJanitor(base({ rssMb: () => 350, softMb: 300, pressureMb: 450, sweepers: [() => { swept++; }], shedders: [() => { shed++; }], gc: () => { gcs++; } }));
  const r = await tick();
  assert.equal(swept, 1); assert.equal(shed, 0); assert.equal(gcs, 0); assert.equal(r.pressure, false);
});

test('continuous mode: sweeps every tick and collects on a schedule even when RSS is tiny; idle drops page caches', async () => {
  let swept = 0, shed = 0, gcs = 0, clock = 0;
  const tick = createJanitor(base({ continuous: true, gcEveryMs: 60_000, now: () => clock, rssMb: () => 80 - gcs * 5, pressureMb: 450,
    getSessions: () => [], sweepers: [() => { swept++; }], shedders: [() => { shed++; }], gc: () => { gcs++; } }));
  await tick(); clock += 30_000; await tick(); clock += 30_000; await tick();
  assert.equal(swept, 3); assert.equal(shed, 3); assert.equal(gcs, 2);   // t=0 and t=60s
});

test('continuous mode: page caches are kept while someone is listening', async () => {
  let shed = 0;
  const tick = createJanitor(base({ continuous: true, gcEveryMs: 60_000, rssMb: () => 80, getSessions: () => [{ guildId: '1', player: {} }], shedders: [() => { shed++; }] }));
  await tick();
  assert.equal(shed, 0);
});

test('continuous mode: a collection that frees nothing doubles the wait (max 4x) so audio is not stuttered for nothing', async () => {
  let gcs = 0, clock = 0;
  const tick = createJanitor(base({ continuous: true, gcEveryMs: 60_000, now: () => clock, rssMb: () => 80, gc: () => { gcs++; } }));
  for (let i = 0; i < 12; i++) { await tick(); clock += 30_000; }   // 6 minutes
  assert.ok(gcs >= 2 && gcs <= 4, `gcs=${gcs}`);
});
