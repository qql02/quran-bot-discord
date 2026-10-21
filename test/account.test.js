import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDm, suggestCommand, DM_HELP, DM_HELP_SECTIONS } from '../src/utils/dmCommands.js';
import { parseSetting, parseForget } from '../src/utils/personal.js';
import { collectAccountData, eraseAccountData, resetSettings, buildExport, isEmptyAccount } from '../src/services/accountData.js';
import { dataEmbed, settingsEmbed, listEmbed, forgetEmbed } from '../src/utils/accountUi.js';

// A fake database that records every filter it is asked with.
function fakeModels(seed = {}) {
  const calls = [];
  const model = (name, one) => ({
    findOne: (f) => { calls.push([name, 'findOne', f]); return { lean: async () => seed[name] ?? null }; },
    find: (f) => { calls.push([name, 'find', f]); return { lean: async () => (seed[name] ? [].concat(seed[name]) : []) }; },
    deleteOne: async (f) => { calls.push([name, 'deleteOne', f]); },
    deleteMany: async (f) => { calls.push([name, 'deleteMany', f]); },
    updateOne: async (f, u) => { calls.push([name, 'updateOne', f, u]); },
    one
  });
  return { calls, models: { PersonalList: model('PersonalList'), MushafPref: model('MushafPref'), WirdSubscription: model('WirdSubscription'), Favorites: model('Favorites') } };
}

const FULL = {
  PersonalList: { userId: 'u1', pages: [3, 45], verses: ['2:255'], lang: 'en' },
  MushafPref: { userId: 'u1', view: 'hafs' },
  WirdSubscription: { userId: 'u1', guildId: 'G-SECRET', active: true, expiresAt: new Date(Date.now() + 10 * 864e5), startedAt: new Date(), pagesPerDay: 2, timezone: 'Asia/Riyadh', remindTime: '20:00', remindMode: 'fixed', currentPage: 12, khatmaCount: 1, streak: 4, failCount: 3 },
  Favorites: [{ userId: 'u1', guildId: 'G1', reciters: ['a', 'b'], surahs: [1] }, { userId: 'u1', guildId: 'G2', reciters: [], surahs: [] }]
};

test('the account commands parse in both languages', () => {
  for (const [t, n] of [['!بياناتي', 'data'], ['!mydata', 'data'], ['!حسابي', 'data'], ['!تصدير', 'export'], ['!export', 'export'], ['!انسني', 'forget'], ['!forget all confirm', 'forget']])
    assert.equal(parseDm(t, '!').name, n, t);
});

test('a mistyped command suggests the nearest real one', () => {
  assert.equal(suggestCommand('settngs', 'en'), 'settings');
  assert.equal(suggestCommand('mydat', 'en'), 'mydata');
  assert.equal(suggestCommand('بياناتى', 'ar'), 'بياناتي');
  assert.equal(suggestCommand('zzzzzz', 'en'), null);
  assert.equal(suggestCommand('x', 'en'), null);
  assert.equal(suggestCommand('recite', 'en'), null, 'voice words are never suggested');
});

test('settings reset and the forget scopes parse', () => {
  for (const w of ['reset', 'اعادة', 'افتراضي']) assert.deepEqual(parseSetting(w), { key: 'reset' }, w);
  assert.deepEqual(parseForget(''), { confirm: false, scope: 'personal' });
  assert.deepEqual(parseForget('confirm'), { confirm: true, scope: 'personal' });
  assert.deepEqual(parseForget('تأكيد'), { confirm: true, scope: 'personal' });
  assert.deepEqual(parseForget('all confirm'), { confirm: true, scope: 'all' });
  assert.deepEqual(parseForget('الكل تأكيد'), { confirm: true, scope: 'all' });
  assert.deepEqual(parseForget('all'), { confirm: false, scope: 'all' }, 'all alone confirms nothing');
});

test('collect reads everything by the member id only', async () => {
  const { models, calls } = fakeModels(FULL);
  const d = await collectAccountData('u1', models);
  assert.deepEqual(d.favorites, { servers: 1, reciters: 2, surahs: 1 }, 'a server with empty favourites is not counted');
  for (const c of calls) assert.deepEqual(c[2], { userId: 'u1' }, c.join());
  assert.equal(isEmptyAccount(d), false);
  assert.equal(isEmptyAccount(await collectAccountData('u2', fakeModels().models)), true);
});

test('delete: personal keeps the wird subscription, all removes it; always by member id', async () => {
  let f = fakeModels(FULL);
  await eraseAccountData('u1', 'personal', f.models);
  assert.deepEqual(f.calls.map(c => `${c[0]}.${c[1]}`).sort(), ['Favorites.deleteMany', 'MushafPref.deleteOne', 'PersonalList.deleteOne']);
  f = fakeModels(FULL);
  await eraseAccountData('u1', 'all', f.models);
  assert.ok(f.calls.some(c => c[0] === 'WirdSubscription' && c[1] === 'deleteOne'));
  for (const c of f.calls) assert.deepEqual(c[2], { userId: 'u1' });
});

test('reset clears the language and the view but keeps the saved list', async () => {
  const f = fakeModels(FULL);
  await resetSettings('u1', f.models);
  const upd = f.calls.find(c => c[1] === 'updateOne');
  assert.deepEqual(upd[3].$unset, { lang: 1 });
  assert.ok(!('pages' in (upd[3].$set ?? {})) && !('$unset' in upd[3] && 'pages' in upd[3].$unset));
  assert.ok(f.calls.some(c => c[0] === 'MushafPref' && c[1] === 'deleteOne'));
  assert.ok(!f.calls.some(c => c[0] === 'PersonalList' && c[1] === 'deleteOne'));
});

test('the export has no server ids and no delivery bookkeeping', async () => {
  const d = await collectAccountData('u1', fakeModels(FULL).models);
  const json = JSON.stringify(buildExport('u1', d));
  assert.ok(!json.includes('G-SECRET') && !json.includes('G1') && !json.includes('guildId') && !json.includes('failCount'));
  const out = JSON.parse(json);
  assert.deepEqual(out.personalList, { pages: [3, 45], verses: ['2:255'] });
  assert.equal(out.settings.mushafView, 'hafs');
  assert.equal(out.wird.currentPage, 12);
  assert.equal(JSON.parse(JSON.stringify(buildExport('u2', await collectAccountData('u2', fakeModels().models)))).wird, null);
});

test('the embeds show real numbers, in both languages, and name the exact confirm words', async () => {
  const d = await collectAccountData('u1', fakeModels(FULL).models);
  for (const lang of ['ar', 'en']) {
    for (const e of [dataEmbed(d, lang, '!'), settingsEmbed(d, lang, '!'), listEmbed(d.list, lang, '!'), forgetEmbed(d, lang, '!')]) {
      const text = JSON.stringify(e.data);
      assert.ok(!/undefined|NaN|\[object/.test(text), `${lang}: ${text}`);
    }
  }
  assert.match(JSON.stringify(forgetEmbed(d, 'en', '!').data), /!forget confirm/);
  assert.match(JSON.stringify(forgetEmbed(d, 'ar', '!').data), /!انسني الكل تأكيد/);
  assert.match(JSON.stringify(dataEmbed(d, 'en', '!').data), /2 page\(s\) · 1 verse\(s\)/);
});

test('help: grouped, complete in Arabic too, only the given prefix', () => {
  for (const lang of ['ar', 'en']) {
    const sections = DM_HELP_SECTIONS[lang]('?');
    assert.equal(sections.length, 4);
    for (const s of sections) assert.ok(s.value.length > 0 && s.value.length <= 1024, s.name);
    const text = DM_HELP[lang]('?');
    assert.ok(!text.includes('!') && !text.includes('/recite'));
  }
  assert.match(DM_HELP.ar('?'), /\?بياناتي/);
  assert.match(DM_HELP.ar('?'), /\?انسني/, 'the Arabic help now lists the personal commands too');
});

test('the account code stays out of servers and voice', () => {
  for (const f of ['../src/services/accountData.js', '../src/utils/accountUi.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of ['GuildSettings', 'sessionManager', 'voice', 'joinVoice', 'guilds.cache', 'guildId: ', '{ guildId']) assert.ok(!src.includes(bad), `${f} must not reference ${bad}`);
  }
});

import { createConsent, CONSENT_TTL_MS } from '../src/utils/consent.js';

test('consent: a "yes" counts once, only after the screen was shown, and only while fresh', () => {
  let t = 1000;
  const c = createConsent({ now: () => t });
  assert.equal(c.take('u1', 'export'), false, 'confirming blind does nothing');
  c.ask('u1', 'export');
  assert.equal(c.take('u2', 'export'), false, 'another member cannot use it');
  assert.equal(c.take('u1', 'forget'), false, 'another action cannot use it');
  assert.equal(c.take('u1', 'export'), true);
  assert.equal(c.take('u1', 'export'), false, 'single use');
  c.ask('u1', 'forget'); t += CONSENT_TTL_MS + 1;
  assert.equal(c.take('u1', 'forget'), false, 'expired');
  for (let i = 0; i < 6000; i++) c.ask(`m${i}`, 'export');
  assert.ok(c.size <= 5000, 'bounded');
});

test('settings words are own properties only ("constructor", "__proto__" are not settings)', () => {
  for (const a of ['constructor', 'lang constructor', 'view __proto__', 'toString x', '__proto__ en', 'lang toString']) {
    const r = parseSetting(a);
    assert.ok(r?.error, a);
  }
  assert.equal(parseSetting('lang en').value, 'en');
});

test('what the member typed is cleaned before it is echoed back', () => {
  const c = parseDm('!`[x](http://evil.example)@everyone', '!');
  assert.equal(c.known, false);
  assert.match(c.typed, /^[\p{L}\p{N}]*$/u);
  assert.ok(!c.typed.includes('@') && !c.typed.includes('`') && !c.typed.includes('['));
});

test('deleting reports a partial failure instead of claiming success', async () => {
  const f = fakeModels(FULL);
  f.models.Favorites.deleteMany = async () => { throw new Error('db down'); };
  assert.deepEqual(await eraseAccountData('u1', 'personal', f.models), { scope: 'personal', failed: 1 });
  assert.equal((await eraseAccountData('u1', 'personal', fakeModels(FULL).models)).failed, 0);
});

test('the private-chat handler gates sending and deleting behind the consent screen, and checks the channel type', () => {
  const mc = readFileSync(new URL('../src/events/messageCreate.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.match(mc, /consent\.take\(userId, 'export'\)/);
  assert.match(mc, /consent\.take\(userId, 'forget'\)/);
  assert.match(mc, /isDMBased/);
  assert.ok(mc.indexOf("consent.take(userId, 'export')") < mc.indexOf('AttachmentBuilder(Buffer'), 'the file is built only after consent');
  assert.equal(CONSENT_TTL_MS, 120_000, 'the Arabic text says two minutes');
});

import { GUIDE_TOPICS } from '../src/data/guideText.js';

test('the guide and the DM help mention every private-chat command, in both languages', () => {
  const src = readFileSync(new URL('../src/utils/dmCommands.js', import.meta.url), 'utf8');
  const defs = [...src.matchAll(/\{ name: '(\w+)',\s+ar: \[([^\]]*)\],\s+en: \[([^\]]*)\]/g)];
  assert.ok(defs.length >= 18, 'the definitions were found');
  const guide = { ar: GUIDE_TOPICS.filter(t => ['dm', 'account'].includes(t.key)).map(t => t.ar.body).join('\n'), en: GUIDE_TOPICS.filter(t => ['dm', 'account'].includes(t.key)).map(t => t.en.body).join('\n') };
  const help = { ar: DM_HELP.ar('{p}'), en: DM_HELP.en('{p}') };
  for (const [, name, ar, en] of defs) {
    const first = (list) => list.split(',')[0].trim().replace(/'/g, '');
    for (const [lang, word] of [['ar', first(ar)], ['en', first(en)]]) {
      // an alias of the same command may be the one written (e.g. the plural / long form), so accept any of the names
      const names = (lang === 'ar' ? ar : en).split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
      assert.ok(names.some(n => guide[lang].includes(`{prefix}${n}`)), `guide/${lang} does not mention ${name} (${word})`);
      assert.ok(names.some(n => help[lang].includes(`{p}${n}`)), `help/${lang} does not mention ${name} (${word})`);
    }
  }
});
