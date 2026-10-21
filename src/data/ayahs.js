/**
 * Verse-of-the-day references ("surah:ayah"). Only REFERENCES are stored here — the verse text and its short
 * tafsir (التفسير الميسر) are fetched from the Quran API at post time (see services/ayahService.js), so no religious
 * text is ever typed by hand into this file.
 *
 * Chosen for being short, well known and useful for a daily reminder. The list is walked in a fixed order
 * (one per local day), so every server shows the same verse on the same date.
 */
export const AYAH_REFS = [
  '2:152', '2:153', '2:186', '2:255', '2:256', '2:45', '2:155', '2:156', '2:201', '2:216', '2:261', '2:286',
  '3:8', '3:26', '3:31', '3:92', '3:103', '3:133', '3:139', '3:159', '3:173', '3:185', '3:200',
  '4:36', '4:58', '4:103', '4:135', '5:2', '5:8', '6:162', '7:23', '7:56', '7:199', '8:46',
  '9:51', '9:105', '9:128', '11:88', '11:114', '12:87', '13:11', '13:28', '14:7', '14:40', '15:9',
  '16:90', '16:97', '16:125', '16:128', '17:9', '17:23', '17:24', '18:10', '18:46', '20:14', '20:25', '20:114',
  '21:83', '21:87', '21:107', '24:35', '25:63', '25:74', '26:80', '28:24', '29:45', '29:69',
  '30:21', '31:17', '33:21', '33:41', '33:56', '33:70', '39:9', '39:10', '39:53', '40:60', '41:33', '41:34',
  '49:10', '49:13', '51:56', '55:13', '59:22', '59:24', '64:11', '64:16', '65:2', '65:3', '65:7', '66:8',
  '67:2', '93:5', '94:5', '94:6', '103:3', '112:1'
];

export const DEFAULT_AYAH_TIME = '08:00';
const DAY_MS = 86_400_000;

/** YYYY-MM-DD → whole days since 1970-01-01 (pure date arithmetic). */
function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** The reference for a local date. Same date → same verse everywhere; consecutive days never repeat. */
export function ayahRefForDate(date) {
  return AYAH_REFS[((dayNumber(date) % AYAH_REFS.length) + AYAH_REFS.length) % AYAH_REFS.length];
}

/** "2:255" → { surah: 2, ayah: 255 } or null. */
export function parseRef(ref) {
  const m = /^(\d{1,3}):(\d{1,3})$/.exec(String(ref));
  if (!m) return null;
  const surah = Number(m[1]); const ayah = Number(m[2]);
  return surah >= 1 && surah <= 114 && ayah >= 1 ? { surah, ayah } : null;
}

/**
 * Due-check for the verse-of-the-day post (same rule as the adhkar slots): the guild's LOCAL clock is within
 * `catchupMinutes` after the post time and today's local date was not posted yet. Handles a window that opened
 * before midnight and is still open after it (belongs to YESTERDAY's date).
 * @param {{ time?: string, lastDate?: string|null }} cfg
 * @param {(now: Date) => { date: string, minutes: number }} clockAt  local clock of the guild at an instant
 * @returns {string|null} the local date to post for, or null
 */
export function ayahDueDate(cfg, clockAt, now = new Date(), catchupMinutes = 120) {
  const [h, m] = String(cfg.time || '08:00').split(':').map(Number);
  const start = h * 60 + m;
  const { date, minutes } = clockAt(now);
  if (minutes >= start) {
    return minutes - start < catchupMinutes && cfg.lastDate !== date ? date : null;
  }
  if (minutes + 1440 - start < catchupMinutes) {
    const prev = clockAt(new Date(now.getTime() - DAY_MS)).date;
    return cfg.lastDate !== prev ? prev : null;
  }
  return null;
}
