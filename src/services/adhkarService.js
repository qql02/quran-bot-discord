import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { notifyGuildOwner } from './ownerNotice.js';
import { pingableRoleId } from '../utils/roles.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Blacklist } from '../models/Blacklist.js';
import { logger } from '../utils/logger.js';
import { THUMBNAIL } from '../utils/embeds.js';
import { renderAdhkarPages, renderScatterAdhkar, KIND_META, SCATTER_META, SCATTER_KEEP } from '../data/adhkar.js';
import { dueSlots, dueScatter, weekdayOf } from '../utils/adhkarSchedule.js';
import { isFeatureOn } from '../utils/botControl.js';
import { getControlSync } from './controlService.js';
import { buildExpiry, MAX_PENDING, MAX_TRIES, isPermanentDeleteError } from '../utils/adhkarExpiry.js';

const TICK_MS = 60_000;
const SEND_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

let timer   = null;
let running = false;

function pagesToEmbeds(meta, pages) {
  return pages.map((page, i) => {
    const e = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(page.title)
      .addFields(page.fields);
    if (page.description) e.setDescription(page.description);
    if (i === 0) e.setThumbnail(THUMBNAIL);
    if (i === pages.length - 1) e.setFooter({ text: 'تقبّل الله منا ومنكم صالح الأعمال', iconURL: THUMBNAIL });
    return e;
  });
}

export function buildAdhkarEmbeds(kind, style = 'full') {
  return pagesToEmbeds(KIND_META[kind], renderAdhkarPages(kind, { style }));
}

export async function resolveChannel(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { error: 'no_guild' };
  let hidden = false;
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(err => {
    if (err?.code === 10003) return null;       // Unknown Channel — deleted
    // The bot can no longer see the channel: an admin has to fix that, retrying every minute for two hours only
    // fills the log (the callers treat send_failed as "transient" and release their claim).
    if (err?.code === 50001 || err?.code === 50013) { hidden = true; return null; }
    throw err;
  });
  if (hidden) return { error: 'no_permission' };
  if (!channel) return { error: 'unknown_channel' };
  if (!channel.isTextBased?.() || !channel.send) return { error: 'not_text' };
  if (!channel.permissionsFor(guild.members.me)?.has(SEND_PERMS)) return { error: 'no_permission' };
  return { channel };
}

/**
 * Post one adhkar set to a channel.
 * @param {{ style?: 'full'|'compact', roleId?: string|null }} [opts]
 * @returns {{ ok: true, ids: string[] } | { ok: false, reason: 'no_guild'|'unknown_channel'|'not_text'|'no_permission'|'send_failed', sent?: number }}
 */
export async function sendAdhkar(client, guildId, channelId, kind, opts = {}) {
  let resolved;
  try {
    resolved = await resolveChannel(client, guildId, channelId);
  } catch (err) {
    logger.warn(`[adhkar:${guildId}] channel lookup failed: ${err.message}`);
    return { ok: false, reason: 'send_failed' };
  }
  if (resolved.error) return { ok: false, reason: resolved.error };

  // A deleted role must not leave a dangling "<@&id>" in the post.
  const roleId = pingableRoleId(client.guilds.cache.get(guildId), opts.roleId);

  const ids = [];
  try {
    const embeds = buildAdhkarEmbeds(kind, opts.style === 'compact' ? 'compact' : 'full');
    for (let i = 0; i < embeds.length; i++) {
      const ping = i === 0 && roleId;
      const msg = await resolved.channel.send({
        content: ping ? `<@&${roleId}>` : undefined,
        embeds: [embeds[i]],
        allowedMentions: ping ? { roles: [roleId] } : { parse: [] }
      });
      ids.push(msg.id);
    }
    return { ok: true, ids };
  } catch (err) {
    if (err?.code === 10003) return { ok: false, reason: 'unknown_channel', sent: ids.length };
    if (err?.code === 50001 || err?.code === 50013) return { ok: false, reason: 'no_permission', sent: ids.length };
    logger.warn(`[adhkar:${guildId}] send failed: ${err.message}`);
    return { ok: false, reason: 'send_failed', sent: ids.length };
  }
}

/** One random-time post as an embed (also used by the owner preview). */
export function buildScatterEmbed(exclude = [], minutes, weekday) {
  const { page, title } = renderScatterAdhkar({ exclude, minutes, weekday });
  return { embed: pagesToEmbeds(SCATTER_META, [page])[0], title };
}

/**
 * Post ONE short dhikr (a random-time post). No role ping — it can come several times a day.
 * @param {{ exclude?: string[], minutes?: number, weekday?: number }} [opts]  exclude = titles of the recent posts · minutes = local time of day (picks items that fit it: sleep at night, waking in the morning…)
 * @returns {{ ok: true, id: string, title: string } | { ok: false, reason: string }}
 */
export async function sendScatter(client, guildId, channelId, opts = {}) {
  let resolved;
  try {
    resolved = await resolveChannel(client, guildId, channelId);
  } catch (err) {
    logger.warn(`[adhkar:${guildId}] channel lookup failed: ${err.message}`);
    return { ok: false, reason: 'send_failed' };
  }
  if (resolved.error) return { ok: false, reason: resolved.error };
  const { embed, title } = buildScatterEmbed(opts.exclude ?? [], opts.minutes, opts.weekday);
  try {
    const msg = await resolved.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return { ok: true, id: msg.id, title };
  } catch (err) {
    if (err?.code === 10003) return { ok: false, reason: 'unknown_channel' };
    if (err?.code === 50001 || err?.code === 50013) return { ok: false, reason: 'no_permission' };
    logger.warn(`[adhkar:${guildId}] random-time post failed: ${err.message}`);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Atomically claim random post #index of `date`: only one tick/process can win it. Returns the settings as they were, or null. */
async function claimScatter(guildId, date, index) {
  const base = { guildId, 'adhkar.enabled': true, 'adhkar.scatter.enabled': true };
  const same = await GuildSettings.findOneAndUpdate(
    { ...base, 'adhkar.scatter.day': date, 'adhkar.scatter.sent': { $ne: index } },
    { $addToSet: { 'adhkar.scatter.sent': index } }
  ).lean();
  if (same) return same;
  return GuildSettings.findOneAndUpdate(                              // first post of a new local day: start a fresh list
    { ...base, 'adhkar.scatter.day': { $ne: date } },
    { $set: { 'adhkar.scatter.day': date, 'adhkar.scatter.sent': [index] } }
  ).lean();
}

/** deleteOld: remove the previous post of this slot (only after the new one went out), then remember the new ids. */
async function rememberAndCleanup(client, guildId, slot, adhkar, ids) {
  try {
    const prev = adhkar.lastPosts?.[slot];
    if (adhkar.deleteOld && prev?.ids?.length && prev.channelId) {
      const ch = client.channels.cache.get(prev.channelId) ?? await client.channels.fetch(prev.channelId).catch(() => null);
      if (ch?.messages) await Promise.allSettled(prev.ids.map(id => ch.messages.delete(id)));
    }
    await GuildSettings.updateOne(
      { guildId },
      { $set: { [`adhkar.lastPosts.${slot}`]: adhkar.deleteOld ? { channelId: adhkar.channelId, ids } : { channelId: null, ids: [] } } }
    );
  } catch (err) {
    logger.warn(`[adhkar:${guildId}] cleanup failed: ${err.message}`);
  }
}

/** Put a scheduled post on the delete-later list (persistent). Never throws. */
async function scheduleExpiry(guildId, adhkar, ids, now = Date.now()) {
  try {
    const entry = buildExpiry(adhkar, adhkar.channelId, ids, now);
    if (!entry) return;
    await GuildSettings.updateOne({ guildId }, { $push: { 'adhkar.pendingDelete': { $each: [entry], $slice: -MAX_PENDING } } });
  } catch (err) {
    logger.warn(`[adhkar:${guildId}] could not schedule the auto-delete: ${err.message}`);
  }
}

/** Delete these messages (all of them are the bot's own). → 'done' (gone, or can never be deleted) | 'retry' (a temporary problem). */
async function deleteMessages(client, channelId, ids) {
  let channel;
  try { channel = client.channels.cache.get(channelId) ?? await client.channels.fetch(channelId); }
  catch (err) { return isPermanentDeleteError(err) ? 'done' : 'retry'; }
  if (!channel?.messages) return 'done';
  let retry = false;
  for (const id of ids) {
    try { await channel.messages.delete(id); }
    catch (err) { if (!isPermanentDeleteError(err)) retry = true; }
  }
  return retry ? 'retry' : 'done';
}

/**
 * Delete every scheduled post whose time has come. Runs on every scheduler tick (before posting), also for servers whose adhkar were
 * switched off meanwhile — a post that was promised to disappear still disappears. Never throws.
 * `model` is injectable for tests.
 */
export async function runExpirySweep(client, { now = Date.now(), model = GuildSettings } = {}) {
  const report = { deleted: 0, retried: 0, dropped: 0 };
  try {
    const docs = await model.find(
      { 'adhkar.pendingDelete': { $elemMatch: { deleteAt: { $lte: new Date(now) } } } },
      { guildId: 1, 'adhkar.pendingDelete': 1 }
    ).lean();
    for (const doc of docs) {
      for (const entry of doc.adhkar?.pendingDelete ?? []) {
        if (new Date(entry.deleteAt).getTime() > now) continue;
        const outcome = await deleteMessages(client, entry.channelId, entry.ids ?? []);
        if (outcome === 'retry' && (entry.tries ?? 0) + 1 < MAX_TRIES) {
          report.retried++;
          await model.updateOne({ guildId: doc.guildId, 'adhkar.pendingDelete._id': entry._id }, { $inc: { 'adhkar.pendingDelete.$.tries': 1 } }).catch(() => {});
          continue;
        }
        if (outcome === 'retry') report.dropped++; else report.deleted++;
        await model.updateOne({ guildId: doc.guildId }, { $pull: { 'adhkar.pendingDelete': { _id: entry._id } } }).catch(() => {});
      }
    }
    if (report.deleted) logger.info(`[adhkar] auto-deleted ${report.deleted} expired post(s)`);
  } catch (err) {
    logger.warn(`[adhkar] auto-delete sweep failed: ${err.message}`);
  }
  return report;
}

async function runTick(client) {
  await runExpirySweep(client);                               // first: what was promised to disappear (even if the feature was switched off since)
  if (!isFeatureOn(getControlSync(), 'adhkar')) return;       // switched off by the owner (dashboard)
  const docs = await GuildSettings.find(
    { 'adhkar.enabled': true, 'adhkar.channelId': { $type: 'string' } },
    { guildId: 1, adhkar: 1 }
  ).lean();

  for (const doc of docs) {
    try {
      const { guildId, adhkar } = doc;
      if (!client.guilds.cache.has(guildId)) continue;

      let slots;
      try { slots = dueSlots(adhkar); }
      catch (err) { logger.warn(`[adhkar:${guildId}] bad schedule (${adhkar.timezone}): ${err.message}`); continue; }
      const extra = dueScatter(guildId, adhkar);
      if (!slots.length && !extra.length) continue;

      try { if (await Blacklist.isBanned(guildId)) continue; } catch { /* DB hiccup — don't block delivery */ }

      for (const { slot, date } of slots) {
        const field = slot === 'morning' ? 'adhkar.lastMorning' : 'adhkar.lastEvening';
        // Atomic claim: only one tick/process wins a given slot for a given local date.
        const claimed = await GuildSettings.findOneAndUpdate(
          { guildId, 'adhkar.enabled': true, [field]: { $ne: date } },
          { $set: { [field]: date } }
        ).lean();                                     // returns the document as it was just BEFORE the claim (fresh settings)
        if (!claimed?.adhkar?.channelId) continue;
        const fresh = claimed.adhkar;

        const res = await sendAdhkar(client, guildId, fresh.channelId, slot, { style: fresh.style, roleId: fresh.roleId });
        if (res.ok) {
          logger.info(`[adhkar:${guildId}] posted ${slot} adhkar`);
          await rememberAndCleanup(client, guildId, slot, fresh, res.ids);
          await scheduleExpiry(guildId, fresh, res.ids);            // morning / evening only (not the all-day short adhkar, not the panel's test posts)
        } else {
          logger.warn(`[adhkar:${guildId}] ${slot} not posted (${res.reason})`);
          await notifyGuildOwner(client, guildId, 'adhkar', res.reason, fresh.channelId);
          // Transient failure (network / 5xx / rate limit) and nothing reached the channel → release the claim so the
          // next tick retries inside the catch-up window. Partial posts are never retried (would duplicate).
          if (res.reason === 'send_failed' && !res.sent) {
            await GuildSettings.updateOne({ guildId, [field]: date }, { $set: { [field]: fresh[slot === 'morning' ? 'lastMorning' : 'lastEvening'] ?? null } }).catch(() => {});
          }
          if (res.reason === 'unknown_channel') {
            await GuildSettings.updateOne({ guildId }, { $set: { 'adhkar.enabled': false } });
            logger.warn(`[adhkar:${guildId}] channel deleted — auto-post disabled`);
          }
        }
      }

      for (const { date, index, time } of extra) {
        const claimed = await claimScatter(guildId, date, index);
        if (!claimed?.adhkar?.channelId) continue;
        const fresh = claimed.adhkar;
        const recent = fresh.scatter?.recent ?? [];

        const res = await sendScatter(client, guildId, fresh.channelId, { exclude: recent, minutes: time, weekday: weekdayOf(date) });
        if (res.ok) {
          logger.info(`[adhkar:${guildId}] posted random-time adhkar #${index + 1}`);
          await GuildSettings.updateOne({ guildId }, { $set: { 'adhkar.scatter.recent': [...recent, res.title].slice(-SCATTER_KEEP) } }).catch(() => {});
        } else {
          logger.warn(`[adhkar:${guildId}] random-time adhkar not posted (${res.reason})`);
          await notifyGuildOwner(client, guildId, 'adhkar', res.reason, fresh.channelId);
          if (res.reason === 'send_failed') {                       // nothing reached the channel → let the next tick retry inside the window
            await GuildSettings.updateOne({ guildId, 'adhkar.scatter.day': date }, { $pull: { 'adhkar.scatter.sent': index } }).catch(() => {});
          }
          if (res.reason === 'unknown_channel') {
            await GuildSettings.updateOne({ guildId }, { $set: { 'adhkar.enabled': false } });
            logger.warn(`[adhkar:${guildId}] channel deleted — auto-post disabled`);
          }
        }
      }
    } catch (err) {
      logger.warn(`[adhkar:${doc.guildId}] tick failed for this server: ${err.message}`);
    }
  }
}

/** Starts the once-a-minute scheduler. Safe to call more than once. */
export function startAdhkarScheduler(client) {
  if (timer) return;
  const tick = async () => {
    if (running) return;                      // never overlap with a slow previous tick
    running = true;
    try { await runTick(client); }
    catch (err) { logger.error('[adhkar] scheduler tick failed:', err.message); }
    finally { running = false; }
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();                                     // catch-up right after (re)start
  logger.info('🌅 Adhkar scheduler started');
}
