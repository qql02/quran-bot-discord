/**
 * The voice library (@discordjs/voice 0.19) needs Node.js 22.12+ (Discord's mandatory DAVE encryption).
 * On an older Node the bot would crash with a cryptic import/syntax error; this turns it into a clear message.
 * Dependency-free on purpose: it runs BEFORE anything else is imported.
 */
export const MIN_NODE = [22, 12, 0];

export function isSupportedNode(version) {
  const parts = String(version ?? '').replace(/^v/, '').split('.').map(n => parseInt(n, 10));
  if (parts.length < 2 || parts.some(n => Number.isNaN(n))) return false;
  for (let i = 0; i < MIN_NODE.length; i++) {
    const have = parts[i] ?? 0;
    if (have !== MIN_NODE[i]) return have > MIN_NODE[i];
  }
  return true;
}

/** @returns {string|null} a message when this Node is too old, otherwise null */
export function nodeSupportProblem(version) {
  if (isSupportedNode(version)) return null;
  return [
    `❌ Node.js ${version} is too old — this bot needs Node.js ${MIN_NODE.join('.')} or newer.`,
    `❌ إصدار Node.js الحالي (${version}) قديم — يحتاج البوت Node.js ${MIN_NODE[0]}.${MIN_NODE[1]} أو أحدث.`,
    '   Hosting panel → Startup / Settings → choose Node.js 22 (or newer), then restart.',
    '   من لوحة الاستضافة: Startup أو Settings ← اختر Node.js 22 (أو أحدث) ثم أعد التشغيل.'
  ].join('\n');
}
