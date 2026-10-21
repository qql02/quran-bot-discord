import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setupPlan, guideContent, normLang, cleanSelection, SETUP_KEYS } from '../data/setupLayout.js';

const P = PermissionFlagsBits;
/** What the bot itself needs in every room it creates (a read-only room would otherwise lock the bot out too). */
const BOT_TEXT  = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
const BOT_VOICE = [P.ViewChannel, P.Connect, P.Speak, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];

/**
 * What members may NOT do in a read-only room. Denying SendMessages alone is not enough: members could still open a
 * thread (public or private) and write inside it, which would turn the room into a spam target.
 */
const READ_ONLY_NAMES = ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads', 'AddReactions', 'SendVoiceMessages', 'SendPolls', 'UseApplicationCommands', 'UseExternalApps', 'ManageWebhooks'].filter(n => P[n] !== undefined);
const READ_ONLY = READ_ONLY_NAMES.map(n => P[n]);
/**
 * ManageWebhooks is denied too: a role that has it server-wide could otherwise create a webhook in the room and post through
 * it (a webhook ignores "Send Messages"). A channel-level @everyone deny beats a role's server-wide permission.
 * Slash commands and apps are closed too: most of the bot's commands (/recite, /leave, /volume…) answer in the channel where they were
 * typed, so a member could otherwise make the bot post there. Buttons and menus of the panels are NOT affected (they are not commands).
 */
/**
 * The voice room is the ONE room where members take part: they join, speak AND write in its chat and may use commands.
 * Only the soundboard (and external sounds) is closed. Everything an earlier version of /setup denied there is put back to
 * "inherit" on a repair.
 */
const VOICE_LOCK_NAMES = ['UseSoundboard', 'UseExternalSounds'].filter(n => P[n] !== undefined);
const VOICE_LOCK = VOICE_LOCK_NAMES.map(n => P[n]);
const VOICE_RESET_NAMES = [...READ_ONLY_NAMES, 'UseEmbeddedActivities', 'Speak', 'Stream'].filter(n => P[n] !== undefined);
const VOICE_RESET = VOICE_RESET_NAMES.map(n => P[n]);
const lockFor = (isVoice) => (isVoice ? { names: VOICE_LOCK_NAMES, bits: VOICE_LOCK, reset: VOICE_RESET_NAMES, resetBits: VOICE_RESET } : { names: READ_ONLY_NAMES, bits: READ_ONLY, reset: [], resetBits: [] });

/**
 * Make an EXISTING room locked for members (rooms from an earlier run, or ones the admin loosened by hand, were never
 * re-locked). It changes the @everyone overwrite and the bot's own one. Roles and members that have their OWN overwrite
 * in the room are never touched, except with `strict`; they are listed in `leaks` instead, because an explicit allow
 * on a role beats the @everyone lock: [{ channelId, id, mention, names }].
 * Returns true when it changed something, false when nothing was needed. Throws when Discord refuses.
 */
export async function lockRoom(ch, { everyone, me, botAllow, voice = false, leaks = null, strict = false }) {
  const { names, bits, reset, resetBits } = lockFor(voice);
  const ow = ch.permissionOverwrites;
  if (!ow?.edit) return false;                                   // nothing to edit (not a guild channel)
  let changed = false;

  // Who else is explicitly allowed to do what this room forbids?
  const others = [...(ow.cache?.values?.() ?? [])].filter(o => o.id !== everyone && o.id !== me && o.allow?.has);
  for (const o of others) {
    const allowed = names.filter(n => o.allow.has(P[n]));
    if (!allowed.length) continue;
    leaks?.push({ channelId: ch.id, id: o.id, mention: o.type === 1 || o.type === 'member' ? `<@${o.id}>` : `<@&${o.id}>`, names: allowed });
    if (strict) { await ow.edit(o.id, Object.fromEntries(allowed.map(n => [n, null])), { reason: '/setup' }); changed = true; }
  }

  const locked = ow.cache?.get(everyone)?.deny?.has?.(bits) && !(resetBits.length && ow.cache.get(everyone).deny.any?.(resetBits)) && ow.cache?.get(me)?.allow?.has?.(botAllow);
  if (locked) return changed;
  // The bot first: its own overwrite outranks @everyone's, so it can never lock itself out half-way.
  await ow.edit(me, Object.fromEntries(botAllow.map(b => [Object.keys(P).find(k => P[k] === b), true])), { reason: '/setup' });
  await ow.edit(everyone, { ...Object.fromEntries(reset.map(n => [n, null])), ...Object.fromEntries(names.map(n => [n, false])) }, { reason: '/setup' });
  return true;
}

/** Server-wide permissions /setup needs — everything else (writing in the new rooms) is granted by the room itself. */
export const REQUIRED_BOT_PERMS = { ManageChannels: P.ManageChannels, ViewChannel: P.ViewChannel, SendMessages: P.SendMessages, EmbedLinks: P.EmbedLinks };
// A bot can only grant a permission it has itself, so these must exist BEFORE the first room is created, otherwise
// Discord refuses the new room half-way through.
const NEEDED_FOR_ROOMS = { ReadMessageHistory: P.ReadMessageHistory };
const NEEDED_FOR_VOICE = { Connect: P.Connect, Speak: P.Speak };

/** The permissions the bot lacks: always the base ones; with `selected`, also those the picked rooms need. */
export const missingBotPerms = (guild, selected) => {
  const have = guild.members.me?.permissions;
  const need = { ...REQUIRED_BOT_PERMS, ...(selected ? { ...NEEDED_FOR_ROOMS, ...(cleanSelection(selected).includes('listen') ? NEEDED_FOR_VOICE : {}) } : {}) };
  return Object.entries(need).filter(([, bit]) => !have?.has(bit)).map(([name]) => name);
};

/**
 * Create (or reuse) the category and the rooms the admin PICKED, then wire each room to its feature. A feature that was
 * not picked gets no room and is left exactly as it is. Safe to run again: rooms saved from an earlier run that still
 * exist are reused, only missing ones are created, and nothing is ever deleted or renamed.
 *
 * @param {object} o
 * @param {object} o.guild  @param {object} o.client
 * @param {'ar'|'en'} o.lang  @param {string} o.timezone
 * @param {string[]} [o.selected]    which features to set up (default: all of them)
 * @param {object} o.saved           the `setup` section saved by the previous run ({} the first time)
 * @param {object} o.deps            { GuildSettings, sendVoicePanel, roomPanelMessage, buildEmbed, defaultAyahTime, defaultHadithTime }
 * @returns {Promise<{ channels: object, status: object, listenPanelSent: boolean, categoryId: string|null, selected: string[], lockFailed: string[], lockLeaks: object[] }>}
 */
export async function applySetup({ guild, client, lang, timezone, selected, saved = {}, deps }) {
  lang = normLang(lang);
  const picked   = cleanSelection(selected ?? SETUP_KEYS);
  const plan     = setupPlan(lang, picked);
  const me       = guild.members.me.id;
  const everyone = guild.roles.everyone.id;
  const status   = {};                                  // key → 'created' | 'reused'
  const lockFailed = [];                                // keys of rooms that could not be made read-only
  const lockLeaks  = [];                                // roles/members with their own overwrite that still allows writing
  const find     = (id) => (id ? guild.channels.cache.get(id) ?? null : null);
  const { GuildSettings } = deps;
  if (!plan.items.length) return { channels: {}, status, categoryId: null, listenPanelSent: false, selected: picked, lockFailed, lockLeaks };

  // Everything that exists is written down as soon as it exists, so a failure half-way (a Discord limit, a revoked
  // permission, a restart) never leaves rooms that the next run cannot see and would create a second time.
  const made = {};
  const remember = (categoryId) => GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: {
    'setup.categoryId': categoryId, 'setup.channels': { ...Object.fromEntries(Object.entries(saved.channels ?? {}).filter(([, id]) => find(id))), ...made }
  } }, { upsert: true });

  // 1. Category (only because at least one room is wanted)
  let category = find(saved.categoryId);
  status.category = category ? 'reused' : 'created';
  if (!category) {
    category = await guild.channels.create({ name: plan.category, type: ChannelType.GuildCategory, reason: '/setup' });
    await remember(category.id);
  }

  // 2. Rooms. Nobody but the bot writes in any of them (the bot and the buttons do the talking): the text rooms are
  //    read-only, and the voice room's own chat is too (members still join and listen). A room that already exists is
  //    re-locked as well, so a second run repairs rooms created by an older version or opened up by hand.
  const channels = {};
  for (const item of plan.items) {
    let ch = find(saved.channels?.[item.key]);
    status[item.key] = ch ? 'reused' : 'created';
    if (!ch) {
      ch = await guild.channels.create(item.type === 'voice'
        ? { name: item.name, type: ChannelType.GuildVoice, parent: category.id,
            permissionOverwrites: [{ id: everyone, deny: VOICE_LOCK }, { id: me, allow: BOT_VOICE }], reason: '/setup' }
        : { name: item.name, type: ChannelType.GuildText, parent: category.id, topic: item.topic,
            permissionOverwrites: [{ id: everyone, deny: READ_ONLY }, { id: me, allow: BOT_TEXT }], reason: '/setup' });
      made[item.key] = ch.id;
      await remember(category.id);
    } else {
      await lockRoom(ch, { everyone, me, voice: item.type === 'voice', leaks: lockLeaks, botAllow: item.type === 'voice' ? BOT_VOICE : BOT_TEXT }).catch(() => { lockFailed.push(item.key); });
    }
    channels[item.key] = ch;
  }
  const ids = Object.fromEntries(Object.entries(channels).map(([k, c]) => [k, c.id]));
  // Rooms from an earlier run that still exist belong in the guide too, even when this run did not pick them.
  const known = { ...Object.fromEntries(Object.entries(saved.channels ?? {}).filter(([, id]) => find(id))), ...ids };

  // 3. Wiring
  const settings = await GuildSettings.findOne({ guildId: guild.id }, { adhkar: 1, ayah: 1, hadith: 1, wird: 1 }).lean();

  // 3a. Guide (edited in place on a re-run so there is never a second copy)
  let guideMessageId = saved.guideMessageId ?? null;
  if (channels.start) {
    const embed = deps.buildEmbed(guideContent(lang, known));
    const payload = { embeds: [embed], allowedMentions: { parse: [] } };
    const old = guideMessageId ? await channels.start.messages?.fetch(guideMessageId).catch(() => null) : null;
    if (old) await old.edit(payload).catch(() => {});
    else guideMessageId = (await channels.start.send(payload)).id;
  }

  // 3b. Control panel in the voice room's own chat
  const sent = channels.listen ? await deps.sendVoicePanel(client, guild, channels.listen, null).catch(() => null) : null;

  // 3c. Adhkar + duas: same defaults as /adhkar enable (all-day posts on the first time only)
  if (channels.adhkar) {
    const a = settings?.adhkar ?? {};
    const firstAdhkar = !a.channelId && a.scatter?.enabled === undefined;
    await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: {
      'adhkar.enabled': true, 'adhkar.channelId': ids.adhkar, 'adhkar.timezone': timezone,
      ...(firstAdhkar ? { 'adhkar.scatter.enabled': true } : {})
    } }, { upsert: true });
  }

  // 3d. Verse of the day
  if (channels.ayah) {
    await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: {
      'ayah.enabled': true, 'ayah.channelId': ids.ayah, ...(settings?.ayah?.time ? {} : { 'ayah.time': deps.defaultAyahTime })
    } }, { upsert: true });
  }

  // 3d2. Hadith of the day
  if (channels.hadith) {
    await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: {
      'hadith.enabled': true, 'hadith.channelId': ids.hadith, ...(settings?.hadith?.time ? {} : { 'hadith.time': deps.defaultHadithTime })
    } }, { upsert: true });
  }

  // 3e. Wird room: the panel in the chosen language (the old panel is replaced, so there is never a second one)
  if (channels.wird) {
    const prev = settings?.wird ?? {};
    const prevCh = prev.channelId ? find(prev.channelId) : null;
    if (prevCh && prev.panelMessageId) await prevCh.messages?.delete(prev.panelMessageId).catch(() => {});
    const msg = await channels.wird.send({ ...deps.roomPanelMessage(lang), allowedMentions: { parse: [] } });
    await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: { 'wird.channelId': ids.wird, 'wird.panelMessageId': msg.id, 'wird.lang': lang } }, { upsert: true });
  }

  // 4. Remember what exists, so a second run reuses it
  await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: {
    'setup.categoryId': category.id, 'setup.channels': known, 'setup.guideMessageId': guideMessageId, 'setup.lockedAt': new Date()
  } }, { upsert: true });

  return { channels, status, categoryId: category.id, listenPanelSent: !!sent, selected: picked, lockFailed, lockLeaks };
}

/**
 * ONE-TIME repair (run by hand: `npm run fix-locks`) for servers that ran /setup before the rooms were locked: every saved room that still exists is made
 * read-only for members. A server is claimed atomically (`setup.lockedAt`) BEFORE it is touched, so it is processed once
 * only: not again on the next restart, and not twice if two processes start together. Servers where Discord refuses are
 * logged and still marked done (an admin fixes those by running /setup again, which re-locks the rooms it reuses).
 * Nothing is ever deleted or renamed.
 *
 * @returns {Promise<{ servers: number, rooms: number, failed: number, leaks: object[] }>}
 */
export async function migrateSetupLocks(client, GuildSettings, log = () => {}, { force = false, strict = false } = {}) {
  const out = { servers: 0, rooms: 0, failed: 0, leaks: [] };
  const todo = await GuildSettings.find({ 'setup.categoryId': { $ne: null }, ...(force ? {} : { 'setup.lockedAt': null }) }, { guildId: 1, setup: 1 }).lean();
  for (const doc of todo) {
    const guild = client.guilds.cache.get(doc.guildId);
    if (!guild) continue;                                        // bot is not (or no longer) there: leave it for a later run
    if (!guild.members?.me) await guild.members?.fetchMe?.().catch(() => null);
    if (!guild.members?.me) continue;
    const claimed = await GuildSettings.findOneAndUpdate({ guildId: doc.guildId, ...(force ? {} : { 'setup.lockedAt': null }) }, { $set: { 'setup.lockedAt': new Date() } });
    if (!claimed) continue;                                      // someone else took it
    out.servers++;
    const ctx = { everyone: guild.roles.everyone.id, me: guild.members.me.id };
    const before = out.leaks.length;
    for (const id of Object.values(doc.setup?.channels ?? {})) {
      const ch = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
      if (!ch) continue;
      try { if (await lockRoom(ch, { ...ctx, strict, leaks: out.leaks, voice: ch.type === ChannelType.GuildVoice, botAllow: ch.type === ChannelType.GuildVoice ? BOT_VOICE : BOT_TEXT })) out.rooms++; }
      catch (err) { out.failed++; log(`[setup-lock] ${guild.id}/${id}: ${err.message}`); }
    }
    for (const l of out.leaks.slice(before)) l.guildId = guild.id;
  }
  return out;
}
