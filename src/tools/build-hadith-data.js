/**
 * Builds src/data/hadithData.json — the hadith texts for "حديث اليوم".
 *
 * NOTHING here is typed by hand: the texts are copied verbatim from the open dataset
 *   https://github.com/AhmedBaset/hadith-json   (pinned to tag v1.2.0; data scraped from sunnah.com)
 * and only filtered / cleaned mechanically:
 *   • الأربعون النووية        — all hadiths.
 *   • رياض الصالحين           — only hadiths whose own text says «متفق عليه» / «رواه البخاري» / «رواه مسلم»
 *                                (i.e. the ones reported in the two Sahih books), and not longer than MAX_LEN_RIYAD.
 * Cleaning only removes invisible direction marks, turns "((…))" into "(…)", fixes a doubled full stop and collapses whitespace. Words are never changed.
 *
 * Run:  node src/tools/build-hadith-data.js            (downloads the two files)
 *       node src/tools/build-hadith-data.js <dir>      (uses nawawi40.json + riyad_assalihin.json already in <dir>)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG  = 'v1.2.0';
const BASE = `https://raw.githubusercontent.com/AhmedBaset/hadith-json/${TAG}/db/by_book`;
const FILES = { nawawi: ['forties/nawawi40.json', 'nawawi40.json'], riyad: ['other_books/riyad_assalihin.json', 'riyad_assalihin.json'] };
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'hadithData.json');

const MAX_LEN_RIYAD  = 900;
const MAX_LEN_NAWAWI = 1800;     // an embed description holds 4096 characters

const strip = (s) => s.replace(/[ً-ٰٟـ]/g, '');          // harakat + tatweel, for matching only
const clean = (s) => s
  .replace(/[‍-‏‪-‮]/g, '')                               // invisible direction marks
  .replace(/\(\s*\(/g, '(').replace(/\)\s*\)/g, ')')                          // ((متفق عليه)) → (متفق عليه)
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\s+([.،؛:!؟])/g, '$1')
  .replace(/(?<!\.)\.\.(?!\.)/g, '.').trim();                         // a doubled full stop ("..") at the end of some entries

/** Who reported it, read from the hadith's own closing words. */
function reporter(plain) {
  if (plain.includes('متفق عليه')) return 'متفق عليه';
  const b = plain.includes('رواه البخاري'), m = plain.includes('رواه مسلم');
  return b && m ? 'رواه البخاري ومسلم' : b ? 'رواه البخاري' : m ? 'رواه مسلم' : null;
}

async function load(key, dir) {
  const [remote, local] = FILES[key];
  if (dir) return JSON.parse(fs.readFileSync(path.join(dir, local), 'utf8'));
  const res = await fetch(`${BASE}/${remote}`);
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`);
  return res.json();
}

const dir = process.argv[2];
const [nawawi, riyad] = [await load('nawawi', dir), await load('riyad', dir)];
const out = [];

for (const h of nawawi.hadiths) {
  const t = clean(h.arabic);
  if (t && t.length <= MAX_LEN_NAWAWI && !/[A-Za-z{}*_]/.test(t)) out.push({ s: 'n', n: h.idInBook, t });
}
for (const h of riyad.hadiths) {
  const t = clean(h.arabic);
  const by = reporter(strip(t));
  if (!by || t.length > MAX_LEN_RIYAD || /[A-Za-z{}*_]/.test(t)) continue;   // Latin letters/braces = scraping noise
  out.push({ s: 'r', n: h.idInBook, t, by });
}

fs.writeFileSync(OUT, JSON.stringify(out));
const c = (s) => out.filter(x => x.s === s).length;
console.log(`wrote ${out.length} hadiths (nawawi ${c('n')}, riyad ${c('r')}) → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
