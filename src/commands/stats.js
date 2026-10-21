import { SlashCommandBuilder } from 'discord.js';
import { buildStatsMessage } from '../utils/statsCard.js';

/** /stats — this server's recitation statistics. */
export default {
  data: new SlashCommandBuilder().setName('stats').setDescription('Server recitation stats / إحصائيات التلاوة في السيرفر').setDMPermission(false),
  async execute(interaction) { return interaction.reply({ ...(await buildStatsMessage(interaction.guildId)), ephemeral: true }); }
};
