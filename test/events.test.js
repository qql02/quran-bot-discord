import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, validateRange, eventDueDate, dayOfEvent, eventState, shortId, MAX_SPAN_DAYS } from '../src/utils/events.js';
import { localClock } from '../src/utils/adhkarSchedule.js';

test('parseDate: real dates only, Arabic digits and "اليوم" accepted', () => {
  assert.equal(parseDate('2027-02-08'), '2027-02-08');
  assert.equal(parseDate('2027/2/8'), '2027-02-08');
  assert.equal(parseDate('٢٠٢٧-٠٢-٠٨'), '2027-02-08');
  assert.equal(parseDate('اليوم', '2026-10-05'), '2026-10-05');
  assert.equal(parseDate('today', '2026-10-05'), '2026-10-05');
  for (const bad of ['2027-02-30', '2027-13-01', '08-02-2027', 'غداً', '', null, '2027-2']) assert.equal(parseDate(bad, '2026-10-05'), null, String(bad));
  assert.equal(parseDate('اليوم'), null);               // no "today" known
});

test('validateRange: not in the past, end after start, bounded length', () => {
  assert.equal(validateRange('2026-10-05', '2026-10-05', '2026-10-05'), null);
  assert.equal(validateRange('2026-10-05', '2026-11-03', '2026-10-05'), null);
  assert.ok(validateRange('2026-10-04', '2026-10-05', '2026-10-05'));
  assert.ok(validateRange('2026-10-06', '2026-10-05', '2026-10-05'));
  assert.equal(validateRange('2026-10-05', '2027-01-12', '2026-10-05'), null);          // exactly 100 days
  assert.ok(validateRange('2026-10-05', '2027-01-13', '2026-10-05'));                    // 101 days
  assert.ok(validateRange('2028-01-01', '2028-01-02', '2026-10-05'));                    // too far ahead
  assert.equal(MAX_SPAN_DAYS, 100);
});

test('eventDueDate: only inside the range, at its time, once per date', () => {
  const ev = { time: '21:00', startDate: '2027-02-08', endDate: '2027-03-09', lastDate: null, timezone: 'Africa/Cairo' };
  const clock = (now) => localClock('Africa/Cairo', now);
  const at = (iso) => new Date(iso);                    // Cairo is UTC+2 in February
  assert.equal(eventDueDate(ev, clock, at('2027-02-08T19:00:00Z')), '2027-02-08');    // 21:00 local, first day
  assert.equal(eventDueDate(ev, clock, at('2027-02-08T18:00:00Z')), null);            // 20:00 local, too early
  assert.equal(eventDueDate(ev, clock, at('2027-02-07T19:00:00Z')), null);            // day before the start
  assert.equal(eventDueDate(ev, clock, at('2027-03-09T19:30:00Z')), '2027-03-09');    // last day
  assert.equal(eventDueDate(ev, clock, at('2027-03-10T19:00:00Z')), null);            // after the end
  assert.equal(eventDueDate({ ...ev, lastDate: '2027-02-08' }, clock, at('2027-02-08T19:05:00Z')), null);   // already posted
});

test('dayOfEvent / eventState / shortId', () => {
  const ev = { startDate: '2027-02-08', endDate: '2027-03-09', enabled: true };
  assert.deepEqual(dayOfEvent(ev, '2027-02-10'), { day: 3, total: 30 });
  assert.deepEqual(dayOfEvent({ startDate: '2027-02-08', endDate: '2027-02-08' }, '2027-02-08'), { day: 1, total: 1 });
  assert.equal(eventState(ev, '2027-02-01'), 'upcoming');
  assert.equal(eventState(ev, '2027-02-20'), 'running');
  assert.equal(eventState(ev, '2027-03-10'), 'finished');
  assert.equal(eventState({ ...ev, enabled: false }, '2027-02-20'), 'paused');
  assert.equal(shortId('64F0A1B2C3D4E5F6A7B8C9D0'), 'b8c9d0');
});
