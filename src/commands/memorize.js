import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { startByCommand, surahAutocomplete, resolveSurah } from '../utils/sessionCommands.js';
import { enqueue, playNext, getSession, setMemorizeMode } from '../managers/sessionManager.js';
import { findDefaultReciter } from '../services/quranService.js';
import { REPEAT_CHOICES, DEFAULT_REPEATS, MEMORIZE_DELAY_MS } from '../panels/playerTools.js';

/** /memorize — repeat one surah several times (the panel's memorize tool, by command). */
export default {
  data: new SlashCommandBuilder()
    .setName('memorize')
    .setDescription('Repeat a surah to memorize it / كرّر سورة للحفظ')
    .setDMPermission(false)
    .addStringOption(o => o.setName('surah').setDescription('Surah name or number / اسم السورة أو رقمها').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('times').setDescription(`Repetitions, default ${DEFAULT_REPEATS} / عدد التكرار`).setRequired(false)
      .addChoices(...REPEAT_CHOICES.map(n => ({ name: String(n), value: n })))),

  autocomplete: surahAutocomplete,

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    await interaction.deferReply();
    const surah = resolveSurah(interaction.options.getString('surah', true), lang);
    if (!surah) return interaction.editReply({ embeds: [buildErrorEmbed(ar ? 'لم أجد هذه السورة. اكتب اسمها أو رقمها واختر من القائمة.' : 'Surah not found. Type its name or number and pick from the list.', lang)] });
    const reps = interaction.options.getInteger('times') ?? DEFAULT_REPEATS;
    const label = ar ? surah.arabic : surah.english;
    return startByCommand(interaction, lang, async () => {
      const reciter = await findDefaultReciter(interaction.user.id, interaction.guildId);
      if (!reciter?.moshaf?.length) return false;
      setMemorizeMode(interaction.guildId, { repeatCount: reps, delayMs: MEMORIZE_DELAY_MS });
      enqueue(interaction.guildId, { surah, reciter: reciter.displayName ?? reciter.name, reciterObj: reciter });
      const s = getSession(interaction.guildId);
      if (s && (s.status === 'idle' || !s.current)) await playNext(interaction.guildId);
      return true;
    }, ar ? 'بدأ وضع الحفظ' : 'Memorize started', ar ? `سورة **${label}** × **${reps}** مرة، بصوت قارئ السيرفر.` : `Surah **${label}** × **${reps}**, with the server's reciter.`);
  }
};
