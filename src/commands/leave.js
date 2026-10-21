import { SlashCommandBuilder } from 'discord.js';
import { buildSuccessEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { destroySession } from '../managers/sessionManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Stop and leave the voice room / إيقاف التلاوة ومغادرة الروم')
    .setDMPermission(false),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const { lang } = c;
    const ar = lang === 'ar';
    const gid = interaction.guildId;
    await interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'غادر البوت' : 'Left', ar ? 'أُوقفت التلاوة وغادرتُ الروم.' : 'Playback stopped and I left the room.', lang)] });
    await destroySession(gid);
  }
};
