/**
 * Pure scheduling helpers for the adhkar auto-poster (no imports — unit-testable).
 *
 * A slot (morning / evening) is "due" when the guild's LOCAL clock is within CATCHUP_MINUTES after the slot
 * time and that slot has not been sent on today's local date. The window lets a restart or a slow tick
 * still deliver the post, without ever sending morning adhkar at night.
 */

export const CATCHUP_MINUTES = 120;
export const DEFAULT_TIMEZONE = 'Asia/Riyadh';
export const DEFAULT_MORNING = '06:00';
export const DEFAULT_EVENING = '17:00';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** "6:30" / "06:30" / "٠٦:٣٠" → "06:30", or null when invalid. */
export function parseTime(input) {
  const ascii = String(input ?? '').trim().replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));
  const m = TIME_RE.exec(ascii);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Building an Intl.DateTimeFormat is slow; the schedulers call localClock once per guild/user every minute.
const fmtCache = new Map();
function formatterFor(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    fmtCache.set(tz, f);
  }
  return f;
}

// Members rarely know "Africa/Algiers": they type their country or city (Arabic / English / French, typos allowed).
// The matching lives in timezoneResolver.js; it is re-exported here because every caller imports it from this file.
export { resolveTimeZone, suggestTimeZones } from './timezoneResolver.js';

/** Day of the week (0 = Sunday … 5 = Friday) of a local YYYY-MM-DD date — pure date arithmetic, no timezone involved. */
export const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Local calendar date (YYYY-MM-DD) and minutes-since-midnight in `tz` at instant `now`. */
export function localClock(tz, now = new Date()) {
  const parts = formatterFor(tz).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute'))
  };
}

/**
 * @param {{ timezone?: string, morningTime?: string, eveningTime?: string, lastMorning?: string, lastEvening?: string }} cfg
 * @returns {{ slot: 'morning'|'evening', date: string }[]}
 */
export function dueSlots(cfg, now = new Date()) {
  const tz = cfg.timezone || DEFAULT_TIMEZONE;
  const { date, minutes } = localClock(tz, now);
  const out = [];
  for (const [slot, time, last] of [
    ['morning', cfg.morningTime || DEFAULT_MORNING, cfg.lastMorning],
    ['evening', cfg.eveningTime || DEFAULT_EVENING, cfg.lastEvening]
  ]) {
    const start = toMinutes(time);
    if (minutes >= start) {
      if (minutes - start < CATCHUP_MINUTES && last !== date) out.push({ slot, date });
    } else if (minutes + 1440 - start < CATCHUP_MINUTES) {
      // Window opened yesterday evening (e.g. 23:30) and is still open after midnight → it belongs to YESTERDAY's date.
      const prev = localClock(tz, new Date(now.getTime() - 86_400_000)).date;
      if (last !== prev) out.push({ slot, date: prev });
    }
  }
  return out;
}

// ── All-day posts ─────────────────────────────────────────────────────────────────────────────────────────────────
// A short dhikr post every MIN–MAX minutes (random gap each time) inside a daily window. The times are derived from
// (guild, local date, settings) with a seeded PRNG, so a restart never reshuffles them and no per-day list is stored.

export const SCATTER_DEFAULT_FROM = '07:00';
export const SCATTER_DEFAULT_TO = '22:00';
export const SCATTER_DEFAULT_MIN_GAP = 60;
export const SCATTER_DEFAULT_MAX_GAP = 90;
export const SCATTER_LIMIT_MIN_GAP = 30;    // the shortest gap an admin can pick (minutes)
export const SCATTER_LIMIT_MAX_GAP = 360;   // the longest
export const SCATTER_MIN_WINDOW = 120;      // minutes
export const SCATTER_AVOID = 20;            // minutes kept clear around the full morning/evening posts
export const SCATTER_CATCHUP = 20;          // a missed post is dropped after this many minutes (stale, not worth posting late)

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp the stored settings to something safe (old/hand-edited documents may hold anything). Times are minutes since midnight. */
export function scatterSettings(sc = {}) {
  const num = (v, def) => (Number.isFinite(Math.trunc(Number(v))) && Math.trunc(Number(v)) > 0 ? Math.trunc(Number(v)) : def);
  const minGap = Math.min(SCATTER_LIMIT_MAX_GAP, Math.max(SCATTER_LIMIT_MIN_GAP, num(sc.minGap, SCATTER_DEFAULT_MIN_GAP)));
  const maxGap = Math.min(SCATTER_LIMIT_MAX_GAP, Math.max(minGap, num(sc.maxGap, Math.max(minGap, SCATTER_DEFAULT_MAX_GAP))));
  let from = toMinutes(parseTime(sc.from) ?? SCATTER_DEFAULT_FROM);
  let to   = toMinutes(parseTime(sc.to)   ?? SCATTER_DEFAULT_TO);
  if (to - from < SCATTER_MIN_WINDOW) { from = toMinutes(SCATTER_DEFAULT_FROM); to = toMinutes(SCATTER_DEFAULT_TO); }
  return { from, to, minGap, maxGap };
}

/**
 * Sorted minutes-since-midnight of the day's posts: the first shortly after `from`, then each next one a random
 * minGap..maxGap minutes later, until `to`. A time within SCATTER_AVOID minutes of an `avoid` time (the full
 * morning/evening posts) is dropped.
 */
export function scatterTimes({ guildId, date, from, to, minGap, maxGap, avoid = [] }) {
  const rng = mulberry32(hashSeed(`${guildId}|${date}|${from}|${to}|${minGap}|${maxGap}`));
  const out = [];
  let t = from + Math.round(rng() * Math.min(15, minGap / 2));
  while (t <= to) {
    out.push(t);
    t += minGap + Math.round(rng() * (maxGap - minGap));
  }
  return out.filter(x => !avoid.some(a => Math.abs(a - x) < SCATTER_AVOID));
}

/**
 * @param {object} adhkar  the guild's adhkar settings (timezone, morningTime, eveningTime, scatter{enabled,from,to,minGap,maxGap,day,sent})
 * @returns {{ date: string, index: number, time: number }[]}  posts that are due now and not yet sent today (time = minutes since midnight)
 */
export function dueScatter(guildId, adhkar, now = new Date()) {
  if (!adhkar?.scatter?.enabled) return [];
  const tz = adhkar.timezone || DEFAULT_TIMEZONE;
  const { date, minutes } = localClock(tz, now);
  const { from, to, minGap, maxGap } = scatterSettings(adhkar.scatter);
  const avoid = [adhkar.morningTime || DEFAULT_MORNING, adhkar.eveningTime || DEFAULT_EVENING].map(toMinutes);
  const sent = adhkar.scatter.day === date ? (adhkar.scatter.sent ?? []) : [];
  // The index is the position in the day's FULL list (before the avoid filter) — stable whatever the morning/evening times are.
  return scatterTimes({ guildId, date, from, to, minGap, maxGap }).map((time, index) => ({ date, index, time }))
    .filter(({ time }) => !avoid.some(a => Math.abs(a - time) < SCATTER_AVOID))
    .filter(({ time, index }) => minutes >= time && minutes - time < SCATTER_CATCHUP && !sent.includes(index));
}
