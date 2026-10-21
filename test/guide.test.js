import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { GUIDE_TOPICS, GUIDE_KEYS, guideTopic } from '../src/data/guideText.js';
import { COMMAND_ORDER } from '../src/data/commandOrder.js';
import * as guideModule from '../src/panels/guide.js';
import { guideHome, GUIDE_MENU_ID } from '../src/panels/guide.js';

test('every topic has Arabic and English text that fits one embed and one menu option', () => {
  assert.ok(GUIDE_TOPICS.length >= 2 && GUIDE_TOPICS.length <= 25, 'a select menu holds at most 25 options');
  assert.equal(new Set(GUIDE_KEYS).size, GUIDE_KEYS.length, 'unique keys');
  for (const t of GUIDE_TOPICS) {
    for (const l of ['ar', 'en']) {
      const x = t[l];
      assert.ok(x?.label && x.desc && x.body, `${t.key}/${l}`);
      assert.ok(x.label.length <= 100 && x.desc.length <= 100, `${t.key}/${l} label/description over 100`);
      assert.ok(x.body.length <= 1800, `${t.key}/${l} body is ${x.body.length} chars (limit 1800, an embed allows 4096)`);
    }
  }
});

test('every slash command of the bot (except the owner one) is explained in the guide, in both languages', () => {
  const files = readdirSync(new URL('../src/commands/', import.meta.url));
  const names = files.map(f => readFileSync(new URL(`../src/commands/${f}`, import.meta.url), 'utf8').match(/new SlashCommandBuilder\(\)\s*\.setName\('([^']+)'\)/)?.[1]).filter(Boolean);
  assert.deepEqual([...names].sort(), [...COMMAND_ORDER].sort());
  const all = { ar: GUIDE_TOPICS.map(t => t.ar.body).join('\n'), en: GUIDE_TOPICS.map(t => t.en.body).join('\n') };
  for (const n of COMMAND_ORDER.filter(n => !['owner', 'test'].includes(n))) {
    for (const l of ['ar', 'en']) assert.ok(all[l].includes(`/${n}`), `/${n} is not mentioned in the ${l} guide`);
  }
});

test('the guide never mentions a command that no longer exists', () => {
  const text = GUIDE_TOPICS.map(t => t.ar.body + t.en.body).join('\n');
  for (const gone of ['/riwaya', '/upnext', '/panel', '/wird', '/favorites', '/stations', '/language', '/adhkar', '/events', '/donation']) {
    assert.ok(!text.includes(gone), `${gone} was removed`);
  }
});

const menuOf = (payload) => payload.components[0].toJSON().components[0];   // the stubbed discord.js keeps the menu's data

test('guideHome in DMs: the menu id carries the language and the prefix is filled in', () => {
  const { GUIDE_DM_PREFIX } = guideModule;
  for (const lang of ['ar', 'en']) {
    const home = guideHome(lang, 'dm', { dm: true });
    assert.ok(home.embeds[0].data.setTitle.includes(lang === 'ar' ? 'الخاص' : 'DMs'), 'the dm topic exists');
    assert.equal(menuOf(home).custom_id, `${GUIDE_DM_PREFIX}${lang}`);
    assert.ok(!home.embeds[0].data.setDescription.includes('{prefix}'), 'placeholder replaced');
  }
});

test('guideHome: the chosen topic is shown and marked, an unknown key falls back to the first', () => {
  for (const lang of ['ar', 'en']) {
    const home = guideHome(lang, 'radio');
    assert.equal(home.components.length, 1);
    const menu = menuOf(home);
    assert.equal(menu.custom_id, GUIDE_MENU_ID);
    assert.equal(menu.options.length, GUIDE_TOPICS.length);
    assert.deepEqual(menu.options.filter(o => o.default).map(o => o.value), ['radio']);
    assert.equal(menuOf(guideHome(lang, 'nope')).options.find(o => o.default).value, GUIDE_KEYS[0]);
  }
  assert.equal(guideTopic('nope').key, GUIDE_KEYS[0]);
});
