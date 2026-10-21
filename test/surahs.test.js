import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURAHS, getSurahByNumber, getSurahByName, searchSurahs, surahLabel } from '../src/data/surahs.js';

test('surah data is complete and consistent', () => {
  assert.equal(SURAHS.length, 114);
  SURAHS.forEach((s, i) => {
    assert.equal(s.number, i + 1, `surah #${i + 1} has the wrong number`);
    assert.ok(s.arabic && s.english, `surah #${s.number} is missing a name`);
    assert.ok(['meccan', 'medinan'].includes(s.type), `surah #${s.number} has an invalid type`);
    if (i > 0) assert.ok(s.page >= SURAHS[i - 1].page, `surah #${s.number} page goes backwards`);
  });
  assert.equal(SURAHS.reduce((sum, s) => sum + s.ayahs, 0), 6236, 'total ayah count');
  assert.equal(SURAHS[113].page, 604, 'last surah starts on the last mushaf page');
  assert.equal(new Set(SURAHS.map(s => s.arabic)).size, 114, 'Arabic names are unique');
});

test('getSurahByNumber', () => {
  assert.equal(getSurahByNumber(1).english, 'Al-Fatihah');
  assert.equal(getSurahByNumber(114).arabic, 'الناس');
  assert.equal(getSurahByNumber(0), null);
  assert.equal(getSurahByNumber(115), null);
});

test('getSurahByName finds by Arabic, English, number, with variants', () => {
  assert.equal(getSurahByName('البقرة').number, 2);
  assert.equal(getSurahByName('البقره').number, 2);          // taa marbuta typed as haa
  assert.equal(getSurahByName('ال عمران').number, 3);        // آل عمران without the madda
  assert.equal(getSurahByName('al kahf').number, 18);
  assert.equal(getSurahByName('Al-Kahf').number, 18);
  assert.equal(getSurahByName('٢٣').number, 23);             // Arabic-Indic digits
  assert.equal(getSurahByName('zzzz'), null);
  assert.equal(getSurahByName(''), null);
});

test('searchSurahs: empty query returns popular surahs first, capped at 25', () => {
  const r = searchSurahs('');
  assert.equal(r.length, 25);
  assert.deepEqual(r.slice(0, 4).map(s => s.number), [1, 18, 36, 55]);
  assert.equal(new Set(r.map(s => s.number)).size, 25, 'no duplicates');
});

test('searchSurahs ranks exact > prefix > contains, then by number', () => {
  assert.equal(searchSurahs('الرحمن')[0].number, 55);
  assert.equal(searchSurahs('baqara')[0].number, 2);
  assert.equal(searchSurahs('11')[0].number, 11);            // exact number first
  assert.deepEqual(searchSurahs('11').map(s => s.number), [11, 110, 111, 112, 113, 114].filter(n => String(n).startsWith('11')));
  assert.deepEqual(searchSurahs('zzzz'), []);
});

test('surahLabel shows both languages, preferred one first', () => {
  assert.equal(surahLabel(SURAHS[1], 'ar'), '2. البقرة · Al-Baqarah');
  assert.equal(surahLabel(SURAHS[1], 'en'), '2. Al-Baqarah · البقرة');
});
