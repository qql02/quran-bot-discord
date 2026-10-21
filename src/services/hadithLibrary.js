import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { MAX_NUMBER, parseHadith } from '../data/hadithBooks.js';

/**
 * One hadith of one of the six books, fetched from the open hadith-api dataset (one small JSON file per hadith) and cached.
 *   GET <apiUrl>/editions/<edition>/<number>.json  →  { hadithnumber, arabicnumber, text, grades: [{ name, grade }], reference: { book, hadith } }
 * The answer is verified (right number, non-empty text) before it is ever shown.
 */
/** Mirrors of the same dataset (same paths): jsDelivr's other edges, then GitHub itself. The configured URL always comes first. */
export const MIRRORS = [
  'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1',
  'https://fastly.jsdelivr.net/gh/fawazahmed0/hadith-api@1',
  'https://gcore.jsdelivr.net/gh/fawazahmed0/hadith-api@1',
  'https://raw.githubusercontent.com/fawazahmed0/hadith-api/1'
];
export const sources = () => [...new Set([config.hadithApi.apiUrl, ...MIRRORS].map(u => u.replace(/\/+$/, '')))];

const cache = new Map();              // "bukhari:1" → hadith
const CACHE_MAX = 300;
const failedAt = new Map();           // key → timestamp of the last network failure (don't hammer a dead API)
const RETRY_AFTER_MS = 30_000;

/** @returns {Promise<{status:'ok', hadith:object} | {status:'notfound'} | {status:'error'}>} */
export async function fetchHadith(book, number) {
  if (!Number.isInteger(number) || number < 1 || number > MAX_NUMBER) return { status: 'notfound' };
  const key = `${book.id}:${number}`;
  if (cache.has(key)) return { status: 'ok', hadith: cache.get(key) };
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_AFTER_MS) return { status: 'error' };

  // The configured source first, then mirrors of the same dataset: a mirror that is down or blocked never stops the command.
  // A 404 is an answer ("no such number"), not a failure, so it ends the search at once.
  const { timeoutMs } = config.hadithApi;
  let lastErr = null;
  for (const base of sources()) {
    try {
      const { data } = await axios.get(`${base}/editions/${book.edition}/${number}.json`, { timeout: timeoutMs, maxRedirects: 2, maxContentLength: 1_000_000, responseType: 'json' });
      const hadith = parseHadith(data, number);
      if (!hadith) throw new Error('unexpected API response');
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, hadith); failedAt.delete(key);
      return { status: 'ok', hadith };
    } catch (err) {
      if (err?.response?.status === 404) return { status: 'notfound' };     // no such number in this book
      lastErr = err;
    }
  }
  logger.warn(`[hadith] fetch ${key} failed on every source: ${lastErr?.message}`);
  failedAt.set(key, Date.now());
  return { status: 'error' };
}

/** A random hadith of a book (or of any book): a few tries, because a random number may fall past the real end of a book. */
export async function fetchRandomHadith(pick, tries = 4) {
  let result = { status: 'error' };
  for (let i = 0; i < tries; i++) {
    const { book, number } = pick();
    result = await fetchHadith(book, number);
    if (result.status === 'ok') return { ...result, book };
    if (result.status === 'error') break;                               // the API is down — more tries would only wait
  }
  return result;
}

export const forgetHadithCache = () => { cache.clear(); failedAt.clear(); };
