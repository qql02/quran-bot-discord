import { Readable } from 'node:stream';
import { safeFetch } from '../urlSafety.js';
import { Mp3FrameSplitter } from './mp3Frames.js';

// ─── ffmpeg-free MP3 backend ───────────────────────────────────────────────────
// Pure JavaScript/WebAssembly: HTTP → MP3 frames → mpg123 (WASM) → resample to 48kHz → s16le stereo.
// No native modules, no child processes, no binary downloads → runs on hosts that block ffmpeg.
// Supports MP3 only (all mp3quran recordings + MP3 radio). AAC/HLS/Ogg need ffmpeg.

const OUT_RATE = 48000;
const USER_AGENT = 'Mozilla/5.0 (QuranBot; +wasm)';
const UNSUPPORTED = /(mpegurl|aac|mp4|ogg|opus|vorbis|flac|wav|webm|html|json|xml|text\/)/i;

export async function wasmAvailable() {
  try { await import('mpg123-decoder'); return true; } catch { return false; }
}

// ── Resampler ──────────────────────────────────────────────────────────────────
// Windowed-sinc (Blackman-Harris, 32 taps, 1024 sub-sample phases) streaming resampler → interleaved s16le stereo @48kHz.
// The previous linear interpolation folded high frequencies back into the audible band (measured SNR ≈ 32 dB on 44.1k
// and ≈ 24 dB on 22.05k sources, vs ≈ 80 dB for ffmpeg). Sources are always ≤ 48kHz here, so this is pure upsampling:
// the low-pass sits at the SOURCE Nyquist and nothing else needs filtering.
const HALF   = 16;                    // taps on each side of the interpolation point
const TAPS   = HALF * 2;
const PHASES = 1024;
const HIST   = TAPS;                  // samples of history carried between chunks

const KERNEL = (() => {
  const t = new Float32Array(PHASES * TAPS);
  const sinc = x => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const win  = x => {                 // Blackman-Harris over |x| ≤ HALF
    const r = 0.5 + x / (2 * HALF);
    return r < 0 || r > 1 ? 0
      : 0.35875 - 0.48829 * Math.cos(2 * Math.PI * r) + 0.14128 * Math.cos(4 * Math.PI * r) - 0.01168 * Math.cos(6 * Math.PI * r);
  };
  for (let ph = 0; ph < PHASES; ph++) {
    const frac = ph / PHASES;
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      const x = (k - (HALF - 1)) - frac;          // distance from the interpolation point, in source samples
      const w = sinc(x) * win(x);
      t[ph * TAPS + k] = w; sum += w;
    }
    for (let k = 0; k < TAPS; k++) t[ph * TAPS + k] /= sum;   // unity DC gain for every phase
  }
  return t;
})();

const clip16 = x => (x >= 1 ? 32767 : x <= -1 ? -32767 : Math.round(x * 32767));

class Resampler {
  constructor() { this.reset(0); }

  reset(srcRate) {
    this.srcRate = srcRate;
    this.histL = new Float32Array(HIST);
    this.histR = new Float32Array(HIST);
    this.pos   = HIST;                // position (in source samples) of the next output, relative to the history start
  }

  process(channels, srcRate) {
    const inL = channels[0];
    const inR = channels[1] ?? channels[0];       // mono → duplicate
    const n = inL.length;
    if (!n) return Buffer.alloc(0);
    if (srcRate !== this.srcRate) this.reset(srcRate);

    // Already 48kHz: no resampling, just float → s16.
    if (srcRate === OUT_RATE) {
      const out = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) { out[2 * i] = clip16(inL[i]); out[2 * i + 1] = clip16(inR[i]); }
      return Buffer.from(out.buffer, 0, out.byteLength);
    }

    const m = HIST + n;
    const L = new Float32Array(m), R = new Float32Array(m);
    L.set(this.histL, 0); L.set(inL, HIST);
    R.set(this.histR, 0); R.set(inR, HIST);

    const step = srcRate / OUT_RATE;
    const out  = new Int16Array(Math.ceil(n / step) * 2 + 8);
    let o = 0, p = this.pos;
    while (Math.floor(p) + HALF < m) {
      const i  = Math.floor(p);
      const kb = Math.min(PHASES - 1, Math.round((p - i) * PHASES)) * TAPS;   // nearest sub-sample phase
      const s0 = i - (HALF - 1);
      let accL = 0, accR = 0;
      for (let k = 0; k < TAPS; k++) {
        const w = KERNEL[kb + k];
        accL += L[s0 + k] * w;
        accR += R[s0 + k] * w;
      }
      out[o++] = clip16(accL);
      out[o++] = clip16(accR);
      p += step;
    }
    const shift = m - HIST;
    this.pos   = p - shift;
    this.histL = L.slice(shift);
    this.histR = R.slice(shift);
    return Buffer.from(out.buffer, 0, o * 2);
  }
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * @returns {Promise<{ stream: Readable, close: () => void }>}
 */
export async function openWasm(url, { loadTimeoutMs, onData }) {
  const { MPEGDecoder } = await import('mpg123-decoder');
  const ac = new AbortController();
  let decoder = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try { ac.abort(); } catch {}
    try { decoder?.free(); } catch {}
    decoder = null;
  };

  try {
    const res = await withTimeout(
      safeFetch(url, { signal: ac.signal, headers: { 'user-agent': USER_AGENT, 'icy-metadata': '0' } }),
      loadTimeoutMs, `load timeout after ${loadTimeoutMs}ms`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = res.headers.get('content-type') ?? '';
    if (UNSUPPORTED.test(ct)) throw new Error(`format not supported without ffmpeg (${ct})`);

    decoder = new MPEGDecoder();
    await decoder.ready;
    const splitter = new Mp3FrameSplitter();
    const resampler = new Resampler();

    // Pull-based: the network is only read as fast as Discord consumes audio.
    const it = (async function* () {
      for await (const chunk of res.body) {
        if (closed) return;
        onData?.();
        const frames = splitter.push(chunk);
        if (!frames) continue;
        const r = decoder.decode(new Uint8Array(frames));
        if (!r.samplesDecoded) continue;
        const pcm = resampler.process(r.channelData, r.sampleRate);
        if (pcm.length) yield pcm;
      }
    })()[Symbol.asyncIterator]();

    const first = await withTimeout(it.next(), loadTimeoutMs, `no audio data within ${loadTimeoutMs}ms`);
    if (first.done) throw new Error('stream contained no decodable MP3 audio');

    const stream = Readable.from((async function* () {
      yield first.value;
      for (;;) {
        const n = await it.next();
        if (n.done) return;
        yield n.value;
      }
    })(), { objectMode: false });
    stream.on('close', close);

    return { stream, close };
  } catch (err) {
    close();
    throw err;
  }
}
