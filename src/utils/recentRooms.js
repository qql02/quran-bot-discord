/**
 * The last voice room each member LEFT, remembered for a few minutes. /pull uses it to know which recitation a member means when
 * several are running ("the room you just came from"), so most of the time no option has to be typed. Memory only, bounded.
 */
const TTL_MS = 15 * 60 * 1000;
const MAX    = 5000;
const KEEP   = 4;               // rooms remembered per member
const left   = new Map();   // `${guildId}:${userId}` → [{ channelId, at, stayMs }, …] newest first (stayMs = how long they were in it; null = unknown)
const joined = new Map();   // `${guildId}:${userId}` → { channelId, at } — the room they are in now, and since when
/** Someone who only walked through a room for a moment was not "listening" there: /pull ignores stays shorter than this. */
export const MIN_STAY_MS = 15_000;

export function rememberJoinedRoom(guildId, userId, channelId, now = Date.now()) {
  if (!guildId || !userId || !channelId) return;
  const key = `${guildId}:${userId}`;
  joined.delete(key);
  joined.set(key, { channelId, at: now });
  if (joined.size > MAX) for (const k of joined.keys()) { joined.delete(k); if (joined.size <= MAX * 0.9) break; }
}

export function rememberLeftRoom(guildId, userId, channelId, now = Date.now()) {
  if (!guildId || !userId || !channelId) return;
  const key = `${guildId}:${userId}`;
  const list = (left.get(key) ?? []).filter(r => r.channelId !== channelId && now - r.at <= TTL_MS);
  const was = joined.get(key);                             // when did they come into this room? (unknown after a restart → null)
  joined.delete(key);
  const stayMs = was && was.channelId === channelId ? Math.max(0, now - was.at) : null;
  left.delete(key);                                        // re-insert → Map order stays "oldest first"
  left.set(key, [{ channelId, at: now, stayMs }, ...list].slice(0, KEEP));
  if (left.size > MAX) for (const k of left.keys()) { left.delete(k); if (left.size <= MAX * 0.9) break; }
}

/** The rooms the member left in the last 15 minutes, newest first (moving A → C → B passes through C, but A still counts). */
export function recentLeftRooms(guildId, userId, now = Date.now(), { minStayMs = 0 } = {}) {
  return (left.get(`${guildId}:${userId}`) ?? [])
    .filter(r => now - r.at <= TTL_MS && (r.stayMs === null || r.stayMs === undefined || r.stayMs >= minStayMs))   // unknown stay → benefit of the doubt
    .map(r => r.channelId);
}

export const _clearRecentRooms = () => { left.clear(); joined.clear(); };   // tests
