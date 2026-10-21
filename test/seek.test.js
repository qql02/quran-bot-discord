import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skipPcm, pcmBytesFor, PCM_BYTES_PER_MS } from '../src/services/sources/seek.js';

const collect = async (stream) => { const parts = []; for await (const c of stream) parts.push(c); return Buffer.concat(parts); };

test('PCM math: 48 kHz stereo 16-bit is 192 bytes per millisecond, always whole frames', () => {
  assert.equal(PCM_BYTES_PER_MS, 192);
  assert.equal(pcmBytesFor(1000), 192_000);
  assert.equal(pcmBytesFor(0), 0);
  assert.equal(pcmBytesFor(-5), 0);
  assert.equal(pcmBytesFor('abc'), 0);
  assert.equal(pcmBytesFor(1234) % 4, 0);
});

/** A stream of numbered 4-byte frames, delivered in awkward chunk sizes (never aligned to a frame). */
function numberedStream(frames, chunkSizes = [7, 1000, 3, 4096, 13]) {
  const all = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) all.writeUInt32LE(i, i * 4);
  const chunks = [];
  for (let at = 0, k = 0; at < all.length; k++) { const n = chunkSizes[k % chunkSizes.length]; chunks.push(all.subarray(at, at + n)); at += n; }
  return { all, stream: Readable.from(chunks, { objectMode: false }) };
}

test('skipPcm drops exactly the requested audio and keeps the rest byte for byte', async () => {
  const frames = 48_000 * 2;                                   // 2 seconds
  const { all, stream } = numberedStream(frames);
  const out = await collect(await skipPcm(stream, 500));       // 500 ms = 24 000 frames
  assert.equal(out.readUInt32LE(0), 24_000, 'the first frame is exactly frame #24000');
  assert.ok(out.equals(all.subarray(pcmBytesFor(500))));
});

test('skipPcm: 0 ms returns the stream untouched', async () => {
  const { all, stream } = numberedStream(1000);
  const same = await skipPcm(stream, 0);
  assert.equal(same, stream);
  assert.ok((await collect(same)).equals(all));
});

test('skipPcm: a position beyond the end of the recording is reported, not silently played from 0', async () => {
  const { stream } = numberedStream(48_000);                   // 1 second
  await assert.rejects(skipPcm(stream, 5_000), /seek-past-end/);
});

test('skipPcm: stopping early releases the source', async () => {
  let closed = false;
  async function* gen() { try { for (let i = 0; ; i++) yield Buffer.alloc(19_200); } finally { closed = true; } }
  const src = Readable.from(gen(), { objectMode: false });
  const out = await skipPcm(src, 300);
  await new Promise(r => out.once('data', r));                 // playback has started …
  out.destroy();                                               // … and is then stopped
  await new Promise(r => setTimeout(r, 50));
  assert.equal(closed, true);
});

// ── the real decoder: a 3 s 440 Hz tone followed by a 3 s 1760 Hz tone, started 3.5 s in ──────────────────────────────
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
test('with a real ffmpeg decode, starting at 3.5 s lands inside the SECOND tone', { skip: !hasFfmpeg }, async () => {
  const { openFfmpeg } = await import('../src/services/sources/ffmpegSource.js');
  const dir = mkdtempSync(join(tmpdir(), 'seek-'));
  try {
    const file = join(dir, 'two-tones.mp3');
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=1760:duration=3',
      '-filter_complex', '[0][1]concat=n=2:v=0:a=1', '-ar', '48000', '-ac', '2', '-b:a', '128k', file]);
    assert.equal(r.status, 0, String(r.stderr));

    const zeroCrossingsPerSecond = (pcm) => {                  // left channel only
      let z = 0, prev = 0;
      const n = Math.min(48_000, Math.floor(pcm.length / 4));
      for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 4); if ((prev < 0) !== (v < 0) && i > 0) z++; prev = v; }
      return z / 2;                                            // two crossings per cycle → Hz
    };

    const plain = await openFfmpeg(file, { bin: 'ffmpeg', loadTimeoutMs: 10_000 });
    const fromStart = await collect(plain.stream); plain.close();
    const hzStart = zeroCrossingsPerSecond(fromStart.subarray(48_000 * 4));            // inside the first tone
    assert.ok(Math.abs(hzStart - 440) < 25, `first tone ${hzStart}`);

    const src = await openFfmpeg(file, { bin: 'ffmpeg', loadTimeoutMs: 10_000 });
    const skipped = await collect(await skipPcm(src.stream, 3_500)); src.close();
    const hz = zeroCrossingsPerSecond(skipped.subarray(0, 48_000 * 4));
    assert.ok(Math.abs(hz - 1760) < 60, `expected ~1760 Hz after the skip, got ${hz}`);
    const seconds = skipped.length / 192_000;
    assert.ok(seconds > 2.3 && seconds < 2.7, `about 2.5 s should remain, got ${seconds}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
