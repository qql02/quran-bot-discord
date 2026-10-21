import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { parseTarget } from '../utils/mushaf.js';
import { openMushaf } from '../components/mushafHandler.js';

/** /mushaf — the Mushaf for everyone (no subscription): text, or a picture of the page in Hafs / Warsh, switched with buttons. `page`: 45, "juz 5", "surah kahf". */
export default {
  data: new SlashCommandBuilder()
    .setName('mushaf')
    .setDescription('Read the Mushaf — text or Hafs / Warsh page images / اقرأ المصحف: نص أو صور حفص وورش')
    .setDMPermission(false)
    .addStringOption(o => o.setName('page').setDescription('Page 45, juz 5, or a surah name — empty = where you stopped / صفحة أو جزء أو سورة').setRequired(false).setMaxLength(40)),

  async execute(interaction) {
    const raw = interaction.options.getString('page')?.trim();
    if (!raw) return openMushaf(interaction, null);
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const target = parseTarget(raw, lang);
    if (target.error) return interaction.reply({ embeds: [buildErrorEmbed(target.error, lang)], ephemeral: true });
    return openMushaf(interaction, target.page);
  }
};
