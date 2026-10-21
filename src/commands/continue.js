import { SlashCommandBuilder } from 'discord.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { resumeSession, playNext } from '../managers/sessionManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('continue')
    .setDescription('Resume the recitation / متابعة التلاوة')
    .setDMPermission(false),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const { lang, session } = c;
    const ar = lang === 'ar';
    const gid = interaction.guildId;
    if (session.status === 'paused') resumeSession(gid);
    else if (session.status === 'idle' && session.queue.length) await playNext(gid);
    else return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'لا شيء متوقف لمتابعته. ابدأ بـ `/recite`.' : 'Nothing is paused. Start with `/recite`.', lang)], ephemeral: true });
    return interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'تمت المتابعة' : 'Resumed', ar ? 'تُكمل التلاوة.' : 'Playback continues.', lang)] });
  }
};
