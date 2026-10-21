import { SlashCommandBuilder } from 'discord.js';
import { buildSuccessEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { clearQueue } from '../managers/sessionManager.js';

/** /clearqueue — empty the queue (what is playing now continues). */
export default {
  data: new SlashCommandBuilder().setName('clearqueue').setDescription('Clear the queue / مسح قائمة الانتظار').setDMPermission(false),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const ar = c.lang === 'ar';
    const n = c.session.queue.length;
    clearQueue(interaction.guildId);
    return interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'تم' : 'Done', n ? (ar ? `مُسحت قائمة الانتظار (${n}).` : `Queue cleared (${n}).`) : (ar ? 'القائمة فارغة أصلاً.' : 'The queue was already empty.'), c.lang)] });
  }
};
