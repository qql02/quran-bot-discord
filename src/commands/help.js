import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { menuHome } from '../panels/menu.js';

/** /help — the member's menu (Mushaf, daily wird, stats, invite, support, the player panel). */
export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('📋 Menu: mushaf, wird, stats, support / القائمة: المصحف، الورد، الإحصائيات')
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    return interaction.reply({ ...menuHome(lang, isAdmin), ephemeral: true });
  }
};
