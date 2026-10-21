import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSurahList } from '../src/utils/surahList.js';

test('parses singles, commas, spaces and ranges', () => {
  assert.deepEqual(parseSurahList('1,2,5-8 112'), [1, 2, 5, 6, 7, 8, 112]);
  assert.deepEqual(parseSurahList('3'), [3]);
});

test('empty / missing input', () => {
  assert.deepEqual(parseSurahList(''), []);
  assert.deepEqual(parseSurahList(null), []);
  assert.deepEqual(parseSurahList(undefined), []);
});

test('ignores junk, zero, negative and backwards ranges', () => {
  assert.deepEqual(parseSurahList('abc 0 -4 9-3 7'), [7]);
});

test('clamps to real surah numbers (no memory blow-up on a bogus API value)', () => {
  const r = parseSurahList('1-999999999');
  assert.equal(r.length, 114);
  assert.equal(r.at(-1), 114);
  assert.deepEqual(parseSurahList('113-500'), [113, 114]);
  assert.deepEqual(parseSurahList('115 200'), []);
});
