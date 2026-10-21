// Shared helpers for every wird screen: date/time, ranges, and the Arabic labels for plans.
import { SURAHS } from '../../data/surahs.js';
import { wirdText } from './text.js';
import { localClock, DEFAULT_TIMEZONE } from '../../utils/adhkarSchedule.js';
import {
  DEFAULT_PAGES, DEFAULT_REMIND_TIME, todayPortion, juzAtPage, surahAtPage, pagesToday
} from '../../utils/wird.js';

// ── Formatting ──
export const ts = (d, style = 'D') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;
export const hhmm = (v) => v || DEFAULT_REMIND_TIME;
export const range = (from, to, lang = 'ar') => (from === to ? wirdText(lang).page(from) : wirdText(lang).pages(from, to));
export const where = (page, lang = 'ar') => {
  const surah = surahAtPage(page, SURAHS);
  return wirdText(lang).where(lang === 'en' ? surah.english : surah.arabic, juzAtPage(page));
};

// ── The member's day ──
/** The member's own local date (guards against a bad stored timezone). */
export function todayFor(sub, now = new Date()) {
  try { return localClock(sub.timezone || DEFAULT_TIMEZONE, now).date; }
  catch { return localClock(DEFAULT_TIMEZONE, now).date; }
}

/** Pages still to read TODAY → { from, to } or null when today's wird is done. */
export function remainingToday(sub, today) {
  const left = (sub.pagesPerDay ?? DEFAULT_PAGES) - pagesToday(sub, today);
  if (sub.lastReadDate === today || left <= 0) return null;
  return todayPortion(sub.currentPage ?? 0, left);
}

// ── Plan labels ──
export const durationLabel = (d, lang = 'ar') => { const t = wirdText(lang); return t.duration[d] ?? t.durationDays(d); };
export const pagesLabel = (n, lang = 'ar') => wirdText(lang).pagesPerDay(n);
