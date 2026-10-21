import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Sibling bots — several bots (different tokens, same code, ONE MongoDB) serving the same server, each in its own voice room.
 *
 *  • Every bot publishes a heartbeat: which servers it is in and which voice channel it is reciting in.
 *  • When a member asks a busy bot for a recitation, `busyAdvice` answers with the sibling that can really help
 *    (one that is in this server and free) instead of a blind mention.
 *
 * Deliberately has no static imports of mongoose / the model / the session manager: the session manager only calls
 * `notifySessionsChanged()`, and the database is touched lazily, so this file is cheap to load and safe in tests.
 */

const HEARTBEAT_MS = 15_000;
const ALIVE_MS     = 90_000;    // a sibling silent for longer than this is treated as offline
const DB_TIMEOUT   = 1_500;     // a slow database must never block a member's command
const DEBOUNCE_MS  = 400;

let client = null;
let getSessions = () => [];
let timer = null;
let debounce = null;
let stopped = true;

const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), DB_TIMEOUT))]);

async function model() {
  const { default: mongoose } = await import('mongoose');
  if (mongoose.connection.readyState !== 1) return null;   // not connected → behave as "no siblings"
  return (await import('../models/BotInstance.js')).BotInstance;
}

async function publish() {
  if (stopped || !client?.user) return;
  try {
    const BotInstance = await model();
    if (!BotInstance) return;
    const sessions = getSessions()
      .filter(s => s?.guildId && s?.voiceChannelId)
      .map(s => ({
        guildId: s.guildId, channelId: s.voiceChannelId, channelName: s.channelName ?? '',
        status: s.status ?? 'idle', surah: s.current?.surah?.english ?? null, surahAr: s.current?.surah?.arabic ?? null,
        reciter: s.current?.reciter ?? null, queueSize: s.queue?.length ?? 0, loop: !!s.loop, fullQuran: !!s.fullQuran, volume: s.volume ?? 100
      }));
    await withTimeout(BotInstance.updateOne(
      { _id: client.user.id },
      { $set: { tag: client.user.tag, role: config.bot.role, guildIds: [...client.guilds.cache.keys()], sessions, lastSeen: new Date() } },
      { upsert: true }
    ));
  } catch (err) {
    logger.warn(`[Siblings] heartbeat failed: ${err.message}`);
  }
}

/** Publish right now (the worker calls it after executing a dashboard command, so the owner sees the new state at once). */
export const publishNow = () => publish();

/** Sessions of the live voice-only bots, with what the dashboard shows. Never throws. → [{ botId, botTag, guildId, channelId, channelName, status, … }] */
export async function getWorkerSessions(now = Date.now()) {
  try {
    const BotInstance = await model();
    if (!BotInstance || !client?.user) return [];
    const docs = await withTimeout(BotInstance.find({ _id: { $ne: client.user.id }, role: 'secondary', lastSeen: { $gt: new Date(now - ALIVE_MS) } }).lean());
    return docs.flatMap(d => (d.sessions ?? []).map(s => ({ ...s, botId: d._id, botTag: d.tag ?? d._id })));
  } catch {
    return [];
  }
}

/** Called by the session manager whenever a session starts, ends or moves. Cheap: coalesced into one write. */
export function notifySessionsChanged() {
  if (stopped) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => { void publish(); }, DEBOUNCE_MS);
  debounce.unref?.();
}

export function startSiblingSync(discordClient, sessionsFn) {
  client = discordClient;
  getSessions = sessionsFn ?? getSessions;
  stopped = false;
  void publish();
  timer = setInterval(() => { void publish(); }, HEARTBEAT_MS);
  timer.unref?.();
}

/** Shutdown: disappear from the registry so siblings stop pointing people at a bot that is going away. */
export async function stopSiblingSync() {
  stopped = true;
  clearInterval(timer);
  clearTimeout(debounce);
  try {
    const BotInstance = await model();
    if (BotInstance && client?.user) await withTimeout(BotInstance.deleteOne({ _id: client.user.id }));
  } catch { /* best effort */ }
}

/** Live sibling bots that are in this server: [{ id, busyChannelId|null, busyChannelName }]. Never throws. */
export async function getSiblings(guildId, now = Date.now()) {
  if (!client?.user) return [];                      // sibling sync not started (tests, tools): no database round-trip at all
  try {
    const BotInstance = await model();
    if (!BotInstance) return [];
    const docs = await withTimeout(BotInstance.find({
      _id: { $ne: client.user.id },
      guildIds: guildId,
      lastSeen: { $gt: new Date(now - ALIVE_MS) }
    }).lean());
    return docs.map(d => {
      const s = (d.sessions ?? []).find(x => x.guildId === guildId);
      return { id: d._id, role: d.role ?? 'primary', busyChannelId: s?.channelId ?? null, busyChannelName: s?.channelName ?? '' };
    });
  } catch {
    return [];
  }
}

/**
 * Is another bot of this database still a member of the server? Used before a departing bot deletes the server's shared data:
 * liveness is NOT checked on purpose (a sibling that restarts for two minutes is still in the server), and when the database
 * cannot answer the result is `true` — an uncertain "yes" only skips a cleanup, an uncertain "no" would destroy data.
 */
export async function siblingStillInGuild(guildId) {
  try {
    const BotInstance = await model();
    if (!BotInstance || !client?.user) return true;
    return !!(await withTimeout(BotInstance.exists({ _id: { $ne: client.user.id }, guildIds: guildId })));
  } catch {
    return true;
  }
}

/**
 * Pure decision for the PRIMARY bot (the one with the slash commands): which voice-only sibling should take this member's request?
 *   here → a secondary is already reciting in the member's room: it gets the request (queue / change)
 *   free → an idle secondary in the server: it joins the member's room
 *   null → nobody can take it (then the normal "busy" advice applies)
 * Only siblings with role 'secondary' qualify: they have no commands, so telling a member to "use <@bot>" would be a dead end.
 */
export function pickDelegate(siblings, userChannelId) {
  const workers = (siblings ?? []).filter(s => s.role === 'secondary');
  const here = userChannelId && workers.find(s => s.busyChannelId === userChannelId);
  if (here) return { id: here.id, kind: 'here' };
  const free = workers.find(s => !s.busyChannelId);
  return free ? { id: free.id, kind: 'free' } : null;
}

/**
 * Two Quran bots must never stay in the same voice room. When it happens anyway (both joined at the same moment), exactly ONE yields,
 * decided the same way on both sides: the voice-only bot gives way to the main bot; between equal roles the higher ID gives way.
 */
export function shouldYield(me, other) {
  if (me.role !== other.role) return me.role === 'secondary';
  return String(me.id) > String(other.id);
}

/**
 * Pure decision: what should a member who asked THIS bot (which cannot serve them) be told?
 *   sibling_here → a sibling is already reciting in the member's own room: use it
 *   sibling_free → a sibling is in the server and idle: use it
 *   all_busy     → siblings exist but every one is reciting elsewhere
 *   none         → no sibling known (caller falls back to its normal message)
 * `fallbackId` (ALT_BOT_ID) is only used when the registry knows nothing — it keeps the old behaviour.
 */
export function pickAdvice(siblings, userChannelId, fallbackId = null) {
  const here = userChannelId && siblings.find(s => s.busyChannelId === userChannelId);
  if (here) return { kind: 'sibling_here', bot: here.id };
  const free = siblings.find(s => !s.busyChannelId);
  if (free) return { kind: 'sibling_free', bot: free.id };
  if (siblings.length) return { kind: 'all_busy', bots: siblings.map(s => s.id) };
  if (fallbackId) return { kind: 'sibling_free', bot: fallbackId };
  return { kind: 'none' };
}

const KEYS = { sibling_here: 'errors.busy_sibling_here', sibling_free: 'errors.busy_use_other', all_busy: 'errors.busy_all_busy' };

/** → { key, vars } for i18n, or null when there is nothing useful to add. */
export async function busyAdvice(guildId, userChannelId) {
  const a = pickAdvice(await getSiblings(guildId), userChannelId, config.bot.altBotId ?? null);
  if (a.kind === 'none') return null;
  return { key: KEYS[a.kind], vars: { bot: a.bot ? `<@${a.bot}>` : '', bots: (a.bots ?? []).map(id => `<@${id}>`).join(' ') } };
}

/**
 * Every voice-only bot the registry knows (online or not), newest first. For the "add the second bot" page: it needs the bot's
 * ID (= client ID) to build an invite link, and to tell a bot that is in the server from one that is merely running.
 * → [{ id, tag, alive, guildIds }]. Never throws.
 */
export async function getSecondaryBots(now = Date.now()) {
  try {
    const BotInstance = await model();
    if (!BotInstance || !client?.user) return [];
    const docs = await withTimeout(BotInstance.find({ _id: { $ne: client.user.id }, role: 'secondary' }).sort({ lastSeen: -1 }).limit(10).lean());
    return docs.map(d => ({ id: String(d._id), tag: d.tag || null, alive: !!d.lastSeen && now - new Date(d.lastSeen).getTime() <= ALIVE_MS, guildIds: d.guildIds ?? [] }));
  } catch {
    return [];
  }
}
