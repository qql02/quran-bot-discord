import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildQueueEmbed } from '../utils/embeds.js';
import { buildQueueButtons } from '../utils/buttons.js';
import { getSession } from '../managers/sessionManager.js';

/** /queue — what comes next (the same card as the panel's "Up next" button; its page buttons work too). */
export default {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show what is queued / عرض قائمة الانتظار').setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const s = getSession(interaction.guildId);
    if (!s) return interaction.reply({ embeds: [buildErrorEmbed(lang === 'ar' ? 'لا توجد جلسة نشطة.' : 'No active session.', lang)], ephemeral: true });
    const { embed, totalPages, currentPage } = buildQueueEmbed(s, 1, lang);
    return interaction.reply({ embeds: [embed], components: totalPages > 1 ? [buildQueueButtons(currentPage, totalPages, lang)] : [], ephemeral: true });
  }
};
