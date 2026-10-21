import { GuildPlayer }          from '../services/audioService.js';
import { logger }               from '../utils/logger.js';
import { Statistics }           from '../models/Statistics.js';
import { SessionSnapshot }      from '../models/SessionSnapshot.js';
import { getPlayableUrls }      from '../services/quranService.js';
import { getSurahByNumber }     from '../data/surahs.js';
import { config } from '../config.js';
import { getControlSync } from '../services/controlService.js';
import { t } from '../utils/i18n.js';
import { UserError } from '../utils/errors.js';
import { notifySessionsChanged, getSiblings, shouldYield } from '../services/siblingService.js';

// While something plays, its position is saved every 30 s, so even a crash (no clean shutdown) resumes close to where it was.
const POSITION_SAVE_MS = 30_000;
setInterval(() => {
  for (const s of sessions.values()) if (s.status === 'playing' && s.current && !s.current.isRadio) saveSnapshot(s).catch(() => {});
}, POSITION_SAVE_MS).unref?.();

// ─── Session Map ───────────────────────────────────────────────────────────────
const sessions = new Map();

// Snapshot writes of one server run strictly one after another. They used to be fired without waiting, so a save started just
// before a stop could land AFTER the remove (both are upserts / deletes on different pooled connections) and bring a stopped
// session back after a restart.
const _snapQueue = new Map();
function snapEnqueue(guildId, fn) {
  const next = (_snapQueue.get(guildId) ?? Promise.resolve()).catch(() => {}).then(fn);
  _snapQueue.set(guildId, next);
  next.catch(() => {}).finally(() => { if (_snapQueue.get(guildId) === next) _snapQueue.delete(guildId); });
  return next;
}
/** Save the session's snapshot — skipped when the session is no longer the live one by the time its turn comes. */
const saveSnapshot = (session) => snapEnqueue(session.guildId, () => (sessions.get(session.guildId) === session ? SessionSnapshot.save(session) : undefined));
const removeSnapshot = (guildId) => snapEnqueue(guildId, () => SessionSnapshot.remove(guildId));

const AUTO_LEAVE_MS   = config.session.autoLeaveMs;
const PAUSED_LEAVE_MS = config.session.pausedLeaveMs;
export const MAX_SESSIONS = config.session.maxSessions;   // RAM guard: each live stream costs 10–50MB
export const MAX_QUEUE = config.session.maxQueue;
/** The queue limit that applies to a server right now: the global cap, the owner's global cap, and the server's own (shorter) cap. */
export const queueLimit = (session) => Math.min(MAX_QUEUE, getControlSync().maxQueue ?? MAX_QUEUE, session?.queueCap ?? MAX_QUEUE);   // per guild — stops anyone in the channel from queueing without limit

// ─── Session Shape ─────────────────────────────────────────────────────────────
function createSession(guildId, voiceChannelId, channelName, ownerId) {
  return {
    guildId,
    voiceChannelId,
    channelName,
    ownerId,
    player:         null,   // GuildPlayer (local ffmpeg + @discordjs/voice)
    queue:          [],
    current:        null,
    status:         'idle',
    loop:           false,
    fullQuran:      false,
    volume:         100,
    language:       'en',
    panelMessage:   null,
    sleepTimer:     null,
    autoLeaveTimer: null,
    pullGraceUntil: null,   // the last listener moved to ANOTHER room: do not leave before this time, so /pull can still reach the recitation
    memorize:       null,
    radio:          null,   // FIX: active radio station object — must be in shape for consistent access
    _client:        null
  };
}

// ─── Getters ───────────────────────────────────────────────────────────────────
export function getSession(guildId)  { return sessions.get(guildId) ?? null; }
export function hasSession(guildId)  { return sessions.has(guildId); }
export function getAllSessions()     { return [...sessions.values()]; }

// ─── Auto-Leave Timers ─────────────────────────────────────────────────────────
// FIX Bug #3: exported so voiceStateUpdate can start the timer when channel empties
const EMPTY_LEAVE_MS = config.session.emptyLeaveMs;

/** True when no human is left in the bot's voice channel (bots do not count as listeners). */
function isChannelEmpty(session) {
  const ch = session?._client?.guilds?.cache?.get(session.guildId)?.channels?.cache?.get(session.voiceChannelId);
  return ch?.members ? !ch.members.some(m => !m.user.bot) : false;
}

/**
 * @param {{ empty?: boolean, graceMs?: number }} [opts]  `empty: true` = "the room has no listeners" timer. That kind is replaced by the
 *        normal idle/paused timer as soon as someone comes back (see onListenerArrived); an idle/paused timer is not.
 *        `graceMs`: the last listener only moved to ANOTHER voice room — keep the bot that long (never less than the empty-room limit)
 *        so they can /pull the recitation to them.
 */
export function startAutoLeaveTimer(guildId, ms = AUTO_LEAVE_MS, { empty = false, graceMs = 0 } = {}) {
  const session = getSession(guildId);
  if (!session) return;
  clearAutoLeaveTimer(guildId);
  // Nobody is listening → never wait longer than the empty-room limit, whatever the reason for the timer
  // (queue finished, paused, restored after a restart…).
  if (graceMs > 0) session.pullGraceUntil = Date.now() + graceMs;
  const nobodyHere = empty || isChannelEmpty(session);
  if (nobodyHere) {
    // The pull window is remembered on the session: a surah ending (or any other restart of this timer) during it must not cut it short.
    const graceLeft = Math.max(graceMs, (session.pullGraceUntil ?? 0) - Date.now());
    ms = Math.min(ms, Math.max(EMPTY_LEAVE_MS, graceLeft));
    if (graceLeft > ms) ms = graceLeft;
  }
  session.autoLeaveKind = nobodyHere ? 'empty' : 'state';
  session.autoLeaveTimer = setTimeout(async () => {
    logger.info(`[${guildId}] Auto-leave fired — destroying session`);
    await notifyLeave(guildId, 'idle');
    await destroySession(guildId);
  }, ms);
}

export function clearAutoLeaveTimer(guildId) {
  const session = getSession(guildId);
  if (!session?.autoLeaveTimer) return;
  clearTimeout(session.autoLeaveTimer);
  session.autoLeaveTimer = null;
  session.autoLeaveKind  = null;
}

/**
 * A listener entered the bot's room. If the pending leave timer was the "room is empty" one, it no longer applies:
 *   playing → no timer needed;  idle → back to the normal idle timer;  paused → back to the paused timer.
 * An idle/paused timer that was already running keeps its original deadline (joining must not extend it, otherwise an
 * idle bot never leaves while anyone is in the room and keeps hogging one of the limited session slots).
 */
export function onListenerArrived(guildId) {
  const session = getSession(guildId);
  if (session) session.pullGraceUntil = null;          // someone is here again: the pull window no longer applies
  if (session && !session.panelMessage) autoPanel(guildId);   // the panel was removed while the room was empty: bring it back
  if (!session?.autoLeaveTimer || session.autoLeaveKind !== 'empty') return;
  clearAutoLeaveTimer(guildId);
  if (session.status === 'idle')        startAutoLeaveTimer(guildId);
  else if (session.status === 'paused') startAutoLeaveTimer(guildId, PAUSED_LEAVE_MS);
}

// ─── "Why did the bot leave?" notice ───────────────────────────────────────────
// Without this the bot just vanishes from the voice channel and people think it crashed.
async function notifyLeave(guildId, kind) {
  const session = getSession(guildId);
  const client  = session?._client;
  const channelId = session?.panelMessage?.channelId ?? session?.textChannelId;
  if (!client || !channelId) return;
  try {
    // Nothing is ever left behind in the voice room's own chat: a leave notice goes to a normal text channel only.
    if (channelId === session.voiceChannelId) return;
    const channel = client.channels.cache.get(channelId);
    const me = channel?.guild?.members?.me;
    if (!channel?.isTextBased?.() || !me || !channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) return;
    const key = kind === 'sleep' ? 'misc.left_sleep' : kind === 'radio' ? 'misc.radio_lost' : 'misc.left_idle';
    const content = t(session.language, key);
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch { /* notice is best-effort */ }
}

// ─── Automatic control panel ───────────────────────────────────────────────────
// Every playback — started by a command, a panel button, the dashboard, the second bot or a restart recovery — has a control
// panel in the voice room's chat. It is created here, the moment something plays (or a listener comes back to a room whose panel
// was removed while it was empty), and deleted with the session (removePanelOf in destroySession). Registry is loaded on demand:
// panelRegistry imports this file.
function autoPanel(guildId) {
  const session = getSession(guildId);
  if (!session?._client || session.panelMessage) return;
  import('../utils/panelRegistry.js')
    .then(m => m.ensurePanel(session._client, guildId))
    .then(ok => { if (ok) refreshPanel(guildId, session._client).catch(() => {}); })
    .catch(() => {});
}

// ─── Panel Refresh ─────────────────────────────────────────────────────────────
async function refreshPanel(guildId, client) {
  const session = getSession(guildId);
  if (!session?.panelMessage || !client) return;
  await _doRefreshPanel(guildId, session, client);
}

/** Delete the control-panel message of `session` (best-effort) and forget it, so nothing stale stays in the channel. */
async function removePanelOf(guildId, session) {
  const ref    = session?.panelMessage;
  const client = session?._client;
  if (!ref || !client) return;
  session.panelMessage = null;
  try {
    // Not in the cache (e.g. after a sweep) → fetch it, otherwise the panel would stay behind.
    const channel = client.channels?.cache?.get(ref.channelId) ?? await client.channels?.fetch?.(ref.channelId).catch(() => null);
    await channel?.messages?.delete(ref.messageId);
  } catch (err) {
    logger.debug?.(`[${guildId}] Panel delete skipped: ${err.message}`);
  }
  try { (await import('../utils/panelRegistry.js')).forgetPanel(guildId); } catch { /* registry is optional */ }
}

/**
 * Delete EVERYTHING this bot wrote in the voice room's chat (panel, command replies, notices, leftovers from before a restart).
 * Called when the bot leaves, so nothing stays behind. Only its own messages are touched. Best effort, never throws.
 * @returns {Promise<number>} how many messages were deleted
 */
export async function sweepOwnMessages(session) {
  const client = session?._client;
  if (!client?.user || !session.voiceChannelId) return 0;
  try {
    const ch = client.channels?.cache?.get(session.voiceChannelId) ?? await client.channels?.fetch?.(session.voiceChannelId).catch(() => null);
    if (!ch?.messages?.fetch) return 0;
    const me = ch.guild?.members?.me;
    if (me && !ch.permissionsFor?.(me)?.has(['ViewChannel', 'ReadMessageHistory'])) return 0;
    const batch = await ch.messages.fetch({ limit: 100 });
    const mine = [...batch.values()].filter(m => m.author?.id === client.user.id);
    const done = await Promise.allSettled(mine.map(m => m.delete()));
    return done.filter(r => r.status === 'fulfilled').length;
  } catch (err) {
    logger.debug?.(`[${session.guildId}] Voice-chat sweep skipped: ${err.message}`);
    return 0;
  }
}

export async function deletePanel(guildId) {
  await removePanelOf(guildId, getSession(guildId));
}

// FIX Bug #4: Internal helper that accepts a session object directly.
// destroySession removes the session from the Map before refreshing the panel,
// so getSession() returns null — making the standard refreshPanel a no-op.
// This variant bypasses the Map lookup using the already-captured session ref.
async function _doRefreshPanel(guildId, session, client) {
  if (!session?.panelMessage || !client) return;
  try {
    const { buildPanelEmbed }   = await import('../utils/embeds.js');
    const { buildPanelButtons } = await import('../utils/buttons.js');
    const { buildPanelMessage, isPanelCard, surahPageOf } = await import('../utils/panel.js');
    const guild   = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(session.panelMessage.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(session.panelMessage.messageId).catch(() => null);
    if (!message) return;
    // A panel sent before the card design existed is still an embed message: Discord cannot turn it into a card.
    const payload = isPanelCard(message)
      ? buildPanelMessage(session, session.language, guildId, surahPageOf(message))
      : { embeds: [buildPanelEmbed(session, session.language)], components: buildPanelButtons(session, session.language) };
    await message.edit(payload).catch(() => {});
  } catch (err) {
    logger.warn(`[${guildId}] Panel refresh failed: ${err.message}`);
  }
}

// ─── Per-guild join lock — prevents two simultaneous /recite calls from both
// calling joinVoiceChannel on the same guild, which causes ghost sessions.
const _joiningLock = new Set();

// ─── Create & Join ─────────────────────────────────────────────────────────────
export async function createAndJoin(guild, voiceChannel, ownerId, lang = 'en', client = null) {
  // Another bot is already in that voice channel (a music bot, say) → refuse and say why, so the Quran is never played
  // over music. The person is asked to remove that bot from the channel (or use another channel) and try again.
  if (config.session.leaveForOtherBots) {
    const myId = guild.members?.me?.id ?? client?.user?.id ?? guild.client?.user?.id;
    const others = [...(voiceChannel.members?.values?.() ?? [])].filter(m => m.user?.bot && m.id !== myId);
    if (others.length) {
      logger.warn(`[${guild.id}] Join refused — other bot(s) in #${voiceChannel.name}: ${others.map(m => m.user.tag ?? m.id).join(', ')}`);
      throw new UserError('other_bot_in_voice', { bots: others.map(m => `<@${m.id}>`).join(' '), channel: `<#${voiceChannel.id}>` });
    }
  }
  // Replacing a guild's own session doesn't add load; a NEW guild session is refused once the cap is reached.
  if (!sessions.has(guild.id) && sessions.size >= MAX_SESSIONS) {
    logger.warn(`[${guild.id}] Session refused — ${sessions.size}/${MAX_SESSIONS} sessions already active`);
    throw Object.assign(new Error('Bot is at capacity'), { code: 'CAPACITY' });
  }
  // If a join is already in progress for this guild, wait for it to finish (max ~5s) and then decide:
  //   • it succeeded and bot is in the caller's channel → share that session
  //   • it succeeded in ANOTHER channel                  → refuse (never move the bot / inject tracks into it)
  //   • it failed (no session)                           → try the join ourselves instead of failing for nothing
  //   • it is still busy after 5s                        → refuse
  // Refusals are UserErrors: the person just needs to retry in a moment, that is not a bug to report.
  if (_joiningLock.has(guild.id)) {
    logger.warn(`[${guild.id}] createAndJoin called while join already in progress — waiting`);
    for (let i = 0; i < 10 && _joiningLock.has(guild.id); i++) await new Promise(r => setTimeout(r, 500));
    if (_joiningLock.has(guild.id)) throw new UserError('join_in_progress');
    const existing = getSession(guild.id);
    if (existing) {
      if (existing.voiceChannelId !== voiceChannel.id) throw new UserError('join_in_progress');
      return existing;
    }
  }

  _joiningLock.add(guild.id);
  try {
    return await _createAndJoinInner(guild, voiceChannel, ownerId, lang, client);
  } finally {
    _joiningLock.delete(guild.id);
  }
}

async function _createAndJoinInner(guild, voiceChannel, ownerId, lang = 'en', client = null) {
  // Never two Quran bots in one room: refuse if the other bot is already there (known from the registry or visible in the room)…
  const sibs = await getSiblings(guild.id);
  const there = sibs.find(s => s.busyChannelId === voiceChannel.id || voiceChannel.members?.has?.(s.id));
  if (there) throw new UserError('busy_sibling_here', { bot: `<@${there.id}>` });

  await destroySession(guild.id);

  const player = new GuildPlayer(guild, voiceChannel);
  await player.connect();   // throws if the voice channel cannot be joined

  // …and if both joined at the same instant, exactly one of them gives way (the same rule runs on both sides).
  const meId = guild.members?.me?.id ?? client?.user?.id ?? guild.client?.user?.id;
  const rival = (await getSiblings(guild.id)).find(s => voiceChannel.members?.has?.(s.id));
  if (rival && shouldYield({ id: meId, role: config.bot.role }, rival)) {
    try { await player.destroy(); } catch { /* leaving anyway */ }
    throw new UserError('busy_sibling_here', { bot: `<@${rival.id}>` });
  }

  const session      = createSession(guild.id, voiceChannel.id, voiceChannel.name, ownerId);
  session.language   = lang;
  session._client    = client;
  session.player     = player;
  sessions.set(guild.id, session);
  notifySessionsChanged();   // sibling bots learn which room this bot is now in

  // ── Player event listeners ──────────────────────────────────────────────────
  // 'end' fires only when a track finishes on its own. stop()/replace are silent,
  // so skipSession() can advance manually without a double playNext.
  player.on('end', () => onTrackEnd(guild.id));

  // Playback error in the middle of a track → move on.
  player.on('exception', (data) => {
    const msg = data?.exception?.message ?? JSON.stringify(data);
    logger.error(`[${guild.id}] Track exception:`, msg);
    if (guild.client?._pushActivity) {
      guild.client._pushActivity('error',
        `خطأ تشغيل: ${getSession(guild.id)?.current?.surah?.arabic ?? 'Unknown'}`,
        `السبب: ${msg}`
      );
    }
    onTrackEnd(guild.id);
  });

  // No audio data for too long (network stall) → skip.
  player.on('stuck', (data) => {
    const threshold = data?.thresholdMs ?? '?';
    logger.warn(`[${guild.id}] Track stuck (${threshold}ms) — skipping`);
    if (guild.client?._pushActivity) {
      guild.client._pushActivity('error',
        `المسار توقف (stuck): ${getSession(guild.id)?.current?.surah?.arabic ?? 'Unknown'}`,
        `توقف لأكثر من ${threshold}ms`
      );
    }
    onTrackEnd(guild.id);
  });

  // Voice connection is gone for good (kicked / channel deleted / Discord dropped us).
  player.on('closed', (data) => {
    const code   = Number(data?.code ?? 0);
    const reason = data?.reason ?? 'no reason';
    logger.warn(`[${guild.id}] Voice connection closed [${code}] ${reason}`);
    if (guild.client?._pushActivity) {
      guild.client._pushActivity('error',
        `اتصال الصوت انقطع: ${guild.name ?? guild.id}`,
        `Code: ${code} | ${reason}`
      );
    }
    destroySession(guild.id).catch(() => {});
  });

  player.setVolume(session.volume);

  Statistics.increment(guild.id, { totalSessions: 1 }).catch(() => {});
  logger.success(`[${guild.id}] Session created → #${voiceChannel.name}`);
  return session;
} // end _createAndJoinInner

// ─── Playback ──────────────────────────────────────────────────────────────────
// FIX Bug #10: Per-guild lock to prevent concurrent playNext calls.
// Race condition: skip button calls onTrackEnd manually, but if the player
// 'end' event fires at nearly the same time (timing edge case), two playNext
// calls could run simultaneously — causing duplicate plays or skipped surahs.
// guildId → the token of the playNext() call that owns the lock. A call may only release a lock it still owns: the memorize delay
// lets go of the lock on purpose, another playNext() can take it meanwhile, and the first call's `finally` must not delete THAT one.
const _playingLock = new Map();

export async function playNext(guildId, _skipCount = 0) {
  const token = Symbol('playNext');
  // Someone asked for a surah: that replaces the radio, otherwise a pending reconnect would cut the recitation off.
  if (_skipCount === 0) cancelRadio(getSession(guildId));
  // Only apply lock on fresh calls (skipCount=0). Recursive retry calls
  // from the same chain are safe — they already hold the lock context.
  if (_skipCount === 0) {
    if (_playingLock.has(guildId)) {
      logger.warn(`[${guildId}] playNext skipped — already in progress`);
      return;
    }
    _playingLock.set(guildId, token);
  }

  let skipRequested = false;
  try {
    await _playNextInner(guildId, _skipCount);
  } finally {
    if (_skipCount === 0) {
      if (_playingLock.get(guildId) === token) _playingLock.delete(guildId);   // never release somebody else's lock
      // A skip arrived while this track was still loading (see skipSession): honour it now that the load is over.
      // (If another call holds the lock, that call will honour it — consuming it here would only get it dropped.)
      const sess = getSession(guildId);
      if (!_playingLock.has(guildId) && sess?.skipPending) { sess.skipPending = false; skipRequested = true; }
    }
  }
  if (skipRequested) return playNext(guildId);
}

/** Full-Quran mode picks "current surah + 1". When a surah fails to load, `current` is still the previous one,
 *  so the retry would pick the SAME surah 20 times and stop the whole khatma. Move the cursor past the failure. */
function skipPast(session, item) {
  if (session.fullQuran && session.current && item?.surah) session.current = { ...session.current, surah: item.surah, startedAt: null };
}

async function _playNextInner(guildId, _skipCount = 0) {
  const session = getSession(guildId);
  if (!session) return;

  if (_skipCount >= 20) {
    logger.error(`[${guildId}] playNext: too many consecutive failures — aborting`);
    session.status  = 'idle';
    session.current = null;
    session.loop    = false;
    refreshPanel(guildId, session._client).catch(() => {});
    startAutoLeaveTimer(guildId);
    if (session._client?._pushActivity) {
      session._client._pushActivity('error',
        `فشل التشغيل المتكرر: ${guildId}`,
        `فشلت 20 محاولة متتالية — تم إيقاف الجلسة`
      );
    }
    return;
  }

  clearAutoLeaveTimer(guildId);
  // A new track must not cancel a pending "room is empty" countdown (it used to: a surah ending in an empty room
  // cleared the timer and the bot kept reciting to nobody).
  if (isChannelEmpty(session)) startAutoLeaveTimer(guildId, EMPTY_LEAVE_MS);

  // ── Pick next item ──────────────────────────────────────────────────────────
  let item = null;

  if (session.loop && session.current) {
    item = {
      surah:      session.current.surah,
      reciter:    session.current.reciter,
      reciterObj: session.current.reciterObj,
      riwaya:     session.current.riwaya
    };
  } else if (session.queue.length > 0) {
    item = session.queue.shift();
  } else if (session.fullQuran && session.current) {
    const nextNum = session.current.surah.number + 1;
    if (nextNum <= 114) {
      item = {
        surah:      getSurahByNumber(nextNum),
        reciter:    session.current.reciter,
        reciterObj: session.current.reciterObj,
        riwaya:     session.current.riwaya
      };
    } else {
      // Al-Nas was the last surah: the khatma is complete. Switch the mode off, otherwise the next single surah anyone
      // plays would silently continue into a brand-new khatma (surah+1, +2, …).
      session.fullQuran = false;
    }
  } else if (session.memorize && session.current) {
    const mem = session.memorize;
    if (mem.currentRep < mem.repeatCount - 1) {
      mem.currentRep += 1;
      if (mem.delayMs > 0) {
        // FIX: Release the lock BEFORE sleeping so /next can interrupt the delay.
        // Re-check session after the delay — it may have been destroyed or skipped.
        const owner = _playingLock.get(guildId);
        _playingLock.delete(guildId);
        await new Promise(r => setTimeout(r, mem.delayMs));
        // If session was destroyed or skip was called during the delay, abort.
        // FIX Bug: also check freshSession.memorize — skipSession sets currentRep=repeatCount,
        // then onTrackEnd→playNext runs and sets session.memorize=null when reps exhausted.
        // If memorize is null here it means skip already advanced; continuing would
        // re-play whatever surah is now current instead of aborting cleanly.
        const freshSession = getSession(guildId);
        if (!freshSession || !freshSession.memorize || freshSession.status !== 'playing') return;
        // Re-acquire lock before continuing
        if (_playingLock.has(guildId)) return; // another playNext already running (its lock is not ours to release)
        if (owner) _playingLock.set(guildId, owner);   // take it back under the SAME owner so the outer call's finally still matches
      }
      if (!getSession(guildId)) return;
      item = {
        surah:      session.current.surah,
        reciter:    session.current.reciter,
        reciterObj: session.current.reciterObj
      };
    } else {
      session.memorize = null;
    }
  }

  if (!item) {
    session.status  = 'idle';
    session.current = null;
    // FIX: clear end_of_track sentinel — the timer has now fired (queue exhausted).
    // Without this, the panel would keep showing '😴 Sleep Timer' after going idle.
    if (session.sleepTimer === 'end_of_track') session.sleepTimer = null;
    logger.info(`[${guildId}] Queue exhausted — session idle`);
    refreshPanel(guildId, session._client).catch(() => {});
    startAutoLeaveTimer(guildId);
    return;
  }

  // ── Resolve URL & play ──────────────────────────────────────────────────────
  try {
    // Get ALL candidate URLs (moshaf variants) for this surah — tries primary moshaf first.
    let candidates = await getPlayableUrls(item.reciterObj, item.surah.number);
    // A recitation handed over from another room/bot: the recording it was playing comes first, so the position still matches.
    if (item.preferUrl) candidates = [...candidates.filter(c => c.url === item.preferUrl), ...candidates.filter(c => c.url !== item.preferUrl)];
    const startMs = Number.isFinite(item.startMs) && item.startMs > 0 ? Math.floor(item.startMs) : 0;
    if (!candidates.length) {
      logger.warn(`[${guildId}] No URL candidates for surah ${item.surah.number} — skipping`);
      skipPast(session, item);
      return _playNextInner(guildId, _skipCount + 1);
    }

    let chosenCandidate = null;

    for (const candidate of candidates) {
      try {
        // play() resolves once audio data is flowing, rejects if the URL can't be loaded.
        await session.player.play(candidate.url, startMs ? { startMs } : undefined);
        chosenCandidate = candidate;
        break;
      } catch (loadErr) {
        if (loadErr.message === 'superseded') return; // a newer play/skip took over
        if (loadErr.message === 'seek-past-end') {
          // The handed-over position is at (or past) the end of this recording: the surah was effectively finished.
          // Carry on with whatever comes after it instead of replaying the surah from the start.
          logger.info(`[${guildId}] Resume position is past the end of surah ${item.surah.number} — moving on`);
          if (getSession(guildId) !== session) return;
          session.current = { surah: item.surah, reciter: item.reciter, reciterObj: item.reciterObj, riwaya: item.riwaya, startedAt: null };
          return _playNextInner(guildId, _skipCount + 1);
        }
        logger.warn(`[${guildId}] Could not load ${candidate.url}: ${loadErr.message} — trying next moshaf`);
        // Voice connection itself is gone → nothing else to try
        if (!session.player.isConnected()) {
          logger.error(`[${guildId}] Voice connection not ready — going idle`);
          if (session._client?._pushActivity) {
            session._client._pushActivity('error', `الاتصال الصوتي غير جاهز`, loadErr.message);
          }
          session.status  = 'idle';
          session.current = null;
          startAutoLeaveTimer(guildId);
          return;
        }
      }
    }

    // The session may have been destroyed (stop / auto-leave / kick) while the stream was loading.
    // Without this check we would write a snapshot for a dead session and "resurrect" it on the next boot.
    if (getSession(guildId) !== session) {
      session.player?.stop?.();
      return;
    }

    if (!chosenCandidate) {
      logger.warn(
        `[${guildId}] All ${candidates.length} moshaf variant(s) failed for surah` +
        ` #${item.surah.number} (${item.reciter}) — skipping`
      );
      if (session._client?._pushActivity) {
        session._client._pushActivity('error',
          `تعذّر تحميل السورة: ${item.surah.arabic ?? item.surah.english}`,
          `القارئ: ${item.reciter} | جُرِّبت ${candidates.length} رواية — تخطي`
        );
      }
      skipPast(session, item);
      return _playNextInner(guildId, _skipCount + 1);
    }

    session.status  = 'playing';
    session.current = {
      surah:      item.surah,
      reciter:    item.reciter,
      reciterObj: item.reciterObj,
      riwaya:     chosenCandidate.riwaya,
      url:        chosenCandidate.url,
      startedAt:  Date.now(),
      offsetMs:   startMs           // where in the recording this play began (0 normally; >0 after a pull) — see managers/sessionTransfer.js
    };

    logger.info(`[${guildId}] ▶ Playing: ${item.surah.english} by ${item.reciter}`);

    Statistics.increment(guildId, { totalPlayedSurahs: 1 }).catch(() => {});
    Statistics.recordReciter(guildId, item.reciter).catch(() => {});
    saveSnapshot(session).catch(() => {});
    refreshPanel(guildId, session._client).catch(() => {});
    autoPanel(guildId);   // whatever started this, the room has its control panel
    // Push play event to activity log
    if (session._client?._pushActivity) {
      session._client._pushActivity('play',
        `▶ تشغيل: ${item.surah.arabic ?? item.surah.english}`,
        `القارئ: ${item.reciter} | السيرفر: ${guildId}`
      );
    }

  } catch (err) {
    logger.error(`[${guildId}] playNext error:`, err.message);
    if (session._client?._pushActivity) {
      session._client._pushActivity('error',
        `خطأ في التشغيل: ${item?.surah?.arabic ?? guildId}`,
        `${err.message} — جاري إعادة المحاولة`
      );
    }
    skipPast(session, item);
    return _playNextInner(guildId, _skipCount + 1);
  }
}

// ─── Radio reconnect ───────────────────────────────────────────────────────────
// Live streams drop all the time (station restarts, network blips). Retry with growing delays instead of a single
// attempt; give up after the last one so a dead station never keeps the bot idling in the room forever.
const RADIO_BACKOFF_MS = [3_000, 10_000, 30_000, 60_000, 120_000];
const RADIO_STABLE_MS  = 15_000;

function clearRadioTimer(session) {
  if (session?.radioTimer) { clearTimeout(session.radioTimer); session.radioTimer = null; }
}

/** Stop any radio state: the pending reconnect, the remembered station, the failure count. */
function cancelRadio(session) {
  if (!session) return;
  clearRadioTimer(session);
  session.radio = null;
  session.radioFails = 0;
}

function scheduleRadioReconnect(guildId) {
  const session = getSession(guildId);
  if (!session?.radio) return;
  const attempt = session.radioFails ?? 0;
  if (attempt >= RADIO_BACKOFF_MS.length) return giveUpRadio(guildId, session);

  const station = session.radio;
  const delay   = RADIO_BACKOFF_MS[attempt];
  logger.info(`[${guildId}] Radio stream ended — reconnecting in ${delay / 1000}s (attempt ${attempt + 1}/${RADIO_BACKOFF_MS.length})`);
  clearRadioTimer(session);
  session.radioTimer = setTimeout(async () => {
    session.radioTimer = null;
    const stale = () => getSession(guildId) !== session || session.radio !== station;   // stopped / replaced meanwhile
    if (stale()) return;
    const ok = await _startRadioStream(guildId, station);
    if (stale() || ok) return;
    session.radioFails = (session.radioFails ?? 0) + 1;
    scheduleRadioReconnect(guildId);
  }, delay);
}

function giveUpRadio(guildId, session) {
  logger.warn(`[${guildId}] Radio reconnect failed ${RADIO_BACKOFF_MS.length} times — giving up`);
  cancelRadio(session);
  session.status  = 'idle';
  session.current = null;
  refreshPanel(guildId, session._client).catch(() => {});
  session._client?._pushActivity?.('error', `انقطع البث الإذاعي: ${guildId}`, 'فشلت إعادة الاتصال — تم الإيقاف');
  notifyLeave(guildId, 'radio').catch(() => {});
  startAutoLeaveTimer(guildId);   // nothing is playing any more → normal idle timer
}

function onTrackEnd(guildId) {
  const session = getSession(guildId);
  if (!session) return;

  if (session.current?.startedAt) {
    const secs = playedSeconds(session);
    Statistics.addPlayTime(guildId, secs).catch(() => {});
  }

  // FIX: Radio streams end when the connection drops, not when content finishes.
  // If a radio station is active, reconnect automatically instead of going idle.
  if (session.radio && session.current?.isRadio) {
    // A stream that died within seconds of starting counts as a failed attempt; one that ran for a while resets the count.
    const lasted = Date.now() - (session.current.startedAt ?? 0);
    session.radioFails = lasted < RADIO_STABLE_MS ? (session.radioFails ?? 0) + 1 : 0;
    session.status  = 'idle';
    session.current = null;
    scheduleRadioReconnect(guildId);
    return;
  }

  playNext(guildId).catch(err => {
    logger.error(`[${guildId}] onTrackEnd playNext error:`, err.message);
    const sess = getSession(guildId);
    if (sess?._client?._pushActivity) {
      sess._client._pushActivity('error',
        `خطأ بعد انتهاء المسار: ${guildId}`,
        err.message
      );
    }
  });
}

// ─── Queue Operations ──────────────────────────────────────────────────────────
/** Keep a running session in step with /language: later panel refreshes and notices use the new language. */
export function setSessionLanguage(guildId, lang) {
  const session = getSession(guildId);
  if (!session) return;
  session.language = lang;
  refreshPanel(guildId, session._client).catch(() => {});
}

/** @returns {boolean} false if there is no session or the queue is full */
export function enqueue(guildId, item) {
  const session = getSession(guildId);
  // queueCap = this server's own (shorter) limit set by the owner; it can never exceed the global MAX_QUEUE.
  if (!session || session.queue.length >= queueLimit(session)) return false;
  session.queue.push(item);
  refreshPanel(guildId, session._client).catch(() => {});   // keep the live panel's queue count accurate
  return true;
}

export function clearQueue(guildId) {
  const session = getSession(guildId);
  if (session) session.queue = [];
}

/** Dashboard queue tools. Each returns false/null when the session or the index does not exist, and refreshes the live panel. */
export function removeQueueItem(guildId, index) {
  const item = removeFromQueue(guildId, index);
  if (item) refreshPanel(guildId, getSession(guildId)?._client).catch(() => {});
  return item;
}
export function moveQueueItem(guildId, from, to) {
  const session = getSession(guildId);
  const n = session?.queue.length ?? 0;
  if (!session || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) return false;
  if (from !== to) session.queue.splice(to, 0, session.queue.splice(from, 1)[0]);
  refreshPanel(guildId, session._client).catch(() => {});
  return true;
}
export function shuffleQueue(guildId) {
  const session = getSession(guildId);
  if (!session || session.queue.length < 2) return false;
  const q = session.queue;
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  refreshPanel(guildId, session._client).catch(() => {});
  return true;
}

export function removeFromQueue(guildId, index) {
  const session = getSession(guildId);
  if (!session || index < 0 || index >= session.queue.length) return null;
  return session.queue.splice(index, 1)[0];
}

// ─── Controls ──────────────────────────────────────────────────────────────────
/** Seconds the current track has really been playing: time spent paused is not listening time. */
function playedSeconds(session) {
  const end = session.status === 'paused' && session.pausedAt ? session.pausedAt : Date.now();
  return Math.max(0, Math.floor((end - session.current.startedAt) / 1000));
}

export function pauseSession(guildId) {
  const session = getSession(guildId);
  if (!session || session.status !== 'playing') return false;
  session.player.pause();
  session.status = 'paused';
  session.pausedAt = Date.now();
  clearAutoLeaveTimer(guildId);
  startAutoLeaveTimer(guildId, PAUSED_LEAVE_MS);
  refreshPanel(guildId, session._client).catch(() => {});
  return true;
}

export function resumeSession(guildId) {
  const session = getSession(guildId);
  if (!session || session.status !== 'paused') return false;
  session.player.resume();
  session.status = 'playing';
  if (session.pausedAt && session.current?.startedAt) session.current.startedAt += Date.now() - session.pausedAt;   // the pause is not listening time
  session.pausedAt = null;
  clearAutoLeaveTimer(guildId);
  refreshPanel(guildId, session._client).catch(() => {});
  return true;
}

export function skipSession(guildId) {
  const session = getSession(guildId);
  if (!session) return false;
  session.loop = false;
  if (session.memorize) session.memorize.currentRep = session.memorize.repeatCount;
  // FIX: if a radio stream is active, clear session.radio BEFORE calling onTrackEnd.
  // Without this, onTrackEnd sees session.radio and schedules a reconnect in 3s,
  // making skip useless on radio and causing an infinite reconnect loop.
  cancelRadio(session);
  // A surah is still downloading (playNext holds the lock): stop() cannot cancel that load, and a second playNext would
  // be dropped, so the skip would be lost and the surah the user wanted to skip would start playing anyway.
  // Remember the request; playNext applies it the moment the load finishes.
  if (_playingLock.has(guildId)) { session.skipPending = true; return true; }
  session.player.stop();
  // Manually advance to next track — stop() is silent, so no duplicate 'end' event
  onTrackEnd(guildId);
  return true;
}

export function toggleLoop(guildId) {
  const session = getSession(guildId);
  if (!session) return null;
  session.loop = !session.loop;
  refreshPanel(guildId, session._client).catch(() => {});
  return session.loop;
}

export async function setVolume(guildId, vol) {
  const session = getSession(guildId);
  if (!session) return false;
  session.volume = vol;
  session.player.setVolume(vol);   // 0–150 %, applied live to the current stream
  return true;
}

// ─── Sleep Timer ───────────────────────────────────────────────────────────────
export function setSleepTimer(guildId, ms) {
  const session = getSession(guildId);
  if (!session) return false;
  if (session.sleepTimer) { clearTimeout(session.sleepTimer); session.sleepTimer = null; }
  session.sleepEndsAt = null;
  if (ms === 'end_of_track') {
    session.loop = false; session.fullQuran = false;
    session.queue = []; session.memorize = null;
    // FIX: store sentinel so panel shows timer as active and /sleep cancel works.
    // clearTimeout() safely ignores non-timer arguments, so all existing callers
    // (clearSleepTimer, destroySession, setSleepTimer itself) remain correct.
    session.sleepTimer = 'end_of_track';
    return true;
  }
  session.sleepEndsAt = Date.now() + ms;   // so a pull can re-arm the same timer in the new room
  session.sleepTimer = setTimeout(async () => {
    logger.info(`[${guildId}] Sleep timer fired`);
    await notifyLeave(guildId, 'sleep');
    await destroySession(guildId);
  }, ms);
  return true;
}

export function clearSleepTimer(guildId) {
  const session = getSession(guildId);
  if (!session?.sleepTimer) return;
  clearTimeout(session.sleepTimer);
  session.sleepTimer = null;
  session.sleepEndsAt = null;
}

// ─── Memorize Mode ─────────────────────────────────────────────────────────────
export function setMemorizeMode(guildId, { repeatCount, delayMs }) {
  const session = getSession(guildId);
  if (!session) return false;
  session.memorize  = { repeatCount, delayMs, currentRep: 0 };
  session.loop      = false;
  session.fullQuran = false;   // the khatma branch of playNext runs BEFORE the memorize one: left on, it would play surah+1 instead of repeating
  return true;
}

/**
 * Switch off everything that refills the queue by itself (khatma, loop, memorize).
 * @returns {boolean} true when at least one of them was on
 */
export function stopAutoModes(guildId) {
  const session = getSession(guildId);
  if (!session) return false;
  const was = !!(session.fullQuran || session.loop || session.memorize);
  session.fullQuran = false;
  session.loop      = false;
  session.memorize  = null;
  return was;
}

export function clearMemorizeMode(guildId) {
  const session = getSession(guildId);
  if (session) session.memorize = null;
}

// ─── Destroy ───────────────────────────────────────────────────────────────────
export async function destroySession(guildId, { keepSnapshot = false } = {}) {
  const session = sessions.get(guildId);
  if (!session) return;

  if (session.current?.startedAt) {
    const secs = playedSeconds(session);
    Statistics.addPlayTime(guildId, secs).catch(() => {});
  }

  if (session.sleepTimer)     clearTimeout(session.sleepTimer);
  if (session.autoLeaveTimer) clearTimeout(session.autoLeaveTimer);

  if (!keepSnapshot) removeSnapshot(guildId).catch(() => {});
  else await Promise.race([snapEnqueue(guildId, () => SessionSnapshot.save(session)), new Promise(r => setTimeout(r, 1500))]).catch(() => {});   // restart: remember the exact second (before the player is torn down)

  // Clear radio BEFORE deleting the session to stop any pending reconnect setTimeout
  cancelRadio(session);

  // Remove BEFORE destroying to prevent re-entry
  sessions.delete(guildId);
  notifySessionsChanged();

  // Push stop event to activity log
  if (session._client?._pushActivity) {
    session._client._pushActivity('stop',
      `⏹ إيقاف جلسة: ${session.channelName ?? guildId}`,
      `السيرفر: ${guildId}`
    );
  }

  // Restart path (FIX Bug #4): use _doRefreshPanel with the captured session reference.
  // At this point the session is already removed from the Map, so the normal
  // refreshPanel() → getSession() path returns null and silently does nothing.
  // The bot is leaving voice (stopped, kicked, idle/sleep timeout, channel deleted…): the control panel has nothing left
  // to control, so it is deleted at once (a restart too: the restored session posts a new one).
  // The delete runs alongside the voice teardown: a slow or rate-limited Discord API call must not keep the bot in the room.
  // A restart no longer leaves the panel behind either: the restored session posts a fresh one (autoPanel) and recovery removes
  // an old one it finds, so no dead panel (buttons that fail) stays in the room while the bot is down. Only a full leave also
  // sweeps the rest of the bot's messages — a shutdown has seconds, not minutes.
  let panelGone = Promise.resolve();
  if (keepSnapshot) panelGone = removePanelOf(guildId, session).catch(() => {});
  else panelGone = removePanelOf(guildId, session).then(() => sweepOwnMessages(session)).catch(() => {});

  try {
    if (session.player) {
      session.player.stop();
      await session.player.destroy();   // kills ffmpeg + leaves the voice channel
    }
  } catch {}
  await panelGone;

  logger.info(`[${guildId}] Session destroyed`);
}

// ─── Radio ─────────────────────────────────────────────────────────────────────
/**
 * Play a live radio stream in the guild's session.
 * Stops any current playback and streams the given URL directly through ffmpeg.
 * Returns true on success, false on failure.
 */
export async function playRadio(guildId, station) {
  const session = getSession(guildId);
  if (!session?.player) return false;

  // Clear regular queue and disable all modes — radio is a separate state
  clearQueue(guildId);
  session.loop      = false;
  session.fullQuran = false;
  session.memorize  = null;
  cancelRadio(session);              // drop a previous station's pending reconnect
  session.radio     = station;       // remembered so the stream can be reconnected when it drops

  // Stop any current track first
  if (session.status === 'playing' || session.status === 'paused') {
    session.player.stop();
  }

  const ok = await _startRadioStream(guildId, station);
  if (!ok && getSession(guildId) === session && session.radio === station) {
    // The station would not start. The previous track was stopped above, so the session is really idle now —
    // say so (it used to keep showing "playing" with silence) and let the normal idle timer run.
    cancelRadio(session);
    session.status  = 'idle';
    session.current = null;
    refreshPanel(guildId, session._client).catch(() => {});
    startAutoLeaveTimer(guildId);
  }
  return ok;
}

// Internal: start a live radio stream URL (Icecast/SHOUTcast/HLS) through ffmpeg.
async function _startRadioStream(guildId, station) {
  const session = getSession(guildId);
  if (!session?.player) return false;

  try {
    await session.player.play(station.url, { live: true });
    if (getSession(guildId) !== session) { session.player?.stop?.(); return false; }   // destroyed while connecting
    session.status  = 'playing';
    session.current = {
      surah:     { number: 0, arabic: station.name, english: station.name, ayahs: 0, type: null, page: null },
      reciter:   station.name,
      riwaya:    '🔴 Live',
      startedAt: Date.now(),
      isRadio:   true
    };

    refreshPanel(guildId, session._client).catch(() => {});
    autoPanel(guildId);
    logger.info(`[${guildId}] Radio started: ${station.name}`);
    return true;
  } catch (err) {
    logger.error(`[${guildId}] playRadio error: ${err.message}`);
    return false;
  }
}
