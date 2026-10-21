/**
 * One place for every emoji the wird feature shows.
 *
 * To use your own designs: upload them as APPLICATION emojis (Developer Portal → your app → Emojis) — these work in
 * every server AND in DMs (wird reminders arrive in DMs). Then paste the markup below, e.g.
 *     done: '<:done:123456789012345678>'        (animated: '<a:done:123456789012345678>')
 * A key left out of CUSTOM falls back to the plain Unicode emoji in DEFAULT. Set a key to '' in CUSTOM to show none.
 * Server emojis from another server will NOT render for members who are not in that server.
 */
export const CUSTOM = {
  // quran:    '<:quran:ID>',
  // reminder: '<:reminder:ID>',
  // done:     '<:done:ID>',
};

export const DEFAULT = {
  quran: '📖', read: '📖', reminder: '⏰', done: '✅', more: '➕', plan: '📊', settings: '⚙️',
  stop: '⏸️', renew: '🔄', subscribe: '🔔', delete: '🗑️', streak: '🔥',
  next: '⬅️', prev: '➡️', jump: '🔢', pin: '📍', mushaf: '📖', khatma: '🤲', expiring: '⏳', expired: '⏳', inactive: '💤', warning: '⚠️',
  today: '📖', progress: '📊', goal: '🎯', stats: '🏆', clock: '🕒', globe: '🌍', books: '📚', guide: '💡'
};

const CUSTOM_RE = /^<(a?):(\w{2,32}):(\d{15,25})>$/;

/** The emoji text for `key` ('' when none). */
export const emoji = (key) => (Object.hasOwn(CUSTOM, key) ? CUSTOM[key] : Object.hasOwn(DEFAULT, key) ? DEFAULT[key] : '') ?? '';

/** Emoji in the shape buttons / menu options want: { id, name, animated } | { name } | null. */
export function emojiObj(key) {
  const v = emoji(key);
  if (!v) return null;
  const m = CUSTOM_RE.exec(v);
  return m ? { id: m[3], name: m[2], animated: m[1] === 'a' } : { name: v };
}

/** "<emoji> text" for titles and field names (just the text when the key has no emoji). */
export const withEmoji = (key, text) => { const v = emoji(key); return v ? `${v} ${text}` : text; };
