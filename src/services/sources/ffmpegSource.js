import { spawn, spawnSync } from 'node:child_process';
import { Readable }         from 'node:stream';
import { readFileSync }     from 'node:fs';
import { logger }           from '../../utils/logger.js';
import { config } from '../../config.js';
import { safeFetch, resolveFinalUrl, looksLikeHls, assertSafePlaylist } from '../urlSafety.js';

const USER_AGENT = 'Mozilla/5.0 (QuranBot; +ffmpeg)';

// Live ffmpeg child processes. Their memory is NOT part of process.memoryUsage().rss, but the host counts it
// against the bot's RAM limit (≈ 45–50MB each), so the dashboard has to add it.
const livePids = new Set();

/** Resident memory (bytes) of all running ffmpeg children. Linux only (/proc); returns 0 elsewhere. */
export function ffmpegChildrenRss() {
  let total = 0;
  for (const pid of livePids) {
    try { total += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096; } catch { /* exited or no /proc */ }
  }
  return total;
}
export const ffmpegChildCount = () => livePids.size;

/**
 * Kill every ffmpeg child still alive. Only for the memory janitor, when NO session exists (so nothing can legitimately be decoding):
 * an ffmpeg that outlived its session keeps ~50MB of RAM and a network connection for nothing.
 * @returns {number} how many were killed
 */
export function killStrayFfmpeg() {
  let n = 0;
  for (const pid of [...livePids]) {
    try { process.kill(pid, 'SIGKILL'); n++; } catch { /* already gone */ }
    livePids.delete(pid);
  }
  return n;
}

/** Find a working ffmpeg: FFMPEG_PATH → system `ffmpeg` → bundled ffmpeg-static (if installed). */
export async function findFfmpeg() {
  const candidates = [];
  if (config.audio.ffmpegPath) candidates.push(config.audio.ffmpegPath);
  candidates.push('ffmpeg');
  try {
    const mod = await import('ffmpeg-static');
    if (mod.default) candidates.push(mod.default);
  } catch { /* ffmpeg-static is optional */ }

  for (const bin of candidates) {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    if (r.status === 0) return bin;
  }
  return null;
}

/**
 * Decode `url` to 48kHz stereo s16le PCM with ffmpeg.
 * Resolves once the first PCM bytes arrive (rejects if the URL can't be loaded).
 * @returns {Promise<{ stream: Readable, close: () => void }>}
 */
export async function openFfmpeg(url, { bin, loadTimeoutMs, onData }) {
  // SECURITY: ffmpeg never opens a remote URL itself (it would re-resolve DNS, follow redirects and fetch HLS
  // segments on its own, bypassing every check). Node downloads the stream through safeFetch() — each redirect
  // hop validated, private IPs refused at connect time — and pipes the bytes into ffmpeg's stdin.
  const isHttp = /^https?:\/\//i.test(url);
  // Second layer (play() already runs assertSafeUrl): any other URL scheme (file:, ftp:, rtmp:, concat:, data:, ...)
  // is refused here so ffmpeg can never be pointed at a non-HTTP protocol. Plain paths (tests) still work.
  if (!isHttp && /^[a-z][a-z0-9+.-]+:/i.test(String(url))) throw new Error('Only http(s) URLs are allowed');
  const ac     = new AbortController();
  let   input  = null;          // Node Readable fed into ffmpeg (null for local files in tests / the legacy HLS path)
  let   inputUrl = url;

  if (isHttp) {
    const timer = setTimeout(() => ac.abort(), loadTimeoutMs);
    try {
      const res = await safeFetch(url, { signal: ac.signal, headers: { 'user-agent': USER_AGENT, 'icy-metadata': '0' } });
      if (!res.ok || !res.body) { res.body?.cancel?.().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      if (looksLikeHls(url, res)) {
        res.body.cancel().catch(() => {});
        if (!config.audio.allowHls) throw new Error('HLS (.m3u8) streams are disabled for security — set AUDIO_ALLOW_HLS=1 to allow them');
        // Legacy path: ffmpeg must open the playlist itself. Validate redirects + every playlist host first (fail closed).
        inputUrl = await resolveFinalUrl(url);
        await assertSafePlaylist(inputUrl);
      } else {
        input = Readable.fromWeb(res.body);
      }
    } catch (err) {
      ac.abort();
      throw err;
    } finally { clearTimeout(timer); }
  }

  const piped   = !!input;
  const hlsOpen = isHttp && !piped;           // legacy HLS: ffmpeg talks to the network (restricted protocols)
  const netOpts = hlsOpen
    ? ['-protocol_whitelist', 'http,https,tcp,tls,crypto',
       '-user_agent', USER_AGENT, '-rw_timeout', '15000000',
       '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']
    : piped ? ['-protocol_whitelist', 'pipe'] : [];

  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...netOpts,
    '-i', piped ? 'pipe:0' : inputUrl,
    '-vn',
    '-f', 's16le', '-ar', '48000', '-ac', '2',
    'pipe:1'
  ];

  const proc = spawn(bin, args, { stdio: [piped ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  if (proc.pid) { livePids.add(proc.pid); proc.once('close', () => livePids.delete(proc.pid)); }
  let stderr = '';
  let closed = false;
  proc.stderr.on('data', d => { if (stderr.length < 2000) stderr += d.toString(); });

  if (piped) {
    proc.stdin.on('error', () => {});                 // EPIPE when ffmpeg exits first
    input.on('error', () => { try { proc.stdin.destroy(); } catch {} });
    input.pipe(proc.stdin);
  }

  const close = () => {
    closed = true;
    try { ac.abort(); } catch {}
    try { input?.destroy(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    try { proc.stdout?.destroy(); } catch {}
  };

  // Wait for the first chunk of PCM data (or fail).
  const first = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`load timeout after ${loadTimeoutMs}ms`)), loadTimeoutMs);
    const done = (err, chunk) => {
      clearTimeout(timer);
      proc.stdout.off('data', onFirst);
      proc.off('error', onErr);
      proc.off('close', onClose);
      err ? reject(err) : resolve(chunk);
    };
    const onFirst = chunk => { proc.stdout.pause(); done(null, chunk); };
    const onErr   = err   => done(err);
    const onClose = code  => done(new Error(stderr.trim().split('\n')[0] || `ffmpeg exited with code ${code}`));
    proc.stdout.on('data', onFirst);
    proc.once('error', onErr);
    proc.once('close', onClose);
  }).catch(err => { close(); throw err; });

  proc.on('close', code => {
    // ffmpeg died mid-stream with an error → log it. Normal EOF has code 0.
    if (closed || code === 0 || code === null) return;
    logger.warn(`ffmpeg exited with code ${code}: ${stderr.trim().split('\n')[0] ?? ''}`);
  });

  // Re-attach the peeked chunk in front of the rest of the stream.
  const stream = Readable.from((async function* () {
    yield first;
    for await (const chunk of proc.stdout) {
      onData?.();
      yield chunk;
    }
  })(), { objectMode: false });

  return { stream, close };
}
