// Run by test/mushafIntegration.test.js in a plain Node process: real discord.js builders, real axios,
// a local HTTP server standing in for api.alquran.cloud.
import http from 'node:http';
import assert from 'node:assert/strict';
import { SURAHS } from '../../src/data/surahs.js';

const hits = {};
const globalOf = (s, a) => SURAHS.slice(0, s - 1).reduce((n, x) => n + x.ayahs, 0) + a;
const ay = (s, a, text, full = true) => ({ number: globalOf(s, a), text, juz: 1, ...(full ? { numberInSurah: a, surah: { number: s } } : {}) });
const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
const pages = {
  1: { number: 1, ayahs: Array.from({ length: 7 }, (_, i) => ay(1, i + 1, `فاتحة${i + 1}`)) },
  2: { number: 2, ayahs: Array.from({ length: 5 }, (_, i) => ay(2, i + 1, i === 0 ? `${BASMALA} الٓمٓ` : `بقرة${i + 1}`, false)) },   // only the global number
  3: { number: 3, ayahs: Array.from({ length: 5 }, (_, i) => ay(2, i + 6, `بقرة${i + 6}`)) },
  604: { number: 604, ayahs: [ay(112, 4, 'أحد'), ...Array.from({ length: 5 }, (_, i) => ay(113, i + 1, `فلق${i + 1}`)), ...Array.from({ length: 6 }, (_, i) => ay(114, i + 1, `ناس${i + 1}`))] },
  77: { number: 78, ayahs: [ay(4, 1, 'x')] },                       // the API answers with the WRONG page
  79: { number: 79, ayahs: [] },                                    // empty
  81: { number: 81, ayahs: [{ number: 5, text: 'x', numberInSurah: 1, surah: { number: 200 } }] },   // impossible surah
  293: { number: 293, ayahs: Array.from({ length: 3 }, (_, i) => ay(18, i + 1, `كهف${i + 1}`)) }
};
const server = http.createServer(async (req, res) => {
  const m = req.url.match(/^\/v1\/page\/(\d+)\/quran-uthmani$/);
  if (!m) { res.statusCode = 404; return res.end(); }
  const n = Number(m[1]); hits[n] = (hits[n] ?? 0) + 1;
  if (n === 78) { res.statusCode = 500; return res.end('boom'); }
  if (n === 80) await new Promise(r => setTimeout(r, 150));
  const d = pages[n] ?? { number: n, ayahs: Array.from({ length: 4 }, (_, i) => ay(2, i + 10, `آية${i + 10}`)) };
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ code: 200, status: 'OK', data: d }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.AYAH_API_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.ADMIN_IDS = '999999999999999999';

const { fetchMushafPage, clearMushafCache } = await import('../../src/services/mushafService.js');
const { handleMushaf, openReader, defaultDeps, forgetViews } = await import('../../src/components/mushafHandler.js');

// ───────────────────────── service ─────────────────────────
{
  const p3 = await fetchMushafPage(3);
  assert.equal(p3.ayahs.length, 5); assert.equal(p3.juz, 1);
  await fetchMushafPage(3); await fetchMushafPage(3);
  assert.equal(hits[3], 1, 'cached: one API call for three reads');

  const p2 = await fetchMushafPage(2);
  assert.deepEqual(p2.ayahs.map(a => [a.surah, a.ayah]), [[2, 1], [2, 2], [2, 3], [2, 4], [2, 5]], 'surah/ayah derived from the global number');

  const five = await Promise.all([1, 2, 3, 4, 5].map(() => fetchMushafPage(80)));
  assert.equal(hits[80], 1, 'five simultaneous readers share one API call');
  assert.ok(five.every(x => x?.ayahs.length === 4));

  for (const bad of [77, 78, 79, 81]) assert.equal(await fetchMushafPage(bad), null, `page ${bad} is rejected`);
  const after = { ...hits };
  for (const bad of [77, 78, 79, 81]) await fetchMushafPage(bad);
  assert.deepEqual({ 77: hits[77], 78: hits[78], 79: hits[79], 81: hits[81] }, { 77: after[77], 78: after[78], 79: after[79], 81: after[81] }, 'a failed page is not hammered again right away');
  for (const junk of [0, 605, -1, 3.5, '3', null, undefined]) assert.equal(await fetchMushafPage(junk), null);
  console.log('service OK');
}

// ───────────────────────── handler ─────────────────────────
const UID = '123456789012345678';
const state = { sub: null, log: null, logged: [], fetched: 0 };
const deps = {
  getSub: async () => state.sub,
  logReading: async (_c, uid, n) => { state.logged.push([uid, n]); return state.log(); },
  guildLang: async () => 'ar',
  fetchPage: (p) => { state.fetched++; return fetchMushafPage(p); }
};
const active = (over = {}) => ({ userId: UID, active: true, expiresAt: new Date(Date.now() + 10 * 864e5), currentPage: 2, pagesPerDay: 2, timezone: 'UTC', dayDate: null, dayPages: 0, khatmaCount: 0, ...over });

function mk({ user = UID, customId = '', fromMessage = true, input = '' } = {}) {
  const calls = [];
  return {
    calls, user: { id: user }, customId, isFromMessage: () => fromMessage,
    fields: { getTextInputValue: () => input },
    deferUpdate: async () => calls.push(['deferUpdate']), deferReply: async (o) => calls.push(['deferReply', o]),
    editReply: async (p) => calls.push(['editReply', p]), reply: async (p) => calls.push(['reply', p]), showModal: async (m) => calls.push(['showModal', m])
  };
}
const last = (i) => i.calls.at(-1)[1];
const rows = (p) => p.components.map(r => r.toJSON().components);
const ids  = (p) => rows(p).flat().map(c => c.custom_id ?? 'LINK');
const title = (p) => p.embeds[0].toJSON().title;
const footer = (p) => p.embeds[0].toJSON().footer.text;

// a) no subscription → the reader is for subscribers: a gate card with ONE button, and no page is even fetched
{
  state.sub = null; state.fetched = 0; const i = mk(); await openReader(i, null, deps);
  assert.equal(i.calls[0][0], 'deferReply'); assert.equal(i.calls[0][1].flags, 64, 'private reply');
  const p = last(i);
  assert.equal(title(p), 'قارئ المصحف لمشتركي الورد'); assert.match(p.embeds[0].toJSON().description, /مجاني/);
  assert.deepEqual(ids(p), ['wird:subscribe']); assert.equal(state.fetched, 0, 'no text is fetched for a non-subscriber');
  // every way in is gated, not just the first screen
  for (const customId of [`mushaf:p:5:${UID}`, `mushaf:mine:${UID}`]) { const j = mk({ customId }); await handleMushaf(j, {}, deps); assert.deepEqual(ids(last(j)), ['wird:subscribe'], customId); }
  const slash = mk(); await openReader(slash, 300, deps); assert.deepEqual(ids(last(slash)), ['wird:subscribe'], 'jumping to a page by slash option is gated too');
  assert.equal(state.fetched, 0);
  // had a subscription that ended / was paused → renew instead
  for (const sub of [active({ active: false }), active({ expiresAt: new Date(Date.now() - 864e5) })]) {
    state.sub = sub; const j = mk(); await openReader(j, null, deps);
    assert.deepEqual(ids(last(j)), ['wird:renew']); assert.match(last(j).embeds[0].toJSON().description, /منتهٍ أو موقوف/);
  }
  assert.equal(state.fetched, 0);
}
// b) subscribed, 2 pages read → opens on page 3 with "I finished this page"
{
  state.sub = active(); const i = mk(); await openReader(i, null, deps); const p = last(i);
  assert.match(footer(p), /صفحة 3 من 604.*وردك اليوم 0\/2/);
  assert.equal(rows(p)[1][0].custom_id, `mushaf:done:3:${UID}`); assert.ok(!rows(p)[1][0].disabled);
  assert.match(p.embeds[0].toJSON().description, /^## سورة البقرة|بقرة6/);
}
// c) navigation relative to the wird
{
  const go = async (page) => { const i = mk({ customId: `mushaf:p:${page}:${UID}` }); await handleMushaf(i, {}, deps); assert.equal(i.calls[0][0], 'deferUpdate', 'edits the same message'); return last(i); };
  const ahead = await go(5);  assert.equal(rows(ahead)[1][0].custom_id, `mushaf:mine:${UID}`); assert.match(rows(ahead)[1][0].label, /صفحة وردي \(3\)/); assert.ok(!ids(ahead).some(x => x.startsWith('mushaf:done')));
  const behind = await go(1); assert.equal(rows(behind)[1][0].label, 'قرأتها'); assert.equal(rows(behind)[1][0].disabled, true);
  const first = await go(3);  assert.equal(rows(first)[1][0].custom_id, `mushaf:done:3:${UID}`);
  const lastPage = await go(604); assert.equal(rows(lastPage)[0][0].disabled, true, 'no next after 604'); assert.equal(title(lastPage), 'سورة الإخلاص · الفلق · الناس');
  const junk = await go(700);     assert.match(footer(junk), /صفحة 1 من 604/, 'a forged out-of-range page id is dropped, never trusted');
  const mine = mk({ customId: `mushaf:mine:${UID}` }); await handleMushaf(mine, {}, deps); assert.match(footer(last(mine)), /صفحة 3 من 604/);
}
// d) finishing a page records exactly ONE page; mid-day the next page follows at once, at the goal it STOPS until tomorrow
{
  state.sub = active(); state.logged = [];
  state.log = async () => ({ status: 'ok', sub: active({ currentPage: 3 }), result: { completedKhatma: false, newlyDone: false } });
  let i = mk({ customId: `mushaf:done:3:${UID}` }); await handleMushaf(i, {}, deps);
  assert.deepEqual(state.logged, [[UID, 1]]); let p = last(i);
  assert.match(p.content, /سُجّلت الصفحة 3/); assert.doesNotMatch(p.content, /أتممت وردك اليوم/); assert.match(footer(p), /صفحة 4 من 604/);

  state.logged = [];
  state.log = async () => ({ status: 'ok', sub: active({ currentPage: 3, streak: 4, lastReadDate: new Date().toISOString().slice(0, 10) }), result: { completedKhatma: false, newlyDone: true } });
  i = mk({ customId: `mushaf:done:3:${UID}` }); await handleMushaf(i, {}, deps); p = last(i);
  assert.deepEqual(state.logged, [[UID, 1]]);
  assert.equal(title(p), '🎉 أتممت وردك اليوم'); assert.match(p.embeds[0].toJSON().description, /صفحتان/); assert.match(p.embeds[0].toJSON().description, /\*\*4\*\*.*غداً/s);
  assert.deepEqual(ids(p), [`mushaf:p:4:${UID}`], 'no next page is pushed — only an optional "keep reading" button');
  assert.equal(rows(p)[0][0].label, 'تابع القراءة الآن');
  i = mk({ customId: `mushaf:p:4:${UID}` }); await handleMushaf(i, {}, deps); assert.match(footer(last(i)), /صفحة 4 من 604/);   // and it does open the next page when asked
}
// e) only the member's NEXT page can be recorded; other outcomes explain themselves and never crash
{
  state.sub = active(); state.logged = [];
  let i = mk({ customId: `mushaf:done:5:${UID}` }); await handleMushaf(i, {}, deps);
  assert.equal(state.logged.length, 0, 'a page ahead of the wird is not recorded'); assert.match(last(i).content, /3/);
  for (const [status, re] of [['busy', /للتو/], ['limit', /الحد اليومي/]]) {
    state.log = async () => ({ status }); i = mk({ customId: `mushaf:done:3:${UID}` }); await handleMushaf(i, {}, deps); assert.match(last(i).content, re, status);
  }
  // the subscription ended while the page was open → the card turns into the renew card (never a silent failure)
  for (const status of ['inactive', 'none']) {
    state.sub = active(); state.log = async () => { state.sub = active({ active: false }); return { status }; };
    i = mk({ customId: `mushaf:done:3:${UID}` }); await handleMushaf(i, {}, deps); assert.deepEqual(ids(last(i)), ['wird:renew'], status);
  }
  state.sub = null; i = mk({ customId: `mushaf:done:3:${UID}` }); await handleMushaf(i, {}, deps); assert.deepEqual(ids(last(i)), ['wird:subscribe']);
}
// f) completing the khatma on page 604
{
  state.sub = active({ currentPage: 603 });
  state.log = async () => ({ status: 'ok', sub: active({ currentPage: 0, khatmaCount: 2 }), result: { completedKhatma: true, newlyDone: true } });
  const i = mk({ customId: `mushaf:done:604:${UID}` }); await handleMushaf(i, {}, deps); const p = last(i);
  assert.match(title(p), /تمّت ختمتك/); assert.match(p.embeds[0].toJSON().description, /رقم \*\*2\*\*/);
  assert.equal(rows(p)[0][0].custom_id, `mushaf:p:1:${UID}`);
}
// g) someone else's buttons are refused
{
  const i = mk({ user: '555555555555555555', customId: `mushaf:p:9:${UID}` }); await handleMushaf(i, {}, deps);
  assert.equal(i.calls.length, 1); assert.equal(i.calls[0][0], 'reply'); assert.match(i.calls[0][1].content, /ليست لك/); assert.equal(i.calls[0][1].flags, 64);
}
// h) "go to" box
{
  state.sub = active();
  let i = mk({ customId: `mushaf:jump:${UID}` }); await handleMushaf(i, {}, deps);
  assert.equal(i.calls[0][0], 'showModal'); assert.equal(i.calls[0][1].toJSON().custom_id, `mushaf:jumpm:${UID}`);
  i = mk({ customId: `mushaf:jumpm:${UID}`, input: 'الكهف' }); await handleMushaf(i, {}, deps);
  assert.equal(i.calls[0][0], 'deferUpdate'); assert.match(last(i).content, /سورة الكهف/); assert.match(footer(last(i)), /صفحة 293/);
  i = mk({ customId: `mushaf:jumpm:${UID}`, input: 'xyz' }); await handleMushaf(i, {}, deps);
  assert.equal(i.calls.length, 1); assert.equal(i.calls[0][0], 'reply'); assert.equal(i.calls[0][1].flags, 64);
  i = mk({ customId: `mushaf:jumpm:${UID}`, input: '٤٥', fromMessage: false }); await handleMushaf(i, {}, deps);
  assert.equal(i.calls[0][0], 'deferReply'); assert.match(footer(last(i)), /صفحة 45/);
}
// i) text service down → never a dead end
{
  state.sub = active();
  const i = mk({ customId: `mushaf:p:78:${UID}` }); await handleMushaf(i, {}, deps); const p = last(i);
  assert.equal(title(p), 'تعذّر تحميل الصفحة 78');
  const btns = rows(p)[0]; assert.equal(btns[0].custom_id, `mushaf:p:78:${UID}`); assert.equal(btns[1].url, 'https://quran.com/page/78');
}
// j) buttons coming from a wird reminder / room panel open the CLICKER's own page in a private message
{
  state.sub = active({ currentPage: 41 });
  const i = mk({ customId: 'mushaf:open', fromMessage: true }); await handleMushaf(i, {}, deps);
  assert.equal(i.calls[0][0], 'deferReply'); assert.match(footer(last(i)), /صفحة 42 من 604/);
}
// k) the real DB lookup must not break the reader when Mongo is unreachable
{
  const m = await import('../../src/models/WirdSubscription.js');
  const original = m.WirdSubscription.findOne; m.WirdSubscription.findOne = () => { throw new Error('mongo down'); };
  assert.equal(await defaultDeps.getSub(UID), null);
  m.WirdSubscription.findOne = original;
}
// l) English: a member's own language wins; a server language is the fallback; the Quran text itself stays Arabic
{
  state.sub = active({ lang: 'en' }); let i = mk(); await openReader(i, null, deps); const p = last(i);
  assert.match(footer(p), /Page 3 of 604.*Today's wird 0\/2/); assert.equal(rows(p)[0][0].label, 'Next'); assert.equal(rows(p)[1][0].label, 'I finished this page');
  assert.match(title(p), /^Surah /);
  i = mk({ customId: `mushaf:jumpm:${UID}`, input: 'nonsense' }); await handleMushaf(i, {}, deps); assert.match(last(i).embeds[0].toJSON().description, /did not understand/);
  state.sub = null; const en = { ...deps, guildLang: async () => 'en' }; i = mk(); await openReader(i, null, en);
  assert.equal(title(last(i)), 'The Mushaf reader is for wird subscribers'); assert.equal(rows(last(i))[0][0].label, 'Subscribe free');
  i = mk({ user: '555555555555555555', customId: `mushaf:p:9:${UID}` }); await handleMushaf(i, {}, en); assert.match(i.calls[0][1].content, /not yours/);
}
// m) page pictures (Hafs / Warsh): the same reader, the same page numbers, never a dead end
{
  const asked = [], warmed = [];
  const img = { ...deps, imageRiwayat: () => ['hafs', 'warsh'],
    loadImage: async (riwaya, page) => { asked.push([riwaya, page]); return page === 10 ? null : { buffer: Buffer.from(`png-${riwaya}-${page}`), name: `mushaf-${riwaya}-${String(page).padStart(3, '0')}.png` }; },
    prefetchImage: (riwaya, page) => warmed.push([riwaya, page]) };
  state.sub = active();

  // text view offers one picture button per riwaya (and nothing when images are off — checked by every test above)
  let i = mk(); await openReader(i, null, img); let p = last(i);
  assert.equal(rows(p).length, 3); assert.deepEqual(rows(p)[2].map(c => c.custom_id), [`mushaf:ih:3:${UID}`, `mushaf:iw:3:${UID}`]);
  assert.match(rows(p)[2][0].label, /حفص/); assert.match(rows(p)[2][1].label, /ورش/);
  assert.equal(p.files, undefined, 'the text view carries no attachment');

  // Warsh picture of the SAME page number
  i = mk({ customId: `mushaf:iw:3:${UID}` }); await handleMushaf(i, {}, img); p = last(i);
  assert.deepEqual(asked.at(-1), ['warsh', 3], 'Warsh was asked for page 3'); assert.deepEqual(warmed.at(-1), ['warsh', 4], 'the next picture is warmed');
  assert.equal(p.files.length, 1); assert.equal(p.files[0].name, 'mushaf-warsh-003.png');
  const e = p.embeds[0].toJSON(); assert.equal(e.image.url, 'attachment://mushaf-warsh-003.png'); assert.match(e.title, /ورش عن نافع/); assert.match(e.footer.text, /صفحة 3 من 604.*وردك اليوم.*مجمع الملك فهد/);
  assert.deepEqual(rows(p)[0].map(c => c.custom_id), [`mushaf:iw:4:${UID}`, `mushaf:jumpiw:${UID}`, `mushaf:iw:2:${UID}`], 'navigation stays in the Warsh picture view');
  assert.deepEqual(rows(p)[1].map(c => [c.custom_id, !!c.disabled]), [[`mushaf:ih:3:${UID}`, false], [`mushaf:iw:3:${UID}`, true], [`mushaf:p:3:${UID}`, false]], 'switch riwaya / back to text; the current one is disabled');
  assert.equal(rows(p)[2][0].custom_id, `mushaf:doneiw:3:${UID}`);

  // switch to Hafs keeps the page; the two riwayat are never mixed
  i = mk({ customId: `mushaf:ih:3:${UID}` }); await handleMushaf(i, {}, img);
  assert.deepEqual(asked.at(-1), ['hafs', 3]); assert.equal(last(i).files[0].name, 'mushaf-hafs-003.png'); assert.match(last(i).embeds[0].toJSON().title, /حفص عن عاصم/);

  // back to the text: the old picture is dropped from the message
  i = mk({ customId: `mushaf:p:3:${UID}` }); await handleMushaf(i, {}, img);
  assert.equal(last(i).files, undefined); assert.deepEqual(last(i).attachments, []); assert.equal(last(i).embeds[0].toJSON().image, undefined);

  // finishing a page from the picture records ONE page and stays in the picture view (same riwaya)
  state.logged = []; state.log = async () => ({ status: 'ok', sub: active({ currentPage: 3 }), result: { completedKhatma: false, newlyDone: false } });
  i = mk({ customId: `mushaf:doneiw:3:${UID}` }); await handleMushaf(i, {}, img);
  assert.deepEqual(state.logged, [[UID, 1]]); assert.deepEqual(asked.at(-1), ['warsh', 4]); assert.match(last(i).content, /سُجّلت الصفحة 3/); assert.equal(last(i).files[0].name, 'mushaf-warsh-004.png');
  // a page ahead of the wird: the way back to it stays in the picture view
  i = mk({ customId: `mushaf:ih:9:${UID}` }); await handleMushaf(i, {}, img);
  assert.equal(rows(last(i))[2][0].custom_id, `mushaf:mineih:${UID}`);
  i = mk({ customId: `mushaf:mineih:${UID}` }); await handleMushaf(i, {}, img); assert.deepEqual(asked.at(-1), ['hafs', 3]);

  // the "go to" box keeps the view
  i = mk({ customId: `mushaf:jumpiw:${UID}` }); await handleMushaf(i, {}, img); assert.equal(i.calls[0][1].toJSON().custom_id, `mushaf:jumpmiw:${UID}`);
  i = mk({ customId: `mushaf:jumpmiw:${UID}`, input: 'الكهف' }); await handleMushaf(i, {}, img);
  assert.deepEqual(asked.at(-1), ['warsh', 293]); assert.match(last(i).content, /سورة الكهف/);
  i = mk({ customId: `mushaf:jumpm:${UID}`, input: 'الكهف' }); await handleMushaf(i, {}, img); assert.equal(last(i).files, undefined, 'a text jump stays text');

  // the picture is not available → the text of the page follows with a note (never an error screen)
  i = mk({ customId: `mushaf:iw:10:${UID}` }); await handleMushaf(i, {}, img); p = last(i);
  assert.equal(p.files, undefined); assert.match(p.content, /تعذّر تحميل صورة هذه الصفحة/); assert.match(p.embeds[0].toJSON().description, /آية10/, 'the text of the page is shown instead');

  // a riwaya that is switched off (MUSHAF_IMAGES_RIWAYAT=hafs) is never offered or served
  const only = { ...img, imageRiwayat: () => ['hafs'] };
  i = mk(); await openReader(i, null, only); assert.deepEqual(rows(last(i))[2].map(c => c.custom_id), [`mushaf:ih:3:${UID}`]);
  asked.length = 0; i = mk({ customId: `mushaf:iw:3:${UID}` }); await handleMushaf(i, {}, only);
  assert.equal(asked.length, 0, 'warsh images are off'); assert.equal(last(i).files, undefined);

  // someone else's picture buttons are refused; unknown kinds do nothing
  i = mk({ user: '555555555555555555', customId: `mushaf:iw:3:${UID}` }); await handleMushaf(i, {}, img); assert.match(i.calls[0][1].content, /ليست لك/);
  i = mk({ customId: `mushaf:iz:3:${UID}` }); await handleMushaf(i, {}, img); assert.equal(i.calls.length, 0);

  // English
  state.sub = active({ lang: 'en' }); i = mk({ customId: `mushaf:iw:3:${UID}` }); await handleMushaf(i, {}, img);
  assert.match(last(i).embeds[0].toJSON().title, /Warsh an Nafi/); assert.equal(rows(last(i))[1][2].label, 'Text');
  state.sub = active();
}
console.log('images OK');
// n) the member's way of reading is remembered: the reader opens like they last used it
{
  const saved = new Map(), writes = [];
  const asked = [];
  const mem = { ...deps, imageRiwayat: () => ['hafs', 'warsh'],
    loadImage: async (r, p) => { asked.push([r, p]); return { buffer: Buffer.from('png'), name: `mushaf-${r}-${String(p).padStart(3, '0')}.png` }; },
    getPref: async (uid) => saved.get(uid) ?? null,
    setPref: async (uid, v) => { writes.push([uid, v]); saved.set(uid, v); } };
  state.sub = active(); forgetViews();

  // new member: text, and that first choice is stored once
  let i = mk(); await openReader(i, null, mem); assert.equal(last(i).files, undefined); assert.deepEqual(writes, [[UID, 'text']]);

  // switching to the Warsh picture saves it; turning pages (same view) does not write again
  i = mk({ customId: `mushaf:iw:3:${UID}` }); await handleMushaf(i, {}, mem); assert.deepEqual(writes.at(-1), [UID, 'warsh']);
  const n = writes.length;
  for (const pg of [4, 5, 6]) { i = mk({ customId: `mushaf:iw:${pg}:${UID}` }); await handleMushaf(i, {}, mem); }
  assert.equal(writes.length, n, 'page turns never touch the database');

  // next time the reader opens (slash, menu, or the wird reminder button) it shows the Warsh picture at the member's wird page
  asked.length = 0; forgetViews();
  i = mk(); await openReader(i, null, mem); assert.deepEqual(asked.at(-1), ['warsh', 3], 'slash command / menu button');
  forgetViews(); asked.length = 0;
  i = mk({ customId: 'mushaf:open' }); await handleMushaf(i, {}, mem);
  assert.deepEqual(asked.at(-1), ['warsh', 3]); assert.equal(last(i).files[0].name, 'mushaf-warsh-003.png'); assert.match(last(i).embeds[0].toJSON().title, /ورش/);
  assert.equal(writes.length, n, 'opening in the saved view is not a change');

  // going back to the text is saved too, and the reader then opens on text
  i = mk({ customId: `mushaf:p:3:${UID}` }); await handleMushaf(i, {}, mem); assert.deepEqual(writes.at(-1), [UID, 'text']);
  forgetViews(); i = mk(); await openReader(i, null, mem); assert.equal(last(i).files, undefined);

  // switching riwaya is saved
  i = mk({ customId: `mushaf:ih:3:${UID}` }); await handleMushaf(i, {}, mem); assert.deepEqual(writes.at(-1), [UID, 'hafs']);
  forgetViews(); asked.length = 0; i = mk(); await openReader(i, null, mem); assert.deepEqual(asked.at(-1), ['hafs', 3]);

  // the cards after "finished today's wird" / khatma keep the member's view
  state.log = async () => ({ status: 'ok', sub: active({ currentPage: 3 }), result: { completedKhatma: false, newlyDone: true } });
  i = mk({ customId: `mushaf:doneiw:3:${UID}` }); await handleMushaf(i, {}, mem);
  assert.deepEqual(ids(last(i)), [`mushaf:iw:4:${UID}`]);
  state.log = async () => ({ status: 'ok', sub: active({ currentPage: 0, khatmaCount: 1 }), result: { completedKhatma: true, newlyDone: true } });
  state.sub = active({ currentPage: 603 }); i = mk({ customId: `mushaf:doneih:604:${UID}` }); await handleMushaf(i, {}, mem);
  assert.equal(rows(last(i))[0][0].custom_id, `mushaf:ih:1:${UID}`); state.sub = active();

  // saved Warsh but images are switched off / that riwaya is off → text, and the saved choice is NOT overwritten
  saved.set(UID, 'warsh'); forgetViews(); const wr = writes.length;
  for (const off of [() => [], () => ['hafs']]) {
    i = mk(); await openReader(i, null, { ...mem, imageRiwayat: off }); assert.equal(last(i).files, undefined); assert.ok(last(i).embeds[0].toJSON().description);
  }
  assert.equal(writes.length, wr, 'a feature that is off must not erase what the member chose');
  assert.equal(saved.get(UID), 'warsh');

  // a database failure never breaks the reader
  const broken = { ...mem, getPref: async () => { throw new Error('db down'); } };
  await assert.rejects(() => openReader(mk(), null, broken), /db down/, 'a throwing dependency is the caller\'s problem — the real getPref catches (below)');
  const m = await import('../../src/models/MushafPref.js');
  const find = m.MushafPref.findOne, upd = m.MushafPref.updateOne;
  m.MushafPref.findOne = () => { throw new Error('mongo down'); }; m.MushafPref.updateOne = () => { throw new Error('mongo down'); };
  assert.equal(await defaultDeps.getPref(UID), null); await defaultDeps.setPref(UID, 'warsh');           // neither throws
  let wrote; m.MushafPref.updateOne = async (...a) => { wrote = a; };
  await defaultDeps.setPref(UID, 'hafs'); assert.deepEqual(wrote[0], { userId: UID }); assert.equal(wrote[1].$set.view, 'hafs'); assert.deepEqual(wrote[2], { upsert: true });
  wrote = null; await defaultDeps.setPref(UID, 'qalon'); assert.equal(wrote, null, 'an unknown value is never stored');
  m.MushafPref.findOne = () => ({ lean: async () => ({ view: 'warsh' }) }); assert.equal(await defaultDeps.getPref(UID), 'warsh');
  m.MushafPref.findOne = () => ({ lean: async () => ({ view: 'bogus' }) }); assert.equal(await defaultDeps.getPref(UID), null);
  m.MushafPref.findOne = find; m.MushafPref.updateOne = upd;
}
console.log('preferences OK');
console.log('handler OK');
console.log('ALL OK');
server.close(); clearMushafCache();
process.exit(0);
