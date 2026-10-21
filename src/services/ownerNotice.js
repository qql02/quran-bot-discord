import { EmbedBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { COLORS } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

/**
 * When a scheduled post cannot be delivered because the bot lost access (permissions removed, channel deleted), the
 * server owner is told ONCE A WEEK per feature — otherwise the feature just goes quiet and nobody knows why.
 * Only these two reasons qualify: network / API hiccups are transient and retried by the scheduler itself.
 * Never throws: a closed DM must not break the scheduler. (The throttle is in memory — a restart may repeat one notice.)
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_KEYS = 5000;
const lastSent = new Map();

const FEATURES = {
  adhkar: { ar: 'الأذكار', en: 'Adhkar',          fix: '/adhkar' },
  ayah:   { ar: 'آية اليوم', en: 'Verse of the day', fix: '/adhkar' },
  hadith: { ar: 'حديث اليوم', en: 'Hadith of the day', fix: '/setup' },
  event:  { ar: 'الفعاليات الدينية', en: 'Religious events', fix: '/events' }
};

/** Pure: the message the owner receives. */
export function buildOwnerNotice({ guildName, feature, reason, channelId, lang = 'ar' }) {
  const f  = FEATURES[feature] ?? FEATURES.adhkar;
  const ch = channelId ? `<#${channelId}>` : (lang === 'en' ? 'its channel' : 'قناتها');
  const ar = lang !== 'en';
  const lost = reason === 'unknown_channel';
  const title = ar ? `توقف نشر ${f.ar} في ${guildName}` : `${f.en} posts stopped in ${guildName}`;
  const body = ar
    ? [lost ? `القناة ${ch} لم تعد موجودة، فتوقف نشر **${f.ar}** تلقائياً.` : `لم يعد للبوت صلاحية النشر في ${ch}، فلم يُنشر **${f.ar}** اليوم.`, '',
       lost ? `اختر قناة جديدة بالأمر \`${f.fix}\`.` : 'أعد للبوت صلاحيات **عرض القناة** و**إرسال الرسائل** و**تضمين الروابط**، أو اختر قناة أخرى بالأمر ' + `\`${f.fix}\`.`,
       'سأذكّرك مرة أسبوعياً على الأكثر إن استمرت المشكلة.'].join('\n')
    : [lost ? `The channel ${ch} no longer exists, so **${f.en}** posting was switched off.` : `The bot can no longer post in ${ch}, so **${f.en}** was not posted today.`, '',
       lost ? `Pick a new channel with \`${f.fix}\`.` : `Give the bot **View Channel**, **Send Messages** and **Embed Links** there again, or pick another channel with \`${f.fix}\`.`,
       'I will remind you at most once a week while this continues.'].join('\n');
  return { embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle(title).setDescription(body)] };
}

export const resetOwnerNoticeThrottle = () => lastSent.clear();

/** @returns {Promise<boolean>} true when a notice was actually delivered */
export async function notifyGuildOwner(client, guildId, feature, reason, channelId = null) {
  try {
    if (reason !== 'no_permission' && reason !== 'unknown_channel') return false;
    const key = `${guildId}:${feature}`;
    if (Date.now() - (lastSent.get(key) ?? 0) < WEEK_MS) return false;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    lastSent.set(key, Date.now());                                   // claim first: a failed DM is not retried every minute
    if (lastSent.size > MAX_KEYS) lastSent.delete(lastSent.keys().next().value);

    let lang = 'ar';
    try { lang = await GuildSettings.getLanguage(guildId); } catch { /* default */ }
    const owner = await guild.fetchOwner();
    await owner.send(buildOwnerNotice({ guildName: guild.name, feature, reason, channelId, lang }));
    logger.info(`[owner-notice:${guildId}] told the owner about ${feature} (${reason})`);
    return true;
  } catch (err) {
    logger.debug?.(`[owner-notice:${guildId}] could not notify the owner: ${err?.message}`);
    return false;
  }
}
