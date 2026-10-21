/**
 * Pure helpers for admin-scheduled religious events (no discord.js, no Mongo — unit-testable).
 */
import { ayahDueDate } from '../data/ayahs.js';
import { addDays, daysBetween } from './wird.js';

export const MAX_EVENTS_PER_GUILD = 25;
export const MAX_SPAN_DAYS = 100;
export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 1000;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const TODAY_WORDS = new Set(['اليوم', 'today']);

/**
 * "2027-02-08", "٢٠٢٧/٢/٨", "اليوم" → "YYYY-MM-DD" (a real calendar date), or null.
 * `today` is the guild-local date, used only for the word "اليوم" / "today".
 */
export function parseDate(input, today = null) {
  const raw = String(input ?? '').trim().replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));
  if (today && TODAY_WORDS.has(raw.toLowerCase())) return today;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;   // 2027-02-30 → null
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** @returns {string|null} an Arabic error message, or null when the range is fine */
export function validateRange(start, end, today) {
  if (start < today) return 'تاريخ البداية يجب أن يكون اليوم أو بعده.';
  if (end < start) return 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.';
  if (daysBetween(start, end) + 1 > MAX_SPAN_DAYS) return `أقصى مدة للفعالية ${MAX_SPAN_DAYS} يوماً.`;
  if (daysBetween(today, start) > 400) return 'تاريخ البداية بعيد جداً (أقصاه 400 يوم من اليوم).';
  return null;
}

/**
 * The local date this event should be posted for right now, or null. Same catch-up window as the verse of the day,
 * but only inside [startDate, endDate].
 * @param {{ time: string, lastDate?: string|null, startDate: string, endDate: string }} ev
 * @param {(now: Date) => { date: string, minutes: number }} clockAt
 */
export function eventDueDate(ev, clockAt, now = new Date()) {
  const date = ayahDueDate({ time: ev.time, lastDate: ev.lastDate }, clockAt, now);
  return date && date >= ev.startDate && date <= ev.endDate ? date : null;
}

/** "Day 3 of 30" for a date inside the event's range. */
export function dayOfEvent(ev, date) {
  return { day: daysBetween(ev.startDate, date) + 1, total: daysBetween(ev.startDate, ev.endDate) + 1 };
}

/** 'upcoming' | 'running' | 'finished' | 'paused' on a guild-local date. */
export function eventState(ev, today) {
  if (ev.endDate < today) return 'finished';
  if (!ev.enabled) return 'paused';
  return ev.startDate > today ? 'upcoming' : 'running';
}

/** The short id members of staff type into /events remove (last 6 hex chars of the Mongo id). */
export const shortId = (id) => String(id).slice(-6).toLowerCase();

export { addDays };
