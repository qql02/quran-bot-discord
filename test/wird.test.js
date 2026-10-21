import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL_PAGES, parsePages, prevDate, daysBetween, todayPortion, daysToKhatma, khatmaLength, juzAtPage,
  surahAtPage, progressBar, percent, liveStreak, pagesToday, applyReading, nextExpiry, subscriptionState,
  variedTime, daysLeft, reminderDue, SUBSCRIPTION_DAYS, RENEW_WARN_DAYS, clampToDailyLimit, MAX_PAGES_PER_DAY,
  GOAL_OPTIONS, pagesForGoal, addDays, goalDeadlineFrom, goalStatus, parseGoalDays, daysAtPace,
  lastActivity, isInactive, INACTIVITY_PAUSE_DAYS
} from '../src/utils/wird.js';
import { resolveTimeZone } from '../src/utils/adhkarSchedule.js';
import { SURAHS } from '../src/data/surahs.js';

test('parsePages: whole numbers (Arabic digits too) within range, nothing else', () => {
  assert.equal(parsePages('2'), 2);
  assert.equal(parsePages(' ٢٠ '), 20);
  assert.equal(parsePages('604', 604), 604);
  for (const bad of ['0', '-1', '1.5', 'abc', '', null, '101', '12345']) assert.equal(parsePages(bad), null, String(bad));
  assert.equal(parsePages('101', 604), 101);
});

test('date helpers cross month / year / leap boundaries', () => {
  assert.equal(prevDate('2026-03-01'), '2026-02-28');
  assert.equal(prevDate('2028-03-01'), '2028-02-29');
  assert.equal(prevDate('2026-01-01'), '2025-12-31');
  assert.equal(daysBetween('2026-10-01', '2026-10-05'), 4);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('portions: from the next page, capped at the last page; no portion after the end', () => {
  assert.deepEqual(todayPortion(0, 2), { from: 1, to: 2 });
  assert.deepEqual(todayPortion(24, 5), { from: 25, to: 29 });
  assert.deepEqual(todayPortion(603, 5), { from: 604, to: 604 });
  assert.equal(todayPortion(604, 2), null);
  assert.equal(khatmaLength(2), 302);
  assert.equal(khatmaLength(20), 31);
  assert.equal(daysToKhatma(0, 20), 31);
  assert.equal(daysToKhatma(600, 20), 1);
});

test('juz and surah lookups follow the mushaf', () => {
  assert.equal(juzAtPage(1), 1);
  assert.equal(juzAtPage(21), 1);
  assert.equal(juzAtPage(22), 2);
  assert.equal(juzAtPage(582), 30);
  assert.equal(juzAtPage(604), 30);
  assert.equal(surahAtPage(1, SURAHS).number, 1);
  assert.equal(surahAtPage(2, SURAHS).number, 2);
  assert.equal(surahAtPage(49, SURAHS).number, 2);
  assert.equal(surahAtPage(50, SURAHS).number, 3);
  assert.equal(surahAtPage(604, SURAHS).number, 114);
});

test('progress helpers', () => {
  assert.equal(progressBar(0, 10), '▱'.repeat(10));
  assert.equal(progressBar(1, 10), '▰'.repeat(10));
  assert.equal(progressBar(2, 10), '▰'.repeat(10));   // clamped
  assert.equal(percent(302), 50);
  assert.equal(percent(0), 0);
});

const base = { pagesPerDay: 2, currentPage: 0, streak: 0, bestStreak: 0, khatmaCount: 0, totalPagesRead: 0, lastReadDate: null, dayDate: null, dayPages: 0 };
const merge = (sub, r) => ({ ...sub, ...r.set });

test('applyReading: finishing the daily wird advances pages and starts a streak', () => {
  const r = applyReading(base, 2, '2026-10-05');
  assert.equal(r.added, 2);
  assert.equal(r.newlyDone, true);
  assert.deepEqual([r.set.currentPage, r.set.streak, r.set.lastReadDate, r.set.totalPagesRead], [2, 1, '2026-10-05', 2]);
});

test('applyReading: streak continues on consecutive days, resets after a gap, best streak is kept', () => {
  let s = merge(base, applyReading(base, 2, '2026-10-05'));
  s = merge(s, applyReading(s, 2, '2026-10-06'));
  assert.equal(s.streak, 2);
  s = merge(s, applyReading(s, 2, '2026-10-07'));
  assert.equal(s.streak, 3);
  s = merge(s, applyReading(s, 2, '2026-10-10'));            // missed two days
  assert.equal(s.streak, 1);
  assert.equal(s.bestStreak, 3);
});

test('applyReading: partial pages accumulate within a day and only count once complete', () => {
  let s = merge(base, applyReading(base, 1, '2026-10-05'));
  assert.equal(s.streak, 0);                                   // 1 of 2 pages — day not done yet
  const r = applyReading(s, 1, '2026-10-05');
  assert.equal(r.newlyDone, true);
  s = merge(s, r);
  assert.equal(s.streak, 1);
  const extra = applyReading(s, 3, '2026-10-05');              // reading more the same day never double-counts the streak
  assert.equal(extra.newlyDone, false);
  assert.equal(merge(s, extra).streak, 1);
  assert.equal(merge(s, extra).currentPage, 2 + 3);
});

test('applyReading: the per-day counter resets by itself on a new date', () => {
  const s = merge(base, applyReading(base, 1, '2026-10-05'));
  assert.equal(pagesToday(s, '2026-10-05'), 1);
  assert.equal(pagesToday(s, '2026-10-06'), 0);
});

test('applyReading: reaching page 604 completes a khatma, wraps to 0, and never overflows', () => {
  const near = { ...base, currentPage: 603 };
  const r = applyReading(near, 5, '2026-10-05');
  assert.equal(r.completedKhatma, true);
  assert.equal(r.added, 1);                                    // only 1 page was left
  assert.equal(r.set.currentPage, 0);
  assert.equal(r.set.khatmaCount, 1);
  assert.equal(r.set.totalPagesRead, 1);
  assert.equal(applyReading(base, 0, '2026-10-05').added, 0);
  assert.equal(applyReading(base, 0, '2026-10-05').completedKhatma, false);
});

test('applyReading never mutates its input', () => {
  const sub = Object.freeze({ ...base });
  assert.doesNotThrow(() => applyReading(sub, 2, '2026-10-05'));
});

test('liveStreak: alive today or yesterday, dead after a missed day', () => {
  const s = { streak: 7, lastReadDate: '2026-10-05' };
  assert.equal(liveStreak(s, '2026-10-05'), 7);
  assert.equal(liveStreak(s, '2026-10-06'), 7);
  assert.equal(liveStreak(s, '2026-10-07'), 0);
  assert.equal(liveStreak({ streak: 3, lastReadDate: null }, '2026-10-07'), 0);
});

test('subscription: 30 days, warning window, expiry', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const exp = nextExpiry(now);
  assert.equal(daysBetween('2026-10-05', exp.toISOString().slice(0, 10)), SUBSCRIPTION_DAYS);
  assert.equal(subscriptionState(exp, now), 'active');
  assert.equal(subscriptionState(new Date(now.getTime() + RENEW_WARN_DAYS * 86_400_000), now), 'expiring');
  assert.equal(subscriptionState(new Date(now.getTime() + 3_600_000), now), 'expiring');
  assert.equal(subscriptionState(new Date(now.getTime() - 1), now), 'expired');
  assert.equal(daysLeft(exp, now), SUBSCRIPTION_DAYS);
  assert.equal(daysLeft(new Date(now.getTime() - 5000), now), 0);
});

test('reminderDue: member-local clock, catch-up window, once per day, skipped when already read', () => {
  // Africa/Algiers is UTC+1 all year → 19:30Z is 20:30 local.
  const sub = { timezone: 'Africa/Algiers', remindTime: '20:00', lastRemindedDate: null, lastReadDate: null };
  const at = (iso) => new Date(iso);
  assert.deepEqual(reminderDue(sub, at('2026-10-05T19:30:00Z')), { date: '2026-10-05' });
  assert.equal(reminderDue(sub, at('2026-10-05T18:30:00Z')), null);                                   // 19:30 local — too early
  assert.equal(reminderDue(sub, at('2026-10-05T22:30:00Z')), null);                                   // 23:30 local — past the 2h window
  assert.equal(reminderDue({ ...sub, lastRemindedDate: '2026-10-05' }, at('2026-10-05T19:30:00Z')), null);
  assert.equal(reminderDue({ ...sub, lastReadDate: '2026-10-05' }, at('2026-10-05T19:30:00Z')), null);
  assert.deepEqual(reminderDue({ ...sub, lastRemindedDate: '2026-10-04' }, at('2026-10-05T19:30:00Z')), { date: '2026-10-05' });
});

test('resolveTimeZone: IANA names, any casing, Arabic country names; junk → null', () => {
  assert.equal(resolveTimeZone('Africa/Algiers'), 'Africa/Algiers');
  assert.equal(resolveTimeZone('africa/algiers'), 'Africa/Algiers');
  assert.equal(resolveTimeZone('الجزائر'), 'Africa/Algiers');
  assert.equal(resolveTimeZone('السعودية'), 'Asia/Riyadh');
  assert.equal(resolveTimeZone('الإمارات'), 'Asia/Dubai');
  assert.equal(resolveTimeZone('مصر'), 'Africa/Cairo');
  for (const bad of ['', '   ', 'Atlantis/Nowhere', 'blah', null]) assert.equal(resolveTimeZone(bad), null, String(bad));
});

test('TOTAL_PAGES matches the last surah page table', () => {
  assert.equal(TOTAL_PAGES, 604);
  assert.ok(SURAHS.at(-1).page <= TOTAL_PAGES);
});

test('clampToDailyLimit: caps the day at MAX_PAGES_PER_DAY so one tap cannot fake a khatma', () => {
  const today = '2026-10-05';
  assert.equal(clampToDailyLimit({}, today, 604), MAX_PAGES_PER_DAY);
  assert.equal(clampToDailyLimit({ dayDate: today, dayPages: 90 }, today, 50), 10);
  assert.equal(clampToDailyLimit({ dayDate: today, dayPages: MAX_PAGES_PER_DAY }, today, 5), 0);
  assert.equal(clampToDailyLimit({ dayDate: '2026-10-04', dayPages: 99 }, today, 5), 5);   // yesterday's counter does not count
  assert.equal(clampToDailyLimit({}, today, 'x'), 0);
});

test('khatma goals: 30 / 60 / 90 days give the right daily pace and deadline', () => {
  assert.deepEqual(GOAL_OPTIONS, [15, 30, 60, 90, 180]);
  assert.equal(pagesForGoal(0, 15), 41);
  assert.equal(pagesForGoal(0, 180), 4);
  assert.equal(pagesForGoal(0, 30), 21);      // 604 / 30 → 20.13 → 21
  assert.equal(pagesForGoal(0, 60), 11);
  assert.equal(pagesForGoal(0, 90), 7);
  assert.equal(pagesForGoal(500, 30), 4);     // 104 pages left
  assert.equal(pagesForGoal(603, 90), 1);     // never below 1
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(goalDeadlineFrom('2026-10-05', 30), '2026-11-03');   // 30 days including today
});

test('goalStatus: on track, behind, overdue, none', () => {
  const base = { currentPage: 0, pagesPerDay: 21, goalDeadline: '2026-11-03' };
  assert.equal(goalStatus({ ...base, goalDeadline: null }, '2026-10-05'), null);
  const ok = goalStatus(base, '2026-10-05');
  assert.equal(ok.daysLeft, 30); assert.equal(ok.needed, 21); assert.equal(ok.onTrack, true);
  const behind = goalStatus({ ...base, currentPage: 100 }, '2026-10-25');   // 504 left, 10 days → 51/day
  assert.equal(behind.daysLeft, 10); assert.equal(behind.needed, 51); assert.equal(behind.onTrack, false);
  const late = goalStatus(base, '2026-11-04');
  assert.equal(late.overdue, true); assert.equal(late.onTrack, false);
});

test('parseGoalDays: any period from 7 to 365 days, nothing else', () => {
  assert.equal(parseGoalDays('45'), 45);
  assert.equal(parseGoalDays(' ٤٥ '), 45);
  assert.equal(parseGoalDays('7'), 7);
  assert.equal(parseGoalDays('365'), 365);
  for (const bad of ['6', '0', '366', '1.5', 'abc', '', null]) assert.equal(parseGoalDays(bad), null, String(bad));
});

test('a goal period never takes longer than asked (21 pages/day finish in 29 days, not 31)', () => {
  for (const days of [7, 10, 15, 20, 30, 45, 60, 90, 120, 365]) {
    const ppd = pagesForGoal(0, days);
    assert.ok(daysAtPace(0, ppd) <= days, `${days} days → ${ppd} pages/day`);
  }
  assert.equal(daysAtPace(0, 21), 29);
});

test('inactivity: reminders pause after a silent week, reading or renewing resets it', () => {
  const DAY = 86_400_000;
  const now = new Date('2026-10-20T20:00:00Z');
  const renewedAt = (daysAgo) => new Date(now.getTime() - daysAgo * DAY);
  const withRenewal = (daysAgo, extra = {}) => ({ expiresAt: new Date(renewedAt(daysAgo).getTime() + SUBSCRIPTION_DAYS * DAY), ...extra });

  assert.equal(INACTIVITY_PAUSE_DAYS, 7);
  assert.equal(isInactive(withRenewal(3), now), false);                        // joined 3 days ago, nothing read yet: still fine
  assert.equal(isInactive(withRenewal(8), now), true);                         // joined 8 days ago and never read
  assert.equal(isInactive(withRenewal(20, { lastReadDate: '2026-10-18' }), now), false);   // read 2 days ago
  assert.equal(isInactive(withRenewal(20, { lastReadDate: '2026-10-10' }), now), true);    // last read 10 days ago
  assert.equal(isInactive(withRenewal(20, { dayDate: '2026-10-19', dayPages: 1 }), now), false);   // partial reading counts
  assert.equal(isInactive(withRenewal(20, { dayDate: '2026-10-19', dayPages: 0 }), now), true);    // a zero counter is not activity
  assert.ok(lastActivity(withRenewal(0)) > now.getTime() - 1000);              // renewing counts as activity
});

test('varied reminders: deterministic, inside the day slots, rotating daily and spread across members', async () => {
  const { variedTime, reminderTimeFor, VARIED_WINDOWS } = await import('../src/utils/wird.js');
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const inSlot = (t) => VARIED_WINDOWS.findIndex(w => mins(t) >= mins(w.from) && mins(t) < mins(w.from) + w.span);
  assert.equal(variedTime('42', '2026-10-05'), variedTime('42', '2026-10-05'));          // same member + date → same time
  const slotCount = [0, 0, 0]; const distinct = new Set();
  for (let u = 0; u < 300; u++) {
    const id = String(100000000000000000n + BigInt(u * 7919));
    let prev = -1;
    for (let d = 0; d < 10; d++) {
      const date = `2026-10-${String(10 + d).padStart(2, '0')}`;
      const t = variedTime(id, date), slot = inSlot(t);
      assert.ok(slot >= 0, `${t} is outside every slot`);
      assert.notEqual(slot, prev, 'same part of the day two days in a row');
      prev = slot; if (d === 0) { slotCount[slot]++; distinct.add(t); }
    }
  }
  assert.ok(slotCount.every(c => c > 60), `members are not balanced across the day: ${slotCount}`);     // ~100 each
  assert.ok(distinct.size > 100, 'times are not spread over the minutes');
  // modes
  assert.equal(reminderTimeFor({ userId: '1', remindMode: 'fixed', remindTime: '21:15' }, '2026-10-05'), '21:15');
  assert.equal(reminderTimeFor({ userId: '1', remindTime: '21:15' }, '2026-10-05'), '21:15');             // old documents stay fixed
  assert.equal(reminderTimeFor({ userId: '1', remindMode: 'varied' }, '2026-10-05'), variedTime('1', '2026-10-05'));
});

test('reminderDue in varied mode fires at the varied time, once a day', () => {
  const sub = { userId: '777', timezone: 'UTC', remindMode: 'varied' };
  const [h, m] = variedTime('777', '2026-10-05').split(':').map(Number);
  const at = (min) => new Date(Date.UTC(2026, 9, 5, 0, min));
  assert.equal(reminderDue(sub, at(h * 60 + m - 1)), null);
  assert.deepEqual(reminderDue(sub, at(h * 60 + m)), { date: '2026-10-05' });
  assert.equal(reminderDue({ ...sub, lastRemindedDate: '2026-10-05' }, at(h * 60 + m + 5)), null);
});

// ── finishing a khatma with fewer pages than the daily goal ───────────────────
import { applyReading as _apply } from '../src/utils/wird.js';
test('finishing the khatma counts the day even when fewer pages than the daily goal were left', () => {
  const sub = { currentPage: 603, pagesPerDay: 2, streak: 5, bestStreak: 5, lastReadDate: '2026-10-04', khatmaCount: 0 };
  const r = _apply(sub, 1, '2026-10-05');
  assert.equal(r.completedKhatma, true);
  assert.equal(r.dayDone, true);
  assert.equal(r.newlyDone, true);
  assert.equal(r.set.streak, 6);
  assert.equal(r.set.lastReadDate, '2026-10-05');
});
test('reading nothing never counts as a finished day', () => {
  const r = _apply({ currentPage: 100, pagesPerDay: 2, streak: 5, lastReadDate: '2026-10-04' }, 0, '2026-10-05');
  assert.equal(r.dayDone, false);
  assert.equal(r.set.streak, 5);
});

test('a member reading 20 pages a day completes exactly one khatma at page 604, streak resets after a missed day', () => {
  let sub = { currentPage: 0, pagesPerDay: 20, streak: 0, bestStreak: 0, khatmaCount: 0, totalPagesRead: 0, lastReadDate: null, dayDate: null, dayPages: 0 };
  let date = '2026-10-01', completedAt = null, streakAfterGap = null;
  for (let day = 1; day <= 60 && completedAt === null; day++) {
    if (day === 10) { date = _addDays(date, 1); continue; }            // a missed day
    const r = _apply(sub, 20, date); sub = { ...sub, ...r.set };
    if (day === 11) streakAfterGap = sub.streak;
    if (r.completedKhatma) completedAt = day;
    date = _addDays(date, 1);
  }
  assert.equal(completedAt, 32);
  assert.equal(streakAfterGap, 1);
  assert.equal(sub.bestStreak, 22);      // 9 before the gap, then 22 consecutive days up to the last page
  assert.equal(sub.khatmaCount, 1);
  assert.equal(sub.totalPagesRead, 604);
  assert.equal(sub.currentPage, 0);
});
import { addDays as _addDays } from '../src/utils/wird.js';

test('resolveTimeZone ignores inherited object keys (constructor, toString, __proto__…)', () => {
  for (const bad of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', '__defineGetter__', 'isPrototypeOf']) {
    assert.equal(resolveTimeZone(bad), null, bad);
  }
  assert.equal(resolveTimeZone('مصر'), 'Africa/Cairo');
});
