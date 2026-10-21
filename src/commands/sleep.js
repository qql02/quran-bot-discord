import { SlashCommandBuilder } from 'discord.js';
import { buildSuccessEmbed, buildErrorEmbed } from '../utils/embeds.js';
import { controlContext } from '../utils/sessionCommands.js';
import { setSleepTimer, clearSleepTimer } from '../managers/sessionManager.js';
import { SLEEP_CHOICES } from '../panels/playerTools.js';

const LABEL = { '10': '10', '30': '30', '60': '60', end: 'After the current surah / بعد انتهاء السورة', cancel: 'Cancel the timer / إلغاء المؤقت' };

/** /sleep — stop and leave after a while (the panel's sleep timer, by command). */
export default {
  data: new SlashCommandBuilder()
    .setName('sleep')
    .setDescription('Stop automatically after a while / إيقاف تلقائي بعد مدة')
    .setDMPermission(false)
    .addStringOption(o => o.setName('when').setDescription('Minutes, or when the surah ends / بعد كم دقيقة').setRequired(true)
      .addChoices(...SLEEP_CHOICES.map(v => ({ name: /^\d+$/.test(v) ? `${v} min / دقيقة` : LABEL[v], value: v })))),

  async execute(interaction) {
    const c = await controlContext(interaction);
    if (!c.ok) return;
    const { lang, session } = c;
    const ar = lang === 'ar';
    const v = interaction.options.getString('when', true);
    let text;
    if (v === 'cancel') { clearSleepTimer(interaction.guildId); text = ar ? 'أُلغي المؤقت.' : 'Timer cancelled.'; }
    else if (v === 'end') {
      if (session.current?.isRadio) return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'الإذاعة لا تنتهي؛ اختر مدة بالدقائق.' : 'A live stream never ends — pick a number of minutes.', lang)], ephemeral: true });
      setSleepTimer(interaction.guildId, 'end_of_track');
      text = ar ? 'سيتوقف التشغيل بعد انتهاء السورة الحالية.' : 'Playback will stop after the current surah.';
    } else {
      setSleepTimer(interaction.guildId, Number(v) * 60_000);
      text = ar ? `سيتوقف التشغيل بعد **${v} دقيقة**.` : `Playback will stop in **${v} minutes**.`;
    }
    return interaction.reply({ embeds: [buildSuccessEmbed(ar ? 'مؤقت النوم' : 'Sleep timer', text, lang)] });
  }
};
