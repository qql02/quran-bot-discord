import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, COLORS } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { fetchHadith, fetchRandomHadith } from '../services/hadithLibrary.js';
import { buildHadithMessage } from '../services/hadithService.js';
import { HADITHS } from '../data/hadiths.js';
import { HADITH_BOOKS, MAX_NUMBER, RANDOM_ALL, getBook, bookName, hadithSourceUrl, randomPick, gradeLines } from '../data/hadithBooks.js';

/**
 * /hadith — a noble hadith from the six books (الكتب الستة), Muwatta Malik, the Forty of an-Nawawi and the Forty Qudsi.
 *   /hadith                         → a random hadith from any of the six
 *   /hadith book:<book>             → a random hadith of that book
 *   /hadith book:<book> number:<n>  → that exact hadith (sunnah.com numbering)
 * The message has: ◀ previous number · 🎲 another hadith (same book) · next number ▶ · a link to the source.
 * Texts come from the open hadith-api dataset at read time (services/hadithLibrary.js); gradings are shown only when the dataset has them.
 * If the dataset cannot be reached, a random request falls back to the hadiths stored with the bot (Forty Nawawi + Riyad as-Salihin).
 */

const PREFIX = 'hadith:';
const EPH = MessageFlags.Ephemeral;
const MAX_TEXT = 3800;                                            // embed description limit is 4096

const STR = {
  ar: {
    source: 'المصدر', grade: 'درجة الحديث', number: (n) => `حديث رقم ${n}`,
    footer: 'اللهم صلّ وسلّم على نبينا محمد', cut: '\n…\n*(تتمة الحديث في المصدر)*',
    prev: 'السابق', next: 'التالي', another: 'حديث آخر', read: 'اقرأ في المصدر',
    needBook: 'اختر الكتاب مع الرقم: اكتب `/hadith book:` ثم اختر كتابًا من القائمة.',
    notFound: (b, n) => `لا يوجد حديث برقم ${n} في ${b}.`,
    fail: 'تعذّر جلب الحديث الآن. جرّب مرة أخرى بعد قليل.',
    notYours: 'هذه الأزرار لمن استخدم الأمر. اكتب `/hadith` لحديثك.',
    all: 'عشوائي من الجميع'
  },
  en: {
    source: 'Source', grade: 'Grading', number: (n) => `Hadith no. ${n}`,
    footer: 'O Allah, send blessings upon our Prophet Muhammad', cut: '\n…\n*(the rest is at the source)*',
    prev: 'Previous', next: 'Next', another: 'Another hadith', read: 'Read at the source',
    needBook: 'Pick the book together with the number: type `/hadith book:` and choose a book.',
    notFound: (b, n) => `There is no hadith number ${n} in ${b}.`,
    fail: 'Could not load the hadith right now. Try again in a moment.',
    notYours: 'These buttons belong to whoever ran the command. Use `/hadith` for your own.',
    all: 'Random from all'
  }
};
const L = (lang) => (lang === 'ar' ? STR.ar : STR.en);

const idOf = (action, book, n, userId) => `${PREFIX}${action}:${book}:${n}:${userId}`;

/** One hadith as a message payload. */
export function hadithPayload(book, hadith, userId, lang = 'ar', { scope = book.id } = {}) {
  const s = L(lang);
  const text = hadith.text.length > MAX_TEXT ? `${hadith.text.slice(0, MAX_TEXT).replace(/\s+\S*$/, '')}${s.cut}` : hadith.text;
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${book.icon} ${bookName(book, lang)}`)
    .setDescription(text)
    .addFields({ name: s.source, value: `${bookName(book, lang)} • ${s.number(hadith.number)}` })
    .setFooter({ text: s.footer });
  const grades = gradeLines(hadith.grades);
  if (grades.length) embed.addFields({ name: s.grade, value: grades.join('\n') });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(idOf('go', book.id, hadith.number - 1, userId)).setEmoji('◀️').setLabel(s.prev).setStyle(ButtonStyle.Secondary).setDisabled(hadith.number <= 1),
    new ButtonBuilder().setCustomId(idOf('rnd', scope, 0, userId)).setEmoji('🎲').setLabel(s.another).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(idOf('go', book.id, hadith.number + 1, userId)).setEmoji('▶️').setLabel(s.next).setStyle(ButtonStyle.Secondary).setDisabled(hadith.number >= MAX_NUMBER),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(s.read).setURL(hadithSourceUrl(book, hadith.number))
  );
  return { embeds: [embed], components: [row] };
}

/** Random hadith (of a book, or of any) → payload; falls back to the hadiths stored with the bot when the dataset is unreachable. */
async function randomScreen(scope, userId, lang) {
  const res = await fetchRandomHadith(() => randomPick(Math.random, scope === RANDOM_ALL ? null : scope));
  if (res.status === 'ok') return hadithPayload(res.book, res.hadith, userId, lang, { scope });
  if (scope === RANDOM_ALL && res.status === 'error' && HADITHS.length) {
    const msg = buildHadithMessage(HADITHS[Math.floor(Math.random() * HADITHS.length)], { title: lang === 'ar' ? 'حديث' : 'Hadith' });
    return msg;
  }
  return { embeds: [buildErrorEmbed(L(lang).fail, lang)], components: [] };
}

async function numberScreen(book, number, userId, lang) {
  const res = await fetchHadith(book, number);
  if (res.status === 'ok') return hadithPayload(book, res.hadith, userId, lang);
  return { embeds: [buildErrorEmbed(res.status === 'notfound' ? L(lang).notFound(bookName(book, lang), number) : L(lang).fail, lang)], components: [] };
}

export default {
  data: new SlashCommandBuilder()
    .setName('hadith')
    .setDescription('A noble hadith: the six books and more / حديث نبوي من الكتب الستة وغيرها')
    .setDMPermission(false)
    .addStringOption(o => o.setName('book').setDescription('Hadith book / اختر كتاب الحديث').setRequired(false)
      .addChoices(
        ...HADITH_BOOKS.map(b => ({ name: `${b.ar} ${b.icon}`, value: b.id })),
        { name: 'عشوائي من الجميع 🎲', value: RANDOM_ALL }
      ))
    .addIntegerOption(o => o.setName('number').setDescription('Hadith number in the book / رقم الحديث').setRequired(false).setMinValue(1).setMaxValue(MAX_NUMBER)),

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const bookId = interaction.options.getString('book') ?? RANDOM_ALL;
    const number = interaction.options.getInteger('number');
    const book = getBook(bookId);
    if (number != null && !book) return interaction.reply({ embeds: [buildErrorEmbed(L(lang).needBook, lang)], flags: EPH });
    await interaction.deferReply();                               // the hadith may need a network call; Discord only waits 3 seconds
    const userId = interaction.user.id;
    return interaction.editReply(number != null ? await numberScreen(book, number, userId, lang) : await randomScreen(bookId, userId, lang));
  }
};

/** The buttons (custom id  hadith:<go|rnd>:<book|all>:<number>:<userId>). Only the member who ran the command may use them. */
export async function handleHadithButton(interaction) {
  const [, action, scope, numRaw, userId] = interaction.customId.split(':');
  const lang = await GuildSettings.getLanguage(interaction.guildId);
  if (userId !== interaction.user.id) return interaction.reply({ content: L(lang).notYours, flags: EPH });
  try {
    await interaction.deferUpdate();
    if (action === 'rnd') return await interaction.editReply(await randomScreen(scope === RANDOM_ALL || getBook(scope) ? scope : RANDOM_ALL, userId, lang));
    const book = getBook(scope);
    if (action !== 'go' || !book) return;
    const n = Math.trunc(Number(numRaw));
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) return;
    const payload = await numberScreen(book, n, userId, lang);
    // walking past the last hadith of a book keeps the current one on screen instead of replacing it with an error
    if (payload.components?.length === 0) return interaction.followUp({ ...payload, flags: EPH });
    return await interaction.editReply(payload);
  } catch (err) {
    if (err?.code === 10062 || err?.code === 40060) return;
    logger.warn(`[hadith] button failed: ${err.message}`);
  }
}
