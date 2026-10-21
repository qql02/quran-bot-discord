import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeZone as r, suggestTimeZones } from '../src/utils/adhkarSchedule.js';
import { normalizePlace as norm } from '../src/utils/timezoneResolver.js';

const same = (zone, ...names) => { for (const n of names) assert.equal(r(n), zone, `"${n}"`); };

test('place names: Arabic spellings, dialects, official names and cities all reach the same zone', () => {
  same('Africa/Algiers', 'الجزائر', 'الجزاير', 'الجزائر العاصمة', 'وهران', 'قسنطينة', 'دولة الجزائر', 'Algérie', 'algerie', 'Algeria', 'dzair', 'DZ', 'Alger');
  same('Asia/Riyadh', 'السعودية', 'السعوديه', 'المملكة العربية السعودية', 'جدة', 'مكه المكرمه', 'KSA', 'Saudi Arabia', 'Arabie saoudite');
  same('Asia/Dubai', 'الامارات', 'الإمارات', 'الإمارات العربية المتحدة', 'دولة الإمارات', 'UAE', 'دبي');
  same('Africa/Cairo', 'مصر', 'جمهورية مصر العربية', 'الاسكندرية', 'Misr', 'Egypt', 'Égypte');
  same('Africa/Casablanca', 'المغرب', 'Maroc', 'الرباط', 'مراكش', 'Morocco');
  same('Africa/Tunis', 'تونس', 'Tunisie', 'صفاقس');
  same('Asia/Amman', 'الأردن', 'الاردن', 'عمان الاردن', 'Jordanie');
  same('Asia/Muscat', 'عمان', 'سلطنة عمان', 'مسقط');
  same('Europe/Paris', 'فرنسا', 'France', 'باريس');
  same('America/New_York', 'امريكا', 'أمريكا', 'USA', 'United States', 'New York', 'نيويورك');
  same('America/Los_Angeles', 'los angeles', 'لوس انجلوس');
});

test('place names: one typo, swapped letters, extra words around the name', () => {
  same('Asia/Riyadh', 'Saudi Arabi', 'Saudy Arabia', 'Saudi Arabai');
  same('Africa/Cairo', 'Egipt', 'Egypt country');
  same('Africa/Algiers', 'Algria', 'الجزاءر', 'i live in الجزائر');
  same('Africa/Casablanca', 'Moroco');
  same('Africa/Tunis', 'Tunsia');
});

test('place names: UTC offsets (the tz database writes the sign the other way round)', () => {
  same('Etc/GMT-1', 'UTC+1', 'utc + 1', 'GMT+1', '+1', 'UTC+01:00');
  same('Etc/GMT+5', 'GMT-5', 'UTC-5');
  same('UTC', 'UTC', 'GMT+0');
  assert.equal(r('UTC+15'), null);
  assert.equal(r('UTC-13'), null);
});

test('place names: junk and prototype keys stay null, two different places are not guessed', () => {
  for (const bad of ['', '   ', 'blah', 'x', '12345', 'عربي', 'constructor', 'toString', '__proto__', 'Atlantis/Nowhere', null, undefined, 'a'.repeat(200)])
    assert.equal(r(bad), null, String(bad));
  assert.equal(r('oman algeria'), null, 'oman + algeria are two different zones at the same weight');
});

test('normalizePlace: accents, hamza, ta marbuta, the article «ال» and punctuation do not matter', () => {
  assert.equal(norm('Algérie'), 'algerie');
  assert.equal(norm('الإمارات'), norm('امارات'));
  assert.equal(norm('السعودية'), norm('السعوديه'));
  assert.equal(norm('  Saudi,  Arabia! '), 'saudi arabia');
});

test('suggestions: close names for the error message, in the asked language, no random ones', () => {
  assert.deepEqual(suggestTimeZones('algri', 'en').slice(0, 1), ['Algeria']);
  assert.equal(suggestTimeZones('الجزاءر', 'ar')[0], 'الجزائر');
  assert.equal(suggestTimeZones('saudia arbia', 'en')[0], 'Saudi Arabia');
  assert.deepEqual(suggestTimeZones('qqqqqq', 'en'), []);
  assert.deepEqual(suggestTimeZones('', 'ar'), []);
  assert.ok(suggestTimeZones('saud', 'en').includes('Saudi Arabia'));
});
