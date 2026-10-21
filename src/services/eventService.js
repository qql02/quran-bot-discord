import { EmbedBuilder } from 'discord.js';
import { notifyGuildOwner } from './ownerNotice.js';
import { pingableRoleId } from '../utils/roles.js';
import { ReligiousEvent } from '../models/ReligiousEvent.js';
import { Blacklist } from '../models/Blacklist.js';
import { logger } from '../utils/logger.js';
import { COLORS, THUMBNAIL } from '../utils/embeds.js';
import { localClock } from '../utils/adhkarSchedule.js';
import { eventDueDate, dayOfEvent, addDays } from '../utils/events.js';
import { resolveChannel } from './adhkarService.js';
import { isFeatureOn } from '../utils/botControl.js';
import { getControlSync } from './controlService.js';

const TICK_MS = 60_000;
const PURGE_EVERY_TICKS = 60;          // once an hour
const KEEP_FINISHED_DAYS = 60;

let timer   = null;
let running = false;
let ticks   = 0;

/** The post for one day of an event. `date` null (test post) shows no day counter. */
export function buildEventMessage(ev, date = null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(ev.title)
    .setThumbnail(THUMBNAIL);
  if (ev.description) embed.setDescription(ev.description);
  const { day, total } = date ? dayOfEvent(ev, date) : { day: 1, total: 1 };
  embed.setFooter({ text: total > 1 ? `فعالية دينية · اليوم ${day} من ${total}` : 'فعالية دينية' });
  return { embeds: [embed] };
}

/**
 * Post an event to its channel.
 * @returns {{ ok: true, id: string } | { ok: false, reason: string }}
 */
export async function sendEvent(client, ev, date = null) {
  let resolved;
  try { resolved = await resolveChannel(client, ev.guildId, ev.channelId); }
  catch (err) { logger.warn(`[event:${ev._id}] channel lookup failed: ${err.message}`); return { ok: false, reason: 'send_failed' }; }
  if (resolved.error) return { ok: false, reason: resolved.error };

  // Only ping a role that still exists in this server, and nothing else (no @everyone / users from the text).
  const roleId = pingableRoleId(client.guilds.cache.get(ev.guildId), ev.roleId);
  try {
    const msg = await resolved.channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      ...buildEventMessage(ev, date),
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });
    return { ok: true, id: msg.id };
  } catch (err) {
    if (err?.code === 10003) return { ok: false, reason: 'unknown_channel' };
    if (err?.code === 50001 || err?.code === 50013) return { ok: false, reason: 'no_permission' };
    logger.warn(`[event:${ev._id}] send failed: ${err.message}`);
    return { ok: false, reason: 'send_failed' };
  }
}

async function runTick(client) {
  if (!isFeatureOn(getControlSync(), 'events')) return;       // switched off by the owner (dashboard)
  const todayUtc = new Date().toISOString().slice(0, 10);
  const docs = await ReligiousEvent.find({ enabled: true, endDate: { $gte: addDays(todayUtc, -2) } }).lean();

  for (const ev of docs) {
    if (!client.guilds.cache.has(ev.guildId)) continue;

    let date;
    try { date = eventDueDate(ev, (now) => localClock(ev.timezone, now)); }
    catch (err) { logger.warn(`[event:${ev._id}] bad schedule: ${err.message}`); continue; }
    if (!date) continue;

    try { if (await Blacklist.isBanned(ev.guildId)) continue; } catch { /* DB hiccup — don't block delivery */ }

    // Atomic claim: one tick/process wins a given local date.
    const claimed = await ReligiousEvent.findOneAndUpdate(
      { _id: ev._id, enabled: true, lastDate: { $ne: date } },
      { $set: { lastDate: date } }
    ).lean();
    if (!claimed) continue;

    const res = await sendEvent(client, claimed, date);
    if (res.ok) { logger.info(`[event:${ev._id}] posted day ${date}`); continue; }

    logger.warn(`[event:${ev._id}] not posted (${res.reason})`);
    await notifyGuildOwner(client, claimed.guildId, 'event', res.reason, claimed.channelId);
    if (res.reason === 'api_failed' || res.reason === 'send_failed') {
      // Transient — release the claim so the next tick retries inside the catch-up window.
      await ReligiousEvent.updateOne({ _id: ev._id, lastDate: date }, { $set: { lastDate: claimed.lastDate ?? null } }).catch(() => {});
    } else if (res.reason === 'unknown_channel') {
      await ReligiousEvent.updateOne({ _id: ev._id }, { $set: { enabled: false } }).catch(() => {});
      logger.warn(`[event:${ev._id}] channel deleted — event paused`);
    }
  }

  if (++ticks % PURGE_EVERY_TICKS === 0) {
    await ReligiousEvent.deleteMany({ endDate: { $lt: addDays(todayUtc, -KEEP_FINISHED_DAYS) } }).catch(() => {});
  }
}

export function startEventScheduler(client) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runTick(client); }
    catch (err) { logger.error('[event] scheduler tick failed:', err.message); }
    finally { running = false; }
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
  logger.info('[event] religious events scheduler started');
}
