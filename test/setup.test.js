import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPlan, setupText, guideContent, cleanSelection, SETUP_KEYS } from '../src/data/setupLayout.js';
import { previewText, previewComponents, PICK_ID, CONFIRM_ID } from '../src/utils/setupUi.js';
import { applySetup, missingBotPerms } from '../src/services/setupService.js';

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

test('each language is 100% one language in names, topics and every sentence (commands and ids aside)', () => {
  const strip = (s) => s.replace(/`[^`]*`/g, '').replace(/<#?[^>]*>/g, '').replace(/\*\*/g, '');
  const texts = (lang) => {
    const plan = setupPlan(lang), t = setupText(lang), out = [plan.category];
    for (const it of plan.items) out.push(it.name, it.topic ?? '');
    for (const ids of [{ listen: '1', adhkar: '2', ayah: '3', wird: '4' }, {}]) {      // with every room, and with none
      const g = guideContent(lang, ids);
      out.push(g.title, g.description, g.footer, ...g.fields.flatMap(f => [f.name, f.value]));
    }
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === 'string') out.push(v);
      else if (typeof v === 'function') out.push(v('x', 'y'));
    }
    out.push(...Object.values(t.notes), ...Object.values(t.choices).flatMap(c => [c.label, c.description]));
    // the whole preview card (every pick state) and the picker/buttons it carries
    for (const selected of [SETUP_KEYS, ['ayah'], []]) {
      out.push(previewText({ lang, selected, timezone: 'Asia/Riyadh' }));
      for (const row of previewComponents({ lang, selected })) {
        for (const c of row.toJSON().components) out.push(c.label ?? '', c.placeholder ?? '', ...(c.options ?? []).flatMap(o => [o.label, o.description]));
      }
    }
    return out.map(strip);
  };
  // "العربية"/"English" language names and the bot's own command names are the only allowed exceptions
  for (const s of texts('ar')) assert.ok(!LATIN_WORD.test(s.replace(/Africa|Asia|Manage|Server|Quran/g, '').replace(/-#/g, '')), `Arabic text has Latin words: ${s}`);
  for (const s of texts('en')) assert.ok(!ARABIC.test(s), `English text has Arabic: ${s}`);
});

test('both languages offer the same five rooms, and the voice room is the listening one', () => {
  assert.deepEqual(setupPlan('ar').items.map(i => i.key), SETUP_KEYS);
  assert.deepEqual(setupPlan('en').items.map(i => i.key), SETUP_KEYS);
  assert.equal(setupPlan('en').items.find(i => i.key === 'listen').type, 'voice');
  assert.equal(setupPlan('en').items.find(i => i.key === 'wird').name, '📚・daily-wird');
});

test('a plan only contains what was picked, in display order, and junk keys are dropped', () => {
  assert.deepEqual(setupPlan('en', ['ayah', 'start']).items.map(i => i.key), ['start', 'ayah']);
  assert.deepEqual(setupPlan('ar', []).items, []);
  assert.deepEqual(cleanSelection(['wird', 'bogus', 'wird', 'start', '__proto__']), ['start', 'wird']);
  assert.deepEqual(cleanSelection(undefined), []);
});

test('the preview lists only the picked rooms, names what is skipped, and shows the time zone only with the adhkar', () => {
  const all = previewText({ lang: 'en', selected: SETUP_KEYS, timezone: 'Africa/Algiers' });
  assert.ok(all.includes('daily-wird') && all.includes('Africa/Algiers') && !all.includes('I will not create'));
  const some = previewText({ lang: 'en', selected: ['ayah', 'wird'], timezone: 'Africa/Algiers' });
  assert.ok(some.includes('verse-of-the-day') && some.includes('daily-wird'));
  assert.ok(!some.includes('start-here') && !some.includes('adhkar-and-duas') && !some.includes('🎧') && !some.includes('Africa/Algiers'));
  assert.ok(some.includes('I will not create') && some.includes('Start here') && some.includes('Listening'));
  const none = previewText({ lang: 'ar', selected: [], timezone: 'Asia/Riyadh' });
  assert.ok(none.includes('لم تختر شيئاً') && !none.includes('كاتيغوري'));
});

test('the picker has the five options (ticked by default), and Create is disabled when nothing is picked', () => {
  const [menuRow, btnRow] = previewComponents({ lang: 'ar', selected: SETUP_KEYS }).map(r => r.toJSON());
  assert.equal(menuRow.components[0].custom_id, PICK_ID);
  assert.deepEqual(menuRow.components[0].options.map(o => o.value), SETUP_KEYS);
  assert.ok(menuRow.components[0].options.every(o => o.default));
  assert.equal(btnRow.components.find(b => b.custom_id === CONFIRM_ID).disabled, false);
  const [m2, b2] = previewComponents({ lang: 'en', selected: ['wird'] }).map(r => r.toJSON());
  assert.deepEqual(m2.components[0].options.filter(o => o.default).map(o => o.value), ['wird']);
  assert.equal(previewComponents({ lang: 'en', selected: [] })[1].toJSON().components.find(b => b.custom_id === CONFIRM_ID).disabled, true);
  void b2;
});

// ── applySetup against a fake server ──────────────────────────────────────────────
function fakeGuild() {
  const log = { created: [], sent: [], edited: [], deleted: [] };
  const cache = new Map(); let n = 0;
  const mk = (opts) => {
    const id = `c${++n}`;
    const ch = { id, ...opts, messages: {
      fetch: async (mid) => mid && log.sent.includes(`${id}/${mid}`) ? { edit: async () => { log.edited.push(`${id}/${mid}`); } } : null,
      delete: async (mid) => { log.deleted.push(`${id}/${mid}`); } },
      send: async () => { const m = { id: `m${++n}` }; log.sent.push(`${id}/${m.id}`); return m; } };
    cache.set(id, ch); log.created.push(opts.name); return ch;
  };
  return { log, guild: { id: 'gS', roles: { everyone: { id: 'EVERYONE' } }, members: { me: { id: 'BOT', permissions: { has: () => true } } },
    channels: { cache, create: async (o) => mk(o) } } };
}
function fakeDeps() {
  const writes = [];
  const GuildSettings = {
    findOne: () => ({ lean: async () => ({}) }),
    findOneAndUpdate: async (_q, u) => { writes.push(u.$set); }
  };
  return { writes, deps: { GuildSettings, sendVoicePanel: async () => ({}), roomPanelMessage: () => ({ embeds: [] }),
    buildEmbed: (g) => g, defaultAyahTime: '08:00', defaultHadithTime: '13:00' } };
}

test('/setup creates the category + rooms with the right types, parents and locks, and wires adhkar, ayah, hadith, wird', async () => {
  const { guild, log } = fakeGuild(); const { deps, writes } = fakeDeps();
  const r = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'Africa/Algiers', deps });
  assert.equal(log.created.length, 7);                           // category + 6 rooms
  const rooms = [...guild.channels.cache.values()];
  const cat = rooms.find(c => c.type === 4);
  assert.ok(rooms.filter(c => c.type !== 4).every(c => c.parent === cat.id));
  const text = rooms.find(c => c.type === 0);
  assert.ok(text.permissionOverwrites.some(o => o.id === 'EVERYONE' && o.deny.length), 'text rooms are read-only for members');
  assert.ok(text.permissionOverwrites.some(o => o.id === 'BOT' && o.allow.length), 'but not for the bot');
  const merged = Object.assign({}, ...writes);
  assert.equal(merged['adhkar.enabled'], true);
  assert.equal(merged['adhkar.timezone'], 'Africa/Algiers');
  assert.equal(merged['adhkar.channelId'], r.channels.adhkar.id);
  assert.equal(merged['ayah.channelId'], r.channels.ayah.id);
  assert.equal(merged['hadith.enabled'], true);
  assert.equal(merged['hadith.channelId'], r.channels.hadith.id);
  assert.ok(r.channels.hadith.permissionOverwrites.some(o => o.id === 'EVERYONE' && o.deny.length), 'the hadith room is read-only for members too');
  assert.equal(merged['wird.channelId'], r.channels.wird.id);
  assert.equal(merged['setup.categoryId'], cat.id);
  assert.ok(r.listenPanelSent);
});

test('running /setup again reuses what exists (no duplicates) and never deletes a room', async () => {
  const { guild, log } = fakeGuild(); const a = fakeDeps();
  const first = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'Asia/Riyadh', deps: a.deps });
  const saved = { categoryId: first.categoryId, channels: Object.fromEntries(Object.entries(first.channels).map(([k, c]) => [k, c.id])), guideMessageId: null };
  const before = log.created.length;
  const b = fakeDeps();
  const second = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'Asia/Riyadh', saved, deps: b.deps });
  assert.equal(log.created.length, before);
  assert.ok(Object.values(second.status).every(s => s === 'reused'));
  assert.deepEqual(log.deleted, []);
  // one room removed by the admin → only that one comes back
  guild.channels.cache.delete(saved.channels.ayah);
  const third = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'Asia/Riyadh', saved, deps: fakeDeps().deps });
  assert.equal(third.status.ayah, 'created'); assert.equal(third.status.adhkar, 'reused');
  assert.equal(log.created.length, before + 1);
});

test('picking only some rooms creates only those, wires only those, and leaves everything else alone', async () => {
  const { guild, log } = fakeGuild(); const { deps, writes } = fakeDeps();
  const r = await applySetup({ guild, client: {}, lang: 'en', timezone: 'Asia/Riyadh', selected: ['ayah', 'wird'], deps });
  assert.deepEqual(Object.keys(r.channels), ['ayah', 'wird']);
  assert.equal(log.created.length, 3);                           // category + 2 rooms, no guide / voice / adhkar room
  assert.ok(log.created.every(n => !ARABIC.test(n)));
  assert.ok(!log.created.some(n => /start|Listening|adhkar/.test(n)));
  const merged = Object.assign({}, ...writes);
  assert.equal(merged['ayah.channelId'], r.channels.ayah.id);
  assert.equal(merged['wird.channelId'], r.channels.wird.id);
  assert.equal(merged['wird.lang'], 'en');
  assert.ok(!Object.keys(merged).some(k => k.startsWith('adhkar.')), 'the adhkar settings were not touched');
  assert.equal(r.listenPanelSent, false);
});

test('picking nothing creates nothing at all', async () => {
  const { guild, log } = fakeGuild(); const { deps, writes } = fakeDeps();
  const r = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'Asia/Riyadh', selected: [], deps });
  assert.equal(log.created.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(r.categoryId, null);
});

test('the wird panel is posted in the language that was chosen', async () => {
  for (const lang of ['ar', 'en']) {
    const { guild } = fakeGuild(); const { deps } = fakeDeps();
    let used; deps.roomPanelMessage = (l) => { used = l; return { embeds: [] }; };
    await applySetup({ guild, client: {}, lang, timezone: 'Asia/Riyadh', selected: ['wird'], deps });
    assert.equal(used, lang);
  }
});

test('a later run for a different pick only adds what is new, and the guide lists the earlier rooms too', async () => {
  const { guild, log } = fakeGuild(); const a = fakeDeps();
  const first = await applySetup({ guild, client: {}, lang: 'en', timezone: 'Asia/Riyadh', selected: ['start', 'ayah'], deps: a.deps });
  const saved = { categoryId: first.categoryId, channels: Object.fromEntries(Object.entries(first.channels).map(([k, c]) => [k, c.id])), guideMessageId: null };
  const before = log.created.length;
  const b = fakeDeps(); let guide;
  b.deps.buildEmbed = (g) => { guide = g; return g; };
  const second = await applySetup({ guild, client: {}, lang: 'en', timezone: 'Asia/Riyadh', selected: ['start', 'adhkar'], saved, deps: b.deps });
  assert.equal(log.created.length, before + 1);                  // only the adhkar room is new
  assert.equal(second.status.adhkar, 'created'); assert.equal(second.status.start, 'reused');
  const rooms = guide.fields.find(f => f.name === setupText('en').guideRooms).value;
  assert.ok(rooms.includes(`<#${saved.channels.ayah}>`) && rooms.includes(`<#${second.channels.adhkar.id}>`));
  assert.deepEqual(Object.keys(Object.assign({}, ...b.writes)['setup.channels']).sort(), ['adhkar', 'ayah', 'start']);
});

test('missingBotPerms names exactly what the bot lacks', () => {
  const g = { members: { me: { permissions: { has: (bit) => bit !== 64n } } } };   // 64n = ManageChannels
  assert.deepEqual(missingBotPerms(g), ['ManageChannels']);
});

// ── hardening: the holes found in review ──
import { PermissionFlagsBits as Perm } from 'discord.js';

test('a read-only room also blocks threads, so members cannot write there through them', async () => {
  const { guild } = fakeGuild(); const { deps } = fakeDeps();
  await applySetup({ guild, client: {}, lang: 'en', timezone: 'UTC', selected: ['ayah', 'wird', 'adhkar', 'start'], deps });
  const texts = [...guild.channels.cache.values()].filter(c => c.type === 0);
  assert.equal(texts.length, 4);
  for (const room of texts) {
    const deny = room.permissionOverwrites.find(o => o.id === 'EVERYONE').deny;
    for (const bit of [Perm.SendMessages, Perm.CreatePublicThreads, Perm.CreatePrivateThreads, Perm.SendMessagesInThreads, Perm.AddReactions, Perm.SendPolls, Perm.UseApplicationCommands, Perm.UseExternalApps]) assert.ok(deny.includes(bit), `missing ${bit}`);
    assert.ok(!room.permissionOverwrites.find(o => o.id === 'BOT').allow.includes(undefined));
  }
});

test('a failure half-way keeps what was created, and the next run completes the rest without duplicating anything', async () => {
  const store = {};                                              // the saved `setup` section, like the database would keep it
  const GuildSettings = {
    findOne: () => ({ lean: async () => ({ setup: { ...store } }) }),
    findOneAndUpdate: async (_q, u) => { for (const [k, v] of Object.entries(u.$set)) if (k.startsWith('setup.')) store[k.slice(6)] = v; }
  };
  const { deps } = fakeDeps(); deps.GuildSettings = GuildSettings;
  const { guild, log } = fakeGuild();
  const realCreate = guild.channels.create; let calls = 0, broken = true;
  guild.channels.create = async (o) => { if (broken && ++calls === 3) { const e = new Error('Missing Permissions'); e.code = 50013; throw e; } return realCreate(o); };

  await assert.rejects(applySetup({ guild, client: {}, lang: 'en', timezone: 'UTC', selected: ['start', 'ayah'], deps }));
  assert.equal(log.created.length, 2);                           // category + start room existed before the failure
  assert.ok(store.categoryId && store.channels.start, 'they were written down at once');

  broken = false;
  const r = await applySetup({ guild, client: {}, lang: 'en', timezone: 'UTC', selected: ['start', 'ayah'], saved: { ...store }, deps });
  assert.equal(log.created.length, 3);                           // only the verse room was added
  assert.equal(r.status.start, 'reused'); assert.equal(r.status.category, 'reused'); assert.equal(r.status.ayah, 'created');
  assert.equal(log.created.filter(n => n.includes('Holy Quran')).length, 1);
});

test('missingBotPerms also asks for what the picked rooms need, before anything is created', () => {
  const lacking = (...names) => ({ members: { me: { permissions: { has: (bit) => !names.some(n => Perm[n] === bit) } } } });
  assert.deepEqual(missingBotPerms(lacking('Connect', 'Speak'), ['ayah']), []);                  // no voice room → no voice permissions needed
  assert.deepEqual(missingBotPerms(lacking('Connect', 'Speak'), ['listen']), ['Connect', 'Speak']);
  assert.deepEqual(missingBotPerms(lacking('ReadMessageHistory'), ['wird']), ['ReadMessageHistory']);
  assert.deepEqual(missingBotPerms(lacking('Connect')), []);                                      // the early, selection-free check stays light
});

test('every room (voice chat included) is locked for members, and a reused room is re-locked on the next run', async () => {
  const { guild } = fakeGuild(); const a = fakeDeps();
  const first = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'UTC', deps: a.deps });
  const voice = first.channels.listen;
  assert.ok(!voice.permissionOverwrites.find(o => o.id === 'EVERYONE').deny.includes(Perm.SendMessages), 'members may write in the voice room chat');
  assert.ok(!voice.permissionOverwrites.find(o => o.id === 'EVERYONE').deny.includes(Perm.Speak), 'members may speak in the voice room');
  assert.ok(voice.permissionOverwrites.find(o => o.id === 'EVERYONE').deny.includes(Perm.UseSoundboard), 'but the soundboard is closed');
  assert.ok(voice.permissionOverwrites.find(o => o.id === 'EVERYONE').deny.includes(Perm.UseExternalSounds));
  assert.ok(!voice.permissionOverwrites.find(o => o.id === 'EVERYONE').deny.includes(Perm.Connect), 'members can still join and listen');
  assert.ok(voice.permissionOverwrites.find(o => o.id === 'BOT').allow.includes(Perm.SendMessages), 'and the bot posts the panel');
  // an older room, or one opened up by hand: it exists, but members can write
  const edits = [];
  const old = first.channels.ayah;
  old.permissionOverwrites = { cache: new Map(), edit: async (id, perms) => { edits.push([id, perms]); } };
  const saved = { categoryId: first.categoryId, channels: Object.fromEntries(Object.entries(first.channels).map(([k, c]) => [k, c.id])) };
  const second = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'UTC', saved, deps: fakeDeps().deps });
  assert.deepEqual(second.lockFailed, []);
  assert.deepEqual(edits.map(e => e[0]), ['BOT', 'EVERYONE']);
  assert.equal(edits[1][1].SendMessages, false); assert.equal(edits[1][1].AddReactions, false); assert.equal(edits[1][1].CreatePublicThreads, false);
  // Discord refuses → setup still finishes and reports the room
  old.permissionOverwrites.edit = async () => { throw new Error('Missing Permissions'); };
  const third = await applySetup({ guild, client: {}, lang: 'ar', timezone: 'UTC', saved, deps: fakeDeps().deps });
  assert.deepEqual(third.lockFailed, ['ayah']);
});

test('the one-time repair locks old rooms once per server and never again', async () => {
  const { migrateSetupLocks } = await import('../src/services/setupService.js');
  const edits = [];
  const room = (id, type = 0) => ({ id, type, permissionOverwrites: { cache: new Map(), edit: async (who) => { edits.push(`${id}:${who}`); } } });
  const rooms = new Map([['a', room('a')], ['v', room('v', 2)]]);
  const guild = { id: 'g1', roles: { everyone: { id: 'EVERYONE' } }, members: { me: { id: 'BOT' } }, channels: { cache: rooms, fetch: async () => null } };
  const client = { guilds: { cache: new Map([['g1', guild]]) } };
  const db = [{ guildId: 'g1', setup: { categoryId: 'cat', channels: { start: 'a', listen: 'v', gone: 'x' }, lockedAt: null } }];
  const GuildSettings = {
    find: () => ({ lean: async () => db.filter(d => !d.setup.lockedAt) }),
    findOneAndUpdate: async (q, u) => { const d = db.find(x => x.guildId === q.guildId && !x.setup.lockedAt); if (d) d.setup.lockedAt = u.$set['setup.lockedAt']; return d ?? null; }
  };
  const first = await migrateSetupLocks(client, GuildSettings);
  assert.deepEqual(first, { servers: 1, rooms: 2, failed: 0, leaks: [] });
  assert.ok(edits.length === 4);
  assert.equal(edits.length, 4);                                 // bot + @everyone for each of the 2 rooms
  const second = await migrateSetupLocks(client, GuildSettings);
  assert.deepEqual(second, { servers: 0, rooms: 0, failed: 0, leaks: [] });
  assert.equal(edits.length, 4);
});

test('a repair of a voice room opens speaking again (earlier version denied it) and closes only the soundboard', async () => {
  const { lockRoom } = await import('../src/services/setupService.js');
  const calls = [];
  const everyoneDeny = { has: () => true, any: () => true };      // the old overwrite denied Speak/Stream too
  const ch = { permissionOverwrites: { cache: new Map([['EVERYONE', { deny: everyoneDeny }]]), edit: async (id, p) => { calls.push([id, p]); } } };
  assert.equal(await lockRoom(ch, { everyone: 'EVERYONE', me: 'BOT', botAllow: [], voice: true }), true);
  const p = calls.find(c => c[0] === 'EVERYONE')[1];
  assert.equal(p.Speak, null); assert.equal(p.Stream, null); assert.equal(p.SendMessages, null); assert.equal(p.UseApplicationCommands, null); assert.equal(p.UseSoundboard, false);
});

test('a role with its own "allow" in a locked room is reported (and removed only with strict); the bot and @everyone are not', async () => {
  const { lockRoom } = await import('../src/services/setupService.js');
  const mkOw = (id, allowBits, type = 0) => ({ id, type, allow: { has: (b) => allowBits.includes(b) }, deny: { has: () => false } });
  const run = async (strict) => {
    const calls = [];
    const cache = new Map([['MODS', mkOw('MODS', [Perm.SendMessages, Perm.ManageWebhooks])], ['BOT', mkOw('BOT', [Perm.SendMessages])], ['EVERYONE', mkOw('EVERYONE', [])], ['U1', mkOw('U1', [], 1)]]);
    const ch = { id: 'room1', permissionOverwrites: { cache, edit: async (id, p) => { calls.push([id, p]); } } };
    const leaks = [];
    await lockRoom(ch, { everyone: 'EVERYONE', me: 'BOT', botAllow: [], voice: false, leaks, strict });
    return { leaks, calls };
  };
  const report = await run(false);
  assert.equal(report.leaks.length, 1);
  assert.equal(report.leaks[0].mention, '<@&MODS>'); assert.deepEqual(report.leaks[0].names, ['SendMessages', 'ManageWebhooks']);
  assert.ok(!report.calls.some(c => c[0] === 'MODS'), 'a role is never changed without strict');
  const strict = await run(true);
  const fix = strict.calls.find(c => c[0] === 'MODS')[1];
  assert.equal(fix.SendMessages, null); assert.equal(fix.ManageWebhooks, null);
  // webhooks are denied for members in every text room
  const { guild } = fakeGuild(); const { deps } = fakeDeps();
  const r = await applySetup({ guild, client: {}, lang: 'en', timezone: 'UTC', selected: ['ayah'], deps });
  assert.ok(r.channels.ayah.permissionOverwrites.find(o => o.id === 'EVERYONE').deny.includes(Perm.ManageWebhooks));
});
