import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { PersonalList } from '../models/PersonalList.js';
import { buildErrorEmbed, buildSuccessEmbed, COLORS } from '../utils/embeds.js';
import { normalizeText } from '../utils/arabic.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { fetchAyah } from '../services/ayahService.js';
import { openMushaf } from '../components/mushafHandler.js';
import * as P from '../utils/personal.js';
import { JOURNEYS, TAFSIRS, DEFAULT_TAFSIR, getTafsir, getJourney, journeyTitle, journeyDesc, randomJourney } from '../data/journeys.js';
import { SURAHS } from '../data/surahs.js';
import { toIndic } from '../utils/mushaf.js';

/**
 * /journey — a guided journey through the Quran on one topic (patience, hope, gratitude…), as a private message.
 * Each step is ONE verse: the verse, its short tafsir (التفسير الميسر), a reflection question (وقفة) and where it is in the Mushaf.
 * Buttons: previous / next · save the page of the verse to the member's personal list (the same list as the DM command !mark)
 * · open that page in the Mushaf reader. The last "next" closes the journey with a summary and offers another one.
 *
 *   /journey                 → a random journey
 *   /journey topic:<search>  → that journey (type to search, pick from the suggestions)
 *   /journey tafsir:<tafsir> → read the verses with another tafsir (Muyassar by default; Jalalayn, Qurtubi, Baghawi, Waseet) — falls back to Muyassar when one is missing
 *
 * The verses are only references (data/journeys.js); text, tafsir and page come from the Quran API like the verse of the day.
 */

const PREFIX = 'journey:';
const EPH = MessageFlags.Ephemeral;
const RANDOM = 'random';
const MAX_TAFSIR = 1000;                                          // embed field limit is 1024

const shorten = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);
const idOf = (action, journeyId, step, userId, tf = DEFAULT_TAFSIR) => `${PREFIX}${action}:${journeyId}:${step}:${userId}:${tf}`;

const searchText = (j) => normalizeText(`${j.ar} ${j.en} ${j.descAr} ${j.descEn}`);

/** The journeys whose title or description contains the words typed (all of them when nothing is typed). */
export function searchJourneys(query) {
  const q = normalizeText(query);
  return q ? JOURNEYS.filter(j => searchText(j).includes(q)) : JOURNEYS;
}

// ── Screens ────────────────────────────────────────────────────────────────────────────────────────────────────────

const STR = {
  ar: {
    journey: 'رحلة', tafsir: 'التفسير الميسر', pause: 'وقفة', where: 'الموضع',
    place: (s, a, p) => `سورة ${s} • الآية ${toIndic(a)}${p ? ` • الصفحة ${toIndic(p)}` : ''}`,
    footer: 'جلسة خاصة • يمكنك حفظ صفحة الآية كعلامة',
    prev: 'السابق', next: 'التالي', finish: 'إنهاء الرحلة', save: 'حفظ الصفحة', open: 'فتح في المصحف',
    retry: 'إعادة المحاولة', again: 'أعد الرحلة', another: 'رحلة أخرى',
    failTitle: 'تعذّر جلب الآية', failDesc: 'الخدمة التي تجلب الآيات لا تستجيب الآن. جرّب مرة أخرى بعد قليل.',
    doneTitle: (t) => `ختام رحلة ${t}`, doneIntro: 'مررتَ في هذه الرحلة بهذه الآيات:',
    doneOutro: 'تقبّل الله منك، وجعل ما قرأتَه نورًا في قلبك. يمكنك الرجوع إلى أي آية بزر «حفظ الصفحة» أو بدء رحلة أخرى.',
    doneFooter: 'اللهم انفعنا بما علّمتنا',
    saved: (p) => `حُفظت الصفحة ${p}. اعرض قائمتك في الخاص بـ \`${config.bot.prefix}قائمتي\`.`,
    exists: (p) => `الصفحة ${p} محفوظة عندك من قبل.`,
    full: (n) => `قائمتك ممتلئة (${n} صفحة). احذف شيئًا منها بـ \`${config.bot.prefix}ازل\` في الخاص.`,
    saveFail: 'تعذّر الحفظ الآن، حاول بعد قليل.',
    done: 'تم', noPage: 'لا أعرف صفحة هذه الآية الآن، حاول بعد قليل.',
    notYours: 'هذه الأزرار لمن بدأ الرحلة. اكتب `/journey` لتبدأ رحلتك.',
    unknown: 'لا توجد رحلة بهذا الاسم. اكتب `/journey topic:` واختر من القائمة المقترحة.',
    pick: 'اختر من القائمة المقترحة أثناء الكتابة:',
    random: 'رحلة عشوائية'
  },
  en: {
    journey: 'Journey', tafsir: 'Tafsir (al-Muyassar)', pause: 'Pause & reflect', where: 'Where',
    place: (s, a, p) => `Surah ${s} • Verse ${a}${p ? ` • Page ${p}` : ''}`,
    footer: 'Private session • you can save the verse\'s page as a bookmark',
    prev: 'Previous', next: 'Next', finish: 'Finish journey', save: 'Save page', open: 'Open in Mushaf',
    retry: 'Try again', again: 'Repeat journey', another: 'Another journey',
    failTitle: 'Could not load the verse', failDesc: 'The service that provides the verses is not answering right now. Try again in a moment.',
    doneTitle: (t) => `End of the journey: ${t}`, doneIntro: 'On this journey you passed through:',
    doneOutro: 'May Allah accept it from you and make what you read a light in your heart. Go back to any verse with "Save page", or start another journey.',
    doneFooter: 'O Allah, benefit us by what You taught us',
    saved: (p) => `Saved page ${p}. See your list in DMs with \`${config.bot.prefix}mine\`.`,
    exists: (p) => `Page ${p} is already in your list.`,
    full: (n) => `Your list is full (${n} pages). Free a place with \`${config.bot.prefix}remove\` in DMs.`,
    saveFail: 'Could not save right now, try again shortly.',
    done: 'Done', noPage: 'The page of this verse is not known right now, try again shortly.',
    notYours: 'These buttons belong to whoever started the journey. Use `/journey` for your own.',
    unknown: 'No journey with that name. Type `/journey topic:` and pick from the suggestions.',
    pick: 'Pick one from the suggestions while typing:',
    random: 'Random journey'
  }
};
const L = (lang) => (lang === 'ar' ? STR.ar : STR.en);

const surahName = (ref, lang) => {
  const s = SURAHS[Number(ref.split(':')[0]) - 1];
  return lang === 'ar' ? s.arabic : s.english;
};

/** One step of a journey: the verse + tafsir + reflection + place, with the navigation and action buttons. */
export function stepPayload(journey, step, userId, verse, lang = 'ar', tf = DEFAULT_TAFSIR) {
  const s = L(lang);
  const total = journey.steps.length;
  const i = Math.min(Math.max(0, step), total - 1);
  const cur = journey.steps[i];
  const last = i === total - 1;
  const title = journeyTitle(journey, lang);
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${journey.icon} ${s.journey} ${title} • ${lang === 'ar' ? toIndic(i + 1) : i + 1}/${lang === 'ar' ? toIndic(total) : total}`)
    .setDescription(`## ﴿ ${verse.text} ﴾`)
    .addFields(
      { name: lang === 'ar' ? getTafsir(tf).ar : getTafsir(tf).en, value: shorten(verse.tafsir, MAX_TAFSIR) },
      { name: s.pause, value: lang === 'ar' ? cur.ar : cur.en },
      { name: s.where, value: s.place(lang === 'ar' ? verse.surahName : surahName(cur.ref, 'en'), verse.ayah, verse.page) }
    )
    .setFooter({ text: s.footer });

  const btn = () => new ButtonBuilder();
  const row1 = new ActionRowBuilder().addComponents(
    btn().setCustomId(idOf('go', journey.id, i - 1, userId, tf)).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(i <= 0)
      .setLabel(s.prev),
    btn().setCustomId(idOf('save', journey.id, i, userId, tf)).setEmoji('🔖').setLabel(s.save).setStyle(ButtonStyle.Success)
      .setDisabled(!verse.page)
  );
  const row2 = new ActionRowBuilder().addComponents(
    btn().setCustomId(idOf('open', journey.id, i, userId, tf)).setEmoji('📖').setLabel(s.open).setStyle(ButtonStyle.Secondary)
      .setDisabled(!verse.page),
    btn().setCustomId(idOf('go', journey.id, i + 1, userId, tf)).setEmoji(last ? '✅' : '▶️').setLabel(last ? s.finish : s.next).setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row1, row2] };
}

/** The closing screen: the verses of the journey, a short du'a, and "repeat" / "another journey". */
export function finishPayload(journey, userId, lang = 'ar', tf = DEFAULT_TAFSIR) {
  const s = L(lang);
  const list = journey.steps.map(st => {
    const [sur, ay] = st.ref.split(':').map(Number);
    return `• ${lang === 'ar' ? `سورة ${surahName(st.ref, 'ar')} • ${toIndic(ay)}` : `${surahName(st.ref, 'en')} ${sur}:${ay}`}`;
  }).join('\n');
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`${journey.icon} ${s.doneTitle(journeyTitle(journey, lang))}`)
    .setDescription(`${s.doneIntro}\n${list}\n\n${s.doneOutro}`)
    .setFooter({ text: s.doneFooter });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(idOf('go', journey.id, 0, userId, tf)).setEmoji('🔁').setLabel(s.again).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(idOf('new', journey.id, 0, userId, tf)).setEmoji('🎲').setLabel(s.another).setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

function failPayload(journey, step, userId, lang, tf = DEFAULT_TAFSIR) {
  const s = L(lang);
  return {
    embeds: [buildErrorEmbed(`**${s.failTitle}**\n${s.failDesc}`, lang)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(idOf('go', journey.id, step, userId, tf)).setEmoji('🔄').setLabel(s.retry).setStyle(ButtonStyle.Primary)
    )]
  };
}

/** Any step (or the closing screen when `step` is past the last one) as a message payload. Fetches the verse; warms the next one. */
export async function screenFor(journey, step, userId, lang, tf = DEFAULT_TAFSIR) {
  if (step >= journey.steps.length) return finishPayload(journey, userId, lang, tf);
  const i = Math.max(0, step);
  const edition = getTafsir(tf).edition;
  let shownTf = getTafsir(tf).key;
  let verse = await fetchAyah(journey.steps[i].ref, edition);
  if (!verse && shownTf !== DEFAULT_TAFSIR) {                      // the chosen tafsir is not available for this verse → the default one, never an empty screen
    verse = await fetchAyah(journey.steps[i].ref);
    shownTf = DEFAULT_TAFSIR;
  }
  if (!verse) return failPayload(journey, i, userId, lang, tf);
  const next = journey.steps[i + 1];
  if (next) fetchAyah(next.ref, edition).catch(() => {});          // so "next" feels instant
  return stepPayload(journey, i, userId, verse, lang, shownTf);
}

// ── Command ────────────────────────────────────────────────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('journey')
    .setDescription('A guided Quran journey on a topic / رحلة قرآنية مع موضوع: آية وتفسير ووقفة')
    .setDMPermission(false)
    .addStringOption(o => o.setName('topic').setDescription('Journey topic — type to search / موضوع الرحلة').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('tafsir').setDescription('Tafsir to read with the verses (default: Al-Muyassar) / التفسير').setRequired(false)
      .addChoices(...TAFSIRS.map(t => ({ name: t.ar, value: t.key })))),

  async autocomplete(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId).catch(() => 'ar');
    const typed = interaction.options.getFocused();
    const hits = searchJourneys(typed).slice(0, 24);
    const choices = hits.map(j => ({ name: `${j.icon} ${journeyTitle(j, lang)} — ${journeyDesc(j, lang)}`.slice(0, 100), value: j.id }));
    if (!typed) choices.unshift({ name: `🎲 ${L(lang).random}`, value: RANDOM });
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const raw = interaction.options.getString('topic')?.trim();
    let journey;
    if (!raw || raw === RANDOM) journey = randomJourney();
    else {
      journey = getJourney(raw);                                    // the value picked from the suggestions
      if (!journey) {                                               // typed by hand: accept it when it points at exactly one journey
        const hits = searchJourneys(raw);
        if (hits.length !== 1) {
          const body = hits.length
            ? `${L(lang).pick}\n${hits.slice(0, 25).map(j => `${j.icon} ${journeyTitle(j, lang)}`).join('\n')}`
            : L(lang).unknown;
          return interaction.reply({ embeds: [buildErrorEmbed(body, lang)], flags: EPH });
        }
        journey = hits[0];
      }
    }
    const tf = getTafsir(interaction.options.getString('tafsir')).key;
    await interaction.deferReply({ flags: EPH });                   // the verse may need a network call; Discord only waits 3 seconds
    return interaction.editReply(await screenFor(journey, 0, interaction.user.id, lang, tf));
  }
};

/** The buttons (custom id  journey:<action>:<journey>:<step>:<userId>). Only the member who started the journey may use them. */
export async function handleJourneyButton(interaction) {
  const [, action, journeyId, stepRaw, userId, tfRaw] = interaction.customId.split(':');
  const tf = getTafsir(tfRaw).key;
  const lang = await GuildSettings.getLanguage(interaction.guildId);
  const s = L(lang);
  if (userId !== interaction.user.id) return interaction.reply({ content: s.notYours, flags: EPH });
  const journey = getJourney(journeyId);
  if (!journey) return interaction.deferUpdate();
  const step = Math.min(Math.max(0, Number(stepRaw) || 0), journey.steps.length);

  switch (action) {
    case 'go': {                                                    // previous / next / retry / repeat — edits the same message
      await interaction.deferUpdate();
      return interaction.editReply(await screenFor(journey, step, userId, lang, tf));
    }
    case 'new': {                                                   // another journey, not the one just finished
      await interaction.deferUpdate();
      return interaction.editReply(await screenFor(randomJourney(journey.id), 0, userId, lang, tf));
    }
    case 'save': {                                                  // the verse's page → the member's personal list
      const ref = journey.steps[Math.min(step, journey.steps.length - 1)].ref;
      const verse = await fetchAyah(ref);
      if (!verse?.page) return interaction.reply({ embeds: [buildErrorEmbed(s.noPage, lang)], flags: EPH });
      try {
        const doc = await PersonalList.findOne({ userId }).lean();
        const r = P.addPage(doc, verse.page);
        if (r.status === 'full') return interaction.reply({ embeds: [buildErrorEmbed(s.full(P.MAX_ITEMS), lang)], flags: EPH });
        if (r.status === 'exists') return interaction.reply({ embeds: [buildSuccessEmbed(s.done, s.exists(verse.page), lang)], flags: EPH });
        await PersonalList.updateOne({ userId }, { $set: { pages: r.pages, verses: r.verses, updatedAt: new Date() } }, { upsert: true });
        return interaction.reply({ embeds: [buildSuccessEmbed(s.done, s.saved(verse.page), lang)], flags: EPH });
      } catch (err) {
        logger.warn(`[journey] save page failed: ${err.message}`);
        return interaction.reply({ embeds: [buildErrorEmbed(s.saveFail, lang)], flags: EPH });
      }
    }
    case 'open': {                                                  // the Mushaf reader on the verse's page, in a new private message
      const ref = journey.steps[Math.min(step, journey.steps.length - 1)].ref;
      const verse = await fetchAyah(ref);
      if (!verse?.page) return interaction.reply({ embeds: [buildErrorEmbed(s.noPage, lang)], flags: EPH });
      return openMushaf(interaction, verse.page);
    }
    default:
      return interaction.deferUpdate();
  }
}
