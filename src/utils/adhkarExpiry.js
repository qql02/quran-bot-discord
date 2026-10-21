/**
 * Morning / evening adhkar delete themselves some hours after they were posted. Pure helpers (no Discord, no database).
 *
 * The to-do list lives in the database (adhkar.pendingDelete), not in timers: a restart, a crash or a day offline loses nothing —
 * the next sweep deletes whatever is overdue.
 */
export const DEFAULT_EXPIRY_HOURS = 2;
export const EXPIRY_CHOICES = [2, 1, 3, 6, 12, 0];     // the order the panel button cycles through (0 = keep the posts)
export const MAX_PENDING = 20;                         // entries kept per server (2 a day → 10 days of backlog is already abnormal)
export const MAX_TRIES = 5;                            // a delete that keeps failing for a reason that is not permanent is dropped after this

/** Hours for this server. A server that never chose (old document, no field) gets the default. */
export function expiryHoursOf(adhkar) {
  const v = adhkar?.deleteAfterHours;
  return Number.isFinite(v) && v >= 0 && v <= 24 ? v : DEFAULT_EXPIRY_HOURS;
}

/** The next value of the panel button. */
export function nextExpiryChoice(current) {
  const i = EXPIRY_CHOICES.indexOf(current);
  return EXPIRY_CHOICES[(i + 1) % EXPIRY_CHOICES.length];
}

export function expiryLabel(hours) {
  if (!hours) return 'متوقف';
  if (hours === 1) return 'بعد ساعة';
  if (hours === 2) return 'بعد ساعتين';
  return hours <= 10 ? `بعد ${hours} ساعات` : `بعد ${hours} ساعة`;
}

/** The to-do entry for a post that just went out, or null when nothing should be scheduled. */
export function buildExpiry(adhkar, channelId, ids, now = Date.now()) {
  const hours = expiryHoursOf(adhkar);
  if (!hours || !channelId || !Array.isArray(ids) || !ids.length) return null;
  return { channelId, ids: ids.map(String), deleteAt: new Date(now + hours * 3_600_000), tries: 0 };
}

/** Discord errors that mean "this will never work" (message already gone, channel gone, no access): the entry is finished, not retried. */
export const PERMANENT_DELETE_ERRORS = new Set([10003, 10008, 50001, 50013, 10004, 10015]);
export const isPermanentDeleteError = (err) => PERMANENT_DELETE_ERRORS.has(err?.code);
