/**
 * Pure logic for the daily wird / khatma tracker (no discord.js, no Mongo — unit-testable).
 *
 * Model: the Madani mushaf has 604 pages. A member picks "N pages a day"; `currentPage` is the LAST page they
 * finished (0 = not started). Reaching page 604 completes a khatma, the counter wraps to 0 and `khatmaCount` grows.
 * Dates are the member's LOCAL calendar dates (YYYY-MM-DD) so streaks follow their own midnight.
 */
import { localClock, toMinutes, dueSlots, weekdayOf, CATCHUP_MINUTES, DEFAULT_TIMEZONE } from './adhkarSchedule.js';

export const TOTAL_PAGES = 604;
export const SUBSCRIPTION_DAYS = 30;     // one "month" of free subscription
export const RENEW_WARN_DAYS = 3;        // warn this many days before it lapses
export const DEFAULT_PAGES = 2;
export const DEFAULT_REMIND_TIME = '20:00';
export const MAX_PAGES_PER_DAY = 100;
export const PAGE_PRESETS = [1, 2, 5, 10, 20];      // 20 pages ≈ one juz → a khatma every 30 days

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const DAY_MS = 86_400_000;

/** "٢" / " 5 " → 2 / 5, or null when it is not a whole number in [1, max]. */
export function parsePages(input, max = MAX_PAGES_PER_DAY) {
  const ascii = String(input ?? '').trim().replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));
  if (!/^\d{1,4}$/.test(ascii)) return null;
  const n = Number(ascii);
  return n >= 1 && n <= max ? n : null;
}

/** Duration goals offered to members: a khatma in one, two or three months. */
export const GOAL_OPTIONS = [15, 30, 60, 90, 180];

export const MIN_GOAL_DAYS = 7;       // 604 pages / 100 pages a day → 7 days is the shortest realistic khatma
export const MAX_GOAL_DAYS = 365;

/** "45" / "٤٥" → 45 when it is a whole number of days in [MIN_GOAL_DAYS, MAX_GOAL_DAYS], else null. */
export function parseGoalDays(input) {
  const n = parsePages(input, MAX_GOAL_DAYS);
  return n !== null && n >= MIN_GOAL_DAYS ? n : null;
}

/** Days the rest of the khatma really takes at `pagesPerDay` (never more than the goal period it was derived from). */
export const daysAtPace = (currentPage, pagesPerDay) => daysToKhatma(currentPage, pagesPerDay);

/** YYYY-MM-DD + n days (pure date arithmetic, no timezone involved). */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Previous calendar date of a YYYY-MM-DD string (pure date arithmetic, no timezone involved). */
export function prevDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - DAY_MS).toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / DAY_MS);
}

/** The pages to read next: { from, to } or null when currentPage already is the last page. */
export function todayPortion(currentPage, pagesPerDay) {
  const cur = Math.max(0, Math.min(TOTAL_PAGES, Math.trunc(currentPage) || 0));
  if (cur >= TOTAL_PAGES) return null;
  return { from: cur + 1, to: Math.min(TOTAL_PAGES, cur + Math.max(1, pagesPerDay)) };
}

/** Days still needed to finish the current khatma at this pace. */
export function daysToKhatma(currentPage, pagesPerDay) {
  const left = TOTAL_PAGES - Math.max(0, Math.min(TOTAL_PAGES, currentPage));
  return Math.ceil(left / Math.max(1, pagesPerDay));
}

/** Days a full khatma takes at this pace (e.g. 2 pages/day → 302). */
export function khatmaLength(pagesPerDay) {
  return Math.ceil(TOTAL_PAGES / Math.max(1, pagesPerDay));
}

/** Pages per day needed to finish the rest of the khatma in `days` days (never above MAX_PAGES_PER_DAY). */
export function pagesForGoal(currentPage, days) {
  const left = TOTAL_PAGES - Math.max(0, Math.min(TOTAL_PAGES, Math.trunc(currentPage) || 0));
  return Math.min(MAX_PAGES_PER_DAY, Math.max(1, Math.ceil(left / Math.max(1, Math.trunc(days) || 1))));
}

/** Deadline (inclusive, local date) for a goal of `days` days that starts today. */
export const goalDeadlineFrom = (today, days) => addDays(today, days - 1);

/**
 * Where the member stands against their goal, or null when they have none.
 * `needed` = pages per day required from today on to finish by the deadline.
 * @returns {{ deadline: string, daysLeft: number, needed: number, overdue: boolean, onTrack: boolean } | null}
 */
export function goalStatus(sub, today) {
  if (!sub.goalDeadline) return null;
  const daysLeft = daysBetween(today, sub.goalDeadline) + 1;      // today is still a reading day
  if (daysLeft <= 0) return { deadline: sub.goalDeadline, daysLeft: 0, needed: 0, overdue: true, onTrack: false };
  const needed = Math.ceil((TOTAL_PAGES - Math.max(0, Math.min(TOTAL_PAGES, sub.currentPage ?? 0))) / daysLeft);
  return { deadline: sub.goalDeadline, daysLeft, needed, overdue: false, onTrack: needed <= (sub.pagesPerDay ?? DEFAULT_PAGES) };
}

/** Juz (1–30) a mushaf page belongs to — Madani juz boundaries. */
const JUZ_START = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];
/** First page of a juz (1–30), or null when out of range. */
export const juzStartPage = (juz) => (Number.isInteger(juz) && juz >= 1 && juz <= 30 ? JUZ_START[juz - 1] : null);

export function juzAtPage(page) {
  let juz = 1;
  for (let i = 0; i < JUZ_START.length; i++) if (page >= JUZ_START[i]) juz = i + 1;
  return juz;
}

/** The surah that is open on a page, given the SURAHS table (each with .page = its first page and .arabic). */
export function surahAtPage(page, surahs) {
  let found = surahs[0];
  for (const s of surahs) if (s.page <= page) found = s; else break;
  return found;
}

/** ▰▰▰▱▱▱▱▱▱▱ */
export function progressBar(fraction, length = 12) {
  const f = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(f * length);
  return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

export const percent = (currentPage) => Math.floor((Math.max(0, Math.min(TOTAL_PAGES, currentPage)) / TOTAL_PAGES) * 100);

/**
 * Streak as it should be DISPLAYED on `today`: alive only if the last completed day is today or yesterday.
 */
export function liveStreak(sub, today) {
  if (!sub.lastReadDate) return 0;
  return sub.lastReadDate === today || sub.lastReadDate === prevDate(today) ? (sub.streak ?? 0) : 0;
}

/** Pages already logged on `today` (the per-day counter resets by itself when the date changes). */
export const pagesToday = (sub, today) => (sub.dayDate === today ? (sub.dayPages ?? 0) : 0);

/**
 * Daily logging ceiling (MAX_PAGES_PER_DAY): one tap can never fake a whole khatma.
 * @returns {number} how many of `pages` may still be logged today (0 = the ceiling is reached)
 */
export function clampToDailyLimit(sub, today, pages) {
  const room = MAX_PAGES_PER_DAY - pagesToday(sub, today);
  return Math.max(0, Math.min(Math.trunc(pages) || 0, room));
}

/**
 * Log `pages` read on local date `today`. Pure: returns the new field values, never mutates `sub`.
 *
 * - dayPages accumulates per local day; the day COUNTS (streak +1) the first time it reaches pagesPerDay.
 * - reaching page 604 completes a khatma: currentPage wraps to 0, khatmaCount +1, `completedKhatma` is true.
 * - pages that would run past the end are dropped (a khatma never "overflows" into the next one).
 *
 * @returns {{ set: object, added: number, completedKhatma: boolean, dayDone: boolean, newlyDone: boolean }}
 */
export function applyReading(sub, pages, today) {
  const cur      = Math.max(0, Math.min(TOTAL_PAGES, sub.currentPage ?? 0));
  const room     = TOTAL_PAGES - cur;
  const added    = Math.max(0, Math.min(Math.trunc(pages) || 0, room));
  const dayPages = pagesToday(sub, today) + added;
  const wasDone  = sub.lastReadDate === today;
  // Finishing the khatma counts as a completed day even when fewer pages than the daily goal were left
  // (otherwise the last page of a khatma would break the streak and the member would be reminded again the same day).
  const finishes = added > 0 && cur + added >= TOTAL_PAGES;
  const dayDone  = wasDone || dayPages >= (sub.pagesPerDay ?? DEFAULT_PAGES) || finishes;
  const newlyDone = dayDone && !wasDone;

  let streak = sub.streak ?? 0;
  let lastReadDate = sub.lastReadDate ?? null;
  if (newlyDone) {
    streak = lastReadDate === prevDate(today) ? streak + 1 : 1;
    lastReadDate = today;
  }

  let currentPage = cur + added;
  let khatmaCount = sub.khatmaCount ?? 0;
  const completedKhatma = added > 0 && currentPage >= TOTAL_PAGES;
  if (completedKhatma) { khatmaCount += 1; currentPage = 0; }

  return {
    added, completedKhatma, dayDone, newlyDone,
    set: {
      currentPage,
      khatmaCount,
      totalPagesRead: (sub.totalPagesRead ?? 0) + added,
      dayDate: today,
      dayPages,
      streak,
      bestStreak: Math.max(sub.bestStreak ?? 0, streak),
      lastReadDate
    }
  };
}

// ── Monthly (free) subscription ──────────────────────────────────────────────────────────────────────────────────

/** Expiry for a (re)subscription or an activity-based extension: SUBSCRIPTION_DAYS from `now` (never stacks up). */
export const nextExpiry = (now = new Date()) => new Date(now.getTime() + SUBSCRIPTION_DAYS * DAY_MS);

/**
 * The subscription is a hard limit: it never extends by itself (reading does NOT renew it) — the member renews with
 * one tap. On top of that, reminders pause when nothing was logged for this many days, so the bot never keeps
 * messaging someone who stopped reading.
 */
export const INACTIVITY_PAUSE_DAYS = 7;

/**
 * Last moment of member activity, in ms: the (re)subscription — which is always `expiresAt - SUBSCRIPTION_DAYS`
 * because the subscription only ever changes through subscribe / renew — or the last day they logged pages.
 */
export function lastActivity(sub) {
  const renewedAt = sub.expiresAt ? new Date(sub.expiresAt).getTime() - SUBSCRIPTION_DAYS * DAY_MS : 0;
  const day = (d) => (d ? Date.parse(`${d}T12:00:00Z`) : 0);
  return Math.max(renewedAt || 0, day(sub.lastReadDate), (sub.dayPages ?? 0) > 0 ? day(sub.dayDate) : 0);
}

/** True when the member has been silent for INACTIVITY_PAUSE_DAYS or more. */
export const isInactive = (sub, now = new Date()) => now.getTime() - lastActivity(sub) >= INACTIVITY_PAUSE_DAYS * DAY_MS;

/** 'expired' | 'expiring' (≤ RENEW_WARN_DAYS left) | 'active' */
export function subscriptionState(expiresAt, now = new Date()) {
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) return 'expired';
  return left <= RENEW_WARN_DAYS * DAY_MS ? 'expiring' : 'active';
}

export const daysLeft = (expiresAt, now = new Date()) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS));

// ── Varied reminder times ────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Varied" mode (the default for new members): the reminder moves between the morning, the afternoon (asr) and the
 * evening from one day to the next, at a different minute for every member. Nobody gets two reminders in the same part
 * of the day two days running, and the whole membership is spread over the day instead of all landing at once.
 * Deterministic (same member + same date → same time), so restarts and several processes agree without any storage.
 * Every slot ends before 21:30 so the catch-up window never crosses midnight.
 */
export const VARIED_WINDOWS = [
  { name: 'morning', from: '07:30', span: 150 },     // 07:30 – 09:59
  { name: 'asr',     from: '15:30', span: 120 },     // 15:30 – 17:29
  { name: 'evening', from: '19:30', span: 120 }      // 19:30 – 21:29
];

/** FNV-1a, 32-bit: small, stable, no dependencies. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The member's reminder time (HH:MM, their local clock) on local date `date` in varied mode. */
export function variedTime(userId, date) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  const w   = VARIED_WINDOWS[(hash32(String(userId)) + day) % VARIED_WINDOWS.length];   // rotates every day
  const m   = toMinutes(w.from) + (hash32(`${userId}:${date}`) % w.span);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const isVaried = (sub) => sub.remindMode === 'varied';

/** Reminder time for `date`: the varied time, or the fixed time the member chose. */
export const reminderTimeFor = (sub, date) => (isVaried(sub) ? variedTime(sub.userId, date) : (sub.remindTime || DEFAULT_REMIND_TIME));

// ── Personal adhkar (DMs) ────────────────────────────────────────────────────────────────────────────────────────

export const hasPersonalAdhkar = (sub) => Boolean(sub.adhkarMorning || sub.adhkarEvening);

/** Morning / evening sets due now on the member's own clock, only the ones they switched on and not yet sent that day. */
export function personalAdhkarDue(sub, now = new Date()) {
  if (!hasPersonalAdhkar(sub)) return [];
  return dueSlots({ timezone: sub.timezone, lastMorning: sub.lastAdhkarMorning, lastEvening: sub.lastAdhkarEvening }, now)
    .filter(({ slot }) => (slot === 'morning' ? sub.adhkarMorning : sub.adhkarEvening));
}

// ── Friday ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const KAHF_PAGES = [293, 304];               // Surah Al-Kahf in the Madani mushaf (it starts on 293, Maryam on 305)
/** Is the member's local date `date` (YYYY-MM-DD) a Friday? */
export const isFriday = (date) => weekdayOf(date) === 5;

// ── Reminder scheduling ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Is the daily reminder due now? Same rule as the adhkar posts: the member's LOCAL clock is within
 * CATCHUP_MINUTES after their reminder time, and they were not reminded for this local date yet.
 * Members who already finished today's wird are not nagged.
 * @returns {{ date: string } | null}
 */
export function reminderDue(sub, now = new Date()) {
  const { date, minutes } = localClock(sub.timezone || DEFAULT_TIMEZONE, now);
  const start = toMinutes(reminderTimeFor(sub, date));
  if (minutes < start || minutes - start >= CATCHUP_MINUTES) return null;
  if (sub.lastRemindedDate === date) return null;
  if (sub.lastReadDate === date) return null;     // already read today
  return { date };
}
