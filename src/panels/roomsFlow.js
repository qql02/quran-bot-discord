import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { COLORS, THUMBNAIL } from '../utils/embeds.js';
import { setSessionLanguage } from '../managers/sessionManager.js';
import { sendVoicePanel } from '../utils/panelRegistry.js';
import { roomPanelMessage } from '../utils/wirdUi.js';
import { previewText, previewComponents, PICK_ID, CONFIRM_ID, CANCEL_ID } from '../utils/setupUi.js';
import { DEFAULT_AYAH_TIME } from '../data/ayahs.js';
import { DEFAULT_HADITH_TIME } from '../data/hadiths.js';
import { DEFAULT_TIMEZONE, isValidTimeZone } from '../utils/adhkarSchedule.js';
import { applySetup, missingBotPerms } from '../services/setupService.js';
import { setupPlan, setupText, normLang, cleanSelection, SETUP_KEYS } from '../data/setupLayout.js';
import { logger } from '../utils/logger.js';

const CONFIRM_MS = 60_000;
const running = new Set();        // guilds with a setup in progress: two admins pressing Create together would double every room

/** Every sentence of this command is in ONE language: the one chosen with the `language` option. */
const buildEmbed = ({ title, description, fields, footer }) => {
  const e = new EmbedBuilder().setColor(COLORS.primary).setTitle(title).setDescription(description).setThumbnail(THUMBNAIL);
  if (fields) e.addFields(fields);
  if (footer) e.setFooter({ text: footer });
  return e;
};
// Discord rejects an empty description, so it is only set when there is one.
const plain = (lang, title, description, color = COLORS.primary) => {
  const e = new EmbedBuilder().setColor(color).setTitle(title);
  if (description) e.setDescription(description);
  return e;
};

/**
 * The "create the Quran category & rooms" flow (pick → preview → confirm). It was the whole of /setup; it is now one button of
 * the /setup panel ("إنشاء الرومات"), and everything below is unchanged. Opens its own private message.
 * @param {import('discord.js').Interaction} interaction  any repliable interaction that has not been answered yet
 * @param {{ lang?: string, timezone?: string }} [opts]
 */
export async function runRoomsFlow(interaction, opts = {}) {
    const current = await GuildSettings.getLanguage(interaction.guildId);
    const lang = normLang(opts.lang ?? current);
    const t = setupText(lang);

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [plain(lang, '🔒', t.needManage, COLORS.error ?? 0xe74c3c)], ephemeral: true });
    }
    const missing = missingBotPerms(interaction.guild);                  // the base permissions, before anything is shown
    if (missing.length) {
      return interaction.reply({ embeds: [plain(lang, '⚠️', t.botMissing(missing.map(m => `\`${m}\``).join(', ')), COLORS.error ?? 0xe74c3c)], ephemeral: true });
    }

    const doc = await GuildSettings.findOne({ guildId: interaction.guildId }, { adhkar: 1, setup: 1 }).lean();
    const timezone = opts.timezone ?? doc?.adhkar?.timezone ?? DEFAULT_TIMEZONE;
    if (!isValidTimeZone(timezone)) {
      return interaction.reply({ embeds: [plain(lang, '⚠️', t.badZone(timezone), COLORS.error ?? 0xe74c3c)], ephemeral: true });
    }

    // ── Pick + preview + confirm: nothing is created until the admin presses the button ──
    // Everything is ticked at first; the admin unticks what they do not want, and only the ticked rooms are created.
    let selected = [...SETUP_KEYS];
    const screen = () => ({
      embeds: [plain(lang, t.previewTitle, previewText({ lang, selected, timezone }))],
      components: previewComponents({ lang, selected })
    });
    const msg = await interaction.reply({ ...screen(), ephemeral: true, fetchReply: true });

    let pressed;
    for (;;) {
      try {
        pressed = await msg.awaitMessageComponent({
          time: CONFIRM_MS,
          filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('setup:')
        });
      } catch {
        return interaction.editReply({ embeds: [plain(lang, '⌛', t.timedOut)], components: [] }).catch(() => {});
      }
      if (pressed.customId !== PICK_ID) break;
      selected = cleanSelection(pressed.values);
      await pressed.update(screen());
    }
    if (pressed.customId === CANCEL_ID) {
      return pressed.update({ embeds: [plain(lang, '✖', t.cancelled)], components: [] });
    }
    if (pressed.customId !== CONFIRM_ID || !selected.length) return pressed.update(screen());
    // The rooms picked decide which permissions are needed (the voice room needs Connect / Speak), and they must all be
    // there before the first room is created.
    const lacking = missingBotPerms(interaction.guild, selected);
    if (lacking.length) {
      return pressed.update({ embeds: [plain(lang, '⚠️', t.botMissing(lacking.map(m => `\`${m}\``).join(', ')), COLORS.error ?? 0xe74c3c)], components: [] });
    }
    if (running.has(interaction.guildId)) {
      return pressed.update({ embeds: [plain(lang, '⏳', t.busy)], components: [] });
    }
    running.add(interaction.guildId);

    // ── Build ──
    try {
      await pressed.update({ embeds: [plain(lang, t.working, '')], components: [] });
      await GuildSettings.findOneAndUpdate({ guildId: interaction.guildId }, { $set: { language: lang } }, { upsert: true });
      GuildSettings.invalidateLangCache(interaction.guildId);
      setSessionLanguage(interaction.guildId, lang);

      const res = await applySetup({
        guild: interaction.guild, client: interaction.client, lang, timezone, selected, saved: (await GuildSettings.findOne({ guildId: interaction.guildId }, { setup: 1 }).lean())?.setup ?? {},   // read now, not before the wait: another run may have finished meanwhile
        deps: { GuildSettings, sendVoicePanel, roomPanelMessage, buildEmbed: (g) => buildEmbed(g), defaultAyahTime: DEFAULT_AYAH_TIME, defaultHadithTime: DEFAULT_HADITH_TIME }
      });

      const ch = res.channels;
      const items = setupPlan(lang, res.selected).items;
      const out = [`📁 ${setupPlan(lang).category} — ${res.status.category === 'created' ? t.created : t.reused}`];
      for (const it of items) out.push(`${it.type === 'voice' ? '🔊' : '💬'} ${ch[it.key]} — ${res.status[it.key] === 'created' ? t.created : t.reused}`);
      out.push('');
      if (ch.listen) out.push(t.listenPanel(res.listenPanelSent, ch.listen));
      if (ch.adhkar) out.push(t.adhkarDone(ch.adhkar, timezone));
      if (ch.ayah)   out.push(t.ayahDone(ch.ayah));
      if (ch.hadith) out.push(t.hadithDone(ch.hadith));
      if (ch.wird)   out.push(t.wirdDone(ch.wird));
      if (res.lockFailed?.length) out.push(t.lockFailed(res.lockFailed.map(k => ch[k]).join(' ')));
      if (res.lockLeaks?.length) out.push(t.lockLeaks(res.lockLeaks.slice(0, 10).map(l => `<#${l.channelId}> — ${l.mention}`).join('\n')));
      if (items.every(it => res.status[it.key] === 'reused') && res.status.category === 'reused') out.push('', t.nothingCreatedNew);
      return interaction.editReply({ embeds: [plain(lang, t.doneTitle, out.join('\n'), COLORS.success ?? COLORS.primary)], components: [] });
    } catch (err) {
      logger.error(`[setup] ${interaction.guildId}: ${err.message}`);
      // Only Discord's own refusals are shown (their text is safe and useful); anything else (database, network) stays in the log.
      const what = err.code === 50013 ? 'Missing Permissions' : (typeof err.code === 'number' && err.rawError ? String(err.message ?? '').slice(0, 120) : 'unexpected error');
      return interaction.editReply({ embeds: [plain(lang, '⚠️', t.failed(what), COLORS.error ?? 0xe74c3c)], components: [] }).catch(() => {});
    } finally {
      running.delete(interaction.guildId);
    }
}
