/**
 * Per-server restrictions set by the owner from the dashboard — the PURE decision logic (no database, easy to test).
 *
 *   locked           "read-only" server: slash commands and panel buttons are refused, except the info commands below.
 *                    Scheduled posts (adhkar, verse of the day, wird reminders) and the reading buttons keep working.
 *   lockedUntil      optional end of the lock (ms since epoch). After it the lock simply stops applying — nothing has to run
 *                    to release it, so a restart can never leave a server locked past its time.
 *   disabledCommands slash-command names that are refused in this server.
 *   maxQueue         shorter queue limit for this server (never above the global MAX_QUEUE).
 */

// Always allowed, even in a locked server — people must still be able to learn what happened and reach the owner.
export const LOCKED_ALLOW = new Set(['help', 'guide', 'mushaf', 'stats', 'invite']);

// Buttons / modals that only read or manage the person's OWN data stay available when locked.
export const LOCKED_ALLOW_PREFIX = ['wird:', 'mushaf:', 'menu:'];

// Everything that needs the voice engine (used by the dashboard's "block voice commands" preset).
export const VOICE_COMMANDS = ['start', 'recite', 'khatma', 'live', 'memorize', 'sleep', 'hold', 'continue', 'next', 'leave', 'pull', 'volume', 'clearqueue'];

/**
 * The panel's buttons / menus do the same job as a slash command. "Disable /khatma" must also disable the khatma button,
 * otherwise the restriction is one click away from being bypassed. Keys are the `action` of a `panel:<action>[:…]` custom id.
 */
export const PANEL_ACTION_COMMANDS = Object.freeze({
  khatma: ['khatma'], fullquran: ['khatma'],
  vol_down: ['volume'], vol_up: ['volume'], vol_50: ['volume'], vol_100: ['volume'],
  stop: ['leave'],
  skip: ['next'],
  pause: ['hold'],
  play: ['continue'],
  toggle: ['hold', 'continue'],
  clearq: ['clearqueue'],
  queue_view: ['queue'],
  memorize_info: ['memorize'], mem_rep: ['memorize'], mem_go: ['memorize'],
  sleep_info: ['sleep'], sleep_set: ['sleep'],
  radio: ['live'], radio_pick: ['live'],
  pick_surah: ['recite'], fav_play: ['recite']
});
// The "more tools" select menu carries its choice in the selected value, not in the custom id.
export const PANEL_TOOL_COMMANDS = Object.freeze({ mem: ['memorize'], sleep: ['sleep'], radio: ['live'], clearq: ['clearqueue'], pull: ['pull'] });

/** The slash commands a component press is equivalent to (empty when it has no command twin). */
export function componentCommands(customId = '', values = []) {
  const [ns, action] = String(customId).split(':');
  if (ns !== 'panel') return [];
  if (action === 'tool') return PANEL_TOOL_COMMANDS[values?.[0]] ?? [];
  return PANEL_ACTION_COMMANDS[action] ?? [];
}

export const MAX_LOCK_MINUTES = 30 * 24 * 60;

const toMs = (v) => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) && t > 0 ? t : null;
};

export const normalizeRestrictions = (r) => ({
  locked: !!r?.locked,
  lockedUntil: toMs(r?.lockedUntil),
  disabledCommands: Array.isArray(r?.disabledCommands) ? r.disabledCommands.filter(x => typeof x === 'string').slice(0, 60) : [],
  maxQueue: Number.isInteger(r?.maxQueue) && r.maxQueue >= 1 ? r.maxQueue : null,
  note: typeof r?.note === 'string' ? r.note.slice(0, 200) : ''
});

/** Is the lock in force right now? (locked, and either permanent or not yet expired) */
export const isLocked = (rs, now = Date.now()) => !!rs?.locked && (!rs.lockedUntil || rs.lockedUntil > now);

/**
 * The $set patch for locking / unlocking a server. minutes = null → until the owner unlocks it.
 * @returns {{ error: string } | { patch: object, until: number|null }}
 */
export function buildLockPatch(locked, minutes = null, now = Date.now()) {
  if (typeof locked !== 'boolean') return { error: 'locked must be true or false' };
  if (!locked) return { patch: { 'restrictions.locked': false, 'restrictions.lockedUntil': null }, until: null };
  if (minutes !== null && minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_LOCK_MINUTES)) {
    return { error: `minutes must be a whole number 1-${MAX_LOCK_MINUTES} (30 days) or empty` };
  }
  const until = (minutes === null || minutes === undefined) ? null : now + minutes * 60_000;
  return { patch: { 'restrictions.locked': true, 'restrictions.lockedUntil': until === null ? null : new Date(until) }, until };
}

/**
 * @param {object} rs    normalized restrictions of the server
 * @param {{ kind: 'command'|'autocomplete'|'component', name?: string, customId?: string }} what
 * @returns {null | 'locked' | 'disabled'}  why it is refused, or null when allowed
 */
export function blockedBy(rs, { kind, name = '', customId = '', values = [], now = Date.now() }) {
  if (!rs) return null;
  if (kind === 'command' || kind === 'autocomplete') {
    if (rs.disabledCommands.includes(name)) return 'disabled';
    if (isLocked(rs, now) && !LOCKED_ALLOW.has(name)) return 'locked';
    return null;
  }
  if (kind === 'component' && componentCommands(customId, values).some(c => rs.disabledCommands.includes(c))) return 'disabled';
  if (kind === 'component' && isLocked(rs, now) && !LOCKED_ALLOW_PREFIX.some(p => customId.startsWith(p))) return 'locked';
  return null;
}
