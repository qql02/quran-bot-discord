import { SlashCommandBuilder } from 'discord.js';
import { buildSuccessEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { setVolume } from '../managers/sessionManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the volume 0–150 / ضبط الصوت من 0 إلى 150')
    .setDMPermission(false)
    .addIntegerOption(o => o.setName('percent').setDescription('0–150 (100 = normal) / 0 إلى 150').setRequired(true).setMinValue(0).setMaxValue(150)),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const { lang } = c;
    const ar = lang === 'ar';
    const gid = interaction.guildId;
    const vol = interaction.options.getInteger('percent', true);
    await setVolume(gid, vol);
    return interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'الصوت' : 'Volume', `**${vol}%**`, lang)] });
  }
};
