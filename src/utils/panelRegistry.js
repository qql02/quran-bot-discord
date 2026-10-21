import { PermissionFlagsBits } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { getSession } from '../managers/sessionManager.js';
import { buildPanelMessage, isPanelCard, surahPageOf } from './panel.js';
import { logger } from './logger.js';
import { loadReciterChoice } from '../services/reciterPrefs.js';
import { SessionSnapshot } from '../models/SessionSnapshot.js';

/**
 * ONE control panel per server. Every place that creates a panel (/start, /panel, /recite, /live, the voice-join
 * follow-up) hands the new message to adoptPanel(), which deletes the previous panel first — so the channel never fills
 * up with old panels. Memory only: after a restart the old panel simply stays where it is (and can still be used).
 */
const panels = new Map();   // guildId → { channelId, messageId }

/**
 * A panel nobody started anything from (the bot never joined) would stay in the room forever. After this long without a
 * session it is deleted, like the panel of a bot that left. A panel of a running session is never touched.
 */
export const IDLE_PANEL_MS = 30 * 60 * 1000;
const idleTimers = new Map();   // guildId → Timeout

const clearIdleTimer = (guildId) => { const t = idleTimers.get(guildId); if (t) { clearTimeout(t); idleTimers.delete(guildId); } };

/** The timer's job (exported for tests): delete the panel `messageId` of this server if it is still the panel and still idle. */
export async function cleanupIdlePanel(client, guildId, messageId) {
  idleTimers.delete(guildId);
  const ref = panels.get(guildId);
  if (!ref || ref.messageId !== messageId || getSession(guildId)) return false;
  panels.delete(guildId);
  try {
    const ch = client?.channels?.cache?.get(ref.channelId) ?? await client?.channels?.fetch?.(ref.channelId).catch(() => null);
    await ch?.messages?.delete(ref.messageId);
  } catch (err) { logger.debug?.(`[${guildId}] Idle panel delete skipped: ${err.message}`); }
  return true;
}

function scheduleIdleCleanup(client, guildId, messageId) {
  clearIdleTimer(guildId);
  const t = setTimeout(() => { void cleanupIdlePanel(client, guildId, messageId); }, IDLE_PANEL_MS);
  t.unref?.();
  idleTimers.set(guildId, t);
}

/** Make `message` THE panel of its server: delete the previous one (if it is a different message) and remember this one. */
export async function adoptPanel(client, guildId, message) {
  const prev = panels.get(guildId);
  if (prev && prev.messageId !== message.id) {
    try {
      const ch = client?.channels?.cache?.get(prev.channelId) ?? await client?.channels?.fetch?.(prev.channelId).catch(() => null);
      await ch?.messages?.delete(prev.messageId);
    }
    catch (err) { logger.debug?.(`[${guildId}] Old panel delete skipped: ${err.message}`); }
  }
  panels.set(guildId, { channelId: message.channelId, messageId: message.id });
  const session = getSession(guildId);
  if (!session) scheduleIdleCleanup(client, guildId, message.id); else clearIdleTimer(guildId);
  if (session) {
    session.panelMessage = { channelId: message.channelId, messageId: message.id };
    SessionSnapshot.save(session).catch(() => {});   // so the panel survives a restart (no-op while nothing is playing)
  }
}

/** After a restart: the restored session takes over the panel it had before, instead of leaving it orphaned. */
export function restorePanel(guildId, session, channelId, messageId) {
  if (!channelId || !messageId || !session) return;
  panels.set(guildId, { channelId, messageId });
  session.panelMessage = { channelId, messageId };
}

/**
 * Re-draw the server's panel after something was started from a private (ephemeral) screen such as the tools card:
 * those screens are not the panel, so the panel has to be found and edited from here. Best effort, never throws.
 */
export async function syncPanel(client, guildId) {
  try {
    await ensuring.get(guildId);   // an automatic panel being sent right now is THE panel: do not report "none" and post a second one
    const ref = panels.get(guildId);
    if (!ref) return false;
    const session = getSession(guildId);
    if (session) session.panelMessage = { channelId: ref.channelId, messageId: ref.messageId };
    const ch  = client?.channels?.cache?.get(ref.channelId) ?? await client?.channels?.fetch?.(ref.channelId).catch(() => null);
    const msg = await ch?.messages?.fetch?.(ref.messageId).catch(() => null);
    if (!msg || !isPanelCard(msg)) return false;          // an old embed panel cannot become a card: leave it alone
    const lang = await GuildSettings.getLanguage(guildId);
    await msg.edit(buildPanelMessage(session ?? null, lang, guildId, surahPageOf(msg)));   // keep the surah menu on its page
    return true;
  } catch (err) {
    logger.debug?.(`[${guildId}] Panel sync skipped: ${err.message}`);
    return false;
  }
}

/** Drop the remembered panel of a server (its message was deleted because the bot left voice). */
export function forgetPanel(guildId) { panels.delete(guildId); clearIdleTimer(guildId); }

// ─── Automatic panel: every playback gets one ──────────────────────────────────────────────────────────────────
// Whatever started the recitation (a command, a panel button, the dashboard, a hand-over to the second bot, a restart recovery),
// the room gets its control panel — and it goes away with the bot (destroySession). Called by the session manager the moment
// something starts playing and when a listener comes back to a room whose panel was removed while it was empty.
const ensuring = new Map();   // guildId → Promise: one automatic panel per server at a time

/**
 * Make sure the live session of `guildId` has its control panel. Does nothing when it already has one, when the bot cannot
 * write in the voice room's chat, or when there is no session. Best effort, never throws.
 * @returns {Promise<boolean>} true when the session has a panel afterwards
 */
export function ensurePanel(client, guildId) {
  const running = ensuring.get(guildId);
  if (running) return running;
  const p = (async () => {
    try {
      const session = getSession(guildId);
      if (!session || !client) return false;
      const ref = panels.get(guildId);
      if (session.panelMessage) return true;
      if (ref) {                                    // a panel exists (idle one from /start, or restored): the session takes it over
        session.panelMessage = { channelId: ref.channelId, messageId: ref.messageId };
        clearIdleTimer(guildId);
        return true;
      }
      const guild = client.guilds?.cache?.get(guildId);
      const voice = guild?.channels?.cache?.get(session.voiceChannelId);
      if (!guild || !voice) return false;
      const sent = await sendVoicePanel(client, guild, voice, null);
      // The session may have ended while the message was being sent: do not leave a panel behind.
      if (sent && getSession(guildId) !== session) {
        await sent.message.delete().catch(() => {});
        forgetPanel(guildId);
        return false;
      }
      return !!sent;
    } catch (err) {
      logger.debug?.(`[${guildId}] Automatic panel skipped: ${err.message}`);
      return false;
    }
  })().finally(() => ensuring.delete(guildId));
  ensuring.set(guildId, p);
  return p;
}

/** Periodic cleanup (see services/memoryJanitor.js): people who ran /start and never joined a room must not pile up. */
export function pruneWaiting(now = Date.now()) {
  let n = 0;
  for (const [k, v] of waiting) if (now - v.at > WAIT_MS) { waiting.delete(k); n++; }
  return n;
}

/**
 * Send the panel into a voice channel's own chat (falls back to `fallbackChannel` when the bot may not write there),
 * and make it the server's only panel.
 * @returns {Promise<{ message: object, channel: object } | null>}
 */
export async function sendVoicePanel(client, guild, voiceChannel, fallbackChannel = null) {
  const lang    = await GuildSettings.getLanguage(guild.id);
  await loadReciterChoice(guild.id);
  const payload = buildPanelMessage(getSession(guild.id), lang, guild.id);
  const me      = guild.members.me;
  const canWrite = (ch) => !!ch && ch.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

  for (const channel of [voiceChannel, fallbackChannel]) {
    if (!canWrite(channel)) continue;
    try {
      const message = await channel.send(payload);
      await adoptPanel(client, guild.id, message);
      return { message, channel };
    } catch (err) {
      logger.warn(`[${guild.id}] Panel send to #${channel.name} failed: ${err.message}`);
    }
  }
  return null;
}

// ─── "/start while not in voice": wait for the person to join, then send the panel there ──────────────────────
const WAIT_MS = 10 * 60 * 1000;
const waiting = new Map();   // `${guildId}:${userId}` → { at, textChannelId }

export const waitForVoiceJoin = (guildId, userId, textChannelId) => {
  const now = Date.now();
  for (const [k, v] of waiting) if (now - v.at > WAIT_MS) waiting.delete(k);   // people who never joined must not pile up forever
  waiting.set(`${guildId}:${userId}`, { at: now, textChannelId });
};

/** Called when a member joins a voice channel. Sends the panel if that member ran /start in the last 10 minutes. */
export async function onVoiceJoin(newState, client) {
  const key = `${newState.guild.id}:${newState.id}`;
  const entry = waiting.get(key);
  if (!entry) return false;
  waiting.delete(key);
  if (Date.now() - entry.at > WAIT_MS || !newState.channel) return false;
  const live = getSession(newState.guild.id);
  if (live && live.voiceChannelId !== newState.channel.id) return false;   // the bot is reciting in another room: never replace its panel
  const fallback = newState.guild.channels.cache.get(entry.textChannelId) ?? null;
  return !!(await sendVoicePanel(client, newState.guild, newState.channel, fallback));
}
