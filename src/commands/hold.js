import { SlashCommandBuilder } from 'discord.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { pauseSession } from '../managers/sessionManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hold')
    .setDescription('Pause the recitation / إيقاف مؤقت للتلاوة')
    .setDMPermission(false),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const { lang } = c;
    const ar = lang === 'ar';
    const gid = interaction.guildId;
    if (!pauseSession(gid)) return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'لا شيء يُشغَّل حالياً.' : 'Nothing is playing right now.', lang)], ephemeral: true });
    return interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'إيقاف مؤقت' : 'Paused', ar ? 'استخدم `/continue` للمتابعة.' : 'Use `/continue` to resume.', lang)] });
  }
};
