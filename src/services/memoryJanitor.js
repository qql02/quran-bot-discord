import { logger } from '../utils/logger.js';

/**
 * Memory janitor — a continuous, adaptive job that keeps the process lean without touching anything that is in use.
 *
 * CONTINUOUS by default: on every tick it sweeps and collects regardless of how much RAM is used (see the CONTINUOUS level below);
 * the pressure/critical levels only make it more aggressive.
 * Every tick (30 s by default, MEMORY_JANITOR_SEC) it:
 *   1. drops expired entries of the in-memory caches that only shrink when somebody asks (language, restrictions, "waiting for voice"),
 *   2. ends zombie sessions (their player is already destroyed but the session is still in the map: it keeps timers, listeners and a slot),
 *   3. kills ffmpeg children that outlived their session (two ticks in a row with no session at all — ~50MB each),
 *   4. watches RSS and reacts in two levels:
 *        PRESSURE (RSS > MEMORY_PRESSURE_MB, default 1.5 × GC_LIMIT_MB): empties the page caches (Mushaf pictures and text — all of it
 *          is re-fetched on demand), sweeps the discord.js member/user/message caches right now (instead of waiting for their timers)
 *          and runs a garbage collection;
 *      Below PRESSURE but above SOFT (MEMORY_SOFT_MB, default GC_LIMIT_MB) only the cheap discord.js caches are swept each tick.
 *        CRITICAL (RSS > MEMORY_CRITICAL_MB, default 2 × GC_LIMIT_MB): the same, but the GC is not held back by the back-off below.
 *
 * Back-off: a collection that does not bring RSS down (the memory is live — streams, native image rendering, a busy server) is not
 * repeated every tick, it would only burn CPU and stutter the audio: the wait between collections doubles (up to 5 min) and
 * returns to normal as soon as RSS is under the pressure line again. Cache shedding is cheap and still runs every pressure tick.
 *
 * `deps` is injected so the logic is testable without Discord, ffmpeg or a database. Never throws.
 */
export const JANITOR_INTERVAL_MS = 30_000;
const GC_MIN_GAP_MS = 20_000;
const GC_MAX_GAP_MS = 5 * 60_000;

export function createJanitor(deps) {
  const now = deps.now ?? Date.now;
  let noSessionStrikes = 0;
  let gcGap = GC_MIN_GAP_MS;
  let lastGcAt = -Infinity;
  let told = false;
  let contGap = deps.gcEveryMs ?? 60_000;

  const each = (list) => { for (const fn of list ?? []) { try { fn(); } catch { /* best effort */ } } };

  return async function tick() {
    const report = { pruned: 0, zombies: 0, ffmpegKilled: 0, pressure: false, critical: false, gcRan: false };
    try {
      report.pruned = (deps.pruners ?? []).reduce((n, fn) => { try { return n + (fn() || 0); } catch { return n; } }, 0);

      const sessions = deps.getSessions();
      for (const s of sessions) {
        if (s.player?._destroyed) {
          report.zombies++;
          logger.warn(`[${s.guildId}] Zombie session (its player is already destroyed) — ending it`);
          await deps.destroySession(s.guildId).catch(() => {});
        }
      }

      if (deps.ffmpegCount() > 0 && deps.getSessions().length === 0) {
        if (++noSessionStrikes >= 2) { report.ffmpegKilled = deps.killStray(); noSessionStrikes = 0; }
      } else noSessionStrikes = 0;
      if (report.ffmpegKilled) logger.warn(`Memory janitor: killed ${report.ffmpegKilled} ffmpeg process(es) that outlived their session`);

      const before = deps.rssMb();
      const pressure = deps.pressureMb > 0 && before > deps.pressureMb;
      if (!pressure) {
        // CONTINUOUS level (default, MEMORY_CONTINUOUS=0 turns it off): clean every tick whatever the RSS is — rebuildable discord.js caches
        // are swept, page caches are dropped while nobody is listening, and a collection runs every MEMORY_GC_SEC (default 60 s).
        if (deps.continuous) {
          report.continuous = true;
          each(deps.sweepers);
          if (deps.getSessions().length === 0) each(deps.shedders);
          const t = now();
          if (deps.gc && t - lastGcAt >= contGap) {
            lastGcAt = t;
            deps.gc();
            report.gcRan = true;
            const after = deps.rssMb();
            // freed nothing → live memory: wait longer (up to 4× the base gap) instead of burning CPU; freed something → back to the base gap
            contGap = after > before * 0.98 ? Math.min(deps.gcEveryMs * 4, contGap * 2) : deps.gcEveryMs;
          }
          return report;
        }
        gcGap = GC_MIN_GAP_MS; told = false;
        if (deps.softMb > 0 && before > deps.softMb) { each(deps.sweepers); report.soft = true; }
        return report;
      }

      report.pressure = true;
      report.critical = deps.criticalMb > 0 && before > deps.criticalMb;
      each(deps.shedders);
      each(deps.sweepers);
      if (report.critical) each(deps.criticalShedders);

      const t = now();
      if (deps.gc && (report.critical ? t - lastGcAt >= GC_MIN_GAP_MS : t - lastGcAt >= gcGap)) {
        lastGcAt = t;
        deps.gc();
        report.gcRan = true;
        const after = deps.rssMb();
        if (after > before * 0.95) {                 // the collection freed (almost) nothing: it is live memory
          gcGap = Math.min(GC_MAX_GAP_MS, gcGap * 2);
          if (!told) { told = true; logger.warn(`Memory janitor: RSS stays at ${Math.round(after)}MB after cleaning — it is live memory (streams / rendering), collecting less often`); }
        } else gcGap = GC_MIN_GAP_MS;
        logger.warn(`Memory janitor: RSS ${Math.round(before)}MB is above ${report.critical ? deps.criticalMb : deps.pressureMb}MB — caches emptied, GC run (now ${Math.round(after)}MB)`);
      }
    } catch (err) {
      logger.debug?.(`Memory janitor tick failed: ${err.message}`);
    }
    return report;
  };
}

/** Wire the janitor to the real modules (loaded lazily: this file stays importable in tests without the whole bot). */
export async function startMemoryJanitor({ client, intervalMs } = {}) {
  const [{ getAllSessions, destroySession }, panelRegistry, settings, restrictions, ffmpeg, mushafImages, mushafService, discordCache] = await Promise.all([
    import('../managers/sessionManager.js'),
    import('../utils/panelRegistry.js'),
    import('../models/GuildSettings.js'),
    import('../utils/guildRestrictions.js'),
    import('./sources/ffmpegSource.js'),
    import('./mushafImages.js'),
    import('./mushafService.js'),
    import('../utils/discordCache.js')
  ]);
  const gcLimit = Number(process.env.GC_LIMIT_MB ?? 300);
  const pressureMb = Number(process.env.MEMORY_PRESSURE_MB ?? gcLimit * 1.5) || 0;
  const criticalMb = Number(process.env.MEMORY_CRITICAL_MB ?? gcLimit * 2) || 0;
  const every = intervalMs ?? Math.max(5, Number(process.env.MEMORY_JANITOR_SEC ?? 30) || 30) * 1000;
  const tick = createJanitor({
    getSessions: getAllSessions,
    destroySession,
    pruners: [panelRegistry.pruneWaiting, settings.pruneLangCache, restrictions.pruneRestrictions],
    ffmpegCount: ffmpeg.ffmpegChildCount,
    killStray: ffmpeg.killStrayFfmpeg,
    rssMb: () => process.memoryUsage.rss() / 1048576,
    continuous: process.env.MEMORY_CONTINUOUS !== '0',
    gcEveryMs: Math.max(10, Number(process.env.MEMORY_GC_SEC ?? 60) || 60) * 1000,
    softMb: Number(process.env.MEMORY_SOFT_MB ?? gcLimit) || 0,
    pressureMb,
    criticalMb,
    shedders: [mushafImages.clearMushafPngCache, mushafService.clearMushafCache],
    sweepers: client ? [() => discordCache.sweepClientNow(client)] : [],
    gc: globalThis.__quranGc
  });
  const timer = setInterval(() => { void tick(); }, every);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
