import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { startByCommand } from '../utils/sessionCommands.js';
import { playRadio } from '../managers/sessionManager.js';
import { stationChoices, resolveStation, stationIsLive, NO_LIVE_VALUE } from '../services/stationService.js';

/** /live — a live radio station: this server's own, the public ones, or the Quran radios. Only stations on the air right now are offered. */
export default {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Play a live radio station / إذاعة قرآنية مباشرة')
    .setDMPermission(false)
    .addStringOption(o => o.setName('station').setDescription('Station — type to search / المحطة — اكتب للبحث').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const choices = await stationChoices(interaction.guildId, interaction.options.getFocused()).catch(() => []);
    // Only stations that are on the air are offered; when none are, say so instead of showing an empty box.
    return interaction.respond(choices.length ? choices : [{ name: 'لا توجد محطة تبث الآن بهذا الاسم · No station on the air matches', value: NO_LIVE_VALUE }]);
  },

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    await interaction.deferReply();                                  // looking the station up can call the radio API
    const station = await resolveStation(interaction.guildId, interaction.options.getString('station', true));
    if (!station?.url) return interaction.editReply({ embeds: [buildErrorEmbed(ar ? 'المحطة غير موجودة. اختر من القائمة.' : 'Station not found. Pick one from the list.', lang)] });
    if (!(await stationIsLive(station.url))) {
      return interaction.editReply({ embeds: [buildErrorEmbed(ar ? `**${station.name}** لا تبث الآن. اختر محطة أخرى من القائمة، فهي تعرض المحطات التي تبث حالياً فقط.` : `**${station.name}** is not broadcasting right now. Pick another from the list — it only shows stations that are on the air.`, lang)] });
    }
    return startByCommand(interaction, lang, () => playRadio(interaction.guildId, station),
      ar ? 'بدأت الإذاعة' : 'Radio started', `**${station.name}**`,
      { kind: 'live', station: interaction.options.getString('station', true) });
  }
};
