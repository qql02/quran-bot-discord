import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// axios, the models and the logger are stubs (see test-helpers/hooks.mjs); the service logic is the real code.
const qs = await import('../src/services/quranService.js');

const moshaf = (id, name, list = '1-114') => ({ id, name, server: `https://s${id}.example.com/x/`, surah_list: list, surah_total: 114, moshaf_type: 11 });
const EN = [
  { id: 1, name: 'Mishary Rashid Alafasy', letter: 'M', moshaf: [moshaf(11, 'Hafs')] },
  { id: 2, name: 'Abdul Basit Abdul Samad', letter: 'A', moshaf: [moshaf(21, 'Hafs'), moshaf(22, 'Warsh', '1-50')] },
  { id: 3, name: 'Saad Al-Ghamdi', letter: 'S', moshaf: [moshaf(31, 'Hafs')] },
];
const AR = [
  { id: 1, name: 'مشاري راشد العفاسي', letter: 'م', moshaf: EN[0].moshaf },
  { id: 2, name: 'عبد الباسط عبد الصمد', letter: 'ع', moshaf: EN[1].moshaf },
  { id: 3, name: 'سعد الغامدي', letter: 'س', moshaf: EN[2].moshaf },
];

beforeEach(() => {
  qs.clearQuranCache();
  globalThis.__apiCalls = [];
  globalThis.__api = async (endpoint, params) => ({ reciters: params?.language === 'ar' ? AR : EN });
  globalThis.__lang = {};
  globalThis.__favorites = {};
});

const interaction = (focused, userId = 'u1', guildId = 'g1') => ({
  guildId, user: { id: userId }, options: { getFocused: () => focused },
});

test('findReciter works with English, Arabic and diacritics/variants', async () => {
  assert.equal((await qs.findReciter('Mishary Rashid Alafasy')).id, 1);
  assert.equal((await qs.findReciter('mishary')).id, 1);
  assert.equal((await qs.findReciter('العفاسي')).id, 1);
  assert.equal((await qs.findReciter('عبد الباسط')).id, 2);
  assert.equal(await qs.findReciter('nobody here'), null);
});

test('reciter objects are clones: modifying one never corrupts the shared list', async () => {
  const a = await qs.findReciter('mishary');
  a.moshaf = [];                         // exactly what play.js / recoveryService do
  a.displayName = 'tampered';
  const b = await qs.findReciter('mishary');
  assert.equal(b.moshaf.length, 1);
  assert.equal(b.displayName, 'Mishary Rashid Alafasy');
  assert.notEqual(a, b);
});

test('the merged reciter list is built once per API refresh, not on every search', async () => {
  const before = qs.quranServiceStats.recitersBuilt;
  await qs.searchReciters('a');
  await qs.searchReciters('b');
  await qs.findReciter('mishary');
  await qs.reciterAutocomplete('s');
  assert.equal(qs.quranServiceStats.recitersBuilt - before, 1, 'merged list built once for four lookups');
  assert.equal(globalThis.__apiCalls.length, 2, 'one API request per language (en + ar)');

  qs.clearQuranCache();
  await qs.searchReciters('a');
  assert.equal(qs.quranServiceStats.recitersBuilt - before, 2, 'rebuilt after the cache was refreshed');
});

test('clearing the cache refetches and picks up new data', async () => {
  assert.equal((await qs.searchReciters('')).length, 3);
  globalThis.__api = async (e, p) => ({ reciters: [...(p?.language === 'ar' ? AR : EN), { id: 4, name: 'New Reciter', letter: 'N', moshaf: [moshaf(41, 'Hafs')] }] });
  qs.clearQuranCache();
  assert.equal((await qs.searchReciters('')).length, 4);
});

test('reciterAutocomplete: favourites first with a star; value is always the English name', async () => {
  const choices = await qs.reciterAutocomplete('', { lang: 'en', favorites: ['Saad Al-Ghamdi'] });
  assert.equal(choices[0].name, '⭐ Saad Al-Ghamdi');
  assert.equal(choices[0].value, 'Saad Al-Ghamdi');
  assert.equal(choices.length, 3);
});

test('reciterAutocomplete: Arabic servers see Arabic names too; search accepts either language', async () => {
  const choices = await qs.reciterAutocomplete('العفاسي', { lang: 'ar' });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].name, 'مشاري راشد العفاسي · Mishary Rashid Alafasy');
  assert.equal(choices[0].value, 'Mishary Rashid Alafasy');
});

test('reciterAutocompleteFor reads the guild language and the user\'s favourites', async () => {
  globalThis.__lang = { g1: 'ar' };
  globalThis.__favorites = { 'u1:g1': { reciters: ['Abdul Basit Abdul Samad'] } };
  const choices = await qs.reciterAutocompleteFor(interaction(''));
  assert.match(choices[0].name, /^⭐ عبد الباسط عبد الصمد/);
  assert.equal(choices[0].value, 'Abdul Basit Abdul Samad');
});

test('choices never exceed Discord\'s limits (25 choices, 100 chars)', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, name: `Reciter ${i} ${'x'.repeat(150)}`, letter: 'R', moshaf: [moshaf(i, 'Hafs')] }));
  globalThis.__api = async () => ({ reciters: many });
  qs.clearQuranCache();
  const choices = await qs.reciterAutocomplete('');
  assert.equal(choices.length, 25);
  for (const c of choices) { assert.ok(c.name.length <= 100); assert.ok(c.value.length <= 100); }
});

test('defaultReciterName: the server\'s panel choice, otherwise the configured default (favourites do not decide)', async () => {
  const pop = await import('../src/data/popular.js');
  assert.equal(await qs.defaultReciterName('u1', 'g1'), 'Mishary Rashid Alafasy');
  globalThis.__favorites = { 'u1:g1': { reciters: ['Saad Al-Ghamdi'] } };
  assert.equal(await qs.defaultReciterName('u1', 'g1'), 'Mishary Rashid Alafasy');
  pop.setGuildReciterKey('g1', 'ghamdi');
  assert.equal((await qs.findDefaultReciter('u1', 'g1')).id, 3);
  pop.setGuildReciterKey('g1', 'afasy');
});

test('getRecitersByRiwaya searches ALL reciters (not just the first 25)', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: 200 + i, name: `Reciter ${i}`, letter: 'R', moshaf: [moshaf(i, i === 39 ? 'Qaloon' : 'Hafs')],
  }));
  globalThis.__api = async () => ({ reciters: many });
  qs.clearQuranCache();
  const r = await qs.getRecitersByRiwaya('qaloon');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 239);
});

test('getPlayableUrls: only moshaf variants that contain the surah come first', async () => {
  const reciter = await qs.findReciter('Abdul Basit');
  const urls = await qs.getPlayableUrls(reciter, 80);          // Warsh variant covers only 1-50
  assert.ok(urls.length >= 1);
  assert.equal(urls[0].riwaya, 'Hafs');
  assert.ok(urls[0].url.startsWith('https://'));
  assert.match(urls[0].url, /080\.mp3$/);
});

test('findDefaultReciter: falls back to a close match, then to any reciter, when the default name is not in the API list', async () => {
  // exact default present
  assert.equal((await qs.findDefaultReciter('u1', 'g1')).id, 1);
  // API names it differently → matched on the last word of the default name
  const renamed = [{ id: 7, name: 'Mishari Alafasy', moshaf: [moshaf(71, 'Hafs')] }, EN[1]];
  globalThis.__api = async () => ({ reciters: renamed });
  qs.clearQuranCache();
  assert.equal((await qs.findDefaultReciter('u1', 'g1')).id, 7);
  // nothing resembles it → first reciter that has recitations
  globalThis.__api = async () => ({ reciters: [EN[2]] });
  qs.clearQuranCache();
  assert.equal((await qs.findDefaultReciter('u1', 'g1')).id, 3);
  // service down → null (the button then says the service is not responding)
  globalThis.__api = async () => ({ reciters: [] });
  qs.clearQuranCache();
  assert.equal(await qs.findDefaultReciter('u1', 'g1'), null);
});

test('an owner-hidden reciter is not offered, but still resolves by its exact name (restore / hand-over / saved choice)', async () => {
  qs.setHiddenRecitersSource(() => ['2']);
  try {
    qs.clearQuranCache();
    assert.equal((await qs.searchRecitersFor({ name: 'Basit' })).length, 0, 'not offered by the panel search');
    assert.equal(await qs.findReciter('Abdul Basit'), null, 'a partial name typed by someone does not find a hidden reciter');
    assert.equal((await qs.findReciter('Abdul Basit Abdul Samad')).id, 2);
    assert.equal((await qs.findReciterById('2')).id, 2);
    assert.equal(await qs.findReciter('nobody here'), null);
  } finally { qs.setHiddenRecitersSource(() => null); qs.clearQuranCache(); }
});
