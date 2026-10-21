/**
 * The ONE place that decides the order of the slash commands (by category, same order as /help).
 * A new command that is not listed is placed after these, alphabetically — and test/commandOrder.test.js fails,
 * so it cannot be forgotten.
 */
export const COMMAND_ORDER = [
  // 🎧 the player panel · 🎙️ /recite + playback controls · ⚙️ the server settings panel · ℹ️ the member menu · 🧹 DM cleanup · 🛠 owner
  'start', 'recite', 'khatma', 'live', 'memorize', 'sleep', 'hold', 'continue', 'next', 'leave', 'pull', 'volume', 'now', 'queue', 'clearqueue', 'mushaf', 'azkar', 'journey', 'hadith', 'hijri', 'stats', 'invite', 'setup', 'help', 'guide', 'cleardm', 'owner'
];

const rank = (name) => { const i = COMMAND_ORDER.indexOf(name); return i === -1 ? COMMAND_ORDER.length : i; };

/** Stable: listed commands in COMMAND_ORDER, then unlisted ones A→Z. Works on JSON bodies or builders' toJSON(). */
export const sortCommands = (cmds) =>
  [...cmds].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
