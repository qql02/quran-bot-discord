import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hijriDate } from '../src/commands/hijri.js';

test('hijriDate: a known Umm al-Qura date (1 Ramadan 1445 = 11 March 2024)', () => {
  const d = hijriDate(new Date('2024-03-11T12:00:00Z'), 'Asia/Riyadh');
  assert.deepEqual([d.day, d.month, d.year], [1, 9, 1445]);
  assert.deepEqual(d.gregorian, { day: 11, month: 3, year: 2024 });
});
test('hijriDate: adjust shifts by whole days, timezone decides the local day', () => {
  const now = new Date('2024-03-11T12:00:00Z');
  assert.equal(hijriDate(now, 'Asia/Riyadh', 1).day, 2);
  assert.equal(hijriDate(now, 'Asia/Riyadh', -1).month, 8);
  assert.equal(hijriDate(new Date('2024-03-11T22:30:00Z'), 'Asia/Riyadh').gregorian.day, 12);
});
test('hijriDate: adjust moves only the Hijri date, never the Gregorian date or weekday', () => {
  const now = new Date('2024-03-11T12:00:00Z');
  const a = hijriDate(now, 'Asia/Riyadh'), b = hijriDate(now, 'Asia/Riyadh', 2);
  assert.deepEqual(b.gregorian, a.gregorian);
  assert.equal(b.weekdayEn, a.weekdayEn);
  assert.equal(b.day, a.day + 2);
});
