// Same logic as src/utils/errorReporter.js minus the database / logger imports (language is passed through globalThis).
import { classifyError, errorCode } from '../../src/utils/errors.js';
import { buildErrorEmbed } from '../../src/utils/embeds.js';
import { replyError } from '../../src/utils/permissions.js';
import { t } from '../../src/utils/i18n.js';

export async function reportError(interaction, err, where) {
  const verdict = classifyError(err);
  if (verdict.kind === 'ignore') return null;
  const lang = globalThis.__lang ?? 'en';
  if (verdict.kind === 'user') {
    await replyError(interaction, buildErrorEmbed(t(lang, `errors.${verdict.key}`, verdict.vars), lang));
    return null;
  }
  const code = errorCode(err, where);
  (globalThis.__reported ??= []).push({ where, code, message: err?.message });
  await replyError(interaction, buildErrorEmbed(t(lang, 'errors.unexpected', { code }), lang));
  return code;
}
