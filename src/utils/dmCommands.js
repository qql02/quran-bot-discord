import { normalizeText } from './arabic.js';

/**
 * Prefix commands in the bot's private chat ("!help", "!page 45", "!سورة الكهف").
 * Pure: parsing and texts only — src/events/messageCreate.js does the sending.
 *
 * Reading and information only — nothing that controls voice or a server's player works here.
 * Each command has Arabic and English names; the language of the reply follows the name the member typed.
 * "surah" / "juz" / "page" are shortcuts of "read": they are rewritten to a target the Mushaf already understands.
 */
const DEFS = [
  { name: 'help',   ar: ['مساعدة', 'اوامر', 'الاوامر'],            en: ['help', 'h', 'commands'] },
  { name: 'guide',  ar: ['دليل', 'الدليل'],                         en: ['guide'] },
  { name: 'mushaf', ar: ['مصحف', 'المصحف'],                         en: ['mushaf'] },
  { name: 'read',   ar: ['اقرا', 'قراءة', 'صفحة'],                  en: ['read', 'page', 'p'] },
  { name: 'read',   ar: ['سورة'],  en: ['surah', 'sura'], word: 'surah' },
  { name: 'read',   ar: ['جزء'],   en: ['juz'],           word: 'juz' },
  { name: 'ayah',   ar: ['اية', 'الاية'],                           en: ['ayah', 'verse'] },
  { name: 'hadith', ar: ['حديث', 'الحديث'],                         en: ['hadith'] },
  { name: 'adhkar', ar: ['اذكار', 'الاذكار'],                        en: ['adhkar', 'azkar'] },
  { name: 'dua',    ar: ['دعاء', 'ادعية', 'الادعية', 'موسوعة'],       en: ['dua', 'duas', 'library'] },
  { name: 'wird',   ar: ['ورد', 'الورد', 'وردي'],                   en: ['wird'] },
  { name: 'invite', ar: ['دعوة'],                                   en: ['invite'] },
  { name: 'clear',  ar: ['مسح'],                                    en: ['clear', 'cleardm'] },
  // personal list: saved only under the sender's own id
  { name: 'mark',   ar: ['علامة', 'علم'],                           en: ['mark', 'bookmark'] },
  { name: 'save',   ar: ['احفظ', 'حفظ'],                            en: ['save'] },
  { name: 'mine',   ar: ['قائمتي', 'علاماتي', 'محفوظاتي'],          en: ['mine', 'saved', 'my'] },
  { name: 'open',   ar: ['افتح'],                                   en: ['open', 'go'] },
  { name: 'remove', ar: ['ازل', 'احذف'],                            en: ['remove', 'unmark', 'unsave'] },
  { name: 'settings', ar: ['اعدادات', 'اعداداتي', 'الاعدادات'],       en: ['settings', 'set', 'config'] },
  { name: 'forget', ar: ['انسني'],                                  en: ['forget', 'forgetme'] },
  // the member's own account: what is stored under their id, a copy of it, and its deletion
  { name: 'data',   ar: ['بياناتي', 'معلوماتي', 'حسابي'],           en: ['mydata', 'data', 'account', 'me'] },
  { name: 'export', ar: ['تصدير', 'نسخة'],                          en: ['export', 'download'] },
];

const TABLE = new Map();
for (const d of DEFS) {
  for (const k of d.ar) TABLE.set(normalizeText(k), { name: d.name, lang: 'ar', word: d.word });
  for (const k of d.en) TABLE.set(normalizeText(k), { name: d.name, lang: 'en', word: d.word });
}

// Spellings as written above (not normalized), for "did you mean …" — one list per language.
const SUGGEST = { ar: [], en: [] };
for (const d of DEFS) { for (const k of d.ar) SUGGEST.ar.push(k); for (const k of d.en) SUGGEST.en.push(k); }

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The known command closest to a mistyped word ("settngs" → "settings"), or null when nothing is close enough. */
export function suggestCommand(typed, lang = 'en') {
  const word = normalizeText(typed);
  if (word.length < 2) return null;
  const limit = word.length <= 4 ? 1 : 2;
  let best = null; let bestD = Infinity;
  for (const k of SUGGEST[lang] ?? SUGGEST.en) {
    const d = distance(word, normalizeText(k));
    if (d < bestD) { best = k; bestD = d; }
  }
  return bestD <= limit ? best : null;
}

/** What the member typed, made safe to echo back inside a message: letters and digits only (no markdown, links or mentions). */
const cleanTyped = (w) => String(w).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 30);

export const MAX_DM_LENGTH = 200;   // a command is short; longer messages are ordinary chat and are ignored

/**
 * @param {string} content  the message text
 * @param {string} prefix   e.g. "!"
 * @returns {null | { name: string, args: string, lang: 'ar'|'en', known: boolean, typed: string }}
 *   null = not a command at all (no prefix, a space right after it, too long); known=false = prefix + an unknown word
 */
export function parseDm(content, prefix) {
  const text = String(content ?? '').trim();
  if (!prefix || !text.startsWith(prefix) || text.length > MAX_DM_LENGTH) return null;
  const rest = text.slice(prefix.length);
  if (!rest || /^\s/.test(rest)) return null;
  const [word, ...more] = rest.split(/\s+/);
  const hit = TABLE.get(normalizeText(word));
  if (!hit) return { name: 'unknown', args: '', lang: /[؀-ۿ]/.test(word) ? 'ar' : 'en', known: false, typed: cleanTyped(word) };
  let args = more.join(' ');
  if (hit.word) args = args ? `${hit.word} ${args}` : '';
  return { name: hit.name, args, lang: hit.lang, known: true, typed: cleanTyped(word) };
}

/** Everything a member can type in the private chat, grouped for the help embed: [{ name, value }]. */
export const DM_HELP_SECTIONS = {
  ar: (p) => [
    { name: '📖 القراءة', value: [
      `\`${p}مصحف\` — المصحف للجميع: نص أو صور حفص وورش (بأزرار تحت الصفحة)`,
      `\`${p}صفحة 45\` · \`${p}سورة الكهف\` · \`${p}جزء 5\` — اقرأ مباشرة`,
      `\`${p}اية 2:255\` — آية مع التفسير (و\`${p}اية\` وحدها لآية عشوائية)`,
      `\`${p}حديث\` — حديث من الأربعين النووية ورياض الصالحين (و\`${p}حديث 13\` للحديث رقم 13 من الأربعين النووية)`,
      `\`${p}اذكار\` · \`${p}اذكار مساء\` — أذكار الصباح أو المساء`,
      `\`${p}ادعية\` · \`${p}ادعية 12\` · \`${p}ادعية سفر\` — موسوعة الأدعية والأذكار: الأبواب، بابٌ بعينه، أو بحث`,
      `\`${p}ورد\` — وردك اليومي: يفتح عند صفحة وردك (اشتراك مجاني) · \`${p}ورد حالة\` — تقدمك`
    ].join('\n') },
    { name: '🔖 قائمتي', value: [
      `\`${p}علامة 45\` · \`${p}احفظ 2:255\` — احفظ صفحة أو آية`,
      `\`${p}قائمتي\` · \`${p}افتح 1\` · \`${p}ازل 1\` — اعرضها أو افتح عنصراً أو احذفه`
    ].join('\n') },
    { name: '👤 حسابي', value: [
      `\`${p}بياناتي\` — كل ما هو محفوظ باسم حسابك`,
      `\`${p}اعدادات\` — اللغة ونمط المصحف (\`${p}اعدادات لغة en\` · \`${p}اعدادات عرض حفص\` · \`${p}اعدادات اعادة\`)`,
      `\`${p}تصدير\` — نسخة من بياناتك كملف`,
      `\`${p}انسني\` — احذف بياناتك (بتأكيد)`
    ].join('\n') },
    { name: 'ℹ️ أخرى', value: [
      `\`${p}مساعدة\` — هذه القائمة · \`${p}دليل\` — دليل المستخدم · \`${p}دعوة\` — رابط إضافة البوت`,
      `\`${p}مسح\` — حذف رسائل البوت من هذه المحادثة (ورسائلك إن سمح ديسكورد)`
    ].join('\n') }
  ],
  en: (p) => [
    { name: '📖 Reading', value: [
      `\`${p}mushaf\` — open the Mushaf at your wird page`,
      `\`${p}page 45\` · \`${p}surah kahf\` · \`${p}juz 5\` — read straight away`,
      `\`${p}ayah 2:255\` — a verse with its tafsir (\`${p}ayah\` alone gives a random one)`,
      `\`${p}hadith\` — a hadith from the Forty Nawawi and Riyad as-Salihin (\`${p}hadith 13\` for Nawawi no. 13)`,
      `\`${p}adhkar\` · \`${p}adhkar evening\` — morning or evening adhkar`,
      `\`${p}dua\` · \`${p}dua 12\` · \`${p}dua travel\` — du'a & adhkar library: chapters, one chapter, or search (Arabic titles)`,
      `\`${p}wird\` — the daily wird: subscribe or see your progress`
    ].join('\n') },
    { name: '🔖 My list', value: [
      `\`${p}mark 45\` · \`${p}save 2:255\` — keep a page or a verse`,
      `\`${p}mine\` · \`${p}open 1\` · \`${p}remove 1\` — see your list, open an item or delete it`
    ].join('\n') },
    { name: '👤 My account', value: [
      `\`${p}mydata\` — everything stored under your account`,
      `\`${p}settings\` — language and Mushaf view (\`${p}settings lang en\` · \`${p}settings view hafs\` · \`${p}settings reset\`)`,
      `\`${p}export\` — a copy of your data as a file`,
      `\`${p}forget\` — delete your data (with confirmation)`
    ].join('\n') },
    { name: 'ℹ️ More', value: [
      `\`${p}help\` — this list · \`${p}guide\` — the user guide · \`${p}invite\` — the link to add the bot`,
      `\`${p}clear\` — delete the bot's messages from this chat (and yours, if Discord allows)`
    ].join('\n') }
  ]
};

/** The same text as one block (kept for callers that want a plain string). */
export const DM_HELP = {
  ar: (p) => DM_HELP_SECTIONS.ar(p).map(s => `**${s.name}**\n${s.value}`).join('\n\n'),
  en: (p) => DM_HELP_SECTIONS.en(p).map(s => `**${s.name}**\n${s.value}`).join('\n\n')
};
