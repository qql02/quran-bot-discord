// The optional second bot: picking it, checking that it joined any server, and the page that explains the steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickSecondBot, probeMembership, missingPermissions, secondBotState, buildSecondBotMessage } from '../src/utils/secondBot.js';
import { VOICE_WORKER_PERMS } from '../src/utils/botToken.js';

const G = '111111111111111111', G2 = '222222222222222222', B1 = '900000000000000001', B2 = '900000000000000002', ALT = '900000000000000003';
const bot = (o = {}) => ({ id: B1, tag: 'Second#1', alive: true, guildIds: [], ...o });
const noSleep = async () => {};
const permsOf = (names) => ({ has: (bit) => (typeof bit === 'bigint' ? names.some(n => VOICE_WORKER_PERMS[n] === bit || (bit === 8n && names.includes('Administrator'))) : false) });
const everything = permsOf(Object.keys(VOICE_WORKER_PERMS));

test('pickSecondBot: the bot already in the server wins, then a running one, then the newest; ALT_BOT_ID only when nothing is known', () => {
  assert.equal(pickSecondBot([bot({ id: B1 }), bot({ id: B2, guildIds: [G] })], G).id, B2);
  assert.equal(pickSecondBot([bot({ id: B1, alive: false }), bot({ id: B2 })], G).id, B2);
  assert.equal(pickSecondBot([bot({ id: B1, alive: false }), bot({ id: B2, alive: false })], G).id, B1);
  const fb = pickSecondBot([], G, ALT);
  assert.deepEqual([fb.id, fb.fromFallback, fb.alive], [ALT, true, false]);
  assert.equal(pickSecondBot([], G, null), null);
  assert.equal(pickSecondBot([bot({ id: 'not-an-id' })], G, 'junk'), null, 'only real IDs reach an invite link');
  assert.equal(pickSecondBot([bot({ guildIds: [G] })], G).listedInGuild, true);
  assert.equal(pickSecondBot([bot({ guildIds: [G] })], G2).listedInGuild, false, 'another server: not joined here');
});

test('missingPermissions: names what the bot lacks; Administrator covers everything; unknown member object = nothing claimed', () => {
  assert.deepEqual(missingPermissions({ permissions: everything }), []);
  assert.deepEqual(missingPermissions({ permissions: permsOf(['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'Connect']) }), ['Speak']);
  assert.deepEqual(missingPermissions({ permissions: permsOf(['Administrator']) }), []);
  assert.ok(missingPermissions({ permissions: permsOf([]) }).includes('Connect'));
  assert.deepEqual(missingPermissions({}), []);
  assert.deepEqual(missingPermissions(null), []);
});

test('probeMembership: Discord answers first; one retry; "unknown member" is a real no; the registry is only a fallback', async () => {
  let calls = 0;
  const joined = await probeMembership({ botId: B1, fetchMember: async () => ({ permissions: everything }), sleep: noSleep });
  assert.deepEqual([joined.joined, joined.source, joined.gaps], [true, 'discord', []]);
  // it appears on the second look (the second between "authorised" and "visible")
  const late = await probeMembership({ botId: B1, sleep: noSleep, fetchMember: async () => (++calls < 2 ? Promise.reject(Object.assign(new Error('Unknown Member'), { code: 10007 })) : { permissions: everything }) });
  assert.deepEqual([late.joined, calls], [true, 2]);
  const no = await probeMembership({ botId: B1, sleep: noSleep, fetchMember: async () => Promise.reject(Object.assign(new Error('Unknown Member'), { code: 10007 })) });
  assert.deepEqual([no.joined, no.source], [false, 'discord']);
  const down = await probeMembership({ botId: B1, sleep: noSleep, fetchMember: async () => { throw new Error('network'); } });
  assert.deepEqual([down.joined, down.source], [false, 'none']);
  const viaRegistry = await probeMembership({ botId: B1, sleep: noSleep, listedInGuild: true, fetchMember: async () => { throw new Error('network'); } });
  assert.deepEqual([viaRegistry.joined, viaRegistry.source], [true, 'registry']);
  let n = 0; await probeMembership({ botId: B1, sleep: noSleep, retries: 0, fetchMember: async () => { n++; return null; } });
  assert.equal(n, 1, 'retries: 0 asks once');
});

test('secondBotState', () => {
  assert.equal(secondBotState({ bot: null }), 'none');
  assert.equal(secondBotState({ bot: bot(), probe: { joined: false, gaps: [] } }), 'not_joined');
  assert.equal(secondBotState({ bot: bot(), probe: { joined: true, gaps: ['Speak'] } }), 'gaps');
  assert.equal(secondBotState({ bot: bot(), probe: { joined: true, gaps: [] } }), 'ok');
  assert.equal(secondBotState({ bot: bot({ alive: false }), probe: { joined: true, gaps: [] } }), 'offline');
});

const flat = (m) => JSON.stringify(m.embeds.map(e => e.toJSON?.() ?? e)) + JSON.stringify(m.components.map(c => c.toJSON?.() ?? c));

test('the steps page: a bot-only invite pinned to THIS server, and a check button; the member sees no secret', () => {
  for (const lang of ['ar', 'en']) {
    const m = buildSecondBotMessage({ lang, state: 'not_joined', bot: bot(), guildId: G, probe: { joined: false, gaps: [] } });
    const s = flat(m);
    assert.ok(s.includes(`client_id=${B1}`) && s.includes(`guild_id=${G}`) && s.includes('disable_guild_select=true'));
    assert.ok(!s.includes('applications.commands'), 'the voice-only bot registers no slash commands');
    assert.ok(s.includes('sbot:check'));
    assert.ok(s.includes('1️⃣') && s.includes('4️⃣'));
    assert.ok(!/token|secret/i.test(s));
    assert.ok(!flat(buildSecondBotMessage({ lang, state: 'not_joined', bot: bot(), guildId: G, checked: false })).includes(lang === 'ar' ? 'لم يدخل السيرفر بعد' : 'has not joined this server yet'));
    assert.ok(flat(buildSecondBotMessage({ lang, state: 'not_joined', bot: bot(), guildId: G, checked: true })).includes(lang === 'ar' ? 'لم يدخل السيرفر بعد' : 'has not joined this server yet'), 'after a check it says it is not there yet');
  }
  // another server → another pinned guild id
  assert.ok(flat(buildSecondBotMessage({ lang: 'en', state: 'not_joined', bot: bot(), guildId: G2 })).includes(`guild_id=${G2}`));
});

test('the other pages: ready, missing permissions (named), offline, not set up', () => {
  const ok = flat(buildSecondBotMessage({ lang: 'en', state: 'ok', bot: bot(), guildId: G }));
  assert.ok(ok.includes('ready') && ok.includes(`<@${B1}>`));
  const gaps = flat(buildSecondBotMessage({ lang: 'en', state: 'gaps', bot: bot(), guildId: G, probe: { gaps: ['Connect', 'Speak'] } }));
  assert.ok(gaps.includes('Connect, Speak'));
  assert.ok(flat(buildSecondBotMessage({ lang: 'en', state: 'offline', bot: bot({ alive: false }), guildId: G })).includes('offline'));
  const none = buildSecondBotMessage({ lang: 'ar', state: 'none', bot: null, guildId: G });
  assert.equal(none.components.length, 0);
});

test('both languages carry every second-bot string', () => {
  const ar = JSON.parse(readFileSync(new URL('../src/locales/ar.json', import.meta.url), 'utf8')).commands.secondbot;
  const en = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8')).commands.secondbot;
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const v of [...Object.values(ar), ...Object.values(en)]) assert.ok(typeof v === 'string' && v.length > 0);
});
