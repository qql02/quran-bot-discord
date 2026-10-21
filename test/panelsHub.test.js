import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { COMMAND_ORDER } from '../src/data/commandOrder.js';
import { FEATURES, FEATURE_KEYS } from '../src/utils/botControl.js';
import {
  defaultReciterQuery, setGuildReciterKey, setGuildCustomReciter, getGuildCustomReciter, getGuildReciterKey, riwayaToken
} from '../src/data/popular.js';

const tools = await import('../src/panels/playerTools.js');
const { buildPanelSelects, buildBigPanelButtons, RECITER_SEARCH_VALUE } = await import('../src/utils/buttons.js');

const rowsOf = (payload) => payload.components.map(r => r.toJSON().components);
const flat = (payload) => rowsOf(payload).flat();

test('the commands: the panels plus /recite and the playback controls', () => {
  assert.deepEqual([...COMMAND_ORDER], ['start', 'recite', 'khatma', 'live', 'memorize', 'sleep', 'hold', 'continue', 'next', 'leave', 'pull', 'volume', 'now', 'queue', 'clearqueue', 'mushaf', 'azkar', 'journey', 'hadith', 'hijri', 'stats', 'invite', 'setup', 'help', 'guide', 'cleardm', 'owner']);
  for (const f of Object.values(FEATURES)) for (const c of f.commands) assert.ok(COMMAND_ORDER.includes(c), `feature names a command that does not exist: ${c}`);
});

test('tools menu: seven tools, and every id the tools screens use is one the router handles', () => {
  const home = tools.toolsHome('ar', null, 'g1');
  const menu = flat(home)[0];
  assert.equal(menu.custom_id, 'panel:tool');
  assert.deepEqual(menu.options.map(o => o.value), ['mem', 'sleep', 'radio', 'reciter', 'fav', 'pull', 'clearq']);

  const screens = [
    tools.memorizeScreen('ar'), tools.memorizeScreen('en', 10, 2), tools.sleepScreen('ar', null),
    tools.sleepScreen('ar', { sleepTimer: 'end_of_track', current: { isRadio: false } }),
    tools.radioScreen('ar', [{ label: 'x', value: 's:' + 'a'.repeat(24) }]), tools.reciterScreen('en', 'g1', []),
    tools.reciterScreen('ar', 'g1', [{ id: 1, name: 'A', englishName: 'A', arabicName: 'أ' }]),
    tools.favoritesScreen('ar', { surahs: [1, 2], reciters: ['R'] }, { current: { surah: { number: 1 }, reciter: 'R' } })
  ];
  for (const sc of screens) {
    for (const c of flat(sc)) {
      const id = c.custom_id;
      assert.match(id, /^panel:/, id);
      assert.ok(tools.TOOL_ACTIONS.has(id.split(':')[1]), `unrouted: ${id}`);
      for (const o of c.options ?? []) assert.ok(o.label.length <= 100 && o.value.length <= 100);
      assert.ok((c.options ?? []).length <= 25);
    }
  }
});

test('memorize screen: the chosen repetitions travel in the surah menu id, and paging keeps them', () => {
  const [repRow, surahRow] = rowsOf(tools.memorizeScreen('ar', 20, 1));
  assert.equal(surahRow[0].custom_id, 'panel:mem_go:20:1');
  assert.equal(repRow[0].custom_id, 'panel:mem_rep:1');
  assert.deepEqual(repRow[0].options.map(o => o.value), tools.REPEAT_CHOICES.map(String));
  assert.equal(tools.memorizeScreen('ar', 999).components.length, 3);                     // an unknown value falls back, never throws
  assert.equal(rowsOf(tools.memorizeScreen('ar', 999))[1][0].custom_id, 'panel:mem_go:5:0');
});

test('sleep screen: no "end of surah" for live radio, "cancel" only while a timer runs', () => {
  const values = (s) => flat(s)[0].options.map(o => o.value);
  assert.deepEqual(values(tools.sleepScreen('ar', null)), ['10', '30', '60', 'end']);
  assert.deepEqual(values(tools.sleepScreen('ar', { current: { isRadio: true }, sleepTimer: 5 })), ['10', '30', '60', 'cancel']);
});

test('a reciter outside the short list: remembered per server, replaces the short-list pick, and is undone by it', () => {
  assert.equal(getGuildCustomReciter('gc'), null);
  setGuildReciterKey('gc', 'sudais');
  setGuildCustomReciter('gc', '  Mahmoud Khalil Al-Hussary ');
  assert.equal(getGuildCustomReciter('gc'), 'Mahmoud Khalil Al-Hussary');
  assert.equal(getGuildReciterKey('gc'), null);
  assert.equal(defaultReciterQuery('gc'), 'Mahmoud Khalil Al-Hussary');
  setGuildReciterKey('gc', 'maher');
  assert.equal(getGuildCustomReciter('gc'), null);
  assert.equal(defaultReciterQuery('gc'), 'muaiqly');
  setGuildCustomReciter('gc', '   ');                                                      // blank is ignored
  assert.equal(getGuildCustomReciter('gc'), null);
});

test('the panel reciter menu ends with the search entry and the placeholder shows a searched reciter', () => {
  setGuildCustomReciter('gs', 'Some Reciter');
  const menu = buildPanelSelects('en', 'gs', 0)[1].toJSON().components[0];
  assert.equal(menu.options.at(-1).value, RECITER_SEARCH_VALUE);
  assert.ok(menu.options.length <= 25);
  assert.ok(menu.placeholder.includes('Some Reciter'));
});

test('narration search words: Arabic and English names reach the English moshaf names', () => {
  assert.equal(riwayaToken('ورش'), 'warsh');
  assert.equal(riwayaToken('Hafs'), 'hafs');
  assert.equal(riwayaToken('  '), '');
  assert.equal(riwayaToken('Qalon'), 'qalon');
});

test('panel buttons: the idle card and the live card both offer the tools', () => {
  const ids = (rows) => rows.flatMap(r => r.toJSON().components.map(c => c.custom_id));
  assert.ok(ids(buildBigPanelButtons(null, 'ar')).includes('panel:more'));
  assert.ok(ids(buildBigPanelButtons({ status: 'playing', queue: [], current: {} }, 'ar')).includes('panel:more'));
});

test('every custom-id family used by the panels has a router, and the owner switches cover them', () => {
  const known = new Set(['panel', 'hub', 'adhkar', 'events', 'stations', 'menu', 'setup', 'queue', 'wird', 'mushaf', 'lang']);
  const used = new Set();
  for (const dir of ['src/panels/', 'src/utils/buttons.js']) {
    const files = dir.endsWith('/') ? readdirSync(dir).map(f => dir + f) : [dir];
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/setCustomId\(\s*[`'"]([a-z]+):/g)) used.add(m[1]);
  }
  for (const ns of used) assert.ok(known.has(ns), `unknown id family: ${ns}`);
  const router = readFileSync('src/events/interactionCreate.js', 'utf8');
  for (const p of ['hub:', 'adhkar:', 'events:', 'stations:', 'menu:']) assert.ok(router.includes(`prefix: '${p}'`), p);
  const prefixes = FEATURE_KEYS.flatMap(k => FEATURES[k].prefixes);
  for (const p of ['panel:', 'adhkar:', 'events:', 'stations:', 'setup:']) assert.ok(prefixes.includes(p), p);
});

test('the /setup home menu pages all map to a real owner feature (or none)', async () => {
  const { SECTION_FEATURE } = await import('../src/panels/hub.js');
  for (const f of Object.values(SECTION_FEATURE)) assert.ok(FEATURE_KEYS.includes(f), f);
});

test('the radio menu accepts what stationChoices() really returns ({ name, value }), not only { label, value }', async () => {
  const tools = await import('../src/panels/playerTools.js');
  assert.doesNotThrow(() => tools.radioScreen('en', [{ name: '📻 Quran Radio', value: '12' }, { name: '🏠 Mine', value: 's:' + 'a'.repeat(24) }]));
});
