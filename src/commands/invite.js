import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildInfoEmbed } from '../utils/embeds.js';
import { t } from '../utils/i18n.js';
import { buildInviteUrl } from '../utils/invite.js';
import { secondBotComponents } from '../panels/secondBot.js';

/** /invite — the link to add the bot to another server. */
export default {
  data: new SlashCommandBuilder().setName('invite').setDescription('Add the bot to your server / أضف البوت إلى سيرفرك').setDMPermission(false),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const url = buildInviteUrl(interaction.client.user?.id ?? config.discord.clientId);
    return interaction.reply({ embeds: [buildInfoEmbed(t(lang, 'commands.invite.title'),
      [t(lang, 'commands.invite.body'), '', t(lang, 'commands.invite.features'), '', `[${t(lang, 'commands.invite.click')}](${url}) — ${t(lang, 'commands.invite.cta')}`].join('\n'), lang)], components: await secondBotComponents(lang, interaction.guildId), ephemeral: true });
  }
};
