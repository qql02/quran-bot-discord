import { Readable } from 'node:stream';

/**
 * Starting a recitation from the middle (the "pull" command moves a listener to another room without losing their place).
 *
 * Both decoding backends (ffmpeg and the pure-JS/WASM one) end up producing the same thing: 48 kHz, stereo, 16-bit PCM.
 * That is exactly 192 bytes per millisecond, so "start at 12:30" is simply "throw away the first N bytes" — one implementation
 * that works for every backend, with sample-exact precision. The cost is decoding the skipped part once, which is much faster
 * than real time (a few seconds for half an hour of audio).
 */
export const PCM_BYTES_PER_MS = 192;                   // 48000 Hz × 2 channels × 2 bytes ÷ 1000

/** How many PCM bytes `ms` milliseconds are (always a whole number of stereo frames). */
export const pcmBytesFor = (ms) => Math.floor(Math.max(0, Number(ms) || 0) * PCM_BYTES_PER_MS / 4) * 4;

/**
 * Drop the first `ms` of PCM audio from `stream`.
 * Resolves once the first chunk AFTER the skipped part has arrived (so the caller knows audio is really flowing).
 * Rejects with `Error('seek-past-end')` when the stream ends before `ms` was reached (the position is beyond the file).
 * @param {import('node:stream').Readable} stream
 * @param {number} ms
 * @returns {Promise<Readable>}
 */
export async function skipPcm(stream, ms) {
  let toSkip = pcmBytesFor(ms);
  if (toSkip === 0) return stream;

  const it = stream[Symbol.asyncIterator]();
  let first;
  for (;;) {
    const n = await it.next();
    if (n.done) throw new Error('seek-past-end');
    const chunk = n.value;
    if (toSkip >= chunk.length) { toSkip -= chunk.length; continue; }
    first = toSkip > 0 ? chunk.subarray(toSkip) : chunk;
    break;
  }

  return Readable.from((async function* () {
    try {
      yield first;
      for (;;) {
        const n = await it.next();
        if (n.done) return;
        yield n.value;
      }
    } finally {
      try { await it.return?.(); } catch { /* source already closed */ }
    }
  })(), { objectMode: false });
}
