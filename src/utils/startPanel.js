import { ChannelType } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed } from './embeds.js';
import { sendVoicePanel, waitForVoiceJoin } from './panelRegistry.js';
import { getSession } from '../managers/sessionManager.js';
import { busyAdvice } from '../services/siblingService.js';
import { tryDelegate } from './delegation.js';
import { t } from './i18n.js';

/**
 * Put the player panel in the voice room of whoever asked (or wait up to 10 minutes for them to join one).
 * Used by /start and by the "player panel" button of /help.
 */
export async function startPlayerPanel(interaction) {
    const lang  = await GuildSettings.getLanguage(interaction.guildId);
    const isAr  = lang === 'ar';
    const voice = interaction.member?.voice?.channel;

    // Not in a voice channel: ask them to join one; the panel is sent there the moment they do (10 minutes).
    if (!voice) {
      waitForVoiceJoin(interaction.guildId, interaction.user.id, interaction.channelId);
      return interaction.reply({
        embeds: [buildInfoEmbed(
          isAr ? '🎧 ادخل روماً صوتياً أولاً' : '🎧 Join a voice channel first',
          isAr
            ? 'ادخل أي روم صوتي الآن، وسأرسل لوحة التحكم فيه تلقائياً (خلال 10 دقائق).'
            : 'Join any voice channel now and I will send the control panel there automatically (within 10 minutes).',
          lang
        )],
        ephemeral: true
      });
    }

    if (voice.type === ChannelType.GuildStageVoice) {
      return interaction.reply({
        embeds: [buildErrorEmbed(isAr ? 'قنوات المنصّة (Stage) غير مدعومة. استخدم روماً صوتياً عادياً.' : 'Stage channels are not supported. Use a regular voice channel.', lang)],
        ephemeral: true
      });
    }

    // The bot is already reciting in ANOTHER room: a panel posted here would replace (delete) the live panel of that room.
    const live = getSession(interaction.guildId);
    // A voice-only second bot takes over when this bot is busy elsewhere (or already reciting in THIS room: it re-posts its own panel).
    if ((!live || live.voiceChannelId !== voice.id) && await tryDelegate(interaction, lang, { kind: 'join' }, { onlyHere: !live })) return;
    if (live && live.voiceChannelId !== voice.id) {
      const advice = await busyAdvice(interaction.guildId, voice.id);
      return interaction.reply({
        embeds: [buildErrorEmbed(advice ? t(lang, advice.key, advice.vars) : t(lang, 'errors.not_same_voice'), lang)],
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const sent = await sendVoicePanel(interaction.client, interaction.guild, voice, interaction.channel);
    if (!sent) {
      return interaction.editReply({ embeds: [buildErrorEmbed(
        isAr ? 'لا أملك صلاحية الكتابة في الروم الصوتي ولا في هذه القناة. أعطني «عرض القناة» و«إرسال الرسائل».'
             : 'I may not write in the voice channel or in this channel. Give me “View Channel” and “Send Messages”.', lang)] });
    }
    return interaction.editReply({ embeds: [buildSuccessEmbed(
      isAr ? '✅ أُرسلت لوحة التحكم' : '✅ Control panel sent',
      isAr ? `ستجدها في ${sent.channel}.` : `You will find it in ${sent.channel}.`,
      lang
    )] });
}
