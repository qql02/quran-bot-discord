import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HADITHS, HADITH_SOURCES, hadithForDate, hadithIndexForDate, hadithUrl } from '../src/data/hadiths.js';
import { buildHadithMessage } from '../src/services/hadithService.js';

test('hadith data: well-formed, unique, clean, and short enough for one embed', () => {
  assert.ok(HADITHS.length >= 1000);
  const seen = new Set();
  for (const h of HADITHS) {
    assert.ok(HADITH_SOURCES[h.s], `unknown source ${h.s}`);
    assert.ok(Number.isInteger(h.n) && h.n >= 1);
    const key = `${h.s}:${h.n}`;
    assert.ok(!seen.has(key), `duplicate ${key}`); seen.add(key);
    assert.ok(typeof h.t === 'string' && h.t.length > 20 && h.t.length <= 1800, key);
    assert.ok(!/[A-Za-z{}*_]/.test(h.t), `scraping noise in ${key}`);
    assert.ok(!/[‍-‏‪-‮]/.test(h.t), `hidden direction marks in ${key}`);
    if (h.s === 'r') assert.ok(['متفق عليه', 'رواه البخاري', 'رواه مسلم', 'رواه البخاري ومسلم'].includes(h.by), key);
  }
  assert.ok(HADITHS.some(h => h.s === 'n') && HADITHS.some(h => h.s === 'r'));
});

test('every Riyad as-Salihin entry really is reported in the two Sahihs (checked against its own closing words)', () => {
  const plain = (s) => s.replace(/[ً-ٰٟـ]/g, '');
  for (const h of HADITHS.filter(x => x.s === 'r')) assert.ok(/متفق عليه|رواه البخاري|رواه مسلم/.test(plain(h.t)), `riyad ${h.n}`);
});

test('the hadith is a pure function of the date, changes daily and shows every hadith once per cycle', () => {
  assert.equal(hadithForDate('2026-10-14'), hadithForDate('2026-10-14'));
  assert.notEqual(hadithIndexForDate('2026-10-14'), hadithIndexForDate('2026-10-15'));
  const seen = new Set();
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < HADITHS.length; i++) seen.add(hadithIndexForDate(new Date(start + i * 86_400_000).toISOString().slice(0, 10)));
  assert.equal(seen.size, HADITHS.length);
  assert.ok(hadithForDate('1969-12-31'));                              // dates before 1970 still work
});

test('the message carries the text untouched, its source and a link to sunnah.com', () => {
  const h = HADITHS.find(x => x.s === 'r');
  const m = buildHadithMessage(h);
  const e = m.embeds[0].data;                                          // the test stubs keep each builder call's argument
  assert.equal(e.setDescription, h.t);
  assert.match(e.addFields.value, new RegExp(`${HADITH_SOURCES.r.name} · حديث رقم ${h.n} · `));
  assert.equal(JSON.parse(JSON.stringify(m.components[0])).components[0].url, `https://sunnah.com/riyadussalihin:${h.n}`);
  assert.equal(hadithUrl(HADITHS.find(x => x.s === 'n')).startsWith('https://sunnah.com/nawawi40:'), true);
});
