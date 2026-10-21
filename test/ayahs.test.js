import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AYAH_REFS, ayahRefForDate, parseRef, ayahDueDate } from '../src/data/ayahs.js';
import { localClock } from '../src/utils/adhkarSchedule.js';
import { SURAHS } from '../src/data/surahs.js';

test('every verse reference is well-formed, unique and exists in its surah', () => {
  const seen = new Set();
  for (const ref of AYAH_REFS) {
    const p = parseRef(ref);
    assert.ok(p, `bad ref ${ref}`);
    assert.ok(!seen.has(ref), `duplicate ${ref}`);
    seen.add(ref);
    const surah = SURAHS.find(s => s.number === p.surah);
    assert.ok(p.ayah <= surah.ayahs, `${ref}: ${surah.arabic} has only ${surah.ayahs} ayahs`);
  }
  assert.ok(AYAH_REFS.length >= 60);
});

test('parseRef rejects junk', () => {
  for (const bad of ['', '2', '2:', '0:1', '115:1', '2:0', 'a:b', '2:255:1', null]) assert.equal(parseRef(bad), null, String(bad));
  assert.deepEqual(parseRef('2:255'), { surah: 2, ayah: 255 });
});

test('the verse is a pure function of the date: stable, changes daily, cycles through the whole list', () => {
  assert.equal(ayahRefForDate('2026-10-05'), ayahRefForDate('2026-10-05'));
  assert.notEqual(ayahRefForDate('2026-10-05'), ayahRefForDate('2026-10-06'));
  const days = new Set();
  let d = '2026-01-01';
  for (let i = 0; i < AYAH_REFS.length; i++) {
    days.add(ayahRefForDate(d));
    d = new Date(Date.UTC(2026, 0, 1 + i + 1)).toISOString().slice(0, 10);
  }
  assert.equal(days.size, AYAH_REFS.length);
  assert.ok(AYAH_REFS.includes(ayahRefForDate('1969-12-31')));   // dates before 1970 still map into the list
});

test('ayahDueDate: window after the time, once per day, midnight spill-over', () => {
  const clockIn = (tz) => (now) => localClock(tz, now);
  const cfg = { time: '08:00', lastDate: null };
  const algiers = clockIn('Africa/Algiers');                       // UTC+1
  assert.equal(ayahDueDate(cfg, algiers, new Date('2026-10-05T07:30:00Z')), '2026-10-05');   // 08:30 local
  assert.equal(ayahDueDate(cfg, algiers, new Date('2026-10-05T06:30:00Z')), null);           // 07:30 local — too early
  assert.equal(ayahDueDate(cfg, algiers, new Date('2026-10-05T10:30:00Z')), null);           // 11:30 local — window closed
  assert.equal(ayahDueDate({ ...cfg, lastDate: '2026-10-05' }, algiers, new Date('2026-10-05T07:30:00Z')), null);
  // 23:30 local post time, checked at 00:10 local the next day → still belongs to the previous date
  const late = { time: '23:30', lastDate: null };
  assert.equal(ayahDueDate(late, algiers, new Date('2026-10-05T23:10:00Z')), '2026-10-05');  // 00:10 on the 6th local
  assert.equal(ayahDueDate({ ...late, lastDate: '2026-10-05' }, algiers, new Date('2026-10-05T23:10:00Z')), null);
});
