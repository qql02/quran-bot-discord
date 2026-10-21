import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalAdhkarDue, hasPersonalAdhkar, isFriday, KAHF_PAGES } from '../src/utils/wird.js';
import { weekdayOf } from '../src/utils/adhkarSchedule.js';
import { renderAdhkarPages, scatterCandidates, renderScatterAdhkar } from '../src/data/adhkar.js';
import { wirdText, actionRows } from '../src/wird/ui/index.js';
import { SURAHS } from '../src/data/surahs.js';

const sub = (o = {}) => ({ userId: '1', timezone: 'Africa/Algiers', adhkarMorning: false, adhkarEvening: false, ...o });
const at = (iso) => new Date(iso);                       // Algiers = UTC+1 all year

test('personal adhkar: nothing is due when both switches are off', () => {
  assert.equal(hasPersonalAdhkar(sub()), false);
  assert.deepEqual(personalAdhkarDue(sub(), at('2026-10-09T05:30:00Z')), []);
});

test('personal adhkar: only the switched-on set is due, on the member\'s own clock', () => {
  const now = at('2026-10-09T05:30:00Z');                // 06:30 in Algiers → morning window (06:00 + 2h)
  assert.deepEqual(personalAdhkarDue(sub({ adhkarMorning: true }), now), [{ slot: 'morning', date: '2026-10-09' }]);
  assert.deepEqual(personalAdhkarDue(sub({ adhkarEvening: true }), now), []);
  // 17:30 Algiers
  const eve = at('2026-10-09T16:30:00Z');
  assert.deepEqual(personalAdhkarDue(sub({ adhkarMorning: true, adhkarEvening: true }), eve), [{ slot: 'evening', date: '2026-10-09' }]);
  // the same instant is a different local time for someone in another zone: 03:30 UTC is 06:30 in Riyadh (due) but 04:30 in Algiers (not yet) and 12:30 in Tokyo (past)
  const early = at('2026-10-09T03:30:00Z');
  assert.equal(personalAdhkarDue(sub({ adhkarMorning: true, timezone: 'Asia/Riyadh' }), early).length, 1);
  assert.deepEqual(personalAdhkarDue(sub({ adhkarMorning: true }), early), []);
  assert.deepEqual(personalAdhkarDue(sub({ adhkarMorning: true, timezone: 'Asia/Tokyo' }), early), []);
});

test('personal adhkar: not sent twice for the same local date, and not after the catch-up window', () => {
  const now = at('2026-10-09T05:30:00Z');
  assert.deepEqual(personalAdhkarDue(sub({ adhkarMorning: true, lastAdhkarMorning: '2026-10-09' }), now), []);
  assert.equal(personalAdhkarDue(sub({ adhkarMorning: true, lastAdhkarMorning: '2026-10-08' }), now).length, 1);
  assert.deepEqual(personalAdhkarDue(sub({ adhkarMorning: true }), at('2026-10-09T09:30:00Z')), [], '10:30 is past the window');
});

test('Friday: weekday of a local date, and Al-Kahf pages match the surah table', () => {
  assert.equal(weekdayOf('2026-10-09'), 5);
  assert.equal(isFriday('2026-10-09'), true);
  assert.equal(isFriday('2026-10-10'), false);
  const kahf = SURAHS.find(s => s.english === 'Al-Kahf'), maryam = SURAHS.find(s => s.english === 'Maryam');
  assert.deepEqual(KAHF_PAGES, [kahf.page, maryam.page - 1]);
});

test('all-day posts: Friday items appear only on Friday (or in an unfiltered preview)', () => {
  const friday = (w) => scatterCandidates(undefined, w).filter(i => i.days).map(i => i.title);
  assert.ok(friday(5).includes('سورة الكهف يوم الجمعة') && friday(5).includes('الصلاة على النبي يوم الجمعة'));
  assert.deepEqual(friday(3), []);
  assert.ok(friday(undefined).length >= 2);
  for (let n = 0; n < 200; n++) assert.ok(!renderScatterAdhkar({ weekday: 2, rng: () => (n % 97) / 97 }).title.includes('الجمعة'));
});

test('new content: after-prayer and sleep adhkar exist, are time-correct and fit Discord limits', () => {
  const titles = (m) => scatterCandidates(m).map(i => i.title);
  assert.ok(titles(13 * 60).includes('تسبيح دبر الصلاة'), 'after-prayer adhkar are not tied to a time');
  assert.ok(titles(22 * 60 + 30).includes('أسلمت نفسي إليك') && titles(22 * 60 + 30).includes('آية الكرسي عند النوم'));
  assert.ok(!titles(13 * 60).includes('أسلمت نفسي إليك'), 'sleep adhkar never at noon');
  for (const i of scatterCandidates()) assert.ok(`> ${i.text}${i.note ?? ''}`.length < 1000, i.title);
});

test('the last two verses of Al-Baqarah are in the evening set only', () => {
  const names = (kind) => renderAdhkarPages(kind).flatMap(p => p.fields.map(f => f.name));
  assert.ok(names('evening').some(n => n.includes('آخر آيتين من سورة البقرة')));
  assert.ok(!names('morning').some(n => n.includes('آخر آيتين من سورة البقرة')));
});

test('khatma card carries the du\'a in both languages; the status card has two adhkar switches within 5 rows', () => {
  assert.match(wirdText('ar').khatmaDesc(1), /ربيع قلبي/);
  assert.match(wirdText('en').khatmaDesc(1), /spring of my heart/);
  for (const lang of ['ar', 'en']) {
    const rows = actionRows({ userId: '1', lang, active: true, timezone: 'UTC', currentPage: 3, pagesPerDay: 2, adhkarMorning: true,
      expiresAt: new Date(Date.now() + 9e8) }, { full: true });
    assert.ok(rows.length <= 5);
    const ids = rows.flatMap(r => r.toJSON().components.map(c => c.custom_id));
    assert.ok(ids.includes('wird:adhkar:morning') && ids.includes('wird:adhkar:evening'));
  }
});
