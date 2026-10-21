import { config } from '../config.js';
import { getSiblings, pickDelegate } from '../services/siblingService.js';
import { dispatchJob, waitForJob, describeOutcome } from '../services/playerJobs.js';
import { buildErrorEmbed, buildSuccessEmbed } from './embeds.js';
import { t } from './i18n.js';
import { logger } from './logger.js';

/** Answer an interaction in whatever state it is in (fresh, deferred, already replied). */
async function answer(interaction, embed) {
  if (interaction.replied)  return interaction.followUp({ embeds: [embed], ephemeral: true });
  if (interaction.deferred) return interaction.editReply({ embeds: [embed] });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * The PRIMARY bot cannot serve this member (it is reciting in another room) but a voice-only secondary can: hand the request over
 * through the shared database, wait for its answer and tell the member what happened. The secondary has no commands, so the old
 * "use <@other bot>" advice would be a dead end for it.
 *
 * @param {object} intent  what to start once the secondary is in the room: { kind: 'recite'|'live'|'join', … } (see services/playerJobs.js)
 * @param {{ onlyHere?: boolean }} opts  onlyHere: delegate only to a secondary that is ALREADY in the member's room (the primary has no
 *        session of its own and would simply join itself otherwise)
 * @returns {Promise<boolean>} true = handled (the member has been answered); false = nothing to delegate to, caller keeps its normal flow
 */
export async function tryDelegate(interaction, lang, intent = { kind: 'join' }, { onlyHere = false } = {}) {
  if (config.bot.role === 'secondary') return false;               // only the bot that owns the commands hands work over
  const voice = interaction.member?.voice?.channel;
  if (!voice || !interaction.guildId) return false;

  const target = pickDelegate(await getSiblings(interaction.guildId), voice.id);
  if (!target || (onlyHere && target.kind !== 'here')) return false;

  // The wait can take a few seconds: answer Discord first, or the interaction expires after 3 seconds.
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });

  let outcome;
  try {
    const job = await dispatchJob({
      targetBotId: target.id, fromBotId: interaction.client?.user?.id ?? null,
      guildId: interaction.guildId, voiceChannelId: voice.id, textChannelId: interaction.channelId ?? null,
      userId: interaction.user.id, lang, intent
    });
    if (!job) return false;                                          // no database connection: behave as if there were no secondary
    outcome = job.busy
      ? { ok: false, key: 'errors.worker_pending', vars: { bot: `<@${target.id}>` } }
      : describeOutcome(await waitForJob(job.id), { botId: target.id, channelId: voice.id });
  } catch (err) {
    logger.warn(`[delegate] hand-off to ${target.id} failed: ${err.message}`);
    outcome = { ok: false, key: 'errors.worker_timeout', vars: { bot: `<@${target.id}>` } };
  }
  const message = t(lang, outcome.key, outcome.vars);
  await answer(interaction, outcome.ok ? buildSuccessEmbed(lang === 'ar' ? 'تم' : 'Done', message, lang) : buildErrorEmbed(message, lang)).catch(() => {});
  return true;
}
