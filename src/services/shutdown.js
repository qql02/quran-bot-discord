import { logger } from '../utils/logger.js';

let shuttingDown = false;

/**
 * Leave every voice channel cleanly before the process dies.
 * A process that is killed WITHOUT sending the "leave" payload leaves a "ghost":
 * the bot still shows in the voice channel, silent, until Discord times it out.
 *
 * Covers: Ctrl+C (SIGINT), pm2/systemd/Docker stop (SIGTERM), closing the
 * terminal window (SIGHUP / SIGBREAK on Windows) and the admin-panel restart button.
 * Snapshots are KEPT so sessions resume automatically on the next start.
 */
export function registerShutdown(client) {
  const run = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`Received ${signal} — leaving voice channels and shutting down...`);

    const force = setTimeout(() => {
      logger.error('Shutdown timed out — forcing exit');
      process.exit(1);
    }, 8_000);
    force.unref?.();

    try {
      const { getAllSessions, destroySession } = await import('../managers/sessionManager.js');
      await Promise.allSettled(
        getAllSessions().map(s => destroySession(s.guildId, { keepSnapshot: true }))
      );
      await new Promise(r => setTimeout(r, 500));   // let the gateway flush the leave payloads
    } catch (err) {
      logger.warn('Shutdown cleanup error:', err.message);
    }

    try { const { stopSiblingSync } = await import('./siblingService.js'); await stopSiblingSync(); } catch { /* ignore */ }
    try { await client.destroy(); } catch { /* ignore */ }
    try { const { stopApiServer } = await import('../api/server.js'); await stopApiServer(); } catch { /* ignore */ }
    try { const { default: mongoose } = await import('mongoose'); await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(0);
  };

  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  if (process.platform === 'win32') signals.push('SIGBREAK');
  for (const sig of signals) process.on(sig, () => run(sig));
}
