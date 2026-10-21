/**
 * parentWatch.js — the second bot (started by the main bot from this same project) must never outlive the main bot.
 * If the host kills the main bot without a clean shutdown, an orphaned second bot would keep running and the next start
 * would add a second copy with the same token. The child checks every few seconds that its parent still exists.
 * Zero imports.
 */
export function watchParent(parentPid, onGone, { intervalMs = 5_000, kill = process.kill.bind(process) } = {}) {
  const pid = Number(parentPid);
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const timer = setInterval(() => {
    try { kill(pid, 0); }                       // signal 0 = "does it exist?"
    catch (e) { if (e?.code === 'ESRCH') { clearInterval(timer); onGone(); } }   // EPERM would mean it exists
  }, intervalMs);
  timer.unref?.();
  return timer;
}
