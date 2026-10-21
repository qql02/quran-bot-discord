import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { guideHome } from '../panels/guide.js';

/** /guide — the user guide: how to use the bot and get the most out of it (topics + questions and answers). */
export default {
  data: new SlashCommandBuilder()
    .setName('guide')
    .setDescription('User guide and FAQ / دليل المستخدم وأسئلة شائعة')
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    return interaction.reply({ ...guideHome(lang), ephemeral: true });
  }
};
