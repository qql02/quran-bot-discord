import { SURAHS } from '../data/surahs.js';
import { TOTAL_PAGES } from './wird.js';

/**
 * The member's personal list: saved Mushaf pages and verses. Pure — no database, no Discord.
 * A cap on each list keeps one member from growing a document without limit.
 */
export const MAX_ITEMS = 30;

const toAscii = (s) => String(s ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

/** "2:255" / "٢:٢٥٥" / "2 255" / "2،255" → "2:255", checked against the real number of verses; null when not a real verse. */
export function normalizeRef(input) {
  const m = /^(\d{1,3})\s*[:：،,\s]\s*(\d{1,3})$/.exec(toAscii(input).trim());
  if (!m) return null;
  const surah = Number(m[1]); const ayah = Number(m[2]);
  const s = SURAHS[surah - 1];
  return s && ayah >= 1 && ayah <= s.ayahs ? `${surah}:${ayah}` : null;
}

export const isPageNumber = (n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_PAGES;

/** @returns {{ pages: number[], verses: string[], status: 'added'|'exists'|'full'|'invalid' }} */
export function addPage(doc, page) {
  const pages = [...(doc?.pages ?? [])]; const verses = [...(doc?.verses ?? [])];
  if (!isPageNumber(page)) return { pages, verses, status: 'invalid' };
  if (pages.includes(page)) return { pages, verses, status: 'exists' };
  if (pages.length >= MAX_ITEMS) return { pages, verses, status: 'full' };
  return { pages: [...pages, page].sort((a, b) => a - b), verses, status: 'added' };
}

export function addVerse(doc, ref) {
  const pages = [...(doc?.pages ?? [])]; const verses = [...(doc?.verses ?? [])];
  const norm = normalizeRef(ref);
  if (!norm) return { pages, verses, status: 'invalid' };
  if (verses.includes(norm)) return { pages, verses, status: 'exists' };
  if (verses.length >= MAX_ITEMS) return { pages, verses, status: 'full' };
  const key = (r) => { const [s, a] = r.split(':').map(Number); return s * 1000 + a; };
  return { pages, verses: [...verses, norm].sort((a, b) => key(a) - key(b)), status: 'added' };
}

/** The numbered list the member sees: pages first, then verses. */
export function combined(doc) {
  return [
    ...(doc?.pages ?? []).map(value => ({ type: 'page', value })),
    ...(doc?.verses ?? []).map(value => ({ type: 'verse', value }))
  ];
}

/** Remove item number `n` (1-based, as shown by combined()). */
export function removeNumber(doc, n) {
  const pages = [...(doc?.pages ?? [])]; const verses = [...(doc?.verses ?? [])];
  const i = Math.trunc(Number(toAscii(n)));
  if (!Number.isInteger(i) || i < 1 || i > pages.length + verses.length) return { pages, verses, status: 'invalid' };
  if (i <= pages.length) pages.splice(i - 1, 1); else verses.splice(i - pages.length - 1, 1);
  return { pages, verses, status: 'removed' };
}

/** "page 45 · Al-Baqarah" style line for one item. */
export function describeItem(item, lang = 'ar') {
  if (item.type === 'page') return lang === 'ar' ? `صفحة ${item.value}` : `Page ${item.value}`;
  const [s, a] = item.value.split(':').map(Number);
  const sur = SURAHS[s - 1];
  return lang === 'ar' ? `${sur.arabic} ${s}:${a}` : `${sur.english} ${s}:${a}`;
}

// ── the member's own settings ─────────────────────────────────────────────────
const LANG_WORDS = { ar: 'ar', عربي: 'ar', العربية: 'ar', عربية: 'ar', en: 'en', english: 'en', انجليزي: 'en', انكليزي: 'en', الانجليزية: 'en' };
const VIEW_WORDS = { text: 'text', نص: 'text', hafs: 'hafs', حفص: 'hafs', warsh: 'warsh', ورش: 'warsh' };
const KEY_WORDS  = { lang: 'lang', language: 'lang', لغة: 'lang', اللغة: 'lang', view: 'view', mushaf: 'view', عرض: 'view', مصحف: 'view', المصحف: 'view' };

const RESET_WORDS = new Set(['reset', 'default', 'defaults', 'اعادة', 'إعادة', 'افتراضي', 'الافتراضي', 'تصفير']);

/** "lang en" / "لغة عربي" / "view hafs" / "عرض ورش" → { key, value } | { error: 'key'|'value' } | null (no args = just show). */
export function parseSetting(args) {
  const [k, v] = String(args ?? '').trim().toLowerCase().split(/\s+/);
  if (!k) return null;
  if (RESET_WORDS.has(k)) return { key: 'reset' };
  const own = (table, w) => (typeof w === 'string' && Object.hasOwn(table, w) ? table[w] : undefined);   // "constructor", "__proto__"… are not words
  const key = own(KEY_WORDS, k);
  if (!key) return { error: 'key' };
  const value = own(key === 'lang' ? LANG_WORDS : VIEW_WORDS, v);
  return value ? { key, value } : { error: 'value', key };
}

/** "confirm" / "all confirm" / "تأكيد الكل" → { confirm, scope: 'personal' | 'all' }. `all` also removes the wird subscription and its progress. */
export function parseForget(args) {
  const words = String(args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return {
    confirm: words.some(w => /^(?:تأكيد|تاكيد|confirm)$/.test(w)),
    scope: words.some(w => /^(?:الكل|كل|all|everything)$/.test(w)) ? 'all' : 'personal'
  };
}
