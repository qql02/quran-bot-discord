import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDm, DM_HELP, MAX_DM_LENGTH } from '../src/utils/dmCommands.js';
import { parseTarget } from '../src/utils/mushaf.js';

test('not a command: no prefix, a space after it, empty, too long', () => {
  for (const x of ['hello', '', '! help', '!', '   ', 'x'.repeat(MAX_DM_LENGTH + 5).replace(/^./, '!')]) assert.equal(parseDm(x, '!'), null, JSON.stringify(x));
  assert.equal(parseDm('!help', ''), null);
});

test('names in both languages; the reply language follows the name typed', () => {
  assert.deepEqual([parseDm('!help', '!').name, parseDm('!help', '!').lang], ['help', 'en']);
  assert.deepEqual([parseDm('!مساعدة', '!').name, parseDm('!مساعدة', '!').lang], ['help', 'ar']);
  assert.equal(parseDm('!HELP', '!').name, 'help');
  assert.equal(parseDm('!الأوامر', '!').name, 'help');           // hamza / alef variants
  assert.equal(parseDm('!آية 2:255', '!').name, 'ayah');
  assert.equal(parseDm('!ayah 2:255', '!').args, '2:255');
  assert.equal(parseDm('.mushaf', '.').name, 'mushaf');
  assert.equal(parseDm('$$wird', '$$').name, 'wird');
});

test('surah / juz / page shortcuts become a target the Mushaf understands', () => {
  const cases = [['!page 45', 45], ['!صفحة ٤٥', 45], ['!juz 5', 'juz'], ['!جزء 5', 'juz'], ['!surah kahf', 'ok'], ['!سورة الكهف', 'ok'], ['!surah 18', 'ok'], ['!read yasin', 'ok']];
  for (const [text, want] of cases) {
    const c = parseDm(text, '!');
    assert.equal(c.name, 'read', text);
    const target = parseTarget(c.args, c.lang);
    assert.ok(!target.error, `${text} -> "${c.args}" -> ${target.error}`);
    if (typeof want === 'number') assert.equal(target.page, want);
  }
  assert.equal(parseTarget(parseDm('!surah kahf', '!').args).page, parseTarget('surah 18').page);
  assert.equal(parseDm('!surah', '!').args, '', 'a shortcut without a target has no args (the handler explains)');
});

test('nothing that controls voice exists in DMs: those words are just unknown commands', () => {
  for (const w of ['recite', 'play', 'start', 'hold', 'continue', 'next', 'leave', 'volume', 'تلاوة', 'شغل']) {
    const c = parseDm(`!${w}`, '!');
    assert.deepEqual([c.name, c.known], ['unknown', false], w);
  }
  const u = parseDm('!zzzz', '!');
  assert.deepEqual([u.name, u.known, u.typed], ['unknown', false, 'zzzz']);
  assert.equal(parseDm('!ماذا', '!').lang, 'ar');
});

test('the DM help lists every command with the configured prefix', () => {
  for (const lang of ['ar', 'en']) {
    const text = DM_HELP[lang]('?');
    assert.ok(text.includes('`?'), lang);
    assert.ok(!text.includes('!'), 'uses the given prefix only');
    assert.ok(!text.includes('/recite'), 'the DM help does not send people to voice commands');
  }
});

test('adhkar: both languages, the evening word is passed on as an argument', () => {
  for (const w of ['adhkar', 'azkar', 'اذكار', 'أذكار', 'الأذكار']) assert.equal(parseDm(`!${w}`, '!').name, 'adhkar', w);
  assert.equal(parseDm('!adhkar evening', '!').args, 'evening');
  assert.equal(parseDm('!اذكار مساء', '!').args, 'مساء');
  assert.equal(parseDm('!ayah', '!').args, '', 'a bare !ayah means a random verse');
});

test('!hadith / !حديث is a known command, with an optional Nawawi number', () => {
  assert.equal(parseDm('!hadith', '!').name, 'hadith');
  assert.equal(parseDm('!حديث 13', '!').name, 'hadith');
  assert.equal(parseDm('!hadith 13', '!').args, '13');
  assert.equal(parseDm('!hadith', '!').args, '', 'a bare !hadith means a random one');
});
