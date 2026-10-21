import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} from 'discord.js';
import { Favorites } from '../models/Favorites.js';
import { COLORS, THUMBNAIL, buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { buildSurahMenu } from '../utils/buttons.js';
import { requireSameVoiceChannel, requireReciterChangeRight } from '../utils/permissions.js';
import { ensureSession } from '../utils/ensureSession.js';
import { adoptPanel, syncPanel, sendVoicePanel } from '../utils/panelRegistry.js';
import { getSurahByNumber, surahLabel } from '../data/surahs.js';
import {
  PANEL_RECITERS, getGuildReciterKey, getGuildCustomReciter, setGuildCustomReciter, panelReciter, clampSurahPage
} from '../data/popular.js';
import {
  getSession, enqueue, playNext, playRadio, clearQueue, setSleepTimer, clearSleepTimer, setMemorizeMode
} from '../managers/sessionManager.js';
import { saveReciterChoice } from '../services/reciterPrefs.js';
import { findDefaultReciter, findReciterById, searchRecitersFor } from '../services/quranService.js';
import { stationChoices, resolveStation, stationIsLive } from '../services/stationService.js';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The player panel's TOOLS: everything that used to be a separate slash command (/memorize, /sleep, /live, /recite with
// another reciter, /riwaya, /favorites, /clearqueue), as one private (ephemeral) card with a menu. Every screen has a
// back button, nothing needs typing except the reciter search, and nothing is stored in memory: the state of each
// screen travels in the custom ids, so a restart never breaks a card that is still on someone's screen.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TOOL_ACTIONS = new Set([
  'more', 'tools', 'tool', 'mem_rep', 'mem_go', 'sleep_set', 'radio', 'radio_pick',
  'rec_search', 'rec_modal', 'rec_pick', 'fav_surah', 'fav_rec', 'fav_play', 'clearq'
]);

export const REPEAT_CHOICES = [3, 5, 7, 10, 20, 30, 50];
export const DEFAULT_REPEATS = 5;
export const MEMORIZE_DELAY_MS = 3000;
export const SLEEP_CHOICES = ['10', '30', '60', 'end', 'cancel'];
export const REC_MODAL_ID = 'panel:rec_modal';

const trunc = (s, n) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const backRow = (lang) => row(new ButtonBuilder().setCustomId('panel:tools').setStyle(ButtonStyle.Secondary)
  .setLabel(lang === 'ar' ? '⬅️ رجوع للأدوات' : '⬅️ Back to tools'));
const card = (title, description, color = COLORS.primary) =>
  new EmbedBuilder().setColor(color).setTitle(title).setDescription(trunc(description, 4000)).setThumbnail(THUMBNAIL);
const noSession = (lang) => ({ embeds: [buildErrorEmbed(lang === 'ar' ? 'لا توجد جلسة نشطة.' : 'No active session.', lang)], ephemeral: true });

/** The reciter the server hears now (panel choice, a searched one, or the default), for display. */
export function currentReciterLabel(guildId, lang) {
  const custom = getGuildCustomReciter(guildId);
  if (custom) return custom;
  const r = panelReciter(getGuildReciterKey(guildId)) ?? PANEL_RECITERS[0];
  return lang === 'ar' ? r.ar : r.en;
}

// ─── Screens (pure: easy to test) ─────────────────────────────────────────────────────────────────────────────
export function toolsHome(lang, session, guildId, note = null) {
  const ar = lang === 'ar';
  const mem = session?.memorize;
  const lines = [
    note,
    ar ? 'اختر أداة من القائمة:' : 'Pick a tool from the menu:',
    '',
    ar ? '📿 **وضع الحفظ** — تكرار سورة عدة مرات' : '📿 **Memorize** — repeat a surah several times',
    ar ? '😴 **مؤقت النوم** — إيقاف تلقائي' : '😴 **Sleep timer** — stop automatically',
    ar ? '📻 **إذاعة** — محطات القرآن والمحطات الخاصة بالسيرفر' : '📻 **Radio** — Quran stations and this server\'s own',
    ar ? '🎙️ **قارئ آخر** — ابحث في كل القرّاء وفي الروايات' : '🎙️ **Another reciter** — search all reciters and narrations',
    ar ? '⭐ **مفضلتي** — سورك وقرّاؤك' : '⭐ **My favourites** — your surahs and reciters',
    ar ? '🚚 **اسحب التلاوة إلى رومي** — انتقلت لروم آخر؟ تكمل من نفس النقطة' : '🚚 **Pull the recitation to my room** — moved rooms? continue from the same point',
    ar ? '🗑 **مسح قائمة الانتظار**' : '🗑 **Clear the queue**'
  ].filter(x => x !== null);
  const status = [];
  if (mem) status.push(ar ? `📿 الحفظ نشط (${mem.currentRep + 1}/${mem.repeatCount})` : `📿 Memorize on (${mem.currentRep + 1}/${mem.repeatCount})`);
  if (session?.sleepTimer) status.push(ar ? '😴 مؤقت النوم نشط' : '😴 Sleep timer on');
  status.push(`🎙️ ${currentReciterLabel(guildId, lang)}`);
  const menu = new StringSelectMenuBuilder().setCustomId('panel:tool')
    .setPlaceholder(ar ? '⚙️ اختر أداة…' : '⚙️ Choose a tool…')
    .addOptions([
      { label: ar ? 'وضع الحفظ' : 'Memorize', value: 'mem', emoji: '📿', description: ar ? 'كرّر سورة للحفظ' : 'Repeat a surah' },
      { label: ar ? 'مؤقت النوم' : 'Sleep timer', value: 'sleep', emoji: '😴', description: ar ? 'إيقاف تلقائي' : 'Auto-stop' },
      { label: ar ? 'إذاعة مباشرة' : 'Live radio', value: 'radio', emoji: '📻', description: ar ? 'اختر محطة' : 'Pick a station' },
      { label: ar ? 'قارئ آخر أو رواية' : 'Another reciter / narration', value: 'reciter', emoji: '🎙️', description: ar ? 'بحث في كل القرّاء' : 'Search every reciter' },
      { label: ar ? 'مفضلتي' : 'My favourites', value: 'fav', emoji: '⭐', description: ar ? 'سور وقرّاء' : 'Surahs and reciters' },
      { label: ar ? 'اسحب التلاوة إلى رومي' : 'Pull the recitation to my room', value: 'pull', emoji: '🚚', description: ar ? 'تكمل من نفس النقطة' : 'Continue from the same point' },
      { label: ar ? 'مسح قائمة الانتظار' : 'Clear the queue', value: 'clearq', emoji: '🗑' }
    ]);
  return {
    embeds: [card(ar ? '⚙️ أدوات التشغيل' : '⚙️ Player tools', `${status.join('  ·  ')}\n\n${lines.join('\n')}`)],
    components: [row(menu)]
  };
}

export function memorizeScreen(lang, reps = DEFAULT_REPEATS, page = 0) {
  const ar = lang === 'ar';
  const r = REPEAT_CHOICES.includes(reps) ? reps : DEFAULT_REPEATS;
  const pg = clampSurahPage(page);
  const repMenu = new StringSelectMenuBuilder().setCustomId(`panel:mem_rep:${pg}`)
    .setPlaceholder(ar ? `🔁 عدد التكرار: ${r} مرة` : `🔁 Repetitions: ${r}`)
    .addOptions(REPEAT_CHOICES.map(n => ({ label: ar ? `${n} مرات` : `${n} times`, value: String(n), default: n === r })));
  return {
    embeds: [card(ar ? '📿 وضع الحفظ' : '📿 Memorize',
      ar ? `١. اختر **عدد التكرار** (الآن: **${r}**)\n٢. اختر **السورة** — يبدأ التشغيل فوراً بصوت القارئ الحالي ويكرّرها ${r} مرة بفاصل 3 ثوانٍ.`
         : `1. Pick the **number of repetitions** (now: **${r}**)\n2. Pick the **surah** — it starts at once with the current reciter and repeats ${r} times, 3 seconds apart.`,
      COLORS.gold)],
    components: [row(repMenu), row(buildSurahMenu(lang, pg, `panel:mem_go:${r}:${pg}`)), backRow(lang)]
  };
}

export function sleepScreen(lang, session, note = null) {
  const ar = lang === 'ar';
  const isRadio = !!session?.current?.isRadio;
  const opts = [
    { label: ar ? 'بعد 10 دقائق' : 'In 10 minutes', value: '10' },
    { label: ar ? 'بعد 30 دقيقة' : 'In 30 minutes', value: '30' },
    { label: ar ? 'بعد 60 دقيقة' : 'In 60 minutes', value: '60' }
  ];
  if (!isRadio) opts.push({ label: ar ? 'بعد انتهاء السورة الحالية' : 'After the current surah', value: 'end' });
  if (session?.sleepTimer) opts.push({ label: ar ? 'إلغاء المؤقت' : 'Cancel the timer', value: 'cancel', emoji: '⏰' });
  const state = session?.sleepTimer ? (ar ? '😴 **المؤقت نشط الآن.**' : '😴 **A timer is on.**') : (ar ? 'لا يوجد مؤقت.' : 'No timer is set.');
  return {
    embeds: [card(ar ? '😴 مؤقت النوم' : '😴 Sleep timer', `${note ? `${note}\n\n` : ''}${state}\n${ar ? 'يتوقف البوت ويخرج من الروم تلقائياً عند انتهاء المدة.' : 'The bot stops and leaves the room when the time is up.'}`, COLORS.gold)],
    components: [row(new StringSelectMenuBuilder().setCustomId('panel:sleep_set').setPlaceholder(ar ? '⏱ متى يتوقف؟' : '⏱ Stop when?').addOptions(opts)), backRow(lang)]
  };
}

export function radioScreen(lang, choices) {
  const ar = lang === 'ar';
  if (!choices.length) {
    return { embeds: [buildErrorEmbed(ar ? 'لا توجد محطة تبث الآن، أو أن خدمة الإذاعة لا تستجيب. حاول بعد قليل.' : 'No station is on the air right now, or the radio service is not responding. Please try again shortly.', lang)], components: [backRow(lang)] };
  }
  return {
    embeds: [card(ar ? '📻 إذاعة مباشرة' : '📻 Live radio',
      ar ? 'اختر محطة لتبدأ فوراً. تُعرض المحطات التي تبث الآن فقط.\n🏠 محطات هذا السيرفر · ⭐ محطات عامة · 📻 الإذاعات القرآنية\nلإضافة محطة خاصة: `/setup` ← «المحطات».'
         : 'Pick a station to start at once. Only stations on the air right now are listed.\n🏠 this server\'s stations · ⭐ public · 📻 Quran radios\nTo add your own: `/setup` → “Stations”.')],
    components: [row(new StringSelectMenuBuilder().setCustomId('panel:radio_pick').setPlaceholder(ar ? '📻 اختر محطة…' : '📻 Choose a station…').addOptions(choices.slice(0, 25).map(c => ({ label: String(c.label ?? c.name ?? '').slice(0, 100) || '—', value: String(c.value) })))), backRow(lang)]   // stationChoices() answers autocomplete-style { name, value }; a select menu needs { label, value }
  };
}

export function reciterScreen(lang, guildId, results = null, note = null) {
  const ar = lang === 'ar';
  const search = new ButtonBuilder().setCustomId('panel:rec_search').setStyle(ButtonStyle.Primary)
    .setLabel(ar ? '🔎 ابحث عن قارئ أو رواية' : '🔎 Search a reciter or narration');
  const parts = [note, `${ar ? 'القارئ الحالي' : 'Current reciter'}: **${currentReciterLabel(guildId, lang)}**`,
    ar ? 'يسمعه كل من في الروم، والاختيار يبقى حتى يغيّره أحد أو يُعاد تشغيل البوت.' : 'Everyone in the room hears it. The choice stays until someone changes it or the bot restarts.'].filter(Boolean);
  const components = [];
  if (results) {
    if (results.length) {
      components.push(row(new StringSelectMenuBuilder().setCustomId('panel:rec_pick').setPlaceholder(ar ? `اختر من النتائج (${results.length})` : `Pick a result (${results.length})`)
        .addOptions(results.slice(0, 25).map(r => {
          const en = r.englishName || r.name;
          const label = ar && r.arabicName && r.arabicName !== en ? `${r.arabicName} · ${en}` : en;
          return { label: trunc(label, 100), value: String(r.id) };
        }))));
    } else {
      parts.push(ar ? '⚠️ لا نتائج. جرّب جزءاً أقصر من الاسم.' : '⚠️ No results. Try a shorter part of the name.');
    }
  }
  components.push(row(search), backRow(lang));
  return { embeds: [card(ar ? '🎙️ قارئ آخر' : '🎙️ Another reciter', parts.join('\n'))], components };
}

export function reciterModal(lang) {
  const ar = lang === 'ar';
  return new ModalBuilder().setCustomId(REC_MODAL_ID).setTitle(ar ? 'ابحث عن قارئ' : 'Search a reciter').addComponents(
    row(new TextInputBuilder().setCustomId('q').setLabel(ar ? 'اسم القارئ (مثل: الحصري)' : 'Reciter name (e.g. Husary)')
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60)),
    row(new TextInputBuilder().setCustomId('r').setLabel(ar ? 'الرواية — اختياري (حفص، ورش، قالون…)' : 'Narration — optional (Hafs, Warsh, Qalon…)')
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(40))
  );
}

export function favoritesScreen(lang, fav, session, note = null) {
  const ar = lang === 'ar';
  const surahs = (fav?.surahs ?? []).map(n => getSurahByNumber(n)).filter(Boolean);
  const reciters = fav?.reciters ?? [];
  const cur = session?.current && !session.current.isRadio ? session.current : null;
  const curSurahFav = !!cur && (fav?.surahs ?? []).includes(cur.surah.number);
  const curRecFav = !!cur && reciters.includes(cur.reciter);
  const lines = [
    note,
    `**${ar ? '📖 السور' : '📖 Surahs'}:** ${surahs.length ? surahs.map(s => surahLabel(s, lang)).join(' · ') : (ar ? 'لا يوجد' : 'none')}`,
    `**${ar ? '🎙️ القرّاء' : '🎙️ Reciters'}:** ${reciters.length ? reciters.join(' · ') : (ar ? 'لا يوجد' : 'none')}`,
    '',
    cur ? (ar ? 'الأزرار تضيف أو تزيل **ما يُشغَّل الآن**.' : 'The buttons add or remove **what is playing now**.')
        : (ar ? 'شغّل سورة لتتمكن من إضافتها وقارئها إلى مفضلتك.' : 'Play a surah to be able to add it and its reciter.')
  ].filter(x => x !== null);
  const buttons = row(
    new ButtonBuilder().setCustomId('panel:fav_surah').setStyle(curSurahFav ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!cur)
      .setLabel(curSurahFav ? (ar ? '⭐ السورة في مفضلتي' : '⭐ Surah saved') : (ar ? '☆ أضف السورة الحالية' : '☆ Save this surah')),
    new ButtonBuilder().setCustomId('panel:fav_rec').setStyle(curRecFav ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!cur)
      .setLabel(curRecFav ? (ar ? '⭐ القارئ في مفضلتي' : '⭐ Reciter saved') : (ar ? '☆ أضف القارئ الحالي' : '☆ Save this reciter'))
  );
  const components = [buttons];
  if (surahs.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('panel:fav_play').setPlaceholder(ar ? '▶ شغّل سورة من مفضلتي…' : '▶ Play one of my surahs…')
      .addOptions(surahs.slice(0, 25).map(s => ({ label: trunc(surahLabel(s, lang), 100), value: String(s.number) })))));
  }
  components.push(backRow(lang));
  return { embeds: [card(ar ? '⭐ مفضلتي' : '⭐ My favourites', lines.join('\n'), COLORS.gold)], components };
}

// ─── Plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────
const fromEphemeralCard = (i) => i.message?.flags?.has?.(MessageFlags.Ephemeral) === true;

/** Show a screen: edit the private card in place when the click came from one, else open a new private card. */
const show = (i, payload) => (fromEphemeralCard(i) ? i.update(payload) : i.reply({ ...payload, ephemeral: true }));

/** Same for screens that need a network call first (answers Discord immediately, then fills the card in). */
async function showLate(i, make) {
  if (fromEphemeralCard(i)) await i.deferUpdate(); else await i.deferReply({ ephemeral: true });
  return i.editReply(await make());
}

/**
 * Start something from a tools screen: voice checks, join, start — then the panel in the room is redrawn (or posted when the
 * room has none yet). The result is a private message for the person who pressed; the tools card itself stays as it was.
 */
async function startFromTools(i, lang, start, doneTitle, doneText) {
  const ar = lang === 'ar';
  if (!i.deferred && !i.replied) await i.deferReply({ ephemeral: true });   // (the caller may already have answered Discord)
  const { ok, session } = await ensureSession(i, lang);
  if (!ok) return;
  const started = await start(session);
  if (!started) {
    return i.editReply({ embeds: [buildErrorEmbed(ar ? 'تعذّر بدء التشغيل الآن. حاول بعد قليل.' : 'Could not start playback right now. Please try again shortly.', lang)] });
  }
  if (!(await syncPanel(i.client, i.guildId))) {
    await sendVoicePanel(i.client, i.guild, i.member?.voice?.channel, i.channel).catch(() => {});
  }
  return i.editReply({ embeds: [buildSuccessEmbed(doneTitle, doneText, lang)] });
}

// ─── The router for every tools action ────────────────────────────────────────────────────────────────────────
export async function handleToolAction(interaction, action, rest, lang) {
  const ar = lang === 'ar';
  const guildId = interaction.guildId;
  const session = getSession(guildId);
  const home = (note = null) => toolsHome(lang, getSession(guildId), guildId, note);

  switch (action) {
    case 'more': {
      // The click came from the panel itself: it becomes THE panel of the server (also when it is an older one on screen).
      await adoptPanel(interaction.client, guildId, interaction.message).catch(() => {});
      return interaction.reply({ ...home(), ephemeral: true });
    }
    case 'tools':
      return interaction.update(home());

    case 'tool': {
      const v = interaction.values?.[0];
      if (v === 'mem')    return interaction.update(memorizeScreen(lang));
      if (v === 'sleep')  return interaction.update(sleepScreen(lang, session));
      if (v === 'radio')  return radioPicker(interaction, lang);
      if (v === 'reciter') return interaction.update(reciterScreen(lang, guildId));
      if (v === 'fav') {
        return showLate(interaction, async () => favoritesScreen(lang, await Favorites.getOrCreate(interaction.user.id, guildId), getSession(guildId)));
      }
      if (v === 'clearq') return clearQueueFromTools(interaction, lang, home);
      if (v === 'pull') return (await import('../commands/pull.js')).pullFlow(interaction);
      return interaction.deferUpdate().catch(() => {});
    }

    // ── Memorize ──
    case 'mem_rep': {
      const reps = Number(interaction.values?.[0]);
      return interaction.update(memorizeScreen(lang, REPEAT_CHOICES.includes(reps) ? reps : DEFAULT_REPEATS, Number(rest[0]) || 0));
    }
    case 'mem_go': {
      const reps = Number(rest[0]);
      const value = interaction.values?.[0] ?? '';
      if (value.startsWith('page:')) return interaction.update(memorizeScreen(lang, reps, Number(value.slice(5)) || 0));
      const surah = getSurahByNumber(Number(value));
      if (!surah || !REPEAT_CHOICES.includes(reps)) return interaction.deferUpdate().catch(() => {});
      const name = ar ? surah.arabic : surah.english;
      return startFromTools(interaction, lang, async () => {
        const reciterObj = await findDefaultReciter(interaction.user.id, guildId);
        if (!reciterObj?.moshaf?.length) return false;
        setMemorizeMode(guildId, { repeatCount: reps, delayMs: MEMORIZE_DELAY_MS });
        enqueue(guildId, { surah, reciter: reciterObj.displayName ?? reciterObj.name, reciterObj });
        const fresh = getSession(guildId);
        if (fresh && (fresh.status === 'idle' || !fresh.current)) await playNext(guildId);
        return true;
      }, ar ? '📿 بدأ وضع الحفظ' : '📿 Memorize started',
      ar ? `سورة **${name}** × **${reps}** مرة.` : `Surah **${name}** × **${reps}**.`);
    }

    // ── Sleep timer ──
    case 'sleep_set': {
      if (!session) return interaction.reply(noSession(lang));
      const { ok } = await requireSameVoiceChannel(interaction, session, lang);
      if (!ok) return;
      const v = interaction.values?.[0];
      if (!SLEEP_CHOICES.includes(v)) return interaction.deferUpdate().catch(() => {});
      let note;
      if (v === 'cancel') { clearSleepTimer(guildId); note = ar ? '⏰ أُلغي المؤقت.' : '⏰ Timer cancelled.'; }
      else if (v === 'end') {
        if (session.current?.isRadio) note = ar ? '⚠️ الإذاعة لا تنتهي؛ اختر مدة.' : '⚠️ A live stream never ends — pick a duration.';
        else { setSleepTimer(guildId, 'end_of_track'); note = ar ? '😴 سيتوقف التشغيل بعد انتهاء السورة الحالية.' : '😴 Playback will stop after the current surah.'; }
      } else { setSleepTimer(guildId, Number(v) * 60_000); note = ar ? `😴 سيتوقف التشغيل بعد **${v} دقيقة**.` : `😴 Playback will stop in **${v} minutes**.`; }
      const shown = interaction.update(sleepScreen(lang, getSession(guildId), note));   // answer first, redraw the panel after
      void syncPanel(interaction.client, guildId);
      return shown;
    }

    // ── Radio (also the idle panel's "Live radio" button) ──
    case 'radio':
      return radioPicker(interaction, lang);
    case 'radio_pick': {
      await interaction.deferReply({ ephemeral: true });          // looking the station up can call the radio API
      const station = await resolveStation(guildId, interaction.values?.[0] ?? '');
      if (!station?.url) {
        return interaction.editReply({ embeds: [buildErrorEmbed(ar ? 'المحطة غير موجودة.' : 'Station not found.', lang)] });
      }
      if (!(await stationIsLive(station.url))) {
        return interaction.editReply({ embeds: [buildErrorEmbed(ar ? `**${station.name}** لا تبث الآن. اختر محطة أخرى.` : `**${station.name}** is not broadcasting right now. Pick another.`, lang)] });
      }
      return startFromTools(interaction, lang, () => playRadio(guildId, station),
        ar ? '📻 بدأت الإذاعة' : '📻 Radio started', `**${station.name}**`);
    }

    // ── Another reciter ──
    case 'rec_search':
      return interaction.showModal(reciterModal(lang));
    case 'rec_modal': {
      const q = interaction.fields.getTextInputValue('q').trim();
      const r = interaction.fields.getTextInputValue('r').trim();
      if (!q && !r) return show(interaction, reciterScreen(lang, guildId, null, ar ? '⚠️ اكتب اسم قارئ أو رواية.' : '⚠️ Type a reciter or a narration.'));
      return showLate(interaction, async () => reciterScreen(lang, guildId, await searchRecitersFor({ name: q, riwaya: r })));
    }
    case 'rec_pick': {
      {                                   // the choice applies to the whole server: not for people outside the room
        const { ok } = await requireReciterChangeRight(interaction, session, lang);
        if (!ok) return;
      }
      await interaction.deferUpdate();    // the reciter list may need a download after a restart
      const rec = await findReciterById(interaction.values?.[0]);
      if (!rec?.moshaf?.length) return interaction.editReply(reciterScreen(lang, guildId, null, ar ? '⚠️ تعذّر العثور على هذا القارئ.' : '⚠️ Could not find that reciter.'));
      setGuildCustomReciter(guildId, rec.displayName ?? rec.name);
      saveReciterChoice(guildId);
      void syncPanel(interaction.client, guildId);
      return interaction.editReply(reciterScreen(lang, guildId, null, ar ? `✅ القارئ الآن: **${rec.displayName ?? rec.name}**. سيُستخدم في كل ما تشغّله من اللوحة بعد الآن.` : `✅ Reciter is now **${rec.displayName ?? rec.name}**. It is used for everything you start from the panel from now on.`));
    }

    // ── Favourites ──
    case 'fav_surah':
    case 'fav_rec': {
      const cur = session?.current && !session.current.isRadio ? session.current : null;
      if (!cur) return interaction.reply(noSession(lang));
      const uid = interaction.user.id;
      const fav = await Favorites.getOrCreate(uid, guildId);
      let note;
      if (action === 'fav_surah') {
        const has = (fav.surahs ?? []).includes(cur.surah.number);
        await (has ? Favorites.removeSurah(uid, guildId, cur.surah.number) : Favorites.addSurah(uid, guildId, cur.surah.number));
        note = has ? (ar ? '🗑 أُزيلت السورة من مفضلتك.' : '🗑 Surah removed.') : (ar ? '⭐ أُضيفت السورة إلى مفضلتك.' : '⭐ Surah saved.');
      } else {
        const has = (fav.reciters ?? []).includes(cur.reciter);
        await (has ? Favorites.removeReciter(uid, guildId, cur.reciter) : Favorites.addReciter(uid, guildId, cur.reciter));
        note = has ? (ar ? '🗑 أُزيل القارئ من مفضلتك.' : '🗑 Reciter removed.') : (ar ? '⭐ أُضيف القارئ إلى مفضلتك.' : '⭐ Reciter saved.');
      }
      return interaction.update(favoritesScreen(lang, await Favorites.getOrCreate(uid, guildId), getSession(guildId), note));
    }
    case 'fav_play': {
      const surah = getSurahByNumber(Number(interaction.values?.[0]));
      if (!surah) return interaction.deferUpdate().catch(() => {});
      return startFromTools(interaction, lang, async () => {
        const reciterObj = await findDefaultReciter(interaction.user.id, guildId);
        if (!reciterObj?.moshaf?.length) return false;
        enqueue(guildId, { surah, reciter: reciterObj.displayName ?? reciterObj.name, reciterObj });
        const fresh = getSession(guildId);
        if (fresh && (fresh.status === 'idle' || !fresh.current)) await playNext(guildId);
        return true;
      }, ar ? '▶ أُضيفت للتشغيل' : '▶ Queued', `**${ar ? surah.arabic : surah.english}**`);
    }

    // ── The queue ──
    case 'clearq': {
      if (!session) return interaction.reply(noSession(lang));
      const { ok } = await requireSameVoiceChannel(interaction, session, lang);
      if (!ok) return;
      clearQueue(guildId);
      const shown = interaction.update({ embeds: [buildSuccessEmbed(ar ? 'تم' : 'Done', ar ? 'مُسحت قائمة الانتظار.' : 'The queue was cleared.', lang)], components: [] });
      void syncPanel(interaction.client, guildId);
      return shown;
    }
  }
}

async function radioPicker(interaction, lang) {
  return showLate(interaction, async () => radioScreen(lang, await stationChoices(interaction.guildId, '').catch(() => [])));
}

async function clearQueueFromTools(interaction, lang, home) {
  const session = getSession(interaction.guildId);
  const ar = lang === 'ar';
  if (!session) return interaction.update(home(ar ? '⚠️ لا توجد جلسة نشطة.' : '⚠️ No active session.'));
  const { ok } = await requireSameVoiceChannel(interaction, session, lang);
  if (!ok) return;
  const n = session.queue.length;
  clearQueue(interaction.guildId);
  void syncPanel(interaction.client, interaction.guildId);
  return interaction.update(home(n ? (ar ? `🗑 مُسحت قائمة الانتظار (${n}).` : `🗑 Queue cleared (${n}).`) : (ar ? 'القائمة فارغة أصلاً.' : 'The queue is already empty.')));
}
