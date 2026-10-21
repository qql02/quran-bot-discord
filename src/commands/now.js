import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildInfoEmbed, statusLabel, volumeBar } from '../utils/embeds.js';
import { getSession } from '../managers/sessionManager.js';

/** /now — what is playing right now. */
export default {
  data: new SlashCommandBuilder().setName('now').setDescription('What is playing now / ما الذي يُشغَّل الآن').setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    const s = getSession(interaction.guildId);
    if (!s?.current) {
      return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'لا شيء يُشغَّل الآن. ابدأ بـ `/recite`.' : 'Nothing is playing. Start with `/recite`.', lang)], ephemeral: true });
    }
    const c = s.current;
    const name = ar ? c.surah.arabic : c.surah.english;
    const lines = [
      `**${name}**`,
      `${ar ? 'القارئ' : 'Reciter'}: ${c.reciter}${c.riwaya && !c.isRadio ? ` · ${c.riwaya}` : ''}`,
      `${ar ? 'الحالة' : 'Status'}: ${statusLabel(s, lang)}`,
      `${ar ? 'الصوت' : 'Volume'}: ${volumeBar(s.volume ?? 100)}`
    ];
    if (!c.isRadio) lines.push(`${ar ? 'في القائمة' : 'In the queue'}: ${s.queue.length}`);
    return interaction.reply({ embeds: [buildInfoEmbed(ar ? 'يُشغَّل الآن' : 'Now playing', lines.join('\n'), lang)] });
  }
};
