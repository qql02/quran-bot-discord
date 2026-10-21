/**
 * Hadith of the day. The texts live in hadithData.json, which is GENERATED from an open dataset (sunnah.com data) by
 * src/tools/build-hadith-data.js — no hadith is typed by hand. Sources: الأربعون النووية, and the hadiths of
 * رياض الصالحين that are reported in Sahih al-Bukhari / Sahih Muslim (the book's own «متفق عليه» / «رواه …» wording).
 *
 * One hadith per local day, the same on every server. The list is walked with a fixed stride so consecutive days
 * come from different topics, and no hadith repeats before the whole list has been shown.
 */
import fs from 'node:fs';

/** @type {{ s: 'n'|'r', n: number, t: string, by?: string }[]} s = source (n: الأربعون النووية, r: رياض الصالحين), n = number in the book */
export const HADITHS = JSON.parse(fs.readFileSync(new URL('./hadithData.json', import.meta.url), 'utf8'));

export const DEFAULT_HADITH_TIME = '13:00';

export const HADITH_SOURCES = {
  n: { name: 'الأربعون النووية', slug: 'nawawi40' },
  r: { name: 'رياض الصالحين',    slug: 'riyadussalihin' }
};

const DAY_MS = 86_400_000;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Stride through the list: about 0.618 of its length, nudged down until it is coprime with it (visits every entry once per cycle). */
const STRIDE = (() => {
  let s = Math.max(1, Math.floor(HADITHS.length * 0.618));
  while (s > 1 && gcd(s, HADITHS.length) !== 1) s--;
  return s;
})();

/** YYYY-MM-DD → whole days since 1970-01-01 (pure date arithmetic). */
function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Index in HADITHS for a local date. Same date → same hadith everywhere. */
export function hadithIndexForDate(date) {
  const n = HADITHS.length;
  return (((dayNumber(date) * STRIDE) % n) + n) % n;
}

export const hadithForDate = (date) => HADITHS[hadithIndexForDate(date)];

/** Where to read it in full (sunnah.com uses the same numbering as the dataset). */
export function hadithUrl(h) {
  return `https://sunnah.com/${HADITH_SOURCES[h.s].slug}:${h.n}`;
}
