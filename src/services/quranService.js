import axios from 'axios';
import { normalizeText } from '../utils/arabic.js';
import { parseSurahList } from '../utils/surahList.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Favorites } from '../models/Favorites.js';
import { logger } from '../utils/logger.js';
import { loadReciterChoice } from './reciterPrefs.js';
import { defaultReciterQuery, getGuildReciterKey, getGuildCustomReciter, panelReciter, riwayaToken } from '../data/popular.js';
import { config } from '../config.js';
import { getExtraReciters, mergeExtraReciters } from './extraReciters.js';
import { visibleReciters } from '../utils/ownerFleet.js';

const BASE_URL  = config.quran.apiUrl;
const CACHE_TTL = config.quran.cacheTtlMs;

// Map internal lang codes → mp3quran API language param
const API_LANG = { ar: 'ar', en: 'eng' };

// ─── Cache Architecture ───────────────────────────────────────────────────────
//
// TWO separate stores intentionally:
//
//  rawCache   — owned exclusively by fetchWithRetry.
//               Holds the raw { reciters: [...] } API response object.
//               Never touched by any other function.
//
//  normCache  — owned exclusively by each fetch* function.
//               Holds the normalized/mapped array ready for consumers.
//               Never passed to fetchWithRetry.
//
// This separation prevents the original bug where fetchReciters overwrote
// rawCache.reciters[lang].data with a normalized array, causing fetchWithRetry
// to return an array on the next cache-hit, making raw.reciters === undefined
// and returning 0 reciters forever.
//
// In-flight deduplication: inflight[key] holds a Promise while a fetch is in
// progress. Concurrent callers await the same Promise instead of each firing
// their own API request (thundering herd / cache stampede prevention).

const rawCache = {
  reciters: { en: { data: null, ts: 0 }, ar: { data: null, ts: 0 } },
  suwar:    { en: { data: null, ts: 0 }, ar: { data: null, ts: 0 } },
  rewayat:  { data: null, ts: 0 },
  radio:    { data: null, ts: 0 }
};

const normCache = {
  reciters: { en: null, ar: null },
  suwar:    { en: null, ar: null },
  rewayat:  null,
  radio:    null
};

const inflight = {};

/** Drop every cached API response (raw + normalised). The next request fetches fresh data. */
export function clearQuranCache() {
  for (const k of ['reciters', 'suwar']) {
    for (const lang of Object.keys(rawCache[k])) { rawCache[k][lang] = { data: null, ts: 0 }; normCache[k][lang] = null; }
  }
  rawCache.rewayat = { data: null, ts: 0 }; normCache.rewayat = null;
  rawCache.radio   = { data: null, ts: 0 }; normCache.radio   = null;
}

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Accept': 'application/json' }
});

// ─── Generic fetch with retry + stale-cache fallback + in-flight dedup ────────

async function fetchWithRetry(endpoint, params, bucketRef, label) {
  const now = Date.now();
  if (bucketRef.data && now - bucketRef.ts < CACHE_TTL) return bucketRef.data;

  const key = `${endpoint}:${JSON.stringify(params)}`;
  if (inflight[key]) {
    logger.debug?.(`${label}: joining in-flight request`);
    return inflight[key];
  }

  const promise = (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data } = await http.get(endpoint, { params });
        bucketRef.data = data;
        bucketRef.ts   = Date.now();
        logger.info(`Loaded ${label} from MP3Quran`);
        return data;
      } catch (err) {
        logger.error(`${label} error (attempt ${attempt}/3): ${err.message}`);
        if (attempt === 3) {
          if (bucketRef.data) {
            logger.warn(`${label}: returning stale cached data`);
            return bucketRef.data;
          }
          return null;
        }
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
    return bucketRef.data ?? null;
  })();

  inflight[key] = promise;
  try {
    return await promise;
  } finally {
    delete inflight[key];
  }
}

// ─── Reciters ─────────────────────────────────────────────────────────────────

export async function fetchReciters(lang = 'ar') {
  const rawBucket = rawCache.reciters[lang] ?? (rawCache.reciters[lang] = { data: null, ts: 0 });

  const now = Date.now();
  if (normCache.reciters[lang] && rawBucket.ts && now - rawBucket.ts < CACHE_TTL) {
    return normCache.reciters[lang];
  }

  const raw = await fetchWithRetry(
    '/reciters',
    { language: API_LANG[lang] ?? lang },
    rawBucket,
    `reciters(${lang})`
  );

  if (!raw) return normCache.reciters[lang] ?? [];

  const reciters = (raw.reciters ?? []).map(r => Object.freeze({
    id:     r.id,
    name:   r.name,
    letter: r.letter,
    moshaf: Object.freeze((r.moshaf ?? []).map(m => Object.freeze({
      id:          m.id,
      name:        m.name,
      server:      m.server,
      surah_list:  m.surah_list,
      surah_total: m.surah_total ?? 0,
      moshaf_type: m.moshaf_type ?? 0
    })))
  }));

  const frozen = Object.freeze(reciters);
  normCache.reciters[lang] = frozen;
  logger.debug?.(`fetchReciters(${lang}): normalized ${reciters.length} reciters into normCache`);
  return frozen;
}

function computeAllReciters(enReciters, arReciters) {
  const map = new Map();
  for (const r of arReciters) map.set(r.id, { ...r, arabicName: r.name });
  for (const r of enReciters) {
    const existing = map.get(r.id);
    if (existing) {
      existing.englishName = r.name;
      existing.displayName = r.name;
      existing.moshaf = [...r.moshaf];
    } else {
      map.set(r.id, { ...r, englishName: r.name, displayName: r.name, moshaf: [...r.moshaf] });
    }
  }

  return [...map.values()].map(r => ({
    ...r,
    moshaf: r.moshaf ? [...r.moshaf] : [],
    displayName: r.englishName || r.arabicName || r.name
  }));
}

// The merged list is rebuilt only when the underlying API cache is refreshed (fetchReciters returns the
// same array object while its cache is valid), not on every keystroke of an autocomplete.
// The shared list is READ-ONLY: anything handed to a caller that may keep or modify it is cloned first
// (play.js / recoveryService replace `reciterObj.moshaf`, which would otherwise corrupt the cache).
// Counts rebuilds of the merged list (observable by tests: proves searches don't rebuild it).
export const quranServiceStats = { recitersBuilt: 0 };
let _recitersMemo = null;   // { en, ar, extra, list }
// Reciters the owner hid from the dashboard: not offered by any search / menu / autocomplete. A lookup BY ID (a recitation being handed
// over, a restart recovering a session) still finds them, so hiding never breaks something that is already playing.
let _hiddenSource = () => null;
let _visibleMemo = null;   // { list, key, out }
export function setHiddenRecitersSource(fn) { _hiddenSource = typeof fn === 'function' ? fn : () => null; _visibleMemo = null; }
async function sharedReciters() {
  const list = await sharedRecitersAll();
  const hidden = _hiddenSource();
  if (!Array.isArray(hidden) || !hidden.length) return list;
  const key = hidden.join(',');
  if (_visibleMemo && _visibleMemo.list === list && _visibleMemo.key === key) return _visibleMemo.out;
  const out = visibleReciters(list, hidden);
  _visibleMemo = { list, key, out };
  return out;
}
/** Every reciter, hidden or not (read-only list, clone before keeping). For the owner dashboard and lookups by id. */
export async function listAllReciters() { return cloneReciters(await sharedRecitersAll()); }
async function sharedRecitersAll() {
  const [en, ar] = await Promise.all([fetchReciters('en'), fetchReciters('ar')]);
  const extra = getExtraReciters();               // the second source: same array object until its background refresh swaps it
  if (_recitersMemo && _recitersMemo.en === en && _recitersMemo.ar === ar && _recitersMemo.extra === extra) return _recitersMemo.list;
  const list = mergeExtraReciters(computeAllReciters(en, ar), extra);
  quranServiceStats.recitersBuilt++;
  _recitersMemo = { en, ar, extra, list };
  return list;
}

const cloneReciters = (list) => list.map(r => structuredClone(r));

const reciterKeys = r => [r.englishName, r.arabicName, r.name, r.displayName].filter(Boolean).map(normalizeText);

export async function searchReciters(query, _lang = 'en') {
  const all = await sharedReciters();
  if (!query || query.trim() === '') return cloneReciters(all.slice(0, 25));

  const q = normalizeText(query);
  return cloneReciters(
    all.filter(r => reciterKeys(r).some(k => k.includes(q))).slice(0, 25)
  );
}

export async function findReciter(query) {
  const results = await searchReciters(query, 'en');
  const q = normalizeText(query);
  const exact = results.find(r => reciterKeys(r).some(k => k === q));
  if (exact) return exact;
  // A reciter the owner hid is no longer OFFERED (search, menus, autocomplete), but a recitation that already names it — a session
  // being restored after a restart, handed to another bot, or a server's saved choice — must still resolve by its exact name.
  if (q && _hiddenSource()?.length) {
    const hit = (await sharedRecitersAll()).find(r => reciterKeys(r).some(k => k === q));
    if (hit) return structuredClone(hit);
  }
  return results[0] ?? null;
}

/** A reciter by its API id (the panel's search results carry only the id in the menu value). */
export async function findReciterById(id) {
  const all = await sharedRecitersAll();
  const hit = all.find(r => String(r.id) === String(id));
  return hit ? structuredClone(hit) : null;
}

/**
 * The panel's search box: name and/or narration, both optional (at least one). The narration is matched against the
 * English moshaf names, so common Arabic names are translated first (see riwayaToken). Max 25 (a Discord menu).
 */
export async function searchRecitersFor({ name = '', riwaya = '' } = {}) {
  const all = await sharedReciters();
  const q = normalizeText(name ?? '');
  const rw = riwayaToken(riwaya);
  const out = all.filter(r =>
    (!q || reciterKeys(r).some(k => k.includes(q))) &&
    (!rw || (r.moshaf ?? []).some(m => (m.name ?? '').toLowerCase().includes(rw))));
  return cloneReciters(out.slice(0, 25));
}

// ─── Suwar (Surahs from API) ──────────────────────────────────────────────────

export async function fetchSuwar(lang = 'ar') {
  const rawBucket = rawCache.suwar[lang] ?? (rawCache.suwar[lang] = { data: null, ts: 0 });

  const now = Date.now();
  if (normCache.suwar[lang] && rawBucket.ts && now - rawBucket.ts < CACHE_TTL) {
    return normCache.suwar[lang];
  }

  const raw = await fetchWithRetry(
    '/suwar',
    { language: API_LANG[lang] ?? lang },
    rawBucket,
    `suwar(${lang})`
  );

  if (!raw) return normCache.suwar[lang] ?? [];

  const suwar = (raw.suwar ?? []).map(s => {
    const tn = s.translated_name;
    const translatedName = typeof tn === 'string'
      ? tn
      : (tn?.eng ?? tn?.en ?? tn?.ar ?? s.name);

    return Object.freeze({
      id:             s.id,
      name:           s.name,
      translatedName,
      countVerses:    s.count_verses ?? 0,
      type:           s.type ?? null,
      page:           s.page ?? null
    });
  });

  normCache.suwar[lang] = Object.freeze(suwar);
  return normCache.suwar[lang];
}

// ─── Rewayat (Narrations) ─────────────────────────────────────────────────────

export async function fetchRewayat() {
  const now = Date.now();
  if (normCache.rewayat && rawCache.rewayat.ts && now - rawCache.rewayat.ts < CACHE_TTL) {
    return normCache.rewayat;
  }

  const raw = await fetchWithRetry('/riwayat', { language: 'ar' }, rawCache.rewayat, 'riwayat');
  if (!raw) return normCache.rewayat ?? [];

  const rewayat = (raw.riwayat ?? raw.rewayat ?? []).map(r => Object.freeze({
    id:     r.id,
    name:   r.name,
    rewaya: r.rewaya ?? r.name
  }));

  normCache.rewayat = Object.freeze(rewayat);
  return normCache.rewayat;
}

export async function getRecitersByRiwaya(riwayaQuery) {
  const all = await sharedReciters();            // ALL reciters (searchReciters('') is capped at 25)
  const q = riwayaQuery.toLowerCase().trim();
  return cloneReciters(all.filter(r =>
    (r.moshaf ?? []).some(m => (m.name ?? '').toLowerCase().includes(q))
  ));
}

// ─── Radio ────────────────────────────────────────────────────────────────────

export async function fetchRadio() {
  const now = Date.now();
  if (normCache.radio && rawCache.radio.ts && now - rawCache.radio.ts < CACHE_TTL) {
    return normCache.radio;
  }

  const raw = await fetchWithRetry('/radios', { language: 'ar' }, rawCache.radio, 'radio');
  if (!raw) return normCache.radio ?? [];

  const list = raw.radio ?? raw.radio_stations ?? raw.stations ?? raw.radios ?? [];
  const stations = list.map(s => Object.freeze({
    id:       s.id,
    name:     s.name,
    url:      s.url,
    language: s.language ?? 'ar'
  }));

  normCache.radio = Object.freeze(stations);
  return normCache.radio;
}

// ─── Moshaf / Audio URLs ───────────────────────────────────────────────────────

export function getReciterMoshaf(reciter) {
  return reciter?.moshaf ?? [];
}

export function buildSurahUrl(moshaf, surahNumber) {
  if (!moshaf?.server) return null;
  const num = Number(surahNumber);
  if (!num || num < 1 || num > 114) {
    logger.warn(`buildSurahUrl: invalid surahNumber: ${surahNumber}`);
    return null;
  }
  const padded = String(num).padStart(3, '0');
  const server = moshaf.server.endsWith('/')
    ? moshaf.server
    : moshaf.server + '/';
  return `${server}${padded}.mp3`;
}

export async function verifySurahUrl(url) {
  return typeof url === 'string' && url.startsWith('https://');
}

export async function getPlayableUrls(reciter, surahNumber) {
  const moshafList = getReciterMoshaf(reciter);
  if (!moshafList.length) return [];

  const candidates = [];

  for (const moshaf of moshafList) {
    const surahList = parseSurahList(moshaf.surah_list);
    if (surahList.length > 0 && !surahList.includes(Number(surahNumber))) continue;
    const url = buildSurahUrl(moshaf, surahNumber);
    if (!url) continue;
    candidates.push({ url, moshaf, riwaya: moshaf.name ?? 'Hafs' });
  }

  for (const moshaf of moshafList) {
    const url = buildSurahUrl(moshaf, surahNumber);
    if (!url) continue;
    if (!candidates.some(c => c.url === url)) {
      candidates.push({ url, moshaf, riwaya: moshaf.name ?? 'Hafs' });
    }
  }

  if (!candidates.length) {
    logger.warn(
      `getPlayableUrls: no URLs for surah #${surahNumber} across ${moshafList.length} moshaf` +
      ` (reciter: ${reciter?.name ?? 'unknown'})`
    );
  }

  return candidates;
}

/**
 * Autocomplete choices. Favourites come first (⭐); Arabic servers see the Arabic name too.
 * The choice VALUE is always the English display name so findReciter() resolves it exactly.
 */
export async function reciterAutocomplete(query, { lang = 'en', favorites = [] } = {}) {
  const all    = await sharedReciters();          // read-only: only names are copied into the choices
  const favSet = new Set(favorites.map(normalizeText));
  const isFav  = r => reciterKeys(r).some(k => favSet.has(k));
  const q      = normalizeText(query);

  let list = q ? all.filter(r => reciterKeys(r).some(k => k.includes(q))) : all;
  const rank = r => (isFav(r) ? 0 : 2) + (q && reciterKeys(r).some(k => k.startsWith(q)) ? 0 : 1);
  list = [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 25);

  return list.map(r => {
    const en    = r.englishName || r.name;
    const label = lang === 'ar' && r.arabicName && r.arabicName !== en ? `${r.arabicName} · ${en}` : en;
    return {
      name:  truncate(`${isFav(r) ? '⭐ ' : ''}${label}`, 100),
      value: truncate(r.displayName || r.name, 100)
    };
  });
}

/** Same, but pulls the guild language and the user's favourites from the interaction. */
export async function reciterAutocompleteFor(interaction) {
  const [lang, fav] = await Promise.all([
    GuildSettings.getLanguage(interaction.guildId).catch(() => 'en'),
    Favorites.peek(interaction.user.id, interaction.guildId).catch(() => null)
  ]);
  return reciterAutocomplete(interaction.options.getFocused(), { lang, favorites: fav?.reciters ?? [] });
}

/** Reciter used when nobody picked one: this server's choice from the panel, else the bot default (favourites no longer decide). */
export async function defaultReciterName(_userId, guildId) {
  return defaultReciterQuery(guildId);
}

/**
 * The reciter to use when nobody picked one: this server's panel choice, else the bot default — and when that exact name is not in
 * the API list (names differ slightly: "Mishary Alafasy" / "Mishari Al-Afasy"…), the closest match on its last word,
 * and as a last resort the first reciter that has recitations. Returns null only when the reciter service itself is down.
 */
export async function findDefaultReciter(userId, guildId) {
  await loadReciterChoice(guildId);
  const picked = getGuildCustomReciter(guildId);          // a reciter found with the panel's search
  if (picked) {
    const hit = await findReciter(picked);
    if (hit?.moshaf?.length) return hit;
  }
  const panel = panelReciter(getGuildReciterKey(guildId));
  for (const key of panel?.search ?? []) {
    const hit = await findReciter(key);
    if (hit?.moshaf?.length) return hit;
  }
  const name = config.quran.defaultReciter;
  const exact = await findReciter(name);
  if (exact?.moshaf?.length) return exact;
  const last = normalizeText(String(name).trim().split(/\s+/).pop() ?? '');
  if (last.length >= 3) {
    const near = (await searchReciters(last, 'en')).find(r => r.moshaf?.length);
    if (near) return near;
  }
  return (await searchReciters('', 'en')).find(r => r.moshaf?.length) ?? null;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
