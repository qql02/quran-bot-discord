import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wirdText, roomPanelMessage, statusMessage, reminderMessage, roomReminderMessage, savedMessage, readingMessage, khatmaMessage,
  khatmaAnnouncement, expiringMessage, expiredMessage, inactiveMessage, roomExpiringMessage, roomExpiredMessage, roomInactiveMessage,
  deleteConfirmMessage, deletedMessage, actionRows, renewRow, deleteRow, range, where, durationLabel, pagesLabel
} from '../src/wird/ui/index.js';
import { resolveTimeZone } from '../src/utils/adhkarSchedule.js';

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;
// commands, ids, zones and mentions are the same in both languages
const strip = (s) => String(s).replace(/https?:\/\/\S+/g, '').replace(/`[^`]*`/g, '').replace(/<[#@:]?[^>]*>/g, '').replace(/\*\*/g, '').replace(/HH:MM|MashaAllah/g, '');

/** Every string reachable from a value (embeds, rows, options, payloads). */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') {
    if (typeof v.toJSON === 'function') strings(v.toJSON(), out);
    else {
      // ids, urls and select values are not text the member reads (a select option has both a label and a value)
      for (const [k, x] of Object.entries(v)) if (!['custom_id', 'url', 'emoji'].includes(k) && !(k === 'value' && 'label' in v)) strings(x, out);
    }
  }
  return out;
}
const sub = (lang) => ({
  userId: '42', lang, active: true, timezone: 'Africa/Algiers', remindMode: 'fixed', remindTime: '20:00', currentPage: 120, pagesPerDay: 5,
  goalDays: 30, goalDeadline: '2099-01-01', streak: 3, bestStreak: 4, khatmaCount: 1, totalPagesRead: 130, khatmaStartedAt: new Date(),
  expiresAt: new Date(Date.now() + 5 * 86_400_000), lastReadDate: null, dayPages: 0, dayDate: null
});

/** Every screen a member can see, built for one language. */
function screens(lang) {
  const s = sub(lang), now = new Date();
  return [
    roomPanelMessage(lang), statusMessage(s, now), statusMessage({ ...s, goalDays: null }, now), statusMessage({ ...s, active: false }, now),
    statusMessage({ ...s, goalDays: 7, goalDeadline: '2000-01-01' }, now), reminderMessage(s, now), roomReminderMessage(s, now),
    savedMessage(s, now), savedMessage(s, now, 'welcomeBack'), savedMessage(s, now, 'settingsSaved'), savedMessage(s, now, 'renewed'),
    readingMessage(s, { added: 2, newlyDone: true, dayDone: true }, now), readingMessage(s, { added: 1, newlyDone: false, dayDone: false }, now),
    khatmaMessage(s), khatmaAnnouncement('42', 2, 40, lang), khatmaAnnouncement('42', 2, null, lang),
    expiringMessage(s), expiredMessage(s), inactiveMessage(s), roomExpiringMessage(s), roomExpiredMessage(s), roomInactiveMessage(s),
    deleteConfirmMessage(lang), deletedMessage(lang), actionRows(s, { full: true }), actionRows(s),
    renewRow(lang), renewRow(lang, 'renewNow'), renewRow(lang, 'resume'), deleteRow(lang),
    range(3, 3, lang), range(3, 8, lang), where(1, lang), where(604, lang), durationLabel(30, lang), durationLabel(45, lang), pagesLabel(1, lang), pagesLabel(5, lang)
  ];
}

test('every wird screen is in ONE language: English has no Arabic, Arabic has no English words', () => {
  for (const s of screens('en').flatMap(x => strings(x))) assert.ok(!ARABIC.test(s), `English wird text has Arabic: ${s}`);
  for (const s of screens('ar').flatMap(x => strings(x)).map(strip)) assert.ok(!LATIN_WORD.test(s), `Arabic wird text has Latin words: ${s}`);
});

test('every sentence in the text tables (modals, errors, setup replies…) is one language too', () => {
  const walk = (lang) => {
    const out = [];
    const visit = (v) => {
      if (typeof v === 'function') visit(v('Africa/Algiers', 7, 'x', 4, 5));
      else if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(wirdText(lang));
    return out;
  };
  for (const s of walk('en')) assert.ok(!ARABIC.test(s), `English text has Arabic: ${s}`);
  for (const s of walk('ar').map(strip)) assert.ok(!LATIN_WORD.test(s.replace(/Africa|Algiers/g, '')), `Arabic text has Latin words: ${s}`);
});

test('both languages define exactly the same texts (nothing forgotten in one of them)', () => {
  const shape = (v) => (typeof v === 'function' ? 'fn' : Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : 'str');
  assert.deepEqual(shape(wirdText('en')), shape(wirdText('ar')));
});

test('the room panel has the same buttons in both languages, each labelled in its own language', () => {
  const ids = (m) => m.components[0].toJSON().components.map(b => b.custom_id);
  assert.deepEqual(ids(roomPanelMessage('en')), ['wird:subscribe', 'wird:me', 'mushaf:open']);
  assert.deepEqual(ids(roomPanelMessage('ar')), ids(roomPanelMessage('en')));
  const label = (m) => m.components[0].toJSON().components.map(b => b.label);
  assert.ok(label(roomPanelMessage('en')).includes('Subscribe to the wird'));
  assert.ok(label(roomPanelMessage('ar')).includes('اشترك في الورد'));
});

test('a member\'s own language decides their cards; a record without one reads as Arabic', () => {
  const en = statusMessage(sub('en')).embeds[0].data.setTitle, ar = statusMessage(sub('ar')).embeds[0].data.setTitle, old = statusMessage(sub(undefined)).embeds[0].data.setTitle;
  assert.match(en, /My daily wird/); assert.match(ar, /وردي اليومي/); assert.equal(old, ar);
});

test('the English card shows surah names in English and the Arabic card in Arabic', () => {
  assert.match(where(1, 'en'), /Al-Fatihah/); assert.match(where(1, 'ar'), /الفاتحة/);
});

test('the time zone box understands English country names too', () => {
  assert.equal(resolveTimeZone('Egypt'), 'Africa/Cairo');
  assert.equal(resolveTimeZone('Saudi  Arabia'), 'Asia/Riyadh');
  assert.equal(resolveTimeZone('مصر'), 'Africa/Cairo');
  assert.equal(resolveTimeZone('constructor'), null);
});

// ── which language a screen uses (before / without a record) ──
import { GuildSettings } from '../src/models/GuildSettings.js';
import { wirdLang } from '../src/wird/handlers/shared.js';

test('wirdLang: the member\'s record wins (a record without a language is Arabic), then the panel language, then the server\'s', async () => {
  const real = GuildSettings.findOne;
  const serve = (doc) => { GuildSettings.findOne = () => ({ lean: async () => doc }); };
  try {
    const inGuild = { guildId: 'g' };
    serve({ language: 'en' });
    assert.equal(await wirdLang(inGuild, { userId: 'u' }), 'ar');            // older record, no lang field
    assert.equal(await wirdLang(inGuild, { lang: 'en' }), 'en');
    assert.equal(await wirdLang(inGuild, null), 'en');                       // no record → the server
    serve({ language: 'ar', wird: { lang: 'en' } });
    assert.equal(await wirdLang(inGuild, null), 'en');                       // the English panel beats an Arabic server
    serve({ language: 'en', wird: { lang: null } });
    assert.equal(await wirdLang(inGuild, null), 'en');                       // no wird room at all → the server's language
    serve({ language: 'en', wird: { channelId: '1', panelMessageId: '2', lang: null } });
    assert.equal(await wirdLang(inGuild, null), 'ar', 'a panel from before languages existed was Arabic and stays Arabic');
    assert.equal(await wirdLang({}, null), 'ar');                            // DMs
    GuildSettings.findOne = () => ({ lean: async () => { throw new Error('db down'); } });
    assert.equal(await wirdLang(inGuild, null), 'en');                       // a failed lookup never breaks the screen
  } finally { GuildSettings.findOne = real; }
});
