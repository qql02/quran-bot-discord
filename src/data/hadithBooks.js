/**
 * /hadith — the six books (الكتب الستة) + Muwatta Malik, the Forty of an-Nawawi and the Forty Qudsi. Only the catalogue lives here; every hadith text is fetched from the open
 * hadith-api dataset (fawazahmed0/hadith-api, sunnah.com numbering) at read time and cached — nothing is typed by hand.
 *
 * `edition`  = the dataset's edition name · `slug` = sunnah.com's name (for the "read at the source" link)
 * `randomMax`= a SAFE LOWER BOUND of the number of hadiths, used only to pick a random number (the real totals are a bit higher;
 *              a number past the end simply answers "not found"). Members may still ask for any number up to MAX_NUMBER.
 */
export const HADITH_BOOKS = [
  { id: 'bukhari',  edition: 'ara-bukhari',  slug: 'bukhari',  icon: '📗', ar: 'صحيح البخاري',  en: 'Sahih al-Bukhari',  randomMax: 7000, graded: false },
  { id: 'muslim',   edition: 'ara-muslim',   slug: 'muslim',   icon: '📘', ar: 'صحيح مسلم',     en: 'Sahih Muslim',      randomMax: 3000, graded: false },
  { id: 'tirmidhi', edition: 'ara-tirmidhi', slug: 'tirmidhi', icon: '📙', ar: 'سنن الترمذي',   en: 'Jami at-Tirmidhi',  randomMax: 3900, graded: true },
  { id: 'abudawud', edition: 'ara-abudawud', slug: 'abudawud', icon: '📕', ar: 'سنن أبي داود',  en: 'Sunan Abi Dawud',   randomMax: 5000, graded: true },
  { id: 'nasai',    edition: 'ara-nasai',    slug: 'nasai',    icon: '📓', ar: 'سنن النسائي',   en: 'Sunan an-Nasa\'i',  randomMax: 5600, graded: true },
  { id: 'ibnmajah', edition: 'ara-ibnmajah', slug: 'ibnmajah', icon: '📔', ar: 'سنن ابن ماجه',  en: 'Sunan Ibn Majah',   randomMax: 4300, graded: true },
  // beyond the six
  { id: 'malik',    edition: 'ara-malik',    slug: 'malik',    icon: '📒', ar: 'موطأ مالك',      en: 'Muwatta Malik',     randomMax: 1500, graded: false },
  { id: 'nawawi',   edition: 'ara-nawawi',   slug: 'nawawi40', icon: '📃', ar: 'الأربعون النووية', en: 'Forty Hadith of an-Nawawi', randomMax: 40, graded: false },
  { id: 'qudsi',    edition: 'ara-qudsi',    slug: 'qudsi40',  icon: '✨', ar: 'الأحاديث القدسية', en: 'Forty Hadith Qudsi', randomMax: 40, graded: false }
];

export const MAX_NUMBER = 10_000;
export const RANDOM_ALL = 'all';

const byId = new Map(HADITH_BOOKS.map(b => [b.id, b]));
export const getBook = (id) => byId.get(id) ?? null;
export const bookName = (b, lang = 'ar') => (lang === 'ar' ? b.ar : b.en);
export const hadithSourceUrl = (book, n) => `https://sunnah.com/${book.slug}:${n}`;

/** A random book (equal chance per book) and a random number inside its safe range. */
export function randomPick(rng = Math.random, bookId = null) {
  const book = (bookId && getBook(bookId)) || HADITH_BOOKS[Math.floor(rng() * HADITH_BOOKS.length)];
  return { book, number: 1 + Math.floor(rng() * book.randomMax) };
}

// ── Gradings (only shown when the dataset itself carries one) ─────────────────────────────────────────────────────
const GRADES = [
  [/sahih.*hasan|hasan.*sahih/i, 'حسن صحيح'], [/hasan/i, 'حسن'], [/sahih/i, 'صحيح'],
  [/da.?if|daif|weak/i, 'ضعيف'], [/maudu|mawdu|fabricated/i, 'موضوع'], [/munkar/i, 'منكر']
];
const SCHOLARS = [[/albani/i, 'الألباني'], [/zubair|zubayr/i, 'زبير علي زئي'], [/darussalam/i, 'دار السلام']];

/** [{ name: 'Al-Albani', grade: 'Sahih' }] → "الألباني: صحيح" lines; unknown wording is kept as it is. Never invents a grade. */
export function gradeLines(grades) {
  if (!Array.isArray(grades)) return [];
  const out = [];
  for (const g of grades) {
    const grade = String(g?.grade ?? '').trim(); const name = String(g?.name ?? '').trim();
    if (!grade) continue;
    const gAr = GRADES.find(([re]) => re.test(grade))?.[1] ?? grade;
    const nAr = SCHOLARS.find(([re]) => re.test(name))?.[1] ?? name;
    out.push(nAr ? `${nAr}: ${gAr}` : gAr);
  }
  return [...new Set(out)].slice(0, 3);
}

// ── Reading the dataset's answer (pure) ───────────────────────────────────────────────────────────────────────────
const clean = (s) => String(s ?? '')
  .replace(/[​-‏‪-‮⁦-⁩]/g, '')       // invisible direction marks
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** The API answer → our hadith, or null when it does not look right. Exported for the tests. */
export function parseHadith(data, number) {
  const h = Array.isArray(data?.hadiths) ? data.hadiths[0] : data;
  const text = clean(h?.text);
  if (!text) return null;
  const n = Number(h?.hadithnumber ?? h?.arabicnumber);
  if (Number.isFinite(n) && n !== number) return null;                // never show a different hadith than the one asked for
  return {
    number,
    text,
    grades: Array.isArray(h?.grades) ? h.grades : [],
    section: Number.isInteger(h?.reference?.book) ? h.reference.book : null,
    inSection: Number.isInteger(h?.reference?.hadith) ? h.reference.hadith : null
  };
}

