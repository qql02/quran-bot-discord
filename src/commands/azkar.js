import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildInfoEmbed } from '../utils/embeds.js';
import { normalizeText } from '../utils/arabic.js';
import { libraryCategories, renderLibraryItemPages, renderAdhkarItemPages, KIND_META, SCATTER_META } from '../data/adhkar.js';

/**
 * /azkar — the adhkar & du'a library (حصن المسلم + أدعية قرآنية), as a slash command.
 * The texts are the ones already shipped in data/encyclopedia.js (copied verbatim from published Hisn al-Muslim datasets, see its header)
 * and the morning / evening sets of data/adhkar.js — nothing is written by hand here.
 *   /azkar                    → the list of chapters (private)
 *   /azkar category:<search>  → the chapter, ONE du'a at a time: "next" / "previous" move through the du'as of that chapter (never to another chapter)
 */

const PREFIX = 'azkar:';
const EPH = MessageFlags.Ephemeral;
const FOOTER = 'حصن المسلم';

let catalogCache = null;
/** Morning / evening first (the most used), then every chapter of the library. */
function catalog() {
  catalogCache ??= [
    ...['morning', 'evening'].map(kind => ({
      id: kind, title: kind === 'morning' ? 'أذكار الصباح' : 'أذكار المساء', icon: kind === 'morning' ? '🌅' : '🌙',
      group: 'الصباح والمساء', color: KIND_META[kind].color, pages: () => renderAdhkarItemPages(kind)
    })),
    ...libraryCategories().map(c => ({ ...c, color: SCATTER_META.color, pages: () => renderLibraryItemPages(c) }))
  ];
  return catalogCache;
}

const byId = (id) => catalog().find(c => c.id === id);
const searchText = (c) => normalizeText(`${c.title} ${c.group}`);

/** The chapters whose title or group contains the words typed (all of them, in order, when nothing is typed). */
export function searchCategories(query) {
  const q = normalizeText(query);
  return q ? catalog().filter(c => searchText(c).includes(q)) : catalog();
}

const pageId = (cat, page, userId) => `${PREFIX}${cat.id}:${page}:${userId}`;

/** One du'a of a chapter as a message payload (embed + previous / next buttons when the chapter has more than one du'a). */
export function azkarPayload(cat, page, userId, lang = 'ar') {
  const pages = cat.pages();
  const last = pages.length - 1;
  const i = Math.min(Math.max(0, page), last);
  const pg = pages[i];
  const ar = lang === 'ar';
  const embed = new EmbedBuilder().setColor(cat.color).setTitle(pg.title);
  if (pg.description) embed.setDescription(pg.description);
  embed.addFields(pg.fields).setFooter({ text: `${FOOTER} | ${ar ? `${i + 1} من ${pages.length}` : `${i + 1} of ${pages.length}`}` });
  const components = [];
  if (pages.length > 1) {
    // laid out for right-to-left reading, like the Mushaf: "next" on the left
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(pageId(cat, i + 1, userId)).setLabel(ar ? 'التالي' : 'Next').setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(i >= last),
      new ButtonBuilder().setCustomId(`${PREFIX}x:${cat.id}:${userId}`).setLabel(`${i + 1} / ${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(pageId(cat, i - 1, userId)).setLabel(ar ? 'السابق' : 'Previous').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(i <= 0)
    ));
  }
  return { embeds: [embed], components };
}

/** The list of chapters, grouped, in chunks that fit an embed. */
function listEmbeds(lang) {
  const ar = lang === 'ar';
  const groups = new Map();
  for (const c of catalog()) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
  const blocks = [...groups].map(([g, list]) => `**${g}**\n${list.map(c => `${c.icon} ${c.title}`).join('\n')}`);
  const chunks = []; let cur = '';
  for (const b of blocks) { if (cur && cur.length + b.length + 2 > 3500) { chunks.push(cur); cur = ''; } cur += `${cur ? '\n\n' : ''}${b}`; }
  if (cur) chunks.push(cur);
  const head = ar
    ? 'اكتب `/azkar category:` ثم اسم الباب أو جزءًا منه، واختر من القائمة المقترحة.\n\n'
    : 'Type `/azkar category:` then part of a chapter name and pick it from the suggestions (chapter titles are in Arabic).\n\n';
  return chunks.map((d, i) => buildInfoEmbed(i === 0 ? (ar ? 'الأذكار والأدعية' : 'Adhkar & du\'a') : (ar ? 'تابع' : 'Continued'), (i === 0 ? head : '') + d, lang));
}

export default {
  data: new SlashCommandBuilder()
    .setName('azkar')
    .setDescription('Adhkar & du\'a from Hisn al-Muslim / أذكار وأدعية من حصن المسلم')
    .setDMPermission(false)
    .addStringOption(o => o.setName('category').setDescription('Chapter — type to search / الباب — اكتب للبحث').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const hits = searchCategories(interaction.options.getFocused()).slice(0, 25);
    return interaction.respond(hits.map(c => ({ name: `${c.icon} ${c.title} — ${c.group}`.slice(0, 100), value: c.id })));
  },

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    const raw = interaction.options.getString('category')?.trim();
    if (!raw) {
      const [first, ...rest] = listEmbeds(lang);
      await interaction.reply({ embeds: [first], flags: EPH });
      for (const e of rest) await interaction.followUp({ embeds: [e], flags: EPH });
      return;
    }
    let cat = byId(raw);                                        // the value picked from the suggestions
    if (!cat) {                                                 // typed by hand: accept it when it points at exactly one chapter
      const hits = searchCategories(raw);
      if (hits.length === 1) cat = hits[0];
      else if (!hits.length) return interaction.reply({ embeds: [buildErrorEmbed(ar ? 'لا يوجد باب بهذا الاسم. اكتب `/azkar` وحدها لعرض الأبواب.' : 'No chapter matches. Use `/azkar` alone to list them.', lang)], flags: EPH });
      else return interaction.reply({ embeds: [buildInfoEmbed(ar ? 'اختر الباب' : 'Pick a chapter', hits.slice(0, 25).map(c => `${c.icon} ${c.title}`).join('\n') + (ar ? '\n\nاختر واحدًا من القائمة المقترحة أثناء الكتابة.' : '\n\nPick one from the suggestions while typing.'), lang)], flags: EPH });
    }
    return interaction.reply(azkarPayload(cat, 0, interaction.user.id, lang));
  }
};

/** The previous / next buttons (custom id  azkar:<chapter>:<page>:<userId>). Only the member who ran the command may turn the pages. */
export async function handleAzkarButton(interaction) {
  const [, chapter, page, userId] = interaction.customId.split(':');
  if (chapter === 'x') return interaction.deferUpdate();         // the page counter
  const lang = await GuildSettings.getLanguage(interaction.guildId);
  if (userId !== interaction.user.id) {
    return interaction.reply({ content: lang === 'ar' ? 'هذه الأزرار لمن استخدم الأمر. اكتب `/azkar` لفتح صفحتك.' : 'These buttons belong to whoever ran the command. Use `/azkar` for your own.', flags: EPH });
  }
  const cat = byId(chapter);
  if (!cat) return interaction.deferUpdate();
  return interaction.update(azkarPayload(cat, Number(page) || 0, userId, lang));
}
