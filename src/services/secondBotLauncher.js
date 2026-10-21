/**
 * secondBotLauncher.js — runs the voice-only second bot FROM THIS SAME PROJECT (no second upload, no second host).
 *
 * Set SECOND_BOT_TOKEN to the second bot's token. The main bot then starts one extra Node process (same code, same files,
 * same MONGODB_URI) with BOT_ROLE=secondary and that token. Its console lines appear in the same console, tagged [2nd-bot].
 * It restarts itself if it crashes (5s, 10s, 20s … up to 60s) and stops when the main bot stops.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { clientIdFromToken, looksLikeTokenText } from '../utils/botToken.js';

const ENTRY = fileURLToPath(new URL('../../index.js', import.meta.url));

/**
 * Decide whether (and how) the second bot starts. Pure.
 * @returns {{ enabled:false, problem?:string } | { enabled:true, id:string, childEnv:object }}
 */
export function planSecondBot(env, primaryId) {
  const token = String(env.SECOND_BOT_TOKEN ?? '').trim();
  if (!token) return { enabled: false };
  if (!looksLikeTokenText(token) || !clientIdFromToken(token)) return { enabled: false, problem: 'SECOND_BOT_TOKEN is not a valid bot token (copy it again from Developer Portal → Bot → Reset Token, no spaces or quotes)' };
  const id = clientIdFromToken(token);
  if (primaryId && id === primaryId) return { enabled: false, problem: 'SECOND_BOT_TOKEN is the SAME bot as DISCORD_TOKEN — it must be a second, different Discord application' };
  const childEnv = { ...env, DISCORD_TOKEN: token, BOT_ROLE: 'secondary', LOG_TAG: '2nd-bot', SECOND_BOT_PARENT_PID: String(process.pid) };
  for (const k of ['SECOND_BOT_TOKEN', 'CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'ALT_BOT_ID']) delete childEnv[k];   // the child derives its own ID from its token
  return { enabled: true, id, childEnv };
}

/** Backoff before restart number `failures` (1-based): 5s, 10s, 20s, 40s, then 60s. */
export const restartDelayMs = (failures) => Math.min(60_000, 5_000 * 2 ** Math.max(0, failures - 1));

const MAX_FAILURES = 8;          // this many quick crashes in a row → stop trying and say so
const STABLE_MS = 60_000;        // ran this long → the crash counter starts again

const KILL_GRACE_MS = 12_000;    // after SIGTERM the child needs a few seconds to leave voice rooms (its own shutdown allows 8s); then it is killed

/**
 * @returns {{ plan, stop(), pause():Promise<boolean>, resume():boolean, status():object }}
 *   pause()  — the owner switched the second bot OFF: the process is ended (so ALL of its memory goes back to the host) and it is NOT
 *              restarted by the crash-restart logic. Resolves when the process is really gone.
 *   resume() — the owner switched it back ON: a fresh process starts (its sessions come back from their saved snapshots).
 */
export function startSecondBot({ logger, env = process.env, primaryId, spawnFn = spawn, setTimer = setTimeout, now = Date.now, startPaused = false, killGraceMs = KILL_GRACE_MS } = {}) {
  const plan = planSecondBot(env, primaryId);
  if (!plan.enabled) {
    if (plan.problem) logger.error(`❌ Second bot NOT started: ${plan.problem}`);
    else logger.info('Second bot: not configured (SECOND_BOT_TOKEN is empty) — set it to run a second voice bot from this same project');
    return { plan, stop() {}, pause: async () => false, resume: () => false, status: () => ({ configured: false, running: false, paused: false }) };
  }

  let child = null, stopping = false, paused = false, gaveUp = false, failures = 0, startedAt = 0, timer = null;
  const exitWaiters = [];

  const launch = () => {
    startedAt = now();
    logger.info(`🎧 Starting the second bot (ID ${plan.id}) from this project…`);
    child = spawnFn(process.execPath, [ENTRY], { env: plan.childEnv, stdio: 'inherit' });
    child.on('error', (err) => logger.error('Second bot could not be started:', err));
    child.on('exit', (code, signal) => {
      child = null;
      for (const done of exitWaiters.splice(0)) done();
      if (stopping || paused) return;
      failures = now() - startedAt >= STABLE_MS ? 1 : failures + 1;
      if (failures >= MAX_FAILURES) {
        gaveUp = true;
        logger.error(`❌ Second bot stopped ${failures} times in a row (last exit: ${signal ?? `code ${code}`}) — giving up. Read the [2nd-bot] lines above for the reason, fix it, then restart the main bot.`);
        return;
      }
      const wait = restartDelayMs(failures);
      logger.warn(`Second bot exited (${signal ?? `code ${code}`}) — restarting in ${wait / 1000}s (attempt ${failures}/${MAX_FAILURES - 1})`);
      timer = setTimer(launch, wait);
      timer.unref?.();
    });
  };

  const stop = () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    try { child?.kill('SIGTERM'); } catch { /* already gone */ }
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(sig, stop);
  process.once('exit', stop);

  const status = () => ({
    configured: true, id: plan.id, running: !!child, paused, gaveUp,
    pid: child?.pid ?? null, startedAt: child ? startedAt : null, failures
  });

  const pause = () => {
    paused = true;
    if (timer) { clearTimeout(timer); timer = null; }     // a restart that was waiting for its back-off is cancelled
    if (!child) return Promise.resolve(true);
    return new Promise((resolve) => {
      let killer = null;
      exitWaiters.push(() => { if (killer) clearTimeout(killer); resolve(true); });
      logger.warn('🎧 Second bot: stopped by the owner — ending its process (all of its memory is released)');
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killer = setTimer(() => { try { child?.kill('SIGKILL'); } catch { /* already gone */ } }, killGraceMs);
      killer.unref?.();
    });
  };

  const resume = () => {
    if (stopping) return false;
    paused = false; gaveUp = false; failures = 0;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!child) { logger.info('🎧 Second bot: switched back on by the owner'); launch(); }
    return true;
  };

  if (startPaused) { paused = true; logger.warn('🎧 Second bot: kept OFF — the owner stopped it from the dashboard (switch it on there to bring it back)'); }
  else launch();
  return { plan, stop, pause, resume, status };
}
