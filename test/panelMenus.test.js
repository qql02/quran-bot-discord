import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_RECITERS, SURAH_PAGE_COUNT, surahPageRange, getGuildReciterKey, setGuildReciterKey, defaultReciterQuery } from '../src/data/popular.js';
import { SURAHS } from '../src/data/surahs.js';

test('the surah menu pages cover all 114 surahs, each page fits Discord\'s 25 options', async () => {
  const { buildPanelSelects } = await import('../src/utils/buttons.js');
  const seen = [];
  for (let p = 0; p < SURAH_PAGE_COUNT; p++) {
    const opts = buildPanelSelects('ar', 'g', p)[0].toJSON().components[0].options;
    assert.ok(opts.length <= 25, `page ${p} has ${opts.length} options`);
    for (const o of opts) if (!o.value.startsWith('page:')) seen.push(Number(o.value));
    assert.equal(opts.some(o => o.value === `page:${p + 1}`), p < SURAH_PAGE_COUNT - 1);
    assert.equal(opts.some(o => o.value === `page:${p - 1}`), p > 0);
  }
  assert.deepEqual(seen, Array.from({ length: 114 }, (_, i) => i + 1));
  assert.deepEqual(surahPageRange(4), [93, 114]);
});

test('panel reciter menu fits Discord limits', () => {
  assert.ok(PANEL_RECITERS.length <= 25);
  assert.equal(new Set(PANEL_RECITERS.map(r => r.key)).size, PANEL_RECITERS.length);
  for (const r of PANEL_RECITERS) assert.ok(r.search.length >= 2 && r.ar && r.en);
});

test('the reciter choice is remembered per server, ignores unknown keys, and drives the default', () => {
  assert.equal(defaultReciterQuery('gx'), 'Mishary Rashid Alafasy');
  setGuildReciterKey('gx', 'nope');
  assert.equal(getGuildReciterKey('gx'), null);
  setGuildReciterKey('gx', 'sudais');
  assert.equal(getGuildReciterKey('gx'), 'sudais');
  assert.equal(getGuildReciterKey('other'), null);
  assert.equal(defaultReciterQuery('gx'), 'sudais');
});
