/**
 * Crash-loop protection for `uncaughtException`.
 *
 * A single stray exception is logged and the bot keeps running (one bad interaction shouldn't drop every
 * voice session). But if exceptions keep coming — `limit` within `windowMs` — the process state can't be
 * trusted any more, so we ask the caller to exit and let the host start a clean process.
 *
 *   const guard = createCrashGuard();
 *   process.on('uncaughtException', () => { if (guard.record()) process.exit(1); });
 */
export function createCrashGuard({ limit = 5, windowMs = 60_000, now = Date.now } = {}) {
  const stamps = [];
  return {
    /** Record one exception. @returns {boolean} true when the process should exit. */
    record() {
      const t = now();
      stamps.push(t);
      while (stamps.length && t - stamps[0] > windowMs) stamps.shift();
      return stamps.length >= limit;
    },
    get count() { return stamps.length; },
  };
}
