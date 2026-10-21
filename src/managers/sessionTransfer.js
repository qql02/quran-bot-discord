import {
  getSession, createAndJoin, destroySession, enqueue, playNext, playRadio, pauseSession, setVolume, setSleepTimer
} from './sessionManager.js';
import { exportState, resumeLagMs } from '../services/transferState.js';
import { UserError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Moving a recitation to another voice room without losing the place (the engine behind /pull).
 *
 *   exportSession(guildId)                     what is playing, how far into it, and what comes next
 *   applyState(guildId, state, deps)           in a freshly joined room: queue + start at that position + modes, volume, sleep timer
 *   moveSession(guild, room, opts, deps)       THIS bot leaves its room and carries on in `room`
 *
 * A second bot taking over a copy (when other people stay in the old room) uses applyState too — see services/playerJobs.js.
 * `deps` gives the Quran lookups; they are only needed for a state that came through the database (a local move keeps the live
 * reciter objects).
 */

export const exportSession = (guildId) => exportState(getSession(guildId));

/** The reciter of a state / queue item: the live object when we have it, otherwise looked up by id, then by name. */
async function reciterOf({ reciterObj, reciterId, reciter }, deps) {
  if (reciterObj?.moshaf?.length) return reciterObj;
  let found = reciterId && deps?.findReciterById ? await deps.findReciterById(reciterId) : null;
  if (!found?.moshaf?.length && reciter && deps?.findReciter) found = await deps.findReciter(reciter);
  return found?.moshaf?.length ? found : null;
}

/**
 * Make the session of `guildId` (already joined) continue `state`: same surah at the same position, same queue and modes.
 * @param {object} deps { surahByNumber, findReciterById, findReciter, findDefaultReciter }
 * @returns {Promise<boolean>} false = nothing could be started (the caller reports it and may roll back)
 */
export async function applyState(guildId, state, deps) {
  const session = getSession(guildId);
  if (!session || !state) return false;

  await setVolume(guildId, state.volume ?? 100);

  // A live radio station has no position: it simply tunes in again.
  if (state.radio) {
    const ok = await playRadio(guildId, { id: 'transfer', name: state.radio.name, url: state.radio.url });
    if (ok && state.sleep) setSleepTimer(guildId, state.sleep);
    return ok;
  }

  // Idle session (queue finished, nothing playing): the member only wanted the bot — it joins and shows its panel.
  if (!state.surah) {
    if (state.sleep) setSleepTimer(guildId, state.sleep);
    return true;
  }

  let reciter = await reciterOf({ reciterObj: state._reciterObj, reciterId: state.reciterId, reciter: state.reciter }, deps);
  if (!reciter && deps?.findDefaultReciter) reciter = await deps.findDefaultReciter(null, guildId);   // same fallback as a worker's /recite
  const surah = deps.surahByNumber(state.surah);
  if (!reciter || !surah) return false;

  session.loop      = !!state.loop;
  session.fullQuran = !!state.fullQuran;
  session.memorize  = state.memorize ? { ...state.memorize } : null;

  const name = reciter.displayName ?? reciter.englishName ?? reciter.name ?? state.reciter;
  if (!enqueue(guildId, { surah, reciter: name, reciterObj: reciter, riwaya: state.riwaya ?? undefined, startMs: (state.positionMs ?? 0) + resumeLagMs(state), preferUrl: state.url ?? undefined })) return false;

  for (const q of state.queue ?? []) {
    const r = await reciterOf(q, deps);
    const s = deps.surahByNumber(q.surah);
    if (r && s) enqueue(guildId, { surah: s, reciter: r.displayName ?? r.englishName ?? r.name ?? q.reciter, reciterObj: r });
  }

  await playNext(guildId);
  const live = getSession(guildId);
  if (live !== session || !session.current) return false;       // the recitation did not start (or the session is gone)

  if (state.paused) pauseSession(guildId);
  if (state.sleep) setSleepTimer(guildId, state.sleep);
  return true;
}

/**
 * THIS bot leaves its voice room and continues in `voiceChannel`, from exactly where it was.
 * The listener never has to touch anything: same surah, same second, same queue, same volume.
 * If the new room cannot be joined or the recitation cannot start, the bot goes back to the old room and continues there.
 *
 * @returns {Promise<{ state: object, fromChannelId: string, session: object }>}
 * @throws {UserError} pull_no_session | pull_already_here | pull_resume_failed — anything the join itself raises (permissions, capacity…) is passed on
 */
export async function moveSession({ guild, voiceChannel, userId = null, lang = null, client = null, requireEmpty = false, afterRollBack = null }, deps) {
  const old = getSession(guild.id);
  if (!old) throw new UserError('pull_no_session');
  if (old.voiceChannelId === voiceChannel.id) throw new UserError('pull_already_here', { bot: `<@${client?.user?.id ?? ''}>` });

  // The decision "nobody else is in the old room, so the bot may leave it" was taken a moment ago (for a voice-only bot: seconds ago, in
  // another process). Check it again now, so somebody who just walked in is not left with a bot that has gone.
  if (requireEmpty) {
    const oldRoom = guild.channels?.cache?.get?.(old.voiceChannelId);
    const stayers = oldRoom?.members ? [...oldRoom.members.values()].filter(m => !m.user?.bot && m.id !== userId).length : 0;
    if (stayers > 0) throw new UserError('pull_someone_joined', { channel: `<#${old.voiceChannelId}>` });
  }

  const state = exportState(old);                 // BEFORE anything is torn down: the position is only known while it plays
  const fromChannelId = old.voiceChannelId;
  const owner = state.ownerId ?? userId;
  const language = lang ?? old.language;

  try {
    // createAndJoin ends the old session itself (its panel in the old room is removed) and joins the new room.
    const session = await createAndJoin(guild, voiceChannel, owner, language, client ?? old._client);
    // A move continues exactly where the recitation stopped (nothing played in between), so no catch-up time is added.
    if (!(await applyState(guild.id, { ...state, exportedAt: null }, deps))) throw new UserError('pull_resume_failed', { channel: `<#${voiceChannel.id}>` });
    return { state, fromChannelId, session };
  } catch (err) {
    // Refused before anything was torn down (another bot in the new room, capacity…): the old session is untouched, nothing to repair.
    if (getSession(guild.id) === old) throw err;
    logger.warn(`[${guild.id}] Move to #${voiceChannel.name} failed (${err.message}) — going back to the old room`);
    await rollBack(guild, fromChannelId, state, owner, language, client ?? old._client, deps, afterRollBack);
    throw err;
  }
}

async function rollBack(guild, channelId, state, owner, language, client, deps, afterRollBack = null) {
  try {
    await destroySession(guild.id);
    const room = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!room) return;
    await createAndJoin(guild, room, owner, language, client);
    await applyState(guild.id, { ...state, exportedAt: null }, deps);   // nothing played meanwhile: same second as before
    try { await afterRollBack?.(room); } catch { /* the panel is a nicety: never undo a successful return because of it */ }   // the old room's panel was removed by the join: put it back
  } catch (err) {
    logger.warn(`[${guild.id}] Could not return to the old room: ${err.message}`);
    await destroySession(guild.id).catch(() => {});
  }
}
