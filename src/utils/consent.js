/**
 * Two-step consent for actions on a member's own data (sending a copy of it, deleting it).
 * Step 1 shows what will happen and records the request; step 2 only counts if that request is still fresh.
 * Single-use, per member and per action, in memory only: a restart simply means "ask again".
 */
export const CONSENT_TTL_MS = 2 * 60_000;
const MAX_PENDING = 5000;

export function createConsent({ ttlMs = CONSENT_TTL_MS, now = () => Date.now() } = {}) {
  const pending = new Map();   // `${userId}:${action}` → expiry
  const key = (u, a) => `${u}:${a}`;
  const sweep = () => { const t = now(); for (const [k, exp] of pending) if (exp <= t) pending.delete(k); };
  return {
    /** Record that the member was shown the request for `action`. */
    ask(userId, action) {
      sweep();
      if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
      pending.set(key(userId, action), now() + ttlMs);
    },
    /** True exactly once per `ask`, and only while it is fresh. */
    take(userId, action) {
      const k = key(userId, action);
      const exp = pending.get(k);
      pending.delete(k);
      return exp !== undefined && exp > now();
    },
    get size() { return pending.size; }
  };
}
