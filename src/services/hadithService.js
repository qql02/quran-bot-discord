import { notifyGuildOwner } from './ownerNotice.js';
import { pingableRoleId } from '../utils/roles.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Blacklist } from '../models/Blacklist.js';
import { logger } from '../utils/logger.js';
import { COLORS, THUMBNAIL } from '../utils/embeds.js';
import { localClock, DEFAULT_TIMEZONE } from '../utils/adhkarSchedule.js';
import { ayahDueDate } from '../data/ayahs.js';          // the due-window rule is the same one the verse of the day uses
import { hadithForDate, hadithUrl, HADITH_SOURCES } from '../data/hadiths.js';
import { resolveChannel } from './adhkarService.js';
import { isFeatureOn } from '../utils/botControl.js';
import { getControlSync } from './controlService.js';

const TICK_MS = 60_000;

let timer   = null;
let running = false;

/** The message for one hadith entry (from data/hadiths.js). */
export function buildHadithMessage(h, { title = 'حديث اليوم', footer = 'اللهم صلّ وسلّم على نبينا محمد' } = {}) {
  const src = HADITH_SOURCES[h.s];
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(title)
    .setDescription(h.t)
    .addFields({ name: 'المصدر', value: `${src.name} · حديث رقم ${h.n}${h.by ? ` · ${h.by}` : ''}` })
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: footer, iconURL: THUMBNAIL });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('اقرأ الحديث في المصدر').setURL(hadithUrl(h))
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Post the hadith of `date` to a channel.
 * @returns {{ ok: true, id: string } | { ok: false, reason: string }}
 */
export async function sendHadith(client, guildId, channelId, date, opts = {}) {
  let resolved;
  try { resolved = await resolveChannel(client, guildId, channelId); }
  catch (err) { logger.warn(`[hadith:${guildId}] channel lookup failed: ${err.message}`); return { ok: false, reason: 'send_failed' }; }
  if (resolved.error) return { ok: false, reason: resolved.error };

  const roleId = pingableRoleId(client.guilds.cache.get(guildId), opts.roleId);
  try {
    const msg = await resolved.channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      ...buildHadithMessage(hadithForDate(date)),
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });
    return { ok: true, id: msg.id };
  } catch (err) {
    if (err?.code === 10003) return { ok: false, reason: 'unknown_channel' };
    if (err?.code === 50001 || err?.code === 50013) return { ok: false, reason: 'no_permission' };
    logger.warn(`[hadith:${guildId}] send failed: ${err.message}`);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Effective timezone of a guild's hadith post (own setting → adhkar timezone → default). */
export const hadithTimezone = (doc) => doc.hadith?.timezone || doc.adhkar?.timezone || DEFAULT_TIMEZONE;

// ── Scheduler (same shape as the verse-of-the-day one) ─────────────────────────────────────────────────────────────
async function runTick(client) {
  if (!isFeatureOn(getControlSync(), 'hadith')) return;       // switched off by the owner (dashboard)
  const docs = await GuildSettings.find(
    { 'hadith.enabled': true, 'hadith.channelId': { $type: 'string' } },
    { guildId: 1, hadith: 1, 'adhkar.timezone': 1 }
  ).lean();

  for (const doc of docs) {
    const { guildId, hadith } = doc;
    if (!client.guilds.cache.has(guildId)) continue;

    let date;
    try {
      const tz = hadithTimezone(doc);
      date = ayahDueDate(hadith, (now) => localClock(tz, now));
    } catch (err) { logger.warn(`[hadith:${guildId}] bad schedule: ${err.message}`); continue; }
    if (!date) continue;

    try { if (await Blacklist.isBanned(guildId)) continue; } catch { /* DB hiccup — don't block delivery */ }

    // Atomic claim: one tick/process wins a given local date.
    const claimed = await GuildSettings.findOneAndUpdate(
      { guildId, 'hadith.enabled': true, 'hadith.lastDate': { $ne: date } },
      { $set: { 'hadith.lastDate': date } }
    ).lean();
    if (!claimed?.hadith?.channelId) continue;

    const res = await sendHadith(client, guildId, claimed.hadith.channelId, date, { roleId: claimed.hadith.roleId });
    if (res.ok) { logger.info(`[hadith:${guildId}] posted hadith of the day`); continue; }

    logger.warn(`[hadith:${guildId}] not posted (${res.reason})`);
    await notifyGuildOwner(client, guildId, 'hadith', res.reason, claimed.hadith.channelId);
    // Transient failure and nothing reached the channel → release the claim; the next tick retries inside the catch-up window.
    if (res.reason === 'send_failed') {
      await GuildSettings.updateOne({ guildId, 'hadith.lastDate': date }, { $set: { 'hadith.lastDate': claimed.hadith.lastDate ?? null } }).catch(() => {});
    } else if (res.reason === 'unknown_channel') {
      await GuildSettings.updateOne({ guildId }, { $set: { 'hadith.enabled': false } }).catch(() => {});
      logger.warn(`[hadith:${guildId}] channel deleted — hadith of the day disabled`);
    }
  }
}

export function startHadithScheduler(client) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runTick(client); }
    catch (err) { logger.error('[hadith] scheduler tick failed:', err.message); }
    finally { running = false; }
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
  logger.info('[hadith] hadith-of-the-day scheduler started');
}
