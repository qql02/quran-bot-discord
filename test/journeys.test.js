import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNEYS, TAFSIRS, getTafsir, getJourney, randomJourney } from '../src/data/journeys.js';
import { SURAHS } from '../src/data/surahs.js';
import { parseRef } from '../src/data/ayahs.js';
import { searchJourneys, stepPayload, finishPayload } from '../src/commands/journey.js';

test('every journey: unique short id, 3–6 steps, real verse references, both languages', () => {
  assert.ok(JOURNEYS.length >= 6);
  assert.equal(new Set(JOURNEYS.map(j => j.id)).size, JOURNEYS.length);
  for (const j of JOURNEYS) {
    assert.match(j.id, /^[a-z]{2,12}$/, j.id);
    assert.ok(j.ar && j.en && j.descAr && j.descEn && j.icon, j.id);
    assert.ok(j.steps.length >= 3 && j.steps.length <= 6, j.id);
    const refs = j.steps.map(s => s.ref);
    assert.equal(new Set(refs).size, refs.length, `${j.id}: repeated verse`);
    for (const s of j.steps) {
      const r = parseRef(s.ref);
      assert.ok(r, `${j.id} ${s.ref}`);
      assert.ok(r.ayah <= SURAHS[r.surah - 1].ayahs, `${j.id} ${s.ref} is past the end of the surah`);
      assert.ok(s.ar.length > 10 && s.en.length > 10, `${j.id} ${s.ref} reflection`);
    }
  }
});

test('search: by Arabic or English words, diacritics ignored; empty → all; no match → none', () => {
  assert.equal(searchJourneys('').length, JOURNEYS.length);
  assert.ok(searchJourneys('صبر').some(j => j.id === 'sabr'));
  assert.ok(searchJourneys('gratitude').some(j => j.id === 'shukr'));
  assert.ok(searchJourneys('التَّوْبَة').some(j => j.id === 'tawba'));
  assert.equal(searchJourneys('zzzzqq').length, 0);
});

test('randomJourney never repeats the one just done', () => {
  for (let i = 0; i < 50; i++) assert.notEqual(randomJourney('sabr').id, 'sabr');
  assert.equal(randomJourney(null, () => 0).id, JOURNEYS[0].id);
});

const verse = { ref: '2:153', surah: 2, ayah: 153, surahName: 'البقرة', text: 'نص الآية', tafsir: 'ت'.repeat(3000), page: 23 };

test('step screen: embed fits Discord limits, buttons have unique ids ≤ 100 chars and the right owner', () => {
  const j = getJourney('sabr');
  for (const lang of ['ar', 'en']) for (let i = 0; i < j.steps.length; i++) {
    const p = stepPayload(j, i, '123456789012345678', verse, lang);
    const e = p.embeds[0].toJSON();
    assert.ok(e.title.length <= 256 && e.description.length <= 4096);
    assert.ok(e.fields.length === 3 && e.fields.every(f => f.value.length <= 1024 && f.value.length > 0));
    const ids = p.components.flatMap(r => r.toJSON().components.map(c => c.custom_id));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => id.length <= 100 && id.startsWith('journey:') && id.endsWith(':123456789012345678:mu')));
    const [prev, , , next] = p.components.flatMap(r => r.toJSON().components);
    assert.equal(prev.disabled === true, i === 0);
    assert.ok(next.custom_id.includes(`:${i + 1}:`));
  }
});

test('step screen without a known page disables save / open (never a dead button that errors)', () => {
  const p = stepPayload(getJourney('hope'), 0, '1', { ...verse, page: null }, 'ar');
  const comps = p.components.flatMap(r => r.toJSON().components);
  assert.deepEqual(comps.filter(c => c.disabled).map(c => c.custom_id.split(':')[1]).sort(), ['open', 'save']);
});

test('closing screen lists every verse and offers repeat + another journey', () => {
  const j = getJourney('tawakkul');
  const p = finishPayload(j, '1', 'ar');
  assert.equal(p.embeds[0].toJSON().description.split('•').length - 1, j.steps.length);
  assert.deepEqual(p.components[0].toJSON().components.map(c => c.custom_id.split(':')[1]), ['go', 'new']);
});

test('tafsir choices: short unique keys, API-looking editions, unknown key → the default', () => {
  assert.equal(new Set(TAFSIRS.map(t => t.key)).size, TAFSIRS.length);
  for (const t of TAFSIRS) { assert.match(t.key, /^[a-z]{2}$/); assert.match(t.edition, /^[a-z]{2}\.[a-z]{3,20}$/); }
  assert.equal(TAFSIRS[0].edition, 'ar.muyassar');
  assert.equal(getTafsir('zz').key, 'mu');
  assert.equal(getTafsir(undefined).key, 'mu');
  const p = stepPayload(getJourney('sabr'), 1, '1', { text: 'x', tafsir: 'y', ayah: 1, surahName: 'ب', page: 2 }, 'ar', 'jl');
  assert.equal(p.embeds[0].toJSON().fields[0].name, 'تفسير الجلالين');
  assert.ok(p.components.flatMap(r => r.toJSON().components).filter(c => c.custom_id).every(c => c.custom_id.endsWith(':jl')));
});
