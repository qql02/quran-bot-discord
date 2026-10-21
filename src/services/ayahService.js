import axios from 'axios';
import { notifyGuildOwner } from './ownerNotice.js';
import { pingableRoleId } from '../utils/roles.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Blacklist } from '../models/Blacklist.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { COLORS, THUMBNAIL } from '../utils/embeds.js';
import { localClock, DEFAULT_TIMEZONE } from '../utils/adhkarSchedule.js';
import { ayahRefForDate, ayahDueDate, parseRef } from '../data/ayahs.js';
import { resolveChannel } from './adhkarService.js';
import { isFeatureOn } from '../utils/botControl.js';
import { getControlSync } from './controlService.js';

const TICK_MS = 60_000;
const MAX_TAFSIR = 1000;          // embed field limit is 1024

let timer   = null;
let running = false;

// ── Fetching (verse text + short tafsir), cached per reference ────────────────────────────────────────────────────
const cache = new Map();          // "2:255" → { ref, surah, ayah, surahName, text, tafsir, page }
const CACHE_MAX = 200;           // the verse of the day uses one entry a day; /journey walks a few dozen distinct verses
const failedAt = new Map();       // ref → timestamp of the last failed fetch (don't hammer a dead API every minute)
const RETRY_AFTER_MS = 60_000;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** @returns {Promise<{ref,surah,ayah,surahName,text,tafsir}|null>} null when the API is unreachable or the answer looks wrong */
export async function fetchAyah(ref, tafsirOverride = null) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const { apiUrl, textEdition, timeoutMs } = config.ayah;
  // /journey lets a member pick another tafsir edition of the same API (e.g. ar.jalalayn); anything odd-looking is ignored.
  const tafsirEdition = /^[a-z]{2}\.[a-z]{3,20}$/.test(tafsirOverride ?? '') ? tafsirOverride : config.ayah.tafsirEdition;
  const key = tafsirEdition === config.ayah.tafsirEdition ? ref : `${ref}|${tafsirEdition}`;
  if (cache.has(key)) return cache.get(key);
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_AFTER_MS) return null;

  const endpoint = `${apiUrl}/ayah/${parsed.surah}:${parsed.ayah}/editions/${textEdition},${tafsirEdition}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data } = await axios.get(endpoint, { timeout: timeoutMs, maxRedirects: 2, maxContentLength: 1_000_000, responseType: 'json' });
      const list   = Array.isArray(data?.data) ? data.data : [];
      const text   = list.find(e => e?.edition?.identifier === textEdition);
      const tafsir = list.find(e => e?.edition?.identifier === tafsirEdition);
      // Never post something we cannot verify: right verse number, non-empty text and tafsir.
      if (!text?.text || !tafsir?.text || text.surah?.number !== parsed.surah || text.numberInSurah !== parsed.ayah) {
        throw new Error('unexpected API response');
      }
      const out = {
        ref, surah: parsed.surah, ayah: parsed.ayah,
        surahName: clean(text.surah.name).replace(/^سورة\s*/, ''),
        text: clean(text.text),
        tafsir: clean(tafsir.text),
        page: Number.isInteger(text.page) && text.page >= 1 && text.page <= 604 ? text.page : null   // Mushaf page (used by /journey)
      };
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, out);
      failedAt.delete(key);
      return out;
    } catch (err) {
      if (attempt === 2) logger.warn(`[ayah] fetch ${ref} failed: ${err.message}`);
      else await new Promise(r => setTimeout(r, 1500));
    }
  }
  failedAt.set(key, Date.now());
  return null;
}

const shorten = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

export function buildAyahMessage(a, { title = 'آية اليوم', footer = 'تدبّر الآية وشاركنا ما استوقفك فيها' } = {}) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(title)
    .setDescription(`## ﴿ ${a.text} ﴾\n**سورة ${a.surahName} · الآية ${a.ayah}**`)
    .addFields({ name: 'التفسير الميسر', value: shorten(a.tafsir, MAX_TAFSIR) })
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: footer, iconURL: THUMBNAIL });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('اقرأ السورة كاملة')
      .setURL(`https://quran.com/${a.surah}/${a.ayah}`)
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Post the verse of `date` to a channel.
 * @returns {{ ok: true, id: string } | { ok: false, reason: string }}
 */
export async function sendAyah(client, guildId, channelId, date, opts = {}) {
  const verse = await fetchAyah(ayahRefForDate(date));
  if (!verse) return { ok: false, reason: 'api_failed' };

  let resolved;
  try { resolved = await resolveChannel(client, guildId, channelId); }
  catch (err) { logger.warn(`[ayah:${guildId}] channel lookup failed: ${err.message}`); return { ok: false, reason: 'send_failed' }; }
  if (resolved.error) return { ok: false, reason: resolved.error };

  const roleId = pingableRoleId(client.guilds.cache.get(guildId), opts.roleId);
  try {
    const msg = await resolved.channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      ...buildAyahMessage(verse),
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });
    return { ok: true, id: msg.id };
  } catch (err) {
    if (err?.code === 10003) return { ok: false, reason: 'unknown_channel' };
    if (err?.code === 50001 || err?.code === 50013) return { ok: false, reason: 'no_permission' };
    logger.warn(`[ayah:${guildId}] send failed: ${err.message}`);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Effective timezone of a guild's verse post (own setting → adhkar timezone → default). */
export const ayahTimezone = (doc) => doc.ayah?.timezone || doc.adhkar?.timezone || DEFAULT_TIMEZONE;

// ── Scheduler ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function runTick(client) {
  if (!isFeatureOn(getControlSync(), 'ayah')) return;         // switched off by the owner (dashboard)
  const docs = await GuildSettings.find(
    { 'ayah.enabled': true, 'ayah.channelId': { $type: 'string' } },
    { guildId: 1, ayah: 1, 'adhkar.timezone': 1 }
  ).lean();

  for (const doc of docs) {
    const { guildId, ayah } = doc;
    if (!client.guilds.cache.has(guildId)) continue;

    let date;
    try {
      const tz = ayahTimezone(doc);
      date = ayahDueDate(ayah, (now) => localClock(tz, now));
    } catch (err) { logger.warn(`[ayah:${guildId}] bad schedule: ${err.message}`); continue; }
    if (!date) continue;

    try { if (await Blacklist.isBanned(guildId)) continue; } catch { /* DB hiccup — don't block delivery */ }

    // Atomic claim: one tick/process wins a given local date.
    const claimed = await GuildSettings.findOneAndUpdate(
      { guildId, 'ayah.enabled': true, 'ayah.lastDate': { $ne: date } },
      { $set: { 'ayah.lastDate': date } }
    ).lean();
    if (!claimed?.ayah?.channelId) continue;

    const res = await sendAyah(client, guildId, claimed.ayah.channelId, date, { roleId: claimed.ayah.roleId });
    if (res.ok) { logger.info(`[ayah:${guildId}] posted verse of the day`); continue; }

    logger.warn(`[ayah:${guildId}] not posted (${res.reason})`);
    await notifyGuildOwner(client, guildId, 'ayah', res.reason, claimed.ayah.channelId);
    // Transient (API down / network) and nothing reached the channel → release the claim; the next tick retries
    // inside the catch-up window.
    if (res.reason === 'api_failed' || res.reason === 'send_failed') {
      await GuildSettings.updateOne({ guildId, 'ayah.lastDate': date }, { $set: { 'ayah.lastDate': claimed.ayah.lastDate ?? null } }).catch(() => {});
    } else if (res.reason === 'unknown_channel') {
      await GuildSettings.updateOne({ guildId }, { $set: { 'ayah.enabled': false } }).catch(() => {});
      logger.warn(`[ayah:${guildId}] channel deleted — verse of the day disabled`);
    }
  }
}

export function startAyahScheduler(client) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runTick(client); }
    catch (err) { logger.error('[ayah] scheduler tick failed:', err.message); }
    finally { running = false; }
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
  logger.info('[ayah] verse-of-the-day scheduler started');
}
