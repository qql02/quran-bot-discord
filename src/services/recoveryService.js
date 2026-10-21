import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { SessionSnapshot } from '../models/SessionSnapshot.js';
import { findReciter } from './quranService.js';
import { getSurahByNumber } from '../data/surahs.js';
import { Blacklist } from '../models/Blacklist.js';
import { mapLimit } from '../utils/mapLimit.js';
import {
  createAndJoin,
  enqueue,
  playNext,
  getSession,
  startAutoLeaveTimer
} from '../managers/sessionManager.js';

/**
 * Delete the control panel a snapshot remembers (best effort). Restored sessions get a fresh panel from the session manager the
 * moment they play, and a snapshot that cannot be restored must not leave a dead panel (buttons that fail) in the room.
 */
async function dropOldPanel(client, snap) {
  if (!snap?.panelChannelId || !snap?.panelMessageId) return;
  try {
    const ch = client.channels?.cache?.get(snap.panelChannelId) ?? await client.channels?.fetch?.(snap.panelChannelId).catch(() => null);
    await ch?.messages?.delete(snap.panelMessageId);
  } catch { /* already gone / no access */ }
}

/** Forget a snapshot that will not be restored, together with its panel. */
function discardSnapshot(client, snap) {
  SessionSnapshot.remove(snap.guildId).catch(() => {});
  void dropOldPanel(client, snap);
}

/**
 * Called once in the ready event.
 * Reads all SessionSnapshot docs and attempts to reconnect.
 */
export async function recoverSessions(client) {
  let snapshots = [];
  try {
    snapshots = await SessionSnapshot.getAll();
  } catch (err) {
    logger.warn('recoverSessions: could not fetch snapshots:', err.message);
    return;
  }

  if (!snapshots.length) return;
  logger.info(`[Recovery] Found ${snapshots.length} session snapshot(s) to restore`);
  if (client._pushActivity) {
    client._pushActivity('info', `استعادة الجلسات عند الإقلاع`, `${snapshots.length} جلسة محفوظة`);
  }

  let restored = 0;
  // A few at a time: each session now decodes up to its saved second, so one after another would delay startup for every server.
  await mapLimit(snapshots, 4, async (snap) => {
    try {
      await restoreOne(client, snap);
      restored++;
    } catch (err) {
      logger.warn(`[Recovery] Failed to restore guild ${snap.guildId}: ${err.message}`);
      if (client._pushActivity) {
        client._pushActivity('error',
          `فشل استعادة جلسة: ${snap.guildId}`,
          err.message
        );
      }
      discardSnapshot(client, snap);
    }
  });
  if (client._pushActivity && restored > 0) {
    client._pushActivity('info', `تمت استعادة ${restored} جلسة بنجاح`, `من أصل ${snapshots.length}`);
  }
}

async function restoreOne(client, snap) {
  const guild = await client.guilds.fetch(snap.guildId).catch(() => null);
  if (!guild) {
    logger.warn(`[Recovery] Guild ${snap.guildId} not found — skipping`);
    discardSnapshot(client, snap);
    return;
  }

  const voiceChannel = await guild.channels.fetch(snap.voiceChannelId).catch(() => null);
  if (!voiceChannel) {
    logger.warn(`[Recovery][${snap.guildId}] Voice channel ${snap.voiceChannelId} not found`);
    discardSnapshot(client, snap);
    return;
  }

  // Guild was blacklisted while the bot was offline → don't resume playback there.
  if (await Blacklist.isBanned(snap.guildId).catch(() => false)) {
    logger.warn(`[Recovery][${snap.guildId}] Guild is blacklisted — snapshot dropped`);
    discardSnapshot(client, snap);
    return;
  }

  // Don't re-create if already active (shouldn't happen but guard it)
  if (getSession(snap.guildId)) return;

  // Resolve reciter
  const reciterObj = snap.reciterName
    ? await findReciter(snap.reciterName).catch(() => null)
    : null;

  if (!reciterObj) {
    logger.warn(`[Recovery][${snap.guildId}] Could not resolve reciter '${snap.reciterName}'`);
    discardSnapshot(client, snap);
    return;
  }

  const surah = getSurahByNumber(snap.surahNumber);
  if (!surah) {
    logger.warn(`[Recovery][${snap.guildId}] Surah #${snap.surahNumber} not found`);
    discardSnapshot(client, snap);
    return;
  }

  const session = await createAndJoin(
    guild, voiceChannel, snap.ownerId, snap.language ?? 'en', client
  );

  session.fullQuran = snap.fullQuran ?? false;
  session.loop      = snap.loop ?? false;

  const reciterName = reciterObj.displayName || reciterObj.name;

  // If a riwaya was saved, reorder reciterObj.moshaf so that moshaf is tried first.
  // This mirrors what play.js does when the user specifies a riwaya preference.
  if (snap.riwaya && reciterObj.moshaf?.length > 1) {
    const q = snap.riwaya.toLowerCase();
    reciterObj.moshaf = [
      ...reciterObj.moshaf.filter(m => (m.name ?? '').toLowerCase().includes(q)),
      ...reciterObj.moshaf.filter(m => !(m.name ?? '').toLowerCase().includes(q))
    ];
  }

  // The old panel (if the bot died without a clean shutdown) is removed; the session posts a new one as soon as it plays.
  void dropOldPanel(client, snap);

  // Continue from the saved second (a snapshot older than a day is not a position anyone is still waiting at).
  const fresh = Date.now() - new Date(snap.savedAt ?? 0).getTime() < 24 * 3_600_000;
  enqueue(snap.guildId, { surah, reciter: reciterName, reciterObj, startMs: fresh ? snap.positionMs ?? 0 : 0, preferUrl: snap.url ?? undefined });
  await playNext(snap.guildId);

  // Restored into a channel nobody is in → the voiceStateUpdate auto-leave never fires.
  // Start the timer here so the bot doesn't recite to an empty room forever.
  if (!voiceChannel.members?.some(m => !m.user.bot)) {
    logger.info(`[Recovery][${snap.guildId}] Channel is empty — auto-leave timer started`);
    startAutoLeaveTimer(snap.guildId, config.session.emptyLeaveMs, { empty: true });
  }

  logger.success(
    `[Recovery][${snap.guildId}] Restored → ${surah.english} by ${reciterName}`
  );
  if (client._pushActivity) {
    client._pushActivity('play',
      `▶ تمت استعادة: ${surah.arabic ?? surah.english}`,
      `القارئ: ${reciterName} | السيرفر: ${snap.guildId}`
    );
  }
}
