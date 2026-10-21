import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCatalogEntry, buildReciter, isComplete, nameKey, mergeExtraReciters, refreshExtraReciters, getExtraReciters
} from '../src/services/extraReciters.js';

const entry = (name, path, extra = {}) => ({ id: 1, name, arabic_name: '', relative_path: path, file_formats: 'mp3', ...extra });

test('catalogue: plain recitations are kept, Taraweeh / translations / children / duets / years are dropped', () => {
  assert.ok(parseCatalogEntry(entry('Abdullah Basfar', 'abdullaah_basfar/')));
  assert.ok(parseCatalogEntry(entry('Dr. Shawqy Hamed [Murattal]', 'dr.shawqy_7amed/murattal/')));
  for (const [n, p] of [
    ['Makkah Taraweeh 1428', 'makkah_1428/'],
    ['Muhammad Ayyoob [Taraweeh]', 'muhammad_ayyoob_hq/'],
    ['Mishari ibn Rashid al-`Afasy with Saabir [Muhsin Khan Translation]', 'mishaari_with_saabir_mkhan/'],
    ['Mahmoud Khalil Al-Husary (with Children)', 'husary_muallim_kids_repeat/'],
    ['Mahmoud Khalil Al-Husary (Muallam)', 'husary_muallim/'],
    ['Maher al-Muaiqly [Assorted]', 'maher_almu3aiqly/year1424-1425/'],
    ['Maher al-Muaiqly [1422-1423]', 'maher_almu3aiqly/year1422-1423/'],
    ['Sudais and Shuraym [Urdu Translation]', 'sudais_and_shuraim_with_urdu/'],
    ['Adel Kalbani', 'adel_kalbani_1437/']
  ]) assert.equal(parseCatalogEntry(entry(n, p)), null, n);
});

test('catalogue: unsafe or missing paths and non-mp3 entries are refused', () => {
  assert.equal(parseCatalogEntry(entry('X Y', '../etc/')), null);
  assert.equal(parseCatalogEntry(entry('X Y', '/abs/')), null);
  assert.equal(parseCatalogEntry(entry('X Y', 'a b/')), null);
  assert.equal(parseCatalogEntry(entry('X Y', 'ok/', { file_formats: 'flac' })), null);
  assert.equal(parseCatalogEntry(null), null);
  assert.equal(parseCatalogEntry(entry('', 'ok/')), null);
});

test('narrations and styles are named like MP3Quran names them, so the narration search finds them', () => {
  assert.match(parseCatalogEntry(entry('AbdulBaset AbdulSamad [Warsh]', 'abdulbaset_warsh/')).moshafName, /Warsh/);
  assert.match(parseCatalogEntry(entry('Ali al-Huthaify [Qaloon]', 'huthayfi_qaloon/')).moshafName, /Qalon/);
  assert.match(parseCatalogEntry(entry('Abdur-Rashid Sufi [Soosi]', 'abdurrashid_sufi_soosi_rec/')).moshafName, /Soosi/);
  assert.match(parseCatalogEntry(entry('Abdur-Rashid Sufi [Shu\'bah an Asim]', 'abdurrashid_sufi_shu3ba/')).moshafName, /Shu'bah/);
  assert.match(parseCatalogEntry(entry('AbdulBaset AbdulSamad [Mujawwad]', 'abdulbaset_mujawwad/')).moshafName, /Hafs.*Mujawwad/);
  assert.match(parseCatalogEntry(entry('Abdullah Basfar', 'abdullaah_basfar/')).moshafName, /Hafs/);
});

test('the reciter has the shape of an MP3Quran one: text id, server + 001.mp3 works, all 114 surahs', () => {
  const r = buildReciter(parseCatalogEntry(entry('Abdullah Basfar', 'abdullaah_basfar/', { id: 2, arabic_name: 'عبدالله بصفر' })));
  assert.equal(r.id, 'qa2');
  assert.equal(r.arabicName, 'عبدالله بصفر');
  assert.equal(r.moshaf[0].server, 'https://download.quranicaudio.com/quran/abdullaah_basfar/');
  assert.equal(r.moshaf[0].surah_list, '1-114');
  assert.equal(structuredClone(r).id, 'qa2');
});

test('complete = every probe surah exists; one missing file rejects the reciter', async () => {
  const seen = [];
  const ok  = { head: async (u) => { seen.push(u); return { status: 200 }; } };
  assert.equal(await isComplete(ok, 'https://h/q/'), true);
  assert.ok(seen.includes('https://h/q/001.mp3') && seen.includes('https://h/q/114.mp3'));
  const missing = { head: async (u) => ({ status: u.endsWith('/067.mp3') ? 404 : 200 }) };
  assert.equal(await isComplete(missing, 'https://h/q/'), false);
  const down = { head: async () => { throw new Error('net'); } };
  assert.equal(await isComplete(down, 'https://h/q/'), false);
});

test('name keys: the same person under different spellings matches, different people do not', () => {
  assert.equal(nameKey('مشاري راشد العفاسي'), nameKey('مشاري العفاسي'));
  assert.equal(nameKey('أبو بكر الشاطرى'), nameKey('أبو بكر الشاطري'));
  assert.notEqual(nameKey('سعود الشريم'), nameKey('عبدالرحمن السديس'));
  assert.equal(nameKey('Mishari'), '');                 // one short word is not enough to call two reciters the same
});

const base = (over) => ({ id: 1, name: 'Saad Al-Ghamdi', englishName: 'Saad Al-Ghamdi', arabicName: 'سعد الغامدي', displayName: 'Saad Al-Ghamdi',
  moshaf: [{ id: 1, name: "Rewayat Hafs A'n Assem - Murattal", server: 'https://s/', surah_list: '1-114' }], ...over });
const extra = (name, ar, moshafName) => buildReciter({ id: 9, englishName: name, arabicName: ar, server: 'https://download.quranicaudio.com/quran/x/', moshafName });

test('merge: a new reciter is added at the end; the base list and its reciters are never modified', () => {
  const b = [base()];
  const snapshot = JSON.stringify(b);
  const out = mergeExtraReciters(b, [extra('Hatem Farid', 'حاتم فريد الواعر', HAFS_M)]);
  assert.equal(out.length, 2);
  assert.equal(out[1].englishName, 'Hatem Farid');
  assert.equal(JSON.stringify(b), snapshot);
  assert.equal(mergeExtraReciters(b, []), b);
  assert.equal(mergeExtraReciters(b, undefined), b);
});
const HAFS_M = "Rewayat Hafs A'n Assem";

test('merge: a reciter MP3Quran already has is not duplicated — it only gains a narration it lacks', () => {
  const b = [base()];
  assert.equal(mergeExtraReciters(b, [extra('Saad al-Ghamdi', 'سعد بن سعيد الغامدي', HAFS_M)]).length, 1);             // same recitation: skipped
  assert.equal(mergeExtraReciters(b, [extra('Saad al-Ghamdi', 'سعد الغامدي', HAFS_M)])[0].moshaf.length, 1);
  const warsh = mergeExtraReciters(b, [extra('Saad al-Ghamdi', 'سعد الغامدي', "Rewayat Warsh A'n Nafi'")]);
  assert.equal(warsh.length, 1);
  assert.equal(warsh[0].moshaf.length, 2);                                                                              // new narration added
  assert.equal(b[0].moshaf.length, 1);                                                                                  // base untouched
});

test('refresh: keeps only complete reciters, caches nothing when the cache is off, never throws', async () => {
  const catalogue = [
    { id: 1, name: 'Abdullah Basfar', arabic_name: 'عبدالله بصفر', relative_path: 'ok/', file_formats: 'mp3' },
    { id: 2, name: 'Partial Reciter', arabic_name: '', relative_path: 'partial/', file_formats: 'mp3' },
    { id: 3, name: 'Makkah Taraweeh 1430', arabic_name: '', relative_path: 'makkah_1430/', file_formats: 'mp3' }
  ];
  const http = {
    get: async () => ({ data: catalogue }),
    head: async (u) => ({ status: u.includes('/partial/') && u.endsWith('/002.mp3') ? 404 : 200 })
  };
  assert.deepEqual([...getExtraReciters()], []);
  assert.equal(await refreshExtraReciters({ http, cacheFile: null }), true);
  assert.deepEqual(getExtraReciters().map(r => r.englishName), ['Abdullah Basfar']);

  const before = getExtraReciters();
  const broken = { get: async () => { throw new Error('down'); }, head: async () => ({ status: 200 }) };
  assert.equal(await refreshExtraReciters({ http: broken, cacheFile: null }), false);   // keeps the previous list
  assert.equal(getExtraReciters(), before);
});
