import { t } from './i18n.js';
import { buildErrorEmbed } from './embeds.js';
import { requireVoiceChannel, requireSameVoiceChannel, replyError } from './permissions.js';
import { getSession, createAndJoin } from '../managers/sessionManager.js';
import { busyAdvice } from '../services/siblingService.js';
import { tryDelegate } from './delegation.js';
import { reportError } from './errorReporter.js';

/**
 * The one place that answers "can this user use the bot's voice features right now, and what is the session?"
 * Used by /recite, /live, /khatma, /memorize and the Khatma panel button.
 *
 *   1. the user must be in a voice channel the bot may join and speak in
 *   2. if the guild already has a session, the user must be in THAT channel (no hijacking)
 *   3. otherwise the bot joins the user's channel and a new session is created
 *
 * @param {object} [intent]  what the member asked for ({ kind: 'recite'|'live'|'join', … }); only used to hand the request to the voice-only
 *          second bot when THIS bot cannot serve the member's room (see utils/delegation.js)
 * @returns {Promise<{ ok: true, session: object, channel: object } | { ok: false }>}
 *          When ok is false an error reply has ALREADY been sent — the caller just returns (also when the second bot took over).
 *          Works for deferred, fresh and already-replied interactions (see replyError).
 */
export async function ensureSession(interaction, lang, intent = null) {
  const { ok, channel } = await requireVoiceChannel(interaction, lang);
  if (!ok) return { ok: false };

  const existing = getSession(interaction.guildId);
  if (existing) {
    // This bot is already reciting in ANOTHER channel → send the user to the sibling bot that can really help
    // (already in their room, or free in this server) instead of a dead end.
    if (interaction.member?.voice?.channel?.id !== existing.voiceChannelId) {
      if (await tryDelegate(interaction, lang, intent ?? undefined)) return { ok: false, delegated: true };
      const advice = await busyAdvice(interaction.guildId, channel.id);
      if (advice) {
        await replyError(interaction, buildErrorEmbed(t(lang, advice.key, advice.vars), lang)).catch(() => {});
        return { ok: false };
      }
    }
    const { ok: sameChannel } = await requireSameVoiceChannel(interaction, existing, lang);
    return sameChannel ? { ok: true, session: existing, channel } : { ok: false };
  }

  // A sibling Quran bot is already reciting in the member's own room → point them to it (never join over it).
  const here = await busyAdvice(interaction.guildId, channel.id);
  if (here?.key === 'errors.busy_sibling_here') {
    if (await tryDelegate(interaction, lang, intent ?? undefined, { onlyHere: true })) return { ok: false, delegated: true };
    await replyError(interaction, buildErrorEmbed(t(lang, here.key, here.vars), lang)).catch(() => {});
    return { ok: false };
  }

  try {
    const session = await createAndJoin(interaction.guild, channel, interaction.user.id, lang, interaction.client);
    return { ok: true, session, channel };
  } catch (err) {
    // Known causes are explained to the user; anything else becomes "unexpected error" + a code for the owner.
    await reportError(interaction, err, 'voice-join');
    return { ok: false };
  }
}
