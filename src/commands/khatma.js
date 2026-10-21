import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { startByCommand, surahAutocomplete, resolveSurah } from '../utils/sessionCommands.js';
import { SURAHS } from '../data/surahs.js';
import { enqueue, playNext, clearQueue, skipSession } from '../managers/sessionManager.js';
import { findDefaultReciter, findReciter, searchReciters, reciterAutocompleteFor, getPlayableUrls } from '../services/quranService.js';

const name = (r) => r.displayName ?? r.englishName ?? r.name;

/** /khatma — the whole Quran in order, from Al-Fatiha or from any surah, with any reciter you search by name. */
export default {
  data: new SlashCommandBuilder()
    .setName('khatma')
    .setDescription('Play the whole Quran in order / تشغيل القرآن كاملاً بالترتيب')
    .setDMPermission(false)
    .addStringOption(o => o.setName('reciter').setDescription('Reciter — type to search / القارئ — اكتب للبحث').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('from').setDescription('Start from this surah (default: Al-Fatiha) / ابدأ من سورة').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    return interaction.options.getFocused(true).name === 'from' ? surahAutocomplete(interaction) : interaction.respond(await reciterAutocompleteFor(interaction));
  },

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    await interaction.deferReply();
    const fail = (m) => interaction.editReply({ embeds: [buildErrorEmbed(m, lang)] });

    const rawFrom = interaction.options.getString('from');
    const first = rawFrom ? resolveSurah(rawFrom, lang) : SURAHS[0];
    if (!first) return fail(ar ? 'لم أجد هذه السورة.' : 'Surah not found.');

    const typed = interaction.options.getString('reciter')?.trim();
    const reciter = typed ? await findReciter(typed) : await findDefaultReciter(interaction.user.id, interaction.guildId);
    if (!reciter?.moshaf?.length) {
      if (!typed) return fail(ar ? 'خدمة القرّاء لا تستجيب الآن. حاول بعد قليل.' : 'The reciters service is not responding right now. Please try again shortly.');
      const close = (await searchReciters(typed.split(/\s+/).sort((a, b) => b.length - a.length)[0], lang)).slice(0, 5).map(name);
      return fail(ar ? `لا يوجد قارئ بهذا الاسم: **${typed}**.${close.length ? `\nربما تقصد: ${close.join(' · ')}` : ''}` : `No reciter found for **${typed}**.${close.length ? `\nDid you mean: ${close.join(' · ')}` : ''}`);
    }
    const reciterName = name(reciter);
    if (!(await getPlayableUrls(reciter, first.number)).length) {
      return fail(ar ? `**${reciterName}** ليس لديه سورة **${first.arabic}**. اختر قارئاً آخر.` : `**${reciterName}** has no recording of **${first.english}**. Pick another reciter.`);
    }

    return startByCommand(interaction, lang, async (session) => {
      clearQueue(interaction.guildId);
      session.fullQuran = true; session.loop = false; session.memorize = null;
      enqueue(interaction.guildId, { surah: first, reciter: reciterName, reciterObj: reciter });
      if (session.status === 'paused' || session.status === 'playing') skipSession(interaction.guildId); else await playNext(interaction.guildId);
      return true;
    }, ar ? 'ختمة كاملة' : 'Full Quran',
    ar ? `من **${first.arabic}** إلى الناس بصوت **${reciterName}**. هذا يستبدل قائمة الانتظار.` : `From **${first.english}** to An-Nas by **${reciterName}**. This replaces the queue.`);
  }
};
