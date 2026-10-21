/**
 * Pure logic of the in-Discord Mushaf reader (no Discord, no network — fully unit-testable):
 *   page numbers, jump targets ("45", "جزء 5", "البقرة"), ayah → surah location, text layout, custom-id codec.
 */
import { SURAHS } from '../data/surahs.js';
import { normalizeText } from './arabic.js';
import { TOTAL_PAGES, juzStartPage } from './wird.js';
import { mushafText } from './mushafText.js';

export const MAX_BODY = 3900;                       // embed description limit is 4096 — keep a safety margin
export const clampPage = (n) => Math.min(TOTAL_PAGES, Math.max(1, Math.trunc(Number(n)) || 1));
export const isPage    = (n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_PAGES;

const INDIC = '٠١٢٣٤٥٦٧٨٩';
export const toIndic = (n) => String(n).replace(/\d/g, d => INDIC[d]);
const toAscii = (s) => String(s ?? '').replace(/[٠-٩]/g, d => String(INDIC.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

// ── global ayah number (1..6236) → { surah, ayah } ────────────────────────────
const CUMULATIVE = (() => { let sum = 0; return SURAHS.map(s => (sum += s.ayahs)); })();
export const TOTAL_AYAHS = CUMULATIVE[CUMULATIVE.length - 1];
export function locateAyah(globalNumber) {
  if (!Number.isInteger(globalNumber) || globalNumber < 1 || globalNumber > TOTAL_AYAHS) return null;
  const i = CUMULATIVE.findIndex(c => globalNumber <= c);
  return { surah: SURAHS[i].number, ayah: globalNumber - (i ? CUMULATIVE[i - 1] : 0) };
}

// ── jump targets ──────────────────────────────────────────────────────────────
const SURAH_KEYS = SURAHS.map(s => ({ s, ar: normalizeText(s.arabic), en: normalizeText(s.english) }));

/**
 * What a member may type to jump:  "45" / "٤٥" (page) · "جزء 5" / "ج5" / "juz 5" · "سورة 18" / "س18" · "الكهف" / "kahf".
 * @returns {{ page: number, label: string } | { error: string }}
 */
export function parseTarget(input, lang = 'ar') {
  const t = mushafText(lang);
  const raw = toAscii(input).trim();
  if (!raw) return { error: t.errEmpty };

  if (/^\d{1,4}$/.test(raw)) {
    const n = Number(raw);
    return isPage(n) ? { page: n, label: t.labelPage(n) } : { error: t.errPage(TOTAL_PAGES) };
  }
  let m = raw.match(/^(?:جزء|الجزء|ج|juz|j)\s*(\d{1,2})$/i);
  if (m) {
    const page = juzStartPage(Number(m[1]));
    return page ? { page, label: t.labelJuz(m[1]) } : { error: t.errJuz };
  }
  m = raw.match(/^(?:سورة|السورة|س|surah|sura|s)\s*(\d{1,3})$/i);
  if (m) {
    const s = SURAHS[Number(m[1]) - 1];
    return s ? { page: s.page, label: t.labelSurah(s.arabic) } : { error: t.errSurah };
  }
  const q = normalizeText(raw.replace(/^(?:سورة|السورة|surah|sura)\s+/i, '')).replace(/^ال/, '');
  if (q.length >= 1) {     // ≥1: two surahs are named by a single letter (ص، ق)
    const strip = (k) => k.replace(/^ال/, '').replace(/^al /, '').replace(/\s+/g, '');   // "ya sin" and "yasin" are the same
    const q2 = q.replace(/\s+/g, '');
    const hit = SURAH_KEYS.find(k => strip(k.ar) === q2 || strip(k.en) === q2)
             ?? (q2.length >= 2 ? SURAH_KEYS.find(k => strip(k.ar).startsWith(q2) || strip(k.en).startsWith(q2)) : undefined)
             ?? (q2.length >= 2 ? SURAH_KEYS.find(k => strip(k.ar).includes(q2) || strip(k.en).includes(q2)) : undefined);
    if (hit) return { page: hit.s.page, label: t.labelSurah(hit.s.arabic) };
  }
  return { error: t.errUnknown };
}

// ── text layout ───────────────────────────────────────────────────────────────
/** The Uthmani text of ayah 1 starts with the basmala in most editions; the header shows it, so drop it from the text. */
export function stripBasmala(text) {
  const words = String(text ?? '').trim().split(/\s+/);
  if (words.length > 4 && normalizeText(words[0]) === 'بسم') return words.slice(4).join(' ');
  return String(text ?? '').trim();
}

const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
export const surahArabic = (n) => SURAHS[n - 1]?.arabic ?? '';

/**
 * @param {{ surah:number, ayah:number, text:string }[]} ayahs  in reading order
 * @returns {{ body: string, surahs: number[] }}
 */
export function layoutPage(ayahs) {
  const groups = [];
  for (const a of ayahs) {
    const last = groups[groups.length - 1];
    if (last && last.surah === a.surah) last.items.push(a); else groups.push({ surah: a.surah, items: [a] });
  }
  const blocks = [];
  for (const g of groups) {
    const lines = [];
    if (g.items[0].ayah === 1) {
      lines.push(`## سورة ${surahArabic(g.surah)}`);
      if (g.surah !== 1 && g.surah !== 9) lines.push(`**${BASMALA}**`);
    }
    const text = g.items.map(a => {
      const t = a.ayah === 1 && g.surah !== 1 && g.surah !== 9 ? stripBasmala(a.text) : String(a.text).trim();
      return `${t} ﴿${toIndic(a.ayah)}﴾`;
    }).join(' ');
    lines.push(text);
    blocks.push(lines.join('\n'));
  }
  let body = blocks.join('\n\n');
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 1).replace(/\s+\S*$/, '')}…`;
  return { body, surahs: groups.map(g => g.surah) };
}

export const pageTitle = (surahs, lang = 'ar') => {
  const names = [...new Set(surahs)].slice(0, 3).map(surahArabic);
  if (!names.length) return lang === 'en' ? 'Mushaf' : 'المصحف';
  return `${lang === 'en' ? 'Surah' : 'سورة'} ${names.join(' · ')}`;
};

// ── views: the text page, or the picture of the page in one riwaya ────────────
export const TEXT_VIEW = Object.freeze({ mode: 'text', riwaya: null });
/** The free reader (/mushaf): same views, but no wird — no subscription gate, no "I finished this page". Encoded as a leading `f` in the kind. */
export const PLAIN_TEXT = Object.freeze({ mode: 'text', riwaya: null, plain: true });
const LETTER = { hafs: 'h', warsh: 'w' };
const RIWAYA_OF = { h: 'hafs', w: 'warsh' };
export const imageView = (riwaya, plain = false) => (LETTER[riwaya] ? { mode: 'img', riwaya, ...(plain ? { plain: true } : {}) } : (plain ? PLAIN_TEXT : TEXT_VIEW));
export const isPlain = (view) => !!view?.plain;

/** What is stored for a member ('text' | 'hafs' | 'warsh') ⇄ the view the reader shows. Anything unknown means text. */
export const viewFromPref = (pref, plain = false) => imageView(pref, plain);
export const prefOfView = (view) => (view?.mode === 'img' && LETTER[view.riwaya] ? view.riwaya : 'text');

/** The custom-id kind of an action in a view: text keeps the original kinds ('p', 'jump', 'done'…), a picture adds `ih` / `iw`, the free reader prefixes `f`. */
export const kindFor = (base, view = TEXT_VIEW) => {
  const f = isPlain(view) ? 'f' : '';
  if (view?.mode !== 'img') return `${f}${base}`;
  const suffix = `i${LETTER[view.riwaya]}`;
  return base === 'p' ? `${f}${suffix}` : `${f}${base}${suffix}`;
};
/** Inverse of kindFor: `{ base, view }`, or null for a kind this reader does not know. */
export function parseKind(kind) {
  let k = String(kind ?? '');
  const plain = k.startsWith('f') && k.length > 1;
  if (plain) k = k.slice(1);
  if (k === 'p') return { base: 'p', view: imageView(null, plain) };
  if (k === 'ih' || k === 'iw') return { base: 'p', view: imageView(RIWAYA_OF[k[1]], plain) };
  const m = /^(open|jumpm|jump|done|mine)(i[hw])?$/.exec(k);
  if (!m) return null;
  return { base: m[1], view: m[2] ? imageView(RIWAYA_OF[m[2][1]], plain) : imageView(null, plain) };
}

// ── custom ids:  mushaf:<kind>[:<page>][:<userId>] ────────────────────────────
export const MUSHAF_PREFIX = 'mushaf:';
export const MODAL_JUMP = 'mushaf:jumpm';
export const MODAL_JUMP_PLAIN = 'mushaf:fjumpm';
export const mid = (kind, ...parts) => [`mushaf`, kind, ...parts].join(':');

/** @returns {{ kind: string, page: number|null, userId: string|null } | null} */
export function parseId(customId) {
  const [ns, kind, a, b] = String(customId ?? '').split(':');
  if (ns !== 'mushaf' || !kind) return null;
  let page = null, userId = null;
  for (const part of [a, b]) {
    if (part === undefined) continue;
    if (/^\d{1,4}$/.test(part) && page === null && Number(part) <= TOTAL_PAGES && part.length <= 3) page = Number(part);
    else if (/^\d{15,25}$/.test(part)) userId = part;
  }
  return { kind, page, userId };
}
