import { EmbedBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Statistics } from '../models/Statistics.js';
import { t } from './i18n.js';
import { COLORS, THUMBNAIL } from './embeds.js';

/** The server's recitation stats as a message payload. */
export async function buildStatsMessage(guildId) {
    const lang  = await GuildSettings.getLanguage(guildId);
    const stats = await Statistics.findOne({ guildId: guildId }).lean();

    if (!stats || stats.totalSessions === 0) {
      return ({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle(t(lang, 'commands.stats.title'))
            .setDescription(t(lang, 'commands.stats.no_stats'))
            .setThumbnail(THUMBNAIL)
            .setTimestamp()
        ]
      });
    }

    // Format play time
    const totalSecs = stats.totalPlayTime ?? 0;
    const hours     = Math.floor(totalSecs / 3600);
    const minutes   = Math.floor((totalSecs % 3600) / 60);
    const timeStr   = t(lang, 'commands.stats.time_format', {
      hours:   String(hours),
      minutes: String(minutes)
    });

    // Top reciter
    const topReciter = Statistics.getTopReciter(stats);

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(t(lang, 'commands.stats.title'))
      .setThumbnail(THUMBNAIL)
      .addFields(
        {
          name:   t(lang, 'commands.stats.field_surahs'),
          value:  String(stats.totalPlayedSurahs ?? 0),
          inline: true
        },
        {
          name:   t(lang, 'commands.stats.field_playtime'),
          value:  timeStr,
          inline: true
        },
        {
          name:   t(lang, 'commands.stats.field_sessions'),
          value:  String(stats.totalSessions ?? 0),
          inline: true
        }
      )
      .setTimestamp()
      .setFooter({
        text:    lang === 'ar' ? 'بوت القرآن الكريم' : 'Quran Bot',
        iconURL: THUMBNAIL
      });

    if (topReciter) {
      embed.addFields({
        name:   t(lang, 'commands.stats.field_top_reciter'),
        value:  topReciter,
        inline: false
      });
    }

    return ({ embeds: [embed] });
}
