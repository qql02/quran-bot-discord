import { GuildSettings } from '../models/GuildSettings.js';
import { normalizeRestrictions } from './restrictionRules.js';

// One tiny cache so the check costs nothing per interaction. The dashboard calls invalidateRestrictions() on save,
// so a change applies immediately on this process; the short TTL only covers a second bot process sharing the DB.
const TTL = 60_000;
const cache = new Map();   // guildId → { value, expiresAt }

export async function getRestrictions(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const doc = await GuildSettings.findOne({ guildId }, 'restrictions').lean();
  const value = normalizeRestrictions(doc?.restrictions);
  if (cache.size > 5000) cache.clear();
  cache.set(guildId, { value, expiresAt: Date.now() + TTL });
  return value;
}

export const invalidateRestrictions = (guildId) => cache.delete(guildId);

/** Drop expired entries (called by services/memoryJanitor.js). */
export function pruneRestrictions(now = Date.now()) {
  let n = 0;
  for (const [k, v] of cache) if (now >= v.expiresAt) { cache.delete(k); n++; }
  return n;
}
