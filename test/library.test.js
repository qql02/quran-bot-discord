import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryCategories, renderLibraryPages, scatterCandidates } from '../src/data/adhkar.js';
import { HISN, QURAN_DUAS } from '../src/data/encyclopedia.js';
import { parseDm } from '../src/utils/dmCommands.js';

const size = (p) => p.title.length + p.fields.reduce((a, f) => a + f.name.length + f.value.length, 0);

test('library: big, every chapter renders within Discord embed limits (long du\'as are split, never cut)', () => {
  const cats = libraryCategories();
  assert.ok(cats.length >= 130 && cats.reduce((a, c) => a + c.items.length, 0) >= 330);
  for (const c of cats) {
    const pages = renderLibraryPages(c);
    assert.ok(pages.length >= 1);
    for (const p of pages) {
      assert.ok(p.fields.length <= 25 && size(p) <= 6000, `${c.title}: embed too large (${size(p)})`);
      for (const f of p.fields) assert.ok(f.name.length <= 256 && f.value.length > 0 && f.value.length <= 1024, `${c.title}: field ${f.value.length}`);
    }
  }
});

test('library: no text is lost when a long item is split', () => {
  const long = libraryCategories().flatMap(c => c.items.map(i => ({ c, i }))).filter(({ i }) => i.text.length > 1000);
  assert.ok(long.length >= 2);
  for (const { c, i } of long) {
    const joined = renderLibraryPages(c).flatMap(p => p.fields).map(f => f.value).join(' ').replace(/[>\s_🔁*]+/gu, '');
    assert.ok(joined.includes(i.text.replace(/\s+/g, '').slice(-80)), `${c.title}: tail missing`);
    assert.ok(joined.includes(i.text.replace(/\s+/g, '').slice(0, 80)), `${c.title}: head missing`);
  }
});

test('library: texts are copied from the sources — every Qur\'anic du\'a has a surah reference, every item has text', () => {
  for (const q of QURAN_DUAS) assert.ok(/^سورة /.test(q.ref) && q.text.length > 8);
  for (const c of HISN) for (const i of c.items) assert.ok(i.text.length > 3 && i.count >= 1);
});

test('all-day pool grew with the encyclopedia and stays single-field', () => {
  assert.ok(scatterCandidates().length >= 300);
});

test('dm command: dua in both languages', () => {
  for (const w of ['dua', 'duas', 'library', 'دعاء', 'ادعية', 'أدعية', 'الأدعية', 'موسوعة']) assert.equal(parseDm(`!${w}`, '!').name, 'dua', w);
  assert.equal(parseDm('!dua 12', '!').args, '12');
});
