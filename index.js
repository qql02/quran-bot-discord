// Launcher. It only checks the Node.js version and then starts the bot (src/bootstrap.js).
// Keeping it this small means an outdated Node on the host prints a clear message instead of a cryptic crash.
import v8 from 'node:v8';
import vm from 'node:vm';
import { nodeSupportProblem } from './src/utils/nodeVersion.js';

const problem = nodeSupportProblem(process.versions.node);
if (problem) {
  console.error(problem);
  process.exit(1);
}

// ── Memory guard ────────────────────────────────────────────────────────────────────────────────────────────────
// Every GC_INTERVAL_SEC seconds (default 15), if this process uses more RAM than GC_LIMIT_MB (default 300), it runs a garbage
// collection (and a second one right after, which frees what the first released). Works without any start flag, so the second bot
// (same file) gets it too. GC_LIMIT_MB=0 turns it off.
// A collection that does not bring RSS under the limit means the memory is NOT garbage (ffmpeg buffers, native image rendering, a
// busy server's real working set): collecting again every 15 seconds would only burn CPU and stutter the audio. In that case the guard
// backs off (15s → 30s → … up to 5 minutes) and says so once; it returns to normal as soon as RSS is under the limit again.
// The same collector is handed to the memory janitor (src/services/memoryJanitor.js) as globalThis.__quranGc.
try {
  const limitMb = Number(process.env.GC_LIMIT_MB ?? 300);
  const baseSec = Math.max(5, Number(process.env.GC_INTERVAL_SEC ?? 15) || 15);
  if (Number.isFinite(limitMb) && limitMb > 0) {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc');
    globalThis.__quranGc = () => { gc(); setImmediate(gc); };
    const rssMb = () => process.memoryUsage().rss / 1048576;
    let waitSec = baseSec, sinceSec = 0, told = false;
    setInterval(() => {
      sinceSec += baseSec;
      if (rssMb() <= limitMb) { waitSec = baseSec; told = false; sinceSec = 0; return; }
      if (sinceSec < waitSec) return;
      sinceSec = 0;
      gc(); setImmediate(gc);
      setTimeout(() => {
        if (rssMb() > limitMb) {
          waitSec = Math.min(300, waitSec * 2);
          if (!told) { told = true; console.error(`Memory guard: RSS is still ${Math.round(rssMb())}MB after a collection (limit ${limitMb}MB) — it is live memory, not garbage; collecting less often`); }
        } else waitSec = baseSec;
      }, 200).unref();
    }, baseSec * 1000).unref();
  }
} catch (err) {
  console.error('Memory guard could not start:', err?.message ?? err);
}

await import('./src/bootstrap.js');
