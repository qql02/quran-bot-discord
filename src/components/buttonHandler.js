import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GuildSettings }   from '../models/GuildSettings.js';
import { t }               from '../utils/i18n.js';
import {
  buildBigPanelEmbed,
  buildQueueEmbed,
  buildErrorEmbed,
  buildSuccessEmbed,
  buildInfoEmbed
} from '../utils/embeds.js';
import {
  buildBigPanelButtons,
  buildQueueButtons,
  RECITER_SEARCH_VALUE
} from '../utils/buttons.js';
import {
  requireSameVoiceChannel, requireReciterChangeRight } from '../utils/permissions.js';
import { ensureSession } from '../utils/ensureSession.js';
import { buildPanelMessage, isPanelCard, surahPageOf } from '../utils/panel.js';
import { loadReciterChoice, saveReciterChoice } from '../services/reciterPrefs.js';
import { TOOL_ACTIONS, handleToolAction, memorizeScreen, sleepScreen, reciterModal } from '../panels/playerTools.js';
import { adoptPanel } from '../utils/panelRegistry.js';
import { setGuildReciterKey, panelReciter } from '../data/popular.js';
import { getSession,
  pauseSession,
  resumeSession,
  skipSession,
  destroySession,
  toggleLoop,
  setVolume,
  enqueue,
  playNext,
  clearQueue,
  setSessionLanguage
} from '../managers/sessionManager.js';
import { SURAHS, getSurahByNumber } from '../data/surahs.js';
import { findDefaultReciter } from '../services/quranService.js';

const VOL_STEP        = 10; // ± step for volume buttons

// ─── Main Router ──────────────────────────────────────────────────────────────
export async function handleButton(interaction) {
  const [namespace, action, ...rest] = interaction.customId.split(':');

  // ── Language picker (welcome message) — only people who can manage the server may change it ──
  if (namespace === 'lang' && action === 'set') {
    const chosen = rest[0] === 'ar' ? 'ar' : 'en';
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '🔒 تحتاج صلاحية «إدارة السيرفر» · You need the Manage Server permission.',
        ephemeral: true
      });
    }
    await GuildSettings.findOneAndUpdate({ guildId: interaction.guildId }, { language: chosen }, { upsert: true });
    GuildSettings.invalidateLangCache(interaction.guildId);
    setSessionLanguage(interaction.guildId, chosen);
    return interaction.update({
      embeds: [buildSuccessEmbed(t(chosen, 'commands.language.changed_title'), t(chosen, 'commands.language.changed'), chosen)],
      components: []
    });
  }

  const lang = await GuildSettings.getLanguage(interaction.guildId);

  if (namespace === 'panel') {
    await loadReciterChoice(interaction.guildId);            // an old panel on screen after a restart still shows the saved reciter
    if (TOOL_ACTIONS.has(action)) return handleToolAction(interaction, action, rest, lang);
    return handlePanelButton(interaction, action, lang);
  }

  if (namespace === 'queue') {
    return handleQueuePagination(interaction, action, parseInt(rest[0]), lang);
  }
}

export { surahPageOf };   // lives in utils/panel.js now (the panel redraws outside this file need it too)

// Re-draw the panel the button was pressed on: new card panels stay cards, older embed panels stay embeds.
function updatePanel(interaction, session, lang) {
  if (isPanelCard(interaction.message)) return interaction.update(buildPanelMessage(session, lang, interaction.guildId, surahPageOf(interaction.message)));
  return interaction.update({
    embeds:     [buildBigPanelEmbed(session, lang)],
    components: buildBigPanelButtons(session, lang)
  });
}

// The panel message as it should look now (card panels stay cards, older embed panels stay embeds).
function panelPayload(message, session, lang, guildId, surahPage = 0) {
  if (isPanelCard(message)) return buildPanelMessage(session, lang, guildId, surahPage);
  return { embeds: [buildBigPanelEmbed(session, lang)], components: buildBigPanelButtons(session, lang) };
}

/**
 * Start something from the panel (a Khatma, radio, a surah): check the voice channel, join, start, then turn THIS panel
 * into the live one. Errors reach only the person who pressed (ephemeral); on success their "thinking…" notice disappears.
 */
async function startFromPanel(interaction, lang, start, surahPage = 0) {
  const isAr = lang === 'ar';
  await interaction.deferReply({ ephemeral: true });
  const { ok, session } = await ensureSession(interaction, lang);
  if (!ok) return;
  const started = await start(session);
  if (!started) {
    return interaction.editReply({ embeds: [buildErrorEmbed(
      isAr ? 'تعذّر بدء التشغيل الآن. حاول بعد قليل.' : 'Could not start playback right now. Please try again shortly.', lang)] });
  }
  const live = getSession(interaction.guildId);
  await adoptPanel(interaction.client, interaction.guildId, interaction.message);
  await interaction.message.edit(panelPayload(interaction.message, live, lang, interaction.guildId, surahPage)).catch(() => {});
  return interaction.deleteReply().catch(() => {});
}

// ─── Panel Button Handler ─────────────────────────────────────────────────────
async function handlePanelButton(interaction, action, lang) {
  const isAr    = lang === 'ar';
  const session = getSession(interaction.guildId);

  // ── Refresh — always available, no session required ────────────────────────
  if (action === 'refresh') {
    return updatePanel(interaction, session, lang);
  }

  // ── Queue View ─────────────────────────────────────────────────────────────
  if (action === 'queue_view') {
    if (!session) {
      return interaction.reply({
        embeds: [buildErrorEmbed(isAr ? 'لا توجد جلسة نشطة.' : 'No active session.', lang)],
        ephemeral: true
      });
    }
    const { embed, totalPages, currentPage } = buildQueueEmbed(session, 1, lang);
    const components = totalPages > 1 ? [buildQueueButtons(currentPage, totalPages, lang)] : [];
    if (session.queue.length) {
      components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:clearq').setStyle(ButtonStyle.Secondary)
        .setLabel(isAr ? '🗑 مسح القائمة' : '🗑 Clear the queue')));
    }
    return interaction.reply({ embeds: [embed], components, ephemeral: true });
  }

  // ── Older panels still on screen: their "memorize" / "sleep" buttons now open the same tools as the new panel ──
  if (action === 'memorize_info') return interaction.reply({ ...memorizeScreen(lang), ephemeral: true });
  if (action === 'sleep_info')    return interaction.reply({ ...sleepScreen(lang, session), ephemeral: true });

  // ── Pick a reciter (menu) — remembered for the whole server ────────────────
  if (action === 'pick_reciter') {
    const key = interaction.values?.[0];
    if (key === RECITER_SEARCH_VALUE) return interaction.showModal(reciterModal(lang));   // another reciter / narration: the search box
    const r = panelReciter(key);
    if (!r) return interaction.deferUpdate().catch(() => {});
    {                                                // the choice applies to the whole server: not for people outside the room
      const { ok } = await requireReciterChangeRight(interaction, session, lang);
      if (!ok) return;
    }
    setGuildReciterKey(interaction.guildId, key);
    saveReciterChoice(interaction.guildId);
    return interaction.update(panelPayload(interaction.message, session, lang, interaction.guildId, surahPageOf(interaction.message)));
  }

  // ── Pick a surah (menu) — plays now, or joins the queue when something is already playing ──────
  if (action === 'pick_surah') {
    const value = interaction.values?.[0] ?? '';
    const page  = Number(interaction.customId.split(':')[2]) || 0;
    if (value.startsWith('page:')) {                       // "previous / next surahs" entry: just turn the page
      return interaction.update(panelPayload(interaction.message, session, lang, interaction.guildId, Number(value.slice(5)) || 0));
    }
    const surah = getSurahByNumber(Number(value));
    if (!surah) return interaction.deferUpdate().catch(() => {});
    const reciterObj = await findDefaultReciter(interaction.user.id, interaction.guildId);
    if (!reciterObj) return noReciters(interaction, lang);
    return startFromPanel(interaction, lang, async (sess) => {
      enqueue(interaction.guildId, { surah, reciter: reciterObj.displayName ?? reciterObj.name, reciterObj });
      if (sess.status === 'idle' || !sess.current) await playNext(interaction.guildId);
      return !!getSession(interaction.guildId)?.current || (getSession(interaction.guildId)?.queue.length ?? 0) > 0;
    }, page);
  }

  // ── Khatma (whole Quran in order) ─────────────────────────────────────────────────────────────
  if (action === 'khatma' || action === 'fullquran') {   // 'fullquran' = old panels still on screen
    const reciterObj = (session?.current && !session.current.isRadio ? session.current.reciterObj : null)
      ?? await findDefaultReciter(interaction.user.id, interaction.guildId);
    if (!reciterObj) return noReciters(interaction, lang);
    const actualName = reciterObj.displayName ?? reciterObj.name;

    return startFromPanel(interaction, lang, async (sess) => {
      clearQueue(interaction.guildId);
      sess.fullQuran = true;
      sess.loop      = false;
      sess.memorize  = null;   // can't run both simultaneously
      enqueue(interaction.guildId, { surah: SURAHS[0], reciter: actualName, reciterObj });
      if (sess.status === 'paused' || sess.status === 'playing') skipSession(interaction.guildId);
      else await playNext(interaction.guildId);
      return true;
    });
  }

  // ── Volume Controls ────────────────────────────────────────────────────────
  if (action === 'vol_down' || action === 'vol_up' || action === 'vol_50' || action === 'vol_100') {
    if (!session) {
      return interaction.reply({
        embeds: [buildErrorEmbed(isAr ? 'لا توجد جلسة نشطة.' : 'No active session.', lang)],
        ephemeral: true
      });
    }
    const { ok } = await requireSameVoiceChannel(interaction, session, lang);
    if (!ok) return;

    let newVol = session.volume ?? 100;
    if (action === 'vol_down') newVol = Math.max(0,   newVol - VOL_STEP);
    if (action === 'vol_up')   newVol = Math.min(150, newVol + VOL_STEP);
    if (action === 'vol_50')   newVol = 50;
    if (action === 'vol_100')  newVol = 100;

    await setVolume(interaction.guildId, newVol);

    return updatePanel(interaction, getSession(interaction.guildId), lang);
  }

  // ── Actions that require an active session ─────────────────────────────────
  if (!session) {
    return interaction.reply({
      embeds: [buildErrorEmbed(
        isAr ? 'لا توجد جلسة نشطة.' : 'No active session.',
        lang
      )],
      ephemeral: true
    });
  }

  const { ok } = await requireSameVoiceChannel(interaction, session, lang);
  if (!ok) return;

  switch (action) {
    case 'toggle': {
      if (session.status === 'playing') pauseSession(interaction.guildId);
      else if (session.status === 'paused') resumeSession(interaction.guildId);
      else if (session.queue.length > 0) await playNext(interaction.guildId);
      break;
    }

    case 'pause': {
      const paused = pauseSession(interaction.guildId);
      if (!paused) {
        return interaction.reply({
          embeds: [buildErrorEmbed(t(lang, 'commands.pause.not_playing'), lang)],
          ephemeral: true
        });
      }
      break;
    }

    case 'play': {
      if (session.status === 'paused') {
        resumeSession(interaction.guildId);
      } else if (session.status === 'idle' && session.queue.length > 0) {
        await playNext(interaction.guildId);
      } else if (session.status === 'idle' && session.queue.length === 0) {
        // FIX: give clear feedback instead of silently doing nothing
        return interaction.reply({
          embeds: [buildInfoEmbed(
            isAr ? 'قائمة الانتظار فارغة' : 'Queue is empty',
            isAr
              ? 'اختر سورة من القائمة أولاً ثم اضغط تشغيل.'
              : 'Pick a surah from the menu first, then press Play.',
            lang
          )],
          ephemeral: true
        });
      }
      break;
    }

    case 'skip': {
      skipSession(interaction.guildId);
      break;
    }

    case 'stop': {
      // Acknowledge first: destroySession deletes this very panel message, so it can no longer be updated afterwards.
      await interaction.deferUpdate().catch(() => {});
      await destroySession(interaction.guildId);
      return;
    }

    case 'loop': {
      // FIX: turning loop ON must clear conflicting modes (fullQuran & memorize).
      // Turning it OFF is always safe — no clearing needed.
      const willBeOn = !session.loop;
      if (willBeOn) {
        session.fullQuran = false;
        session.memorize  = null;
      }
      toggleLoop(interaction.guildId);
      break;
    }
  }

  return updatePanel(interaction, getSession(interaction.guildId), lang);
}

// ─── Queue Pagination ──────────────────────────────────────────────────────────
async function handleQueuePagination(interaction, direction, currentPage, lang) {
  const session = getSession(interaction.guildId);
  if (!session) return interaction.update({ components: [] });

  const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
  const { embed, totalPages, currentPage: page } = buildQueueEmbed(session, newPage, lang);
  const components = totalPages > 1 ? [buildQueueButtons(page, totalPages, lang)] : [];

  return interaction.update({ embeds: [embed], components });
}

function noReciters(interaction, lang) {
  return interaction.reply({
    embeds: [buildErrorEmbed(
      lang === 'ar' ? 'خدمة القرّاء لا تستجيب الآن. حاول بعد قليل.' : 'The reciters service is not responding right now. Please try again shortly.', lang)],
    ephemeral: true
  });
}
