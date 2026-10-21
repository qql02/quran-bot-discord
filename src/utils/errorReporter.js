import { classifyError, errorCode } from './errors.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed } from './embeds.js';
import { replyError } from './permissions.js';
import { logger } from './logger.js';
import { t } from './i18n.js';

/**
 * The ONE place that turns a caught error into something the user sees.
 *  - user-fixable  → clear explanation (see errors.js)
 *  - ignorable     → nothing (the interaction expired / was already answered)
 *  - anything else → "unexpected error" + code; full details go to the log and the dashboard activity feed
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {unknown} err
 * @param {string} where  short label of the place, e.g. `cmd:recite`, `btn:panel:skip`, `voice-join`
 * @returns {Promise<string|null>} the error code when it was unexpected
 */
export async function reportError(interaction, err, where) {
  const verdict = classifyError(err);
  if (verdict.kind === 'ignore') return null;

  const lang = await GuildSettings.getLanguage(interaction.guildId).catch(() => 'en');

  if (verdict.kind === 'user') {
    await replyError(interaction, buildErrorEmbed(t(lang, `errors.${verdict.key}`, verdict.vars), lang)).catch(() => {});
    return null;
  }

  const code = errorCode(err, where);
  logger.error(
    `[${code}] ${where} | guild=${interaction.guildId ?? '-'} user=${interaction.user?.id ?? '-'}` +
    ` | ${err?.name ?? 'Error'}${err?.code !== undefined ? ` (${err.code})` : ''}: ${err?.message ?? err}\n${err?.stack ?? ''}`
  );
  interaction.client?._pushActivity?.('error', `❌ ${code} · ${where}`, String(err?.message ?? err).slice(0, 200));

  await replyError(interaction, buildErrorEmbed(t(lang, 'errors.unexpected', { code }), lang)).catch(() => {});
  return code;
}
