import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, hasArabic } from '../src/utils/arabic.js';

test('normalizeText removes tashkeel and tatweel', () => {
  assert.equal(normalizeText('الرَّحْمَٰن'), 'الرحمن');
  assert.equal(normalizeText('اللـــه'), 'الله');
});

test('normalizeText unifies alef, taa marbuta, yaa and hamza variants', () => {
  assert.equal(normalizeText('آل عمران'), 'ال عمران');
  assert.equal(normalizeText('أنعام'), normalizeText('انعام'));
  assert.equal(normalizeText('البقرة'), normalizeText('البقره'));
  assert.equal(normalizeText('موسى'), normalizeText('موسي'));
});

test('normalizeText converts Arabic-Indic and Persian digits', () => {
  assert.equal(normalizeText('٢٣'), '23');
  assert.equal(normalizeText('۱۱۴'), '114');
});

test('normalizeText makes English names search-friendly', () => {
  assert.equal(normalizeText('Al-Baqarah'), 'al baqarah');
  assert.equal(normalizeText("  Aal-E-Imran  "), 'aal e imran');
  assert.equal(normalizeText("An'am"), 'an am');
});

test('normalizeText is safe on empty / non-string input', () => {
  assert.equal(normalizeText(''), '');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText(42), '42');
});

test('hasArabic', () => {
  assert.equal(hasArabic('سيرفر القرآن'), true);
  assert.equal(hasArabic('Quran Server'), false);
  assert.equal(hasArabic('Server سيرفر'), true);
  assert.equal(hasArabic(null), false);
});
