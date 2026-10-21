import { SlashCommandBuilder } from 'discord.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { skipSession } from '../managers/sessionManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('next')
    .setDescription('Skip to the next surah / تخطي إلى السورة التالية')
    .setDMPermission(false),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const { lang, session } = c;
    const ar = lang === 'ar';
    const gid = interaction.guildId;
    if (!session.current && !session.queue.length) return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'لا شيء لتخطيه.' : 'Nothing to skip.', lang)], ephemeral: true });
    skipSession(gid);
    return interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'تم التخطي' : 'Skipped', session.queue.length ? (ar ? 'ننتقل إلى التالي.' : 'Moving on to the next one.') : (ar ? 'لا شيء بعدها في القائمة.' : 'Nothing else is queued.'), lang)] });
  }
};
