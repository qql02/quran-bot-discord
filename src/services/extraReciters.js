import axios from 'axios';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { mapLimit } from '../utils/mapLimit.js';
import { normalizeText } from '../utils/arabic.js';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A SECOND source of reciters, next to MP3Quran: the QuranicAudio catalogue (quranicaudio.com, the host that also serves the
// audio of Quran.com). It adds reciters MP3Quran does not have, and extra narrations for reciters it already has.
//
// Only COMPLETE, plain recitations are kept:
//   1. names that are Taraweeh, translations, "with children", teaching (Muallim), assorted years, duets… are dropped;
//   2. every remaining reciter is probed on a handful of surahs (HEAD requests) and must have ALL of them — a reciter with
//      missing files would fail in the middle of a Khatma;
//   3. the verified list is cached on disk (logs/extra-reciters.json, 7 days) so a restart never repeats the probing.
// Everything runs in the background: the bot never waits for it, and any failure just leaves MP3Quran as the only source.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CATALOG_URL = 'https://quranicaudio.com/api/qaris';
const FILE_BASE   = 'https://download.quranicaudio.com/quran/';
const CACHE_FILE  = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs', 'extra-reciters.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PROBE_SURAHS = [1, 2, 36, 67, 112, 114];          // first, longest, middle, a juz-amma neighbour, near-last and last
const PROBE_CONCURRENCY = 6;

// ── Which catalogue entries are plain, complete recitations ─────────────────────────────────────────────────
const EXCLUDE_NAME = /taraweeh|tarawih|tarawee|translation|with children|\bkids?\b|muallam|muallim|assorted|\brare\b|\bwith\b|\band\b|\b(13|14)\d\d\b|\[\s*\d{4}|\d{4}\s*\]|\b20\d\d\b/i;
const EXCLUDE_PATH = /_\d{4}\/?$|year\d|collection|taraw|children|kids|translation|_rare|iza3a|muallim|\/\//i;
const SAFE_PATH    = /^[A-Za-z0-9._\-/]+$/;

/** Narration names in the same words MP3Quran uses, so the panel's narration search finds them. */
const RIWAYA = [
  [/warsh|ورش/i,            "Rewayat Warsh A'n Nafi'"],
  [/qal+oo?n|قالون/i,       "Rewayat Qalon A'n Nafi'"],
  [/dou?ri|دوري/i,          "Rewayat Ad-Doori A'n Abi Amr"],
  [/so+si|susi|سوسي/i,      "Rewayat As-Soosi A'n Abi Amr"],
  [/khalaf|خلف/i,           "Rewayat Khalaf A'n Hamzah"],
  [/shu.?ba|شعبة/i,         "Rewayat Shu'bah A'n Asim"]
];
const HAFS = "Rewayat Hafs A'n Assem";
const STYLE_TAGS = /^(murattal|mujawwad)$/i;

/** What a catalogue entry is, or null when it must not be offered. Pure (no network). */
export function parseCatalogEntry(q) {
  const name = String(q?.name ?? '').trim();
  const path = String(q?.relative_path ?? '').trim();
  if (!name || !path || !SAFE_PATH.test(path) || path.startsWith('/') || path.includes('..')) return null;
  if (!String(q?.file_formats ?? '').toLowerCase().split(/[\s,]+/).includes('mp3')) return null;
  if (EXCLUDE_NAME.test(name) || EXCLUDE_PATH.test(path)) return null;

  const tag = /\[([^\]]+)\]/.exec(name)?.[1]?.trim() ?? '';
  let riwaya = HAFS;
  let style  = '';
  if (tag) {
    const hit = RIWAYA.find(([re]) => re.test(tag));
    if (hit) riwaya = hit[1];
    else if (STYLE_TAGS.test(tag)) style = ` - ${tag[0].toUpperCase()}${tag.slice(1).toLowerCase()}`;
    else return null;                                    // [Assorted], [Urdu Translation], a year… not a plain recitation
  }
  return {
    id: Number(q.id),
    englishName: name,
    arabicName: String(q?.arabic_name ?? '').trim(),
    server: `${FILE_BASE}${path.endsWith('/') ? path : `${path}/`}`,
    moshafName: `${riwaya}${style}`
  };
}

/** The reciter in the shape the rest of the bot uses (same as an MP3Quran reciter; the id is text so it can never clash). */
export function buildReciter(c) {
  return {
    id: `qa${c.id}`,
    name: c.englishName,
    englishName: c.englishName,
    arabicName: c.arabicName || undefined,
    displayName: c.englishName,
    letter: c.englishName[0]?.toUpperCase() ?? '',
    source: 'quranicaudio',
    moshaf: [{ id: `qa${c.id}`, name: c.moshafName, server: c.server, surah_list: '1-114', surah_total: 114, moshaf_type: 0 }]
  };
}

// ── Probing ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function exists(http, url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await http.head(url, { timeout: 15_000, maxRedirects: 3, validateStatus: () => true });
      if (res.status === 200 || res.status === 206) return true;
      if (res.status === 404 || res.status === 403) return false;
    } catch { /* network hiccup: try once more */ }
  }
  return false;
}

/** A reciter is complete when every probe surah is there (stops at the first missing one). */
export async function isComplete(http, server) {
  for (const n of PROBE_SURAHS) {
    if (!(await exists(http, `${server}${String(n).padStart(3, '0')}.mp3`))) return false;
  }
  return true;
}

// ── Merging with the MP3Quran list ────────────────────────────────────────────────────────────────────────────
const dropArticle = (t) => (t.startsWith('ال') && t.length > 3 ? t.slice(2) : t);

/** "first|last" of a name, so "مشاري راشد العفاسي" and "مشاري العفاسي" are the same person. '' when there is no usable name. */
export function nameKey(text) {
  const t = normalizeText(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(dropArticle);
  const words = t.filter(w => !['al', 'el', 'ibn', 'bin', 'ben'].includes(w));
  if (words.length < 2) return '';                       // one word is not enough to call two reciters the same person
  return `${words[0]}|${words[words.length - 1]}`;
}
const keysOf = (r) => [...new Set([r.arabicName, r.englishName, r.name].map(nameKey).filter(Boolean))];

/** Which narration + style a moshaf name is (so the same recitation from two sources is not offered twice). */
function recitationKey(moshafName) {
  const n = String(moshafName ?? '');
  const riwaya = /warsh|ورش/i.test(n) ? 'warsh' : /qal+oo?n|قالون/i.test(n) ? 'qalon' : /dou?ri|دوري/i.test(n) ? 'doori'
    : /so+si|susi|سوسي/i.test(n) ? 'soosi' : /khalaf|خلف/i.test(n) ? 'khalaf' : /shu.?ba|شعبة/i.test(n) ? 'shu' : 'hafs';
  return `${riwaya}${/mujawwad|مجود/i.test(n) ? '-mujawwad' : ''}`;
}

/**
 * `base` (MP3Quran) + `extras`: a reciter that is new is added; one that already exists only gains the narrations/styles it
 * does not have yet. `base` and its reciters are never modified (the shared list is read-only).
 */
export function mergeExtraReciters(base, extras) {
  if (!extras?.length) return base;
  const out = base.slice();
  const index = new Map();                                // name key → position in out
  out.forEach((r, i) => { for (const k of keysOf(r)) if (!index.has(k)) index.set(k, i); });

  for (const e of extras) {
    const ks = keysOf(e);
    const at = ks.map(k => index.get(k)).find(i => i !== undefined);
    if (at === undefined) {
      out.push(e);
      ks.forEach(k => index.set(k, out.length - 1));
      continue;
    }
    const r = out[at];
    const have = new Set((r.moshaf ?? []).map(m => recitationKey(m.name)));
    const add = e.moshaf.filter(m => !have.has(recitationKey(m.name)));
    if (add.length) out[at] = { ...r, moshaf: [...(r.moshaf ?? []), ...add] };
  }
  return out;
}

// ── State, cache and refresh ──────────────────────────────────────────────────────────────────────────────────
const NONE = Object.freeze([]);
let current = NONE;                                       // replaced (never mutated), so callers can compare by identity
let loadedAt = 0;
let refreshing = null;
let timer = null;

/** The verified extra reciters right now (empty until the first load finishes, or when the feature is off). */
export const getExtraReciters = () => current;

async function readCache(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(data?.reciters) && data.reciters.every(r => r?.id && r?.moshaf?.[0]?.server?.startsWith(FILE_BASE))) {
      return { at: Number(data.at) || 0, reciters: data.reciters };
    }
  } catch { /* no cache yet */ }
  return null;
}

async function writeCache(file, reciters) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ at: Date.now(), source: 'quranicaudio', reciters }), 'utf8');
  } catch (err) { logger.debug?.(`extra reciters: cache not written (${err.message})`); }
}

/**
 * Fetch the catalogue, keep the complete plain recitations, and swap them in. Never throws; one run at a time.
 * `opts` is for tests: { http, cacheFile (null = no cache file) }.
 */
export function refreshExtraReciters(opts = {}) {
  if (refreshing) return refreshing;
  const http = opts.http ?? axios.create({ timeout: 30_000, headers: { Accept: 'application/json', 'User-Agent': 'QuranBot/2' } });
  const cacheFile = opts.cacheFile === undefined ? CACHE_FILE : opts.cacheFile;

  refreshing = (async () => {
    try {
      let catalogue = null;
      for (let attempt = 1; attempt <= 3 && !catalogue; attempt++) {
        try {
          const { data } = await http.get(CATALOG_URL);
          if (Array.isArray(data) && data.length) catalogue = data;
        } catch (err) {
          logger.warn(`extra reciters: catalogue error (attempt ${attempt}/3): ${err.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
        }
      }
      if (!catalogue) return false;

      const seen = new Set();
      const candidates = catalogue.map(parseCatalogEntry).filter(c => c && !seen.has(c.server) && seen.add(c.server));
      const checked = await mapLimit(candidates, PROBE_CONCURRENCY, async (c) => {
        try { return (await isComplete(http, c.server)) ? c : null; } catch { return null; }
      });
      const complete = checked.filter(Boolean);
      if (!complete.length) { logger.warn('extra reciters: no complete reciter found — keeping what was loaded before'); return false; }

      current = Object.freeze(complete.map(buildReciter));
      loadedAt = Date.now();
      if (cacheFile) await writeCache(cacheFile, current);
      logger.info(`extra reciters: ${current.length} complete reciters added from QuranicAudio (${candidates.length - complete.length} of ${candidates.length} candidates skipped as incomplete)`);
      return true;
    } catch (err) {
      logger.warn(`extra reciters: refresh failed (${err.message})`);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Called once the bot is ready: use the cached list at once, refresh in the background when it is old, then every 12 hours. */
export async function startExtraReciters() {
  if (!config.quran.extraSources) { logger.info('extra reciters: switched off (EXTRA_RECITER_SOURCES=off)'); return; }
  const cached = await readCache(CACHE_FILE);
  if (cached) { current = Object.freeze(cached.reciters); loadedAt = cached.at; logger.info(`extra reciters: ${current.length} loaded from the cache`); }
  const stale = () => !loadedAt || Date.now() - loadedAt > CACHE_MAX_AGE_MS;
  if (stale()) void refreshExtraReciters();
  timer ??= setInterval(() => { if (stale()) void refreshExtraReciters(); }, 12 * 60 * 60 * 1000);
  timer.unref?.();
}
