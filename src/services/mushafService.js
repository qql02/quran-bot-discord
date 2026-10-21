import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { isPage, locateAyah } from '../utils/mushaf.js';

/**
 * Text of one Mushaf page (604 pages) from the same API as the verse of the day (api.alquran.cloud).
 *   • every page is cached for a day (the text never changes) — a page read once is free for everyone afterwards;
 *   • the whole Mushaf fits in the cache (604 pages ≈ a few MB), and an expired page is still served when the API is down
 *     (the text never changes, so stale is always correct — better than an error screen);
 *   • concurrent requests for the same page share ONE API call;
 *   • a failed page is not retried for a few seconds, so a dead API is never hammered by button mashing.
 * Anything that does not look right (wrong page, empty text, impossible ayah) is rejected rather than shown.
 */
const CACHE_MAX = 604;
const TTL_MS    = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5_000;

const cache    = new Map();     // page → { at, data }
const inflight = new Map();     // page → Promise
const failedAt = new Map();     // page → timestamp

export const mushafCacheStats = () => ({ size: cache.size, inflight: inflight.size });
/** Warm the cache for a page the member is likely to open next. Never throws, never waits. */
export function prefetchMushafPage(page) { if (isPage(page)) fetchMushafPage(page).catch(() => {}); }
export function clearMushafCache() { cache.clear(); inflight.clear(); failedAt.clear(); }

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** @returns {Promise<{ page:number, juz:number, ayahs:{surah:number, ayah:number, text:string}[] } | null>} */
export async function fetchMushafPage(page) {
  if (!isPage(page)) return null;
  const hit = cache.get(page);
  if (hit && Date.now() - hit.at < TTL_MS) { cache.delete(page); cache.set(page, hit); return hit.data; }   // LRU touch
  if (Date.now() - (failedAt.get(page) ?? 0) < RETRY_AFTER_MS) return hit?.data ?? null;
  if (inflight.has(page)) return inflight.get(page);

  const p = load(page).then(out => out ?? hit?.data ?? null).finally(() => inflight.delete(page));
  inflight.set(page, p);
  return p;
}

async function load(page) {
  const { apiUrl, textEdition, timeoutMs } = config.ayah;
  const endpoint = `${apiUrl}/page/${page}/${textEdition}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data } = await axios.get(endpoint, { timeout: timeoutMs, maxRedirects: 2, maxContentLength: 2_000_000, responseType: 'json' });
      const out = parse(data?.data, page);
      cache.set(page, { at: Date.now(), data: out });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      failedAt.delete(page);
      return out;
    } catch (err) {
      if (attempt === 2) logger.warn(`[mushaf] page ${page} failed: ${err.message}`);
      else await new Promise(r => setTimeout(r, 800));
    }
  }
  failedAt.set(page, Date.now());
  return null;
}

/** Validate + normalise the API answer; throws when it cannot be trusted. */
export function parse(d, page) {
  const list = Array.isArray(d?.ayahs) ? d.ayahs : [];
  if (!list.length || list.length > 60) throw new Error('unexpected API response');
  if (d.number !== undefined && Number(d.number) !== page) throw new Error(`asked page ${page}, got ${d.number}`);
  const ayahs = list.map(a => {
    const text = clean(a?.text);
    // `surah.number` + `numberInSurah` when present; otherwise derive both from the global ayah number.
    const loc = Number.isInteger(a?.surah?.number) && Number.isInteger(a?.numberInSurah)
      ? { surah: a.surah.number, ayah: a.numberInSurah }
      : locateAyah(a?.number);
    if (!text || !loc || loc.surah < 1 || loc.surah > 114 || loc.ayah < 1) throw new Error('unexpected ayah in response');
    return { surah: loc.surah, ayah: loc.ayah, text };
  });
  const juz = Number(list[0]?.juz);
  return { page, juz: Number.isInteger(juz) && juz >= 1 && juz <= 30 ? juz : null, ayahs };
}
