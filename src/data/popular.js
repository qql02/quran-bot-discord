/**
 * What the control panel offers to someone who has never used the bot: a short list of well-loved surahs and reciters,
 * picked from a menu — nothing to type, nothing to know. Reciters are matched by several search keys (English spellings
 * differ between API versions), and the choice is remembered per server so the whole server hears the same reciter.
 */
import { config } from '../config.js';

/**
 * The panel's "pick a surah" menu offers ALL 114 surahs, in Mushaf order. Discord allows 25 options per menu, so the menu
 * is paged: 23 surahs + "previous" / "next" entries inside the same menu (page number travels in the menu's custom id).
 */
export const SURAH_PAGE_SIZE = 23;
export const SURAH_PAGE_COUNT = Math.ceil(114 / SURAH_PAGE_SIZE);   // 5
export const clampSurahPage = (p) => Math.min(Math.max(Number.isInteger(p) ? p : 0, 0), SURAH_PAGE_COUNT - 1);
/** First and last surah number on a page (1-based, inclusive). */
export const surahPageRange = (page) => {
  const p = clampSurahPage(page);
  return [p * SURAH_PAGE_SIZE + 1, Math.min((p + 1) * SURAH_PAGE_SIZE, 114)];
};

export const PANEL_RECITERS = [
  { key: 'afasy',    ar: 'مشاري العفاسي',          en: 'Mishary Alafasy',     search: ['alafasy', 'afasy', 'العفاسي'] },
  { key: 'sudais',   ar: 'عبد الرحمن السديس',      en: 'Abdul Rahman Al-Sudais', search: ['sudais', 'السديس'] },
  { key: 'maher',    ar: 'ماهر المعيقلي',          en: 'Maher Al-Muaiqly',    search: ['muaiqly', 'maher', 'المعيقلي'] },
  { key: 'ghamdi',   ar: 'سعد الغامدي',            en: 'Saad Al-Ghamdi',      search: ['ghamdi', 'الغامدي'] },
  { key: 'shuraim',  ar: 'سعود الشريم',            en: 'Saud Al-Shuraim',     search: ['shuraim', 'الشريم'] },
  { key: 'basit',    ar: 'عبد الباسط عبد الصمد',   en: 'Abdul Basit',         search: ['basit', 'عبد الباسط'] },
  { key: 'husary',   ar: 'محمود خليل الحصري',      en: 'Mahmoud Al-Husary',   search: ['husary', 'hussary', 'الحصري'] },
  { key: 'minshawi', ar: 'محمد صديق المنشاوي',     en: 'Al-Minshawi',         search: ['minshawi', 'المنشاوي'] },
  { key: 'ajmy',     ar: 'أحمد العجمي',            en: 'Ahmad Al-Ajmy',       search: ['ajmy', 'ajmi', 'العجمي'] },
  { key: 'dosari',   ar: 'ياسر الدوسري',           en: 'Yasser Al-Dosari',    search: ['dosari', 'دوسري', 'الدوسري'] }
];

const chosen = new Map();                                      // guildId → key (memory only: a restart returns to the default)
const custom = new Map();                                      // guildId → name of a reciter found with the panel's search (not in the short list)
export const getGuildReciterKey = (guildId) => chosen.get(guildId) ?? null;
export const setGuildReciterKey = (guildId, key) => {
  if (PANEL_RECITERS.some(r => r.key === key)) { chosen.set(guildId, key); custom.delete(guildId); }
};
export const panelReciter = (key) => PANEL_RECITERS.find(r => r.key === key) ?? null;

/** A reciter outside the short list (picked after a search): remembered per server exactly like the short-list choice. */
export const getGuildCustomReciter = (guildId) => custom.get(guildId) ?? null;
export const setGuildCustomReciter = (guildId, name) => {
  const n = String(name ?? '').trim().slice(0, 100);
  if (!n) return;
  custom.set(guildId, n);
  chosen.delete(guildId);
};

/** The reciter name searched for when nobody picked one: this server's panel choice, else the configured default. */
export const defaultReciterQuery = (guildId) => {
  const c = getGuildCustomReciter(guildId);
  if (c) return c;
  const r = panelReciter(getGuildReciterKey(guildId));
  return r ? r.search[0] : config.quran.defaultReciter;
};

// ─── Narration (riwaya) search ─────────────────────────────────────────────────────────────────────────────
// The API names narrations in English ("Rewayat Hafs A'n Assem", "Rewayat Warsh…"), so the Arabic words people type
// are translated to the English token that appears in those names.
const RIWAYA_ALIASES = [
  [/حفص|hafs/i, 'hafs'], [/ورش|warsh/i, 'warsh'], [/قالون|qalon|qaloon/i, 'qalon'],
  [/شعبة|شعبه|shu'?bah|shubah/i, 'shu'], [/الدوري|دوري|doori|douri/i, 'doori'],
  [/البزي|بزي|bazzi/i, 'bazzi'], [/السوسي|سوسي|soosi|susi/i, 'soosi'],
  [/خلف|khalaf/i, 'khalaf'], [/خلاد|khallad|khalad/i, 'khall'], [/قنبل|qunbul/i, 'qunbul'],
  [/ابن ذكوان|ذكوان|dhakwan|ibn thakwan/i, 'thakwan'], [/هشام|hisham|hesham/i, 'hisham']
];
/** What to look for in a moshaf name for a typed narration ('' = no filter). */
export const riwayaToken = (text) => {
  const t = String(text ?? '').trim();
  if (!t) return '';
  for (const [re, token] of RIWAYA_ALIASES) if (re.test(t)) return token;
  return t.toLowerCase().slice(0, 40);
};
