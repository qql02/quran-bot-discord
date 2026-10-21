// Minimal MP3 (MPEG audio, Layer II/III) frame splitter.
// mpg123-decoder (WASM) only accepts COMPLETE frames, but network chunks cut frames anywhere.
// This buffers bytes, skips ID3v2 tags, resynchronises after garbage, and emits only whole frames.

const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** @returns {{len:number, sampleRate:number}|null} for a valid header at buf[i] (needs 4 bytes) */
function parseHeader(buf, i) {
  if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (buf[i + 1] >> 3) & 3;           // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
  const layer = (buf[i + 1] >> 1) & 3;         // 1 = III, 2 = II, 3 = I, 0 = reserved
  const brIdx = (buf[i + 2] >> 4) & 15;
  const srIdx = (buf[i + 2] >> 2) & 3;
  const pad = (buf[i + 2] >> 1) & 1;
  if (ver === 1 || layer === 0 || layer === 3 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const sampleRate = SR[ver][srIdx];
  let kbps;
  if (ver === 3) kbps = (layer === 1 ? BR_V1_L3 : BR_V1_L2)[brIdx];
  else kbps = BR_V2_L23[brIdx];
  const bitrate = kbps * 1000;
  const len = (layer === 1 && ver !== 3)
    ? Math.floor((72 * bitrate) / sampleRate) + pad     // MPEG2/2.5 Layer III: 576 samples/frame
    : Math.floor((144 * bitrate) / sampleRate) + pad;
  return len >= 21 ? { len, sampleRate } : null;
}

export class Mp3FrameSplitter {
  constructor() { this.buf = Buffer.alloc(0); this.checkedId3 = false; this.id3Skip = 0; }

  /** Feed a network chunk; returns a Buffer of zero or more COMPLETE frames (or null). */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const b = this.buf;
    let pos = 0;

    // ID3v2 tag at the very start: "ID3" + ver(2) + flags(1) + syncsafe size(4)
    if (!this.checkedId3) {
      if (b.length < 10) return null;
      if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
        const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
        this.id3Skip = 10 + size + ((b[5] & 0x10) ? 10 : 0);
      }
      this.checkedId3 = true;
    }
    if (this.id3Skip) {
      const skip = Math.min(this.id3Skip, b.length);
      pos = skip; this.id3Skip -= skip;
      if (this.id3Skip) { this.buf = Buffer.alloc(0); return null; }
    }

    const start = pos;
    let end = pos;
    while (pos + 4 <= b.length) {
      const h = parseHeader(b, pos);
      if (!h) { pos++; end = Math.max(end, start); continue; }          // garbage → resync byte by byte
      const next = pos + h.len;
      if (next + 4 <= b.length) {
        if (!parseHeader(b, next)) { pos++; continue; }                  // false sync: next frame must also be valid
      } else if (next > b.length) break;                                 // incomplete frame → wait for more data
      pos = next; end = pos;
    }
    // Keep from where we stopped (incomplete frame / partial header); frames are b[start..end)
    const frames = end > start ? b.subarray(start, end) : null;
    this.buf = Buffer.from(b.subarray(Math.max(end, Math.min(pos, b.length))));
    return frames;
  }
}
