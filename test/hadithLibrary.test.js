import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HADITH_BOOKS, getBook, randomPick, gradeLines, hadithSourceUrl, parseHadith, MAX_NUMBER } from '../src/data/hadithBooks.js';

test('the books: the six first, then Malik / Nawawi / Qudsi — unique ids, editions and sunnah.com slugs, safe random ranges', () => {
  assert.equal(HADITH_BOOKS.length, 9);
  assert.deepEqual(HADITH_BOOKS.map(b => b.id), ['bukhari', 'muslim', 'tirmidhi', 'abudawud', 'nasai', 'ibnmajah', 'malik', 'nawawi', 'qudsi']);
  assert.equal(new Set(HADITH_BOOKS.map(b => b.edition)).size, 9);
  for (const b of HADITH_BOOKS) {
    assert.match(b.edition, /^ara-[a-z]+$/);
    assert.ok(b.randomMax >= 40 && b.randomMax < MAX_NUMBER, b.id);
    assert.equal(hadithSourceUrl(b, 7), `https://sunnah.com/${b.slug}:7`);
  }
  assert.equal(getBook('nope'), null);
});

test('randomPick stays inside the book and covers every book', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const { book, number } = randomPick();
    assert.ok(number >= 1 && number <= book.randomMax);
    seen.add(book.id);
  }
  assert.equal(seen.size, 9);
  assert.equal(randomPick(() => 0, 'muslim').book.id, 'muslim');
  assert.equal(randomPick(() => 0.999999, 'muslim').number, 3000);
});

test('parseHadith: accepts the dataset shape, refuses a wrong number or an empty text', () => {
  const ok = parseHadith({ hadithnumber: 5, arabicnumber: 5, text: ' نص‏ الحديث ', grades: [{ name: 'Al-Albani', grade: 'Sahih' }], reference: { book: 1, hadith: 5 } }, 5);
  assert.equal(ok.text, 'نص الحديث');
  assert.equal(ok.number, 5);
  assert.equal(parseHadith({ hadithnumber: 6, text: 'x' }, 5), null);
  assert.equal(parseHadith({ hadithnumber: 5, text: '  ' }, 5), null);
  assert.equal(parseHadith(null, 5), null);
  assert.equal(parseHadith({ hadiths: [{ hadithnumber: 2, text: 'a' }] }, 2).text, 'a');
});

test('gradeLines: translates known wording, keeps unknown, never invents one', () => {
  assert.deepEqual(gradeLines([{ name: 'Al-Albani', grade: 'Sahih' }]), ['الألباني: صحيح']);
  assert.deepEqual(gradeLines([{ name: 'Al-Albani', grade: 'Hasan Sahih' }]), ['الألباني: حسن صحيح']);
  assert.deepEqual(gradeLines([{ name: 'Al-Albani', grade: "Da'if" }]), ['الألباني: ضعيف']);
  assert.deepEqual(gradeLines([{ name: 'X', grade: 'Odd' }]), ['X: Odd']);
  assert.deepEqual(gradeLines([]), []);
  assert.deepEqual(gradeLines(undefined), []);
  assert.deepEqual(gradeLines([{ name: 'a', grade: '' }]), []);
});
