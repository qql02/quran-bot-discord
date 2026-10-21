import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTarget, layoutPage, stripBasmala, locateAyah, parseId, mid, clampPage, toIndic, pageTitle, TOTAL_AYAHS, MAX_BODY
} from '../src/utils/mushaf.js';
import { SURAHS } from '../src/data/surahs.js';

test('parseTarget: page, juz, surah by number and by name (Arabic / English, with or without "ال")', () => {
  assert.deepEqual(parseTarget('45'), { page: 45, label: 'صفحة 45' });
  assert.equal(parseTarget('٤٥').page, 45);                                  // Arabic-Indic digits
  assert.equal(parseTarget('جزء 5').page, 82);
  assert.equal(parseTarget('ج30').page, 582);
  assert.equal(parseTarget('juz 1').page, 1);
  assert.equal(parseTarget('سورة 18').page, 293);
  assert.equal(parseTarget('الكهف').page, 293);
  assert.equal(parseTarget('كهف').page, 293);
  assert.equal(parseTarget('البقره').page, 2);                               // ة / ه
  assert.equal(parseTarget('kahf').page, 293);
  assert.equal(parseTarget('yasin').page, SURAHS[35].page);                  // "Ya-Sin"
  for (const bad of ['', '0', '605', '99999', 'جزء 31', 'جزء 0', 'سورة 115', 'zzzz']) assert.ok(parseTarget(bad).error, `"${bad}" is rejected`);
});

test('every surah can be reached by its own Arabic name', () => {
  for (const s of SURAHS) assert.equal(parseTarget(s.arabic).page > 0, true, s.arabic);
});

test('locateAyah maps the global ayah number to surah:ayah across all 6236 ayahs', () => {
  assert.deepEqual(locateAyah(1), { surah: 1, ayah: 1 });
  assert.deepEqual(locateAyah(7), { surah: 1, ayah: 7 });
  assert.deepEqual(locateAyah(8), { surah: 2, ayah: 1 });
  assert.deepEqual(locateAyah(6236), { surah: 114, ayah: 6 });
  assert.equal(TOTAL_AYAHS, 6236);
  assert.equal(locateAyah(0), null); assert.equal(locateAyah(6237), null); assert.equal(locateAyah('x'), null);
});

test('stripBasmala removes the four basmala words whatever their diacritics, and nothing else', () => {
  assert.equal(stripBasmala('بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ الٓمٓ'), 'الٓمٓ');
  assert.equal(stripBasmala('بسم الله الرحمن الرحيم ذلك الكتاب'), 'ذلك الكتاب');
  assert.equal(stripBasmala('ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ'), 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ');
  assert.equal(stripBasmala('بسم الله'), 'بسم الله');                         // too short to be the basmala + text
});

test('layoutPage: header + basmala for a surah that starts here, plain flow when it continues, none for At-Tawbah / Al-Fatiha', () => {
  const start = layoutPage([{ surah: 2, ayah: 1, text: 'بسم الله الرحمن الرحيم الٓمٓ' }, { surah: 2, ayah: 2, text: 'ذَٰلِكَ' }]);
  assert.match(start.body, /^## سورة البقرة\n\*\*بِسْمِ/);
  assert.ok(start.body.includes('الٓمٓ ﴿١﴾ ذَٰلِكَ ﴿٢﴾'), start.body);
  assert.ok(!start.body.includes('بسم الله الرحمن الرحيم الٓمٓ'));

  const mid = layoutPage([{ surah: 2, ayah: 6, text: 'إِنَّ' }]);
  assert.ok(!mid.body.includes('##'));
  assert.equal(mid.body, 'إِنَّ ﴿٦﴾');

  const tawbah = layoutPage([{ surah: 9, ayah: 1, text: 'بَرَآءَةٌ' }]);
  assert.match(tawbah.body, /^## سورة التوبة\nبَرَآءَةٌ ﴿١﴾$/);                // no basmala line

  const fatiha = layoutPage([{ surah: 1, ayah: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' }]);
  assert.ok(fatiha.body.endsWith('ٱلرَّحِيمِ ﴿١﴾'), 'in Al-Fatiha the basmala IS ayah 1 and stays');
});

test('layoutPage: a page with three surahs (the last page) lists them in order; a huge page is cut safely', () => {
  const l = layoutPage([{ surah: 112, ayah: 4, text: 'أ' }, { surah: 113, ayah: 1, text: 'ب' }, { surah: 114, ayah: 1, text: 'ج' }]);
  assert.deepEqual(l.surahs, [112, 113, 114]);
  assert.ok(l.body.indexOf('الفلق') < l.body.indexOf('الناس'));
  assert.equal(pageTitle(l.surahs), 'سورة الإخلاص · الفلق · الناس');

  const huge = layoutPage(Array.from({ length: 60 }, (_, i) => ({ surah: 2, ayah: i + 6, text: 'كلمة '.repeat(60) })));
  assert.ok(huge.body.length <= MAX_BODY);
  assert.ok(huge.body.endsWith('…'));
});

test('custom ids round-trip and never accept junk', () => {
  assert.deepEqual(parseId(mid('p', 5, '123456789012345678')), { kind: 'p', page: 5, userId: '123456789012345678' });
  assert.deepEqual(parseId('mushaf:open'), { kind: 'open', page: null, userId: null });
  assert.deepEqual(parseId('mushaf:jump:123456789012345678'), { kind: 'jump', page: null, userId: '123456789012345678' });
  assert.equal(parseId('wird:done'), null);
  assert.equal(parseId(''), null);
  assert.equal(parseId('mushaf:p:99999').page, null);                          // out-of-range page is dropped, not trusted
  assert.ok(mid('done', 604, '123456789012345678').length < 100);              // Discord custom_id limit
});

test('clampPage and toIndic', () => {
  assert.deepEqual([clampPage(0), clampPage(-5), clampPage(300), clampPage(9999), clampPage('x'), clampPage(12.9)], [1, 1, 300, 604, 1, 12]);
  assert.equal(toIndic(286), '٢٨٦');
});

test('free reader (/mushaf) kinds: the plain flag survives every view and round-trips', async () => {
  const { kindFor, parseKind, imageView, TEXT_VIEW, PLAIN_TEXT, isPlain } = await import('../src/utils/mushaf.js');
  for (const base of ['p', 'jump', 'jumpm']) {
    for (const view of [PLAIN_TEXT, imageView('hafs', true), imageView('warsh', true), TEXT_VIEW, imageView('hafs'), imageView('warsh')]) {
      const back = parseKind(kindFor(base, view));
      assert.equal(back.base, base);
      assert.equal(back.view.mode, view.mode);
      assert.equal(back.view.riwaya, view.riwaya);
      assert.equal(isPlain(back.view), isPlain(view), `${base} ${JSON.stringify(view)}`);
    }
  }
  assert.equal(kindFor('p', TEXT_VIEW), 'p');                    // the wird reader's ids are unchanged
  assert.equal(kindFor('p', imageView('warsh')), 'iw');
  assert.equal(kindFor('p', PLAIN_TEXT), 'fp');
  assert.equal(parseKind('f'), null);
});
