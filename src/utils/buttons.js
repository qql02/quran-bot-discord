import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';
import { SURAHS, surahLabel } from '../data/surahs.js';
import { PANEL_RECITERS, getGuildReciterKey, getGuildCustomReciter, panelReciter, SURAH_PAGE_COUNT, clampSurahPage, surahPageRange } from '../data/popular.js';

// ─── Panel buttons — kept deliberately few ────────────────────────────────────────
// Row 1 is everything most people ever need: pause/continue (ONE toggle button), next, volume −/+, leave.
// Row 2 holds the extras: repeat, Khatma, up-next, and "tools" (memorize, sleep timer, radio stations, another reciter, favourites).
// With no session there is a single obvious action — start a Khatma — instead of a wall of disabled buttons.
// (Old panels still on screen keep working: the handler understands their old button ids too.)
export function buildBigPanelButtons(session, lang) {
  const isAr      = lang === 'ar';
  const isPlaying = session?.status === 'playing';
  const isRadio   = !!session?.current?.isRadio;

  if (!session) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('panel:khatma')
        .setLabel(isAr ? '📖 ابدأ ختمة من الفاتحة' : '📖 Start a Khatma')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('panel:radio')
        .setLabel(isAr ? '📻 إذاعة مباشرة' : '📻 Live radio')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('panel:more')
        .setLabel(isAr ? '⚙️ أدوات' : '⚙️ Tools')
        .setStyle(ButtonStyle.Secondary)
    )];
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:toggle')
      .setLabel(isPlaying ? (isAr ? '⏸ إيقاف مؤقت' : '⏸ Pause') : (isAr ? '▶ استئناف' : '▶ Resume'))
      .setStyle(isPlaying ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('panel:skip')
      .setLabel(isAr ? '⏭ التالية' : '⏭ Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isRadio),            // skipping a live stream only restarts it
    new ButtonBuilder()
      .setCustomId('panel:vol_down')
      .setLabel(isAr ? '🔉 −' : '🔉 −')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:vol_up')
      .setLabel('🔊 +')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:stop')
      .setLabel(isAr ? '🚪 خروج' : '🚪 Leave')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:loop')
      .setLabel(isAr ? '🔁 تكرار' : '🔁 Repeat')
      .setStyle(session.loop ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:khatma')
      .setLabel(isAr ? '📖 ختمة' : '📖 Khatma')
      .setStyle(session.fullQuran ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(isRadio),
    new ButtonBuilder()
      .setCustomId('panel:queue_view')
      .setLabel(isAr ? '📜 القائمة' : '📜 Up next')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:more')
      .setLabel(isAr ? '⚙️ أدوات' : '⚙️ Tools')
      .setStyle((session.memorize || session.sleepTimer) ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  return [row1, row2];
}

// ─── Original buildPanelButtons (kept for /quran backward compat) ─────────────
export function buildPanelButtons(session, lang) {
  return buildBigPanelButtons(session, lang);
}

// ─── Queue Pagination ──────────────────────────────────────────────────────────
export function buildQueueButtons(currentPage, totalPages, lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue:prev:${currentPage}`)
      .setLabel(lang === 'ar' ? '◀ السابق' : '◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),

    new ButtonBuilder()
      .setCustomId(`queue:next:${currentPage}`)
      .setLabel(lang === 'ar' ? 'التالي ▶' : 'Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages)
  );
}

// ─── Menus: pick a surah / pick a reciter — for people who do not want to type commands ──────────────────────
/** Value of the last entry of the reciter menu: opens the search box (any reciter, any narration), not a reciter itself. */
export const RECITER_SEARCH_VALUE = '__search';

/**
 * The paged menu of all 114 surahs: 23 per page, "previous" / "next" are entries of the same menu (value `page:N`).
 * Used by the panel and by the memorize screen (which passes its own custom id).
 */
export function buildSurahMenu(lang, page, customId, placeholderOverride = null) {
  const isAr = lang === 'ar';
  const pg = clampSurahPage(page);
  const [from, to] = surahPageRange(pg);
  const options = [];
  if (pg > 0) {
    const [a, b] = surahPageRange(pg - 1);
    options.push({ label: isAr ? `⬅️ السور السابقة (${a}–${b})` : `⬅️ Previous surahs (${a}–${b})`, value: `page:${pg - 1}` });
  }
  for (let n = from; n <= to; n++) options.push({ label: surahLabel(SURAHS[n - 1], lang).slice(0, 100), value: String(n) });
  if (pg < SURAH_PAGE_COUNT - 1) {
    const [a, b] = surahPageRange(pg + 1);
    options.push({ label: isAr ? `➡️ السور التالية (${a}–${b})` : `➡️ Next surahs (${a}–${b})`, value: `page:${pg + 1}` });
  }
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholderOverride ?? (isAr ? `📖 اختر سورة (${from}–${to} من 114)` : `📖 Pick a surah (${from}–${to} of 114)`))
    .addOptions(options);
}

/** @returns {ActionRowBuilder[]}  two rows: surah menu, reciter menu (the reciter placeholder shows the server's current choice) */
export function buildPanelSelects(lang, guildId, page = 0) {
  const isAr = lang === 'ar';
  const pg = clampSurahPage(page);
  const custom  = getGuildCustomReciter(guildId);
  const current = panelReciter(getGuildReciterKey(guildId)) ?? (custom ? null : PANEL_RECITERS[0]);

  const surahs = buildSurahMenu(lang, pg, `panel:pick_surah:${pg}`);

  const reciterName = current ? (isAr ? current.ar : current.en) : custom;
  const reciters = new StringSelectMenuBuilder()
    .setCustomId('panel:pick_reciter')
    .setPlaceholder(`🎙️ ${isAr ? 'القارئ' : 'Reciter'}: ${reciterName}`.slice(0, 150))
    .addOptions([
      ...PANEL_RECITERS.map(r => ({ label: (isAr ? r.ar : r.en).slice(0, 100), value: r.key })),
      { label: isAr ? '🔎 قارئ آخر أو رواية أخرى…' : '🔎 Another reciter or narration…', value: RECITER_SEARCH_VALUE }
    ]);

  return [new ActionRowBuilder().addComponents(surahs), new ActionRowBuilder().addComponents(reciters)];
}
