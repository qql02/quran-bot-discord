import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { hubHome } from '../panels/hub.js';

/**
 * /setup — the server settings panel. One private card for everything an admin configures: adhkar, verse of the day, events,
 * radio stations, the wird room, language and the automatic rooms. (Replaces /adhkar, /events, /stations, /language, /wird setup.)
 */
export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('⚙️ Server settings panel: adhkar, events, stations, language… / لوحة إعدادات السيرفر')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: lang === 'ar' ? '🔒 تحتاج صلاحية «إدارة السيرفر».' : '🔒 You need the Manage Server permission.', ephemeral: true });
    }
    return interaction.reply({ ...(await hubHome(interaction.guild, lang)), ephemeral: true });
  }
};
