import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { COLORS, buildErrorEmbed } from '../utils/embeds.js';

/**
 * /hijri — today's Hijri date (Umm al-Qura calendar) with the Gregorian date and weekday.
 *   /hijri                → today, in the server's timezone (the adhkar timezone from /setup, default Asia/Riyadh)
 *   /hijri adjust:<-2…2>  → shift the Hijri date by days, for places that follow a different moon sighting
 * Pure Intl — no network call, no database write.
 */

const HIJRI_MONTHS = {
  ar: ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'],
  en: ['Muharram', 'Safar', 'Rabiʿ al-Awwal', 'Rabiʿ al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', 'Shaʿban', 'Ramadan', 'Shawwal', 'Dhul-Qaʿdah', 'Dhul-Hijjah']
};
const DAY_MS = 86_400_000;
const FALLBACK_TZ = 'Asia/Riyadh';

const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

const partsOf = (locale, date, tz, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).formatToParts(date).map(p => [p.type, p.value]));

/** Umm al-Qura when this Node/ICU build has it; otherwise the tabular civil calendar (never a silent Gregorian answer). */
const HIJRI_CAL = (() => {
  for (const cal of ['islamic-umalqura', 'islamic-civil']) {
    try { if (new Intl.DateTimeFormat(`en-u-ca-${cal}`).resolvedOptions().calendar === cal) return cal; } catch { /* try next */ }
  }
  return null;
})();

/**
 * Hijri date of the instant `now` in `tz`. `adjust` shifts ONLY the Hijri date (moon-sighting difference);
 * the Gregorian date and weekday always stay the real ones. Exported for tests.
 */
export function hijriDate(now = new Date(), tz = FALLBACK_TZ, adjust = 0) {
  if (!HIJRI_CAL) throw new Error('This Node build has no Hijri calendar support (Intl islamic calendars)');
  const shifted = new Date(now.getTime() + adjust * DAY_MS);
  const h = partsOf(`en-u-ca-${HIJRI_CAL}-nu-latn`, shifted, tz, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const g = partsOf('en-u-ca-gregory-nu-latn', now, tz, { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' });
  const weekdayAr = new Intl.DateTimeFormat('ar-u-nu-latn', { timeZone: tz, weekday: 'long' }).format(now);
  return {
    day: Number(h.day), month: Number(h.month), year: Number.parseInt(h.year, 10),
    gregorian: { day: Number(g.day), month: Number(g.month), year: Number(g.year) },
    weekdayEn: g.weekday, weekdayAr, calendar: HIJRI_CAL
  };
}

const MONTHS_G = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};

export default {
  data: new SlashCommandBuilder()
    .setName('hijri')
    .setDescription("Today's Hijri date / التاريخ الهجري اليوم")
    .addIntegerOption(o => o.setName('adjust').setDescription('Shift the date by days (-2 to 2) / تعديل الأيام (من -2 إلى 2)').setMinValue(-2).setMaxValue(2))
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    const settings = await GuildSettings.findOne({ guildId: interaction.guildId }).lean().catch(() => null);
    const tz = validTz(settings?.adhkar?.timezone) ? settings.adhkar.timezone : FALLBACK_TZ;
    const adjust = interaction.options.getInteger('adjust') ?? 0;

    let d;
    try { d = hijriDate(new Date(), tz, adjust); }
    catch { return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'التقويم الهجري غير مدعوم على هذا الخادم.' : 'The Hijri calendar is not supported on this server.', lang)], ephemeral: true }); }
    const l = ar ? 'ar' : 'en';
    const month = HIJRI_MONTHS[l][d.month - 1];
    const g = d.gregorian;
    const hijriLine = ar ? `**${d.day} ${month} ${d.year} هـ**` : `**${d.day} ${month} ${d.year} AH**`;
    const gregLine = `${g.day} ${MONTHS_G[l][g.month - 1]} ${g.year}`;

    const embed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle(ar ? '📅 التاريخ الهجري' : '📅 Hijri Date')
      .setDescription(`${ar ? d.weekdayAr : d.weekdayEn}\n${hijriLine}`)
      .addFields({ name: ar ? 'الميلادي' : 'Gregorian', value: gregLine })
      .setFooter({ text: ar ? `التقويم: ${d.calendar === 'islamic-umalqura' ? 'أم القرى' : 'مدني'}${adjust ? ` · تعديل ${adjust > 0 ? '+' : ''}${adjust}` : ''} · ${tz}` : `Calendar: ${d.calendar === 'islamic-umalqura' ? 'Umm al-Qura' : 'civil'}${adjust ? ` · adjusted ${adjust > 0 ? '+' : ''}${adjust}` : ''} · ${tz}` });

    return interaction.reply({ embeds: [embed] });
  }
};
