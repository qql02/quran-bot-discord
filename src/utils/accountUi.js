import { EmbedBuilder } from 'discord.js';
import { COLORS, THUMBNAIL } from './embeds.js';
import { MAX_ITEMS, combined, describeItem } from './personal.js';
import { subscriptionState } from './wird.js';
import { CONSENT_TTL_MS } from './consent.js';

const MINUTES = Math.round(CONSENT_TTL_MS / 60_000);

/**
 * The embeds of the private chat's account commands (data, settings, my list, deletion, help). Pure: data in, embed out.
 * Nothing here reads a database or a server.
 */
const L = (lang, ar, en) => (lang === 'ar' ? ar : en);
const stamp = (d) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:D>`;
const footer = (lang, text) => ({ text: text ?? L(lang, 'بوت القرآن الكريم', 'Quran Bot') });
const base = (color = COLORS.primary) => new EmbedBuilder().setColor(color).setThumbnail(THUMBNAIL);

const VIEW_NAMES = { text: { ar: 'نص', en: 'Text' }, hafs: { ar: 'حفص', en: 'Hafs' }, warsh: { ar: 'ورش', en: 'Warsh' } };
const viewName = (v, lang) => VIEW_NAMES[v ?? 'text']?.[lang] ?? v;
const langName = (v, lang) => (v === 'ar' ? 'العربية' : v === 'en' ? 'English' : L(lang, 'حسب الأمر الذي تكتبه', 'follows the command you type'));

function settingsLines(d, lang) {
  return [
    `${L(lang, 'لغة الردود', 'Reply language')}: **${langName(d.list?.lang, lang)}**`,
    `${L(lang, 'عرض المصحف', 'Mushaf view')}: **${viewName(d.pref?.view, lang)}**`
  ].join('\n');
}

function wirdLines(w, lang, now) {
  if (!w) return L(lang, 'لا يوجد اشتراك.', 'No subscription.');
  const state = !w.active ? L(lang, 'متوقف', 'Stopped')
    : subscriptionState(w.expiresAt, now) === 'expired' ? L(lang, 'منتهٍ', 'Expired') : L(lang, 'فعّال', 'Active');
  return [
    `${L(lang, 'الحالة', 'Status')}: **${state}** · ${L(lang, 'ينتهي', 'ends')} ${stamp(w.expiresAt)}`,
    `${L(lang, 'الخطة', 'Plan')}: ${w.pagesPerDay} ${L(lang, 'صفحة يومياً', 'page(s) a day')} · ${w.remindTime} (${w.timezone})`,
    `${L(lang, 'التقدّم', 'Progress')}: ${L(lang, 'الصفحة', 'page')} ${w.currentPage ?? 0} · ${L(lang, 'ختمات', 'khatmas')} ${w.khatmaCount ?? 0} · ${L(lang, 'تتابع', 'streak')} ${w.streak ?? 0}`
  ].join('\n');
}

/** "My data": everything stored under the member's account, in one place. */
export function dataEmbed(d, lang, prefix, now = new Date()) {
  const items = combined(d.list);
  const f = d.favorites;
  const fields = [
    { name: L(lang, '⚙️ الإعدادات', '⚙️ Settings'), value: settingsLines(d, lang) },
    { name: L(lang, '🔖 قائمتي', '🔖 My list'),
      value: items.length
        ? L(lang, `${d.list.pages.length} صفحة · ${d.list.verses.length} آية (الحد ${MAX_ITEMS} لكل نوع)`, `${d.list.pages.length} page(s) · ${d.list.verses.length} verse(s) (limit ${MAX_ITEMS} each)`)
        : L(lang, 'فارغة.', 'Empty.') },
    { name: L(lang, '📅 الورد اليومي', '📅 Daily wird'), value: wirdLines(d.wird, lang, now) },
    { name: L(lang, '⭐ المفضلة في السيرفرات', '⭐ Player favourites'),
      value: f.servers
        ? L(lang, `${f.reciters} قارئ · ${f.surahs} سورة (محفوظة في ${f.servers} سيرفر)`, `${f.reciters} reciter(s) · ${f.surahs} surah(s) (saved in ${f.servers} server(s))`)
        : L(lang, 'لا شيء.', 'Nothing.') }
  ];
  return base()
    .setTitle(L(lang, '👤 بياناتي', '👤 My data'))
    .setDescription(L(lang, 'هذا كل ما هو محفوظ باسم حسابك. لا يراه أحد غيرك، ولا يُربط بأي سيرفر ما عدا المفضلة المذكورة.', 'This is everything stored under your account. Nobody else sees it, and none of it is tied to a server except the favourites listed.'))
    .addFields(fields)
    .setFooter(footer(lang, L(lang, `${prefix}تصدير نسخة · ${prefix}اعدادات · ${prefix}انسني حذف`, `${prefix}export a copy · ${prefix}settings · ${prefix}forget delete`)));
}

/** "My settings": current values and how to change them. */
export function settingsEmbed(d, lang, prefix) {
  return base()
    .setTitle(L(lang, '⚙️ إعداداتي', '⚙️ My settings'))
    .setDescription(settingsLines(d, lang))
    .addFields([
      { name: L(lang, 'تغيير', 'Change'), value: L(lang,
        `\`${prefix}اعدادات لغة عربي\` · \`${prefix}اعدادات لغة en\`\n\`${prefix}اعدادات عرض نص\` · \`حفص\` · \`ورش\``,
        `\`${prefix}settings lang ar\` · \`${prefix}settings lang en\`\n\`${prefix}settings view text\` · \`hafs\` · \`warsh\``) },
      { name: L(lang, 'إعادة الضبط', 'Reset'), value: L(lang, `\`${prefix}اعدادات اعادة\` — يرجع كل شيء للوضع الافتراضي (قائمتك لا تُمس).`, `\`${prefix}settings reset\` — back to the defaults (your list is kept).`) }
    ])
    .setFooter(footer(lang, L(lang, 'تخصّك وحدك ولا تؤثر على أي سيرفر', 'Yours alone — no server is affected')));
}

/** "My list": pages and verses in two fields, with how full the list is. */
export function listEmbed(doc, lang, prefix) {
  const items = combined(doc);
  const pages = items.filter(i => i.type === 'page');
  const verses = items.filter(i => i.type === 'verse');
  const line = (it) => `**${items.indexOf(it) + 1}.** ${describeItem(it, lang)}`;
  const fields = [];
  if (pages.length) fields.push({ name: L(lang, `📄 الصفحات (${pages.length}/${MAX_ITEMS})`, `📄 Pages (${pages.length}/${MAX_ITEMS})`), value: pages.map(line).join('\n') });
  if (verses.length) fields.push({ name: L(lang, `📜 الآيات (${verses.length}/${MAX_ITEMS})`, `📜 Verses (${verses.length}/${MAX_ITEMS})`), value: verses.map(line).join('\n') });
  return base()
    .setTitle(L(lang, '🔖 قائمتي', '🔖 My list'))
    .addFields(fields)
    .setFooter(footer(lang, L(lang, `${prefix}افتح رقم · ${prefix}ازل رقم · هذه القائمة لك وحدك`, `${prefix}open number · ${prefix}remove number · this list is yours alone`)));
}

/** The deletion screen: what exists, what each choice removes, and the exact words to confirm. */
export function forgetEmbed(d, lang, prefix, now = new Date()) {
  const items = combined(d.list).length;
  const f = d.favorites;
  const personal = [
    L(lang, `قائمتك (${items} عنصر)`, `Your list (${items} item(s))`),
    L(lang, 'لغة الردود ونمط المصحف', 'Reply language and Mushaf view'),
    L(lang, `مفضلة المشغّل (${f.reciters + f.surahs})`, `Player favourites (${f.reciters + f.surahs})`)
  ].map(x => `• ${x}`).join('\n');
  const wirdState = d.wird
    ? (d.wird.active && subscriptionState(d.wird.expiresAt, now) !== 'expired' ? L(lang, 'فعّال', 'active') : L(lang, 'غير فعّال', 'inactive'))
    : null;
  return base(COLORS.warning)
    .setTitle(L(lang, '🗑️ حذف بياناتي', '🗑️ Delete my data'))
    .setDescription(L(lang, `لن يُحذف شيء قبل أن تؤكد خلال ${MINUTES} دقيقتين من هذه الرسالة. الحذف نهائي ولا يمكن التراجع عنه.`, `Nothing is deleted until you confirm within ${MINUTES} minutes of this message. Deletion is permanent.`))
    .addFields([
      { name: L(lang, `بياناتي الشخصية — \`${prefix}انسني تأكيد\``, `Personal data — \`${prefix}forget confirm\``), value: personal },
      { name: L(lang, `كل شيء — \`${prefix}انسني الكل تأكيد\``, `Everything — \`${prefix}forget all confirm\``),
        value: L(lang, `ما سبق، و${wirdState ? `اشتراك الورد (${wirdState}) مع تقدّمك وتتابعك` : 'اشتراك الورد وتقدّمك (لا يوجد اشتراك حالياً)'}. تتوقف التذكيرات.`,
          `All of the above, plus ${wirdState ? `your wird subscription (${wirdState}) with its progress and streak` : 'the wird subscription and progress (none right now)'}. Reminders stop.`) }
    ])
    .setFooter(footer(lang, L(lang, `${prefix}تصدير — خذ نسخة قبل الحذف`, `${prefix}export — take a copy first`)));
}

/** The consent screen before a copy of the member's data is sent: what the file holds and the exact words to agree. */
export function exportConsentEmbed(d, lang, prefix) {
  const w = d.wird;
  const holds = [
    L(lang, 'الإعدادات (لغة الردود ونمط المصحف)', 'Settings (reply language, Mushaf view)'),
    L(lang, `قائمتك (${combined(d.list).length} عنصر)`, `Your list (${combined(d.list).length} item(s))`),
    w ? L(lang, 'اشتراك الورد وتقدّمك', 'Your wird subscription and progress') : null,
    d.favorites.servers ? L(lang, 'أعداد مفضلة المشغّل', 'Player favourite counts') : null
  ].filter(Boolean).map(x => `• ${x}`).join('\n');
  return base(COLORS.warning)
    .setTitle(L(lang, '📤 إرسال نسخة من بياناتي', '📤 Send me a copy of my data'))
    .setDescription(L(lang,
      `سيصلك ملف في هذه المحادثة الخاصة فقط، ولا يُرسل لأحد غيرك. لن يُرسل شيء قبل موافقتك.\n\nللموافقة اكتب \`${prefix}تصدير تأكيد\` خلال ${MINUTES} دقيقتين.`,
      `The file arrives in this private chat only and goes to nobody else. Nothing is sent before you agree.\n\nTo agree, type \`${prefix}export confirm\` within ${MINUTES} minutes.`))
    .addFields([{ name: L(lang, 'ما في الملف', 'What the file holds'), value: holds }])
    .setFooter(footer(lang));
}
