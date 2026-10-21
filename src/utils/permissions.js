import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { t } from './i18n.js';
import { buildErrorEmbed } from './embeds.js';

/**
 * Reply helper that works whether the interaction has been deferred or not.
 * - Not yet replied/deferred → reply() with ephemeral
 * - Already deferred        → editReply() (ephemeral flag set at defer time)
 * - Already replied         → followUp() with ephemeral
 */
export async function replyError(interaction, embed) {
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply({ embeds: [embed] });
  }
  if (interaction.replied) {
    return interaction.followUp({ embeds: [embed], ephemeral: true });
  }
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Can THIS bot join and speak in `voiceChannel`? → null when it can, otherwise { key, vars } (a locale key under `errors.*`).
 * Pure: no replies. requireVoiceChannel() below and the /pull command both use it.
 */
export function voiceAccessProblem(voiceChannel, botMember) {
  if (voiceChannel.type === ChannelType.GuildStageVoice) return { key: 'stage_unsupported', vars: {} };

  const perms = voiceChannel.permissionsFor(botMember);
  if (!perms.has(PermissionFlagsBits.ViewChannel)) return { key: 'no_permission_view', vars: {} };
  if (!perms.has(PermissionFlagsBits.Connect))     return { key: 'no_permission_connect', vars: {} };
  if (!perms.has(PermissionFlagsBits.Speak))       return { key: 'no_permission_speak', vars: {} };

  // A full channel only lets the bot in with Move Members / Administrator — otherwise the join just times out.
  const limit = voiceChannel.userLimit ?? 0;
  const isFull = limit > 0 && (voiceChannel.members?.size ?? 0) >= limit;
  if (isFull && !perms.has(PermissionFlagsBits.MoveMembers) && !perms.has(PermissionFlagsBits.Administrator)) {
    return { key: 'voice_full', vars: { limit } };
  }
  return null;
}

/**
 * Ensure the command user is in a voice channel.
 * Returns { ok: true, channel } or { ok: false } (and replies with error).
 */
export async function requireVoiceChannel(interaction, lang) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await replyError(interaction, buildErrorEmbed(t(lang, 'errors.not_in_voice'), lang));
    return { ok: false };
  }

  const problem = voiceAccessProblem(voiceChannel, interaction.guild.members.me);
  if (problem) {
    await replyError(interaction, buildErrorEmbed(t(lang, `errors.${problem.key}`, problem.vars), lang));
    return { ok: false };
  }

  return { ok: true, channel: voiceChannel };
}

/**
 * Ensure the user is in the SAME voice channel as the bot.
 * Used for control buttons (pause, skip, stop, etc.)
 */
export async function requireSameVoiceChannel(interaction, session, lang) {
  if (!session) return { ok: true }; // No session → let command handle it

  const userChannel = interaction.member?.voice?.channel;
  if (!userChannel || userChannel.id !== session.voiceChannelId) {
    // FIX: use replyError (same helper as requireVoiceChannel) instead of manually
    // choosing followUp vs reply. When the interaction is deferred, followUp creates
    // a second ephemeral message while leaving the deferred slot unfilled — causing
    // Discord to show "This application did not respond". replyError correctly uses
    // editReply when deferred, reply when fresh, and followUp only when already replied.
    await replyError(interaction, buildErrorEmbed(t(lang, 'errors.not_same_voice'), lang));
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Who may change the reciter that is saved for the WHOLE server from a panel menu.
 *   • a session is running → only people in the bot's voice room (as for every other control);
 *   • no session           → a member of a voice channel, or someone with Manage Server. Before this, anybody who could see
 *                            the panel could silently change the server's reciter without being in voice at all.
 */
export async function requireReciterChangeRight(interaction, session, lang) {
  if (session) return requireSameVoiceChannel(interaction, session, lang);
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return { ok: true };
  if (interaction.member?.voice?.channel) return { ok: true };
  await replyError(interaction, buildErrorEmbed(t(lang, 'errors.not_in_voice'), lang));
  return { ok: false };
}
