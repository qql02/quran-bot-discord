/**
 * secondBotControl.js — the owner's ON / OFF switch for the second bot (the voice-only process started from this same project).
 *
 * OFF  = the process is ended. A process that is gone keeps nothing in RAM: its caches, sessions' buffers, ffmpeg children, everything
 *        returns to the host. Its registry entry and any dashboard command still waiting for it are cleaned right away, so the main bot
 *        stops handing recitations to a bot that is not there. The choice is saved in the database: a restart of the main bot does NOT
 *        switch the second bot back on by itself.
 * ON   = a fresh process starts; sessions it was reciting in come back from their saved snapshots.
 *
 * Only a second bot started by THIS project can be switched here. One running on another host is not reachable from this process.
 * Everything that touches the outside is injected, so the logic is testable without a database or a child process.
 */
import { logger } from '../utils/logger.js';

export function createSecondBotControl({ getHandle, readPaused, writePaused, cleanup, readRamMb }) {
  const state = (h, paused) => {
    const st = h?.status?.() ?? { configured: false };
    if (!st.configured) return { managed: false, running: false, paused: false };
    return {
      managed: true, id: st.id, running: !!st.running, paused: !!(st.paused ?? paused), gaveUp: !!st.gaveUp, failures: st.failures ?? 0,
      pid: st.pid ?? null, uptimeSec: st.startedAt ? Math.max(0, Math.round((Date.now() - st.startedAt) / 1000)) : null
    };
  };

  return {
    async status() {
      const h = getHandle();
      const st = state(h, false);
      if (st.managed && st.running && st.pid && readRamMb) st.ramMb = await Promise.resolve(readRamMb(st.pid)).catch(() => null);
      return st;
    },
    async stop(by = '') {
      const h = getHandle();
      if (!h?.status?.().configured) return { ok: false, error: 'not_managed' };
      await writePaused(true).catch((e) => logger.warn(`[second-bot] could not save the OFF state: ${e.message}`));
      await h.pause();
      await Promise.resolve(cleanup?.(h.status().id)).catch((e) => logger.warn(`[second-bot] cleanup failed: ${e.message}`));
      logger.warn(`[second-bot] switched OFF by ${by || 'the owner'}`);
      return { ok: true, ...state(h, true) };
    },
    async start(by = '') {
      const h = getHandle();
      if (!h?.status?.().configured) return { ok: false, error: 'not_managed' };
      await writePaused(false).catch((e) => logger.warn(`[second-bot] could not save the ON state: ${e.message}`));
      if (!h.resume()) return { ok: false, error: 'shutting_down' };
      logger.info(`[second-bot] switched ON by ${by || 'the owner'}`);
      return { ok: true, ...state(h, false) };
    },
    readPaused
  };
}

// ── The real wiring (modules loaded on first use so this file stays importable in tests) ──
let handle = null;
export const registerSecondBot = (h) => { handle = h; };

const real = createSecondBotControl({
  getHandle: () => handle,
  readPaused: async () => {
    const { BotControl } = await import('../models/BotControl.js');
    return !!(await BotControl.findOne({ key: 'global' }, { secondBotPaused: 1 }).lean())?.secondBotPaused;
  },
  writePaused: async (v) => {
    const { BotControl } = await import('../models/BotControl.js');
    await BotControl.updateOne({ key: 'global' }, { $set: { secondBotPaused: !!v } }, { upsert: true });
  },
  cleanup: async (botId) => {
    if (!botId) return;
    const [{ BotInstance }, { WorkerCommand }] = await Promise.all([import('../models/BotInstance.js'), import('../models/WorkerCommand.js')]);
    await BotInstance.deleteOne({ _id: botId });                                                              // out of the registry at once
    await WorkerCommand.updateMany({ targetBotId: botId, status: { $in: ['pending', 'claimed'] } }, { $set: { status: 'cancelled', finishedAt: new Date() } });
  },
  readRamMb: async (pid) => {                                                                                  // best effort (Linux / macOS); null elsewhere
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const { execFile } = await import('node:child_process');
    return new Promise((resolve) => execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 1500 }, (err, out) => {
      const kb = Number(String(out ?? '').trim());
      resolve(err || !Number.isFinite(kb) || kb <= 0 ? null : Math.round(kb / 1024));
    }));
  }
});

export const secondBotStatus = () => real.status();
export const stopSecondBot = (by) => real.stop(by);
export const startSecondBotAgain = (by) => real.start(by);
export const isSecondBotPaused = () => real.readPaused();
