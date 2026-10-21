import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRef, addPage, addVerse, combined, removeNumber, describeItem, MAX_ITEMS } from '../src/utils/personal.js';
import { parseDm } from '../src/utils/dmCommands.js';
import { readFileSync } from 'node:fs';

test('verse references are checked against the real verse counts', () => {
  assert.equal(normalizeRef('2:255'), '2:255');
  assert.equal(normalizeRef('٢:٢٥٥'), '2:255');
  assert.equal(normalizeRef('2 255'), '2:255');
  for (const bad of ['2:287', '115:1', '0:1', '1:0', 'x', '', '2:', '1:8', '2:255:1']) assert.equal(normalizeRef(bad), null, bad);
});

test('pages and verses: add, duplicate, cap, order', () => {
  let d = addPage({}, 45); assert.equal(d.status, 'added');
  d = addPage(d, 3); assert.deepEqual(d.pages, [3, 45]);
  assert.equal(addPage(d, 45).status, 'exists');
  assert.equal(addPage(d, 605).status, 'invalid');
  d = addVerse(d, '2:255'); d = addVerse(d, '1:1'); assert.deepEqual(d.verses, ['1:1', '2:255']);
  const full = { pages: Array.from({ length: MAX_ITEMS }, (_, i) => i + 1), verses: [] };
  assert.equal(addPage(full, 500).status, 'full');
});

test('numbering is pages first, then verses; removal by number; bad numbers change nothing', () => {
  const d = { pages: [3, 45], verses: ['2:255'] };
  assert.equal(combined(d).length, 3);
  assert.deepEqual(removeNumber(d, 2).pages, [3]);
  assert.deepEqual(removeNumber(d, '٣').verses, []);
  for (const n of [0, 4, 'x', '', -1]) assert.equal(removeNumber(d, n).status, 'invalid');
  assert.equal(describeItem({ type: 'page', value: 45 }, 'en'), 'Page 45');
  assert.match(describeItem({ type: 'verse', value: '2:255' }, 'ar'), /البقرة 2:255/);
});

test('personal commands parse in both languages', () => {
  for (const [t, n] of [['!mark 45', 'mark'], ['!علامة 45', 'mark'], ['!save 2:255', 'save'], ['!احفظ 2:255', 'save'], ['!mine', 'mine'], ['!قائمتي', 'mine'], ['!open 1', 'open'], ['!remove 1', 'remove'], ['!ازل 1', 'remove'], ['!forget confirm', 'forget'], ['!انسني تأكيد', 'forget']])
    assert.equal(parseDm(t, '!').name, n, t);
});

test('DM-only by construction: no guild-message intent, a guildId guard, and storage keyed by the sender only', () => {
  const boot = readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
  assert.ok(!/GatewayIntentBits\.GuildMessages/.test(boot.replace(/\/\/.*$/gm, '')), 'no GuildMessages intent');
  const mc = readFileSync(new URL('../src/events/messageCreate.js', import.meta.url), 'utf8');
  assert.match(mc, /message\.guildId\) return/);
  assert.ok(!/guildId/.test(readFileSync(new URL('../src/models/PersonalList.js', import.meta.url), 'utf8')), 'no server key in the model');
  assert.ok(!/args\.match\(\s*\/<@/.test(mc), 'never resolves another user from the message');
});

import { parseSetting } from '../src/utils/personal.js';
test('settings parse in both languages; bad input is an error, no args just shows', () => {
  assert.equal(parseSetting(''), null);
  assert.deepEqual(parseSetting('lang en'), { key: 'lang', value: 'en' });
  assert.deepEqual(parseSetting('لغة عربي'), { key: 'lang', value: 'ar' });
  assert.deepEqual(parseSetting('عرض حفص'), { key: 'view', value: 'hafs' });
  assert.deepEqual(parseSetting('view warsh'), { key: 'view', value: 'warsh' });
  assert.equal(parseSetting('foo bar').error, 'key');
  assert.equal(parseSetting('lang xx').error, 'value');
  assert.equal(parseDm('!اعدادات لغة en', '!').name, 'settings');
  assert.equal(parseDm('!settings', '!').name, 'settings');
});

test('the private-chat handler never reaches voice, sessions or servers', () => {
  const mc = readFileSync(new URL('../src/events/messageCreate.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const bad of ['sessionManager', 'voice', 'joinVoice', 'guilds.cache', 'GuildSettings', 'playNext', 'enqueue'])
    assert.ok(!mc.includes(bad), `messageCreate must not reference ${bad}`);
});
