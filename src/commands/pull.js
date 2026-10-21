import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { t } from '../utils/i18n.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { recentLeftRooms, MIN_STAY_MS } from '../utils/recentRooms.js';
import { runPull, describePulled } from '../services/pullService.js';
import { recordPull } from '../services/pullStats.js';
import { getSiblings } from '../services/siblingService.js';
import { dispatchJob, waitForJob, sendWorkerCommand } from '../services/playerJobs.js';
import { getSession, createAndJoin, destroySession } from '../managers/sessionManager.js';
import { moveSession, applyState, exportSession } from '../managers/sessionTransfer.js';
import { sendVoicePanel } from '../utils/panelRegistry.js';
import { getSurahByNumber } from '../data/surahs.js';
import { findReciterById, findReciter, findDefaultReciter } from '../services/quranService.js';

const quran = { surahByNumber: getSurahByNumber, findReciterById, findReciter, findDefaultReciter };
const deps = {
  getSiblings, getSession, exportSession, moveSession, applyState, createAndJoin, destroySession,
  dispatchJob, waitForJob, sendWorkerCommand, sendVoicePanel, quran
};

/**
 * /pull — "I moved to another voice room: bring the recitation to me, from the same place."
 * Alone in the old room → the same bot follows you. People stayed behind → a second bot comes and continues from the same second.
 * (The decision and the hand-over live in services/pullService.js.)
 */
export default {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Bring the recitation to your voice room / اسحب التلاوة إلى رومك الصوتي من نفس النقطة')
    .setDMPermission(false)
    .addChannelOption(o => o.setName('from')
      .setDescription('The room you were listening in (only needed if several recitations run) / الروم الذي كنت تستمع فيه')
      .addChannelTypes(ChannelType.GuildVoice)
      .setRequired(false)),

  async execute(interaction) {
    return pullFlow(interaction, interaction.options.getChannel('from'));
  }
};

/** The whole /pull, also reached from the player panel's tools menu ("Pull the recitation to my room"). `named` = the optional "from" room. */
export async function pullFlow(interaction, named = null) {
  {
    await interaction.deferReply();                       // FIRST: a slow database must not let the 3-second window expire
    const lang = await GuildSettings.getLanguage(interaction.guildId).catch(() => 'en');
    const voice = interaction.member?.voice?.channel ?? null;   // remembered now: the member may leave voice while the pull runs

    const startedAt = Date.now();
    const result = await runPull({
      guild: interaction.guild, client: interaction.client, userId: interaction.user.id,
      voice, lang, member: interaction.member,
      isManager: !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
      leftChannelIds: recentLeftRooms(interaction.guildId, interaction.user.id, Date.now(), { minStayMs: MIN_STAY_MS }),
      textChannel: interaction.channel, textChannelId: interaction.channelId ?? null,
      hintChannelId: named?.id ?? null, explicit: !!named
    }, deps);
    void recordPull({ guildId: interaction.guildId, userId: interaction.user.id, result, ms: Date.now() - startedAt });   // for the owner dashboard; never blocks the reply

    if (!result.ok) return interaction.editReply({ embeds: [buildErrorEmbed(t(lang, `errors.${result.key}`, result.vars), lang)] });

    const bot = `<@${result.botId}>`;
    const here = `<#${voice.id}>`;   // not interaction.member.voice.channel: that is null if they left meanwhile
    const lines = [result.kind === 'move'
      ? t(lang, 'misc.pull_moved', { bot, channel: here })
      : t(lang, 'misc.pull_cloned', { bot, channel: here, from: `<@${result.fromBotId}>`, old: `<#${result.fromChannelId}>` })];
    const { what, time } = describePulled(result.state, lang);
    if (what) lines.push(t(lang, time ? 'misc.pull_where' : 'misc.pull_where_live', { what, time }));
    return interaction.editReply({ embeds: [buildSuccessEmbed(lang === 'ar' ? 'تم السحب' : 'Pulled', lines.join('\n'), lang)] });
  }
}
