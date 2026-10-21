import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const load = (lang) => JSON.parse(readFileSync(join(ROOT, 'src/locales', `${lang}.json`), 'utf8'));

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, key)); else out[key] = v;
  }
  return out;
}
const placeholders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

test('Arabic and English define exactly the same keys', () => {
  const missingInAr = Object.keys(en).filter(k => !(k in ar));
  const missingInEn = Object.keys(ar).filter(k => !(k in en));
  assert.deepEqual(missingInAr, [], 'keys missing from ar.json');
  assert.deepEqual(missingInEn, [], 'keys missing from en.json');
});

test('no empty strings and every value is a string', () => {
  for (const [lang, map] of [['en', en], ['ar', ar]]) {
    for (const [k, v] of Object.entries(map)) {
      assert.equal(typeof v, 'string', `${lang}:${k} is not a string`);
      assert.ok(v.trim().length > 0, `${lang}:${k} is empty`);
    }
  }
});

test('both languages use the same {{placeholders}} for every key', () => {
  for (const k of Object.keys(en)) {
    if (k in ar) assert.deepEqual(placeholders(ar[k]), placeholders(en[k]), `placeholder mismatch in "${k}"`);
  }
});

test('every literal t(lang, "key") used in the code exists in the locale files', () => {
  const files = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p);
    }
  })(join(ROOT, 'src'));

  const missing = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*[A-Za-z_.]+\s*,\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/gi)) {
      if (!(m[1] in en)) missing.push(`${file.replace(ROOT, '')}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
