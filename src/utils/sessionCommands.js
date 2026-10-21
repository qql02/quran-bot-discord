import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildSuccessEmbed } from './embeds.js';
import { ensureSession } from './ensureSession.js';
import { syncPanel, sendVoicePanel } from './panelRegistry.js';
import { getSurahByName, getSurahByNumber, searchSurahs, surahLabel } from '../data/surahs.js';
import { requireSameVoiceChannel } from './permissions.js';
import { getSession } from '../managers/sessionManager.js';

/**
 * The common start of every playback-control command (/hold /continue /next /leave /volume): the server language, a live session,
 * and the person being in the SAME voice channel as the bot. When something is wrong the error is already sent.
 * @returns {Promise<{ ok: true, lang: string, session: object } | { ok: false }>}
 */
export async function controlContext(interaction) {
  const lang = await GuildSettings.getLanguage(interaction.guildId);
  const session = getSession(interaction.guildId);
  if (!session) {
    await interaction.reply({
      embeds: [buildErrorEmbed(lang === 'ar' ? 'لا توجد جلسة نشطة. ابدأ بـ `/recite` أو `/start`.' : 'No active session. Start with `/recite` or `/start`.', lang)],
      ephemeral: true
    });
    return { ok: false };
  }
  const { ok } = await requireSameVoiceChannel(interaction, session, lang);
  return ok ? { ok: true, lang, session } : { ok: false };
}

/**
 * Start something by command (a Khatma, radio, memorize…): the voice checks and join happen in ensureSession, then `start(session)` does
 * the work, then the server's player panel is redrawn (or posted when the room has none). Replies with a short confirmation.
 * `start` returns true when it started something. Used by /khatma /live /memorize. `intent` is what the voice-only second bot should start
 * when it takes the request over (default: just join and post its panel).
 */
export async function startByCommand(interaction, lang, start, title, text, intent = null) {
  const ar = lang === 'ar';
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
  const { ok, session } = await ensureSession(interaction, lang, intent);
  if (!ok) return;
  if (!(await start(session))) {
    return interaction.editReply({ embeds: [buildErrorEmbed(ar ? 'تعذّر بدء التشغيل الآن. حاول بعد قليل.' : 'Could not start playback right now. Please try again shortly.', lang)] });
  }
  if (!(await syncPanel(interaction.client, interaction.guildId))) {
    await sendVoicePanel(interaction.client, interaction.guild, interaction.member?.voice?.channel, interaction.channel).catch(() => {});
  }
  return interaction.editReply({ embeds: [buildSuccessEmbed(title, text, lang)] });
}

/** Autocomplete answer for a surah option: both languages, popular surahs first when nothing is typed. */
export async function surahAutocomplete(interaction) {
  const lang = await GuildSettings.getLanguage(interaction.guildId).catch(() => 'en');
  const q = String(interaction.options.getFocused() ?? '');
  return interaction.respond(searchSurahs(q, lang).map(s => ({ name: surahLabel(s, lang).slice(0, 100), value: String(s.number) })));
}

/** "18" / "kahf" / "الكهف" → the surah, or null. */
export const resolveSurah = (raw, lang = 'en') => {
  const s = String(raw ?? '').trim();
  return (/^\d{1,3}$/.test(s) ? getSurahByNumber(Number(s)) : null) ?? (s ? getSurahByName(s, lang) : null);
};
