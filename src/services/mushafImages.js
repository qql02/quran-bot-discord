import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, open, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { mapLimit } from '../utils/mapLimit.js';

/**
 * Page IMAGES of the Mushaf — Hafs (عن عاصم) and Warsh (عن نافع) — from quran.ws (King Fahd Glorious Qur'an Printing Complex
 * artwork, pinned release). Nothing here touches the text reader; this service only answers "give me the picture of page N".
 *
 *   • SVG pages are kept untouched on disk:  <dir>/<riwaya>/NNN.svg  (default <project>/assets/quran-images).
 *   • At start-up the folder is scanned and ONLY missing or damaged pages are downloaded (background, a few at a time).
 *     Hosts that wipe local files on restart simply re-download; point MUSHAF_IMAGES_DIR at a persistent folder to avoid it.
 *   • Every file is checked before it is trusted: structure (a complete <svg> document) and — when the CDN manifest is
 *     readable — its exact size and SHA-256. A bad download is never saved; it is retried with back-off.
 *   • A page nobody downloaded yet is fetched on demand the first time a member opens it.
 *   • SVG → PNG happens only when a page is shown (pure JS/native resvg, no FFmpeg, no system fonts needed — the pages are
 *     vector outlines); the last PNGs stay in memory and concurrent requests for one page share one render.
 *
 * Page numbers: in these two KFQC editions every page holds the same part of the Quran (verified against the source
 * data: all 114 surahs start on the same page and all 604 pages carry the same surah sequence) — only the ayah NUMBERS
 * differ between the riwayat. So the page number the reader already uses is the right page for both.
 */
export const TOTAL_PAGES = 604;
export const RIWAYAS = Object.freeze(['hafs', 'warsh']);
export const isRiwaya = (r) => RIWAYAS.includes(r);
const CDN_FOLDER = Object.freeze({ hafs: 'hafs-kfqc', warsh: 'warsh-kfqc' });

const DEFAULT_DIR = fileURLToPath(new URL('../../assets/quran-images/', import.meta.url));
const MIN_SVG_BYTES = 4_000;            // the smallest real page is >100 KB; anything tiny is an error page or a cut-off file
const MAX_SVG_BYTES = 8_000_000;
const ATTEMPTS = 4;
const FAIL_COOLDOWN_MS = 30_000;
const PNG_CACHE_MAX = 10;   // was 40: every cached PNG page stays in RAM
const RENDER_SLOTS = 2;     // pages rasterised at once: each render holds the whole SVG + a bitmap (tens of MB), so a crowd turning pages must queue
let renderBusy = 0;
const renderQueue = [];
async function withRenderSlot(fn) {
  if (renderBusy >= RENDER_SLOTS) await new Promise(r => renderQueue.push(r));
  renderBusy++;
  try { return await fn(); }
  finally { renderBusy--; renderQueue.shift()?.(); }
}
const RESYNC_MIN_MS = 10 * 60_000;
const RESYNC_MAX_MS = 60 * 60_000;
const SVG_BYTES_ESTIMATE = 420_000;      // average per page, for the free-disk check

const pad = (n) => String(n).padStart(3, '0');
export const isPageNo = (n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_PAGES;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Test hook: shrink the retry back-off so a failing page does not make a test wait seconds. */
export const tuning = { backoffBaseMs: 1_000, onDemandDeadlineMs: 20_000 };

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────
export const pageDir  = (riwaya, dir = config.mushafImages.dir || DEFAULT_DIR) => path.join(dir, riwaya);
export const pagePath = (riwaya, page, dir = config.mushafImages.dir || DEFAULT_DIR) => path.join(pageDir(riwaya, dir), `${pad(page)}.svg`);
export const pageUrl  = (riwaya, page, base = config.mushafImages.cdnUrl) => `${String(base).replace(/\/+$/, '')}/${CDN_FOLDER[riwaya]}/${pad(page)}.svg`;
export const manifestUrl = (base = config.mushafImages.cdnUrl) => `${String(base).replace(/\/+$/, '')}/manifest.json`;
export const activeRiwayas = (setting = config.mushafImages.riwayat) => (setting === 'both' ? [...RIWAYAS] : RIWAYAS.filter(r => r === setting));

/** A whole SVG document: big enough, starts like one, ends like one. Catches HTML error pages and cut-off transfers. */
export function isValidSvg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < MIN_SVG_BYTES || buf.length > MAX_SVG_BYTES) return false;
  const head = buf.subarray(0, 600).toString('utf8');
  const tail = buf.subarray(Math.max(0, buf.length - 64)).toString('utf8').trimEnd();
  return /<svg[\s>]/.test(head) && tail.endsWith('</svg>');
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * The CDN publishes <base>/manifest.json (every file with its size and sha256). Its exact shape is not documented anywhere
 * this code could rely on, so the reader accepts the usual layouts and returns null — never throws — for anything else;
 * without a manifest the structural check above is still applied to every file.
 * @returns {Map<string, {size:number|null, sha256:string|null}> | null}  key: "hafs-kfqc/001.svg"
 */
export function parseManifest(json) {
  const out = new Map();
  const add = (p, v) => {
    const m = /(?:^|\/)((?:hafs|warsh)-kfqc)\/(\d{3})\.svg$/.exec(String(p ?? ''));
    if (!m || !v || typeof v !== 'object') return;
    const size = Number(v.size ?? v.bytes ?? v.length);
    const hash = String(v.sha256 ?? v.sha ?? v.hash ?? v.digest ?? '').toLowerCase().replace(/^sha-?256[:=-]?/, '');
    out.set(`${m[1]}/${m[2]}.svg`, { size: Number.isFinite(size) && size > 0 ? size : null, sha256: /^[0-9a-f]{64}$/.test(hash) ? hash : null });
  };
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) { for (const e of node) add(e?.path ?? e?.file ?? e?.name ?? e?.key ?? e?.url, e); return; }
    for (const [k, v] of Object.entries(node)) {
      if (/\.svg$/.test(k)) add(k, v);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  try { walk(json); } catch { return null; }
  return out.size ? out : null;
}

// ── State ──────────────────────────────────────────────────────────────────────
const have     = new Map(RIWAYAS.map(r => [r, new Set()]));   // pages verified on disk
const missingForever = new Map(RIWAYAS.map(r => [r, new Map()]));   // page → ts: the CDN answered 404 — not asked again for an hour (a bad deploy must not hide a page until the next restart)
const GONE_MS = 60 * 60_000;
const isGone = (riwaya, page) => { const t = missingForever.get(riwaya).get(page); if (t === undefined) return false; if (Date.now() - t > GONE_MS) { missingForever.get(riwaya).delete(page); return false; } return true; };
const inflight = new Map();                                   // "riwaya:page" → Promise<boolean> (download)
const failedAt = new Map();                                   // "riwaya:page" → ts
const pngCache = new Map();                                   // "riwaya:page" → { buffer }
const pngInflight = new Map();
let manifest = null;
let manifestTried = false;
let running = null;
let stopped = false;
let resyncTimer = null;
let resyncDelay = RESYNC_MIN_MS;
let rendererPromise = null;
let rendererBroken = false;
const progress = { total: 0, done: 0, failed: 0, startedAt: 0 };

export const mushafImagesEnabled = () => config.mushafImages.enabled && !rendererBroken;
export function mushafImageStatus() {
  const riw = activeRiwayas();
  return {
    enabled: config.mushafImages.enabled, rendererBroken, running: !!running,
    riwayat: Object.fromEntries(riw.map(r => [r, have.get(r).size])), total: TOTAL_PAGES * riw.length,
    manifest: manifest ? manifest.size : 0, failed: progress.failed, pngCached: pngCache.size
  };
}

/** Test hook: drop only the rendered PNGs (the page files and what is known about them stay). */
export const clearMushafPngCache = () => pngCache.clear();

/** Test hook: forget everything held in memory (files on disk are untouched). */
export function resetMushafImages() {
  for (const s of have.values()) s.clear();
  for (const s of missingForever.values()) s.clear();
  inflight.clear(); failedAt.clear(); pngCache.clear(); pngInflight.clear();
  manifest = null; manifestTried = false; running = null; stopped = false; rendererPromise = null; rendererBroken = false;
  clearTimeout(resyncTimer); resyncTimer = null; resyncDelay = RESYNC_MIN_MS;
  progress.total = progress.done = progress.failed = progress.startedAt = 0;
}

// ── Disk ───────────────────────────────────────────────────────────────────────
/** Cheap check of a file already on disk (size, first and last bytes) — the full SHA-256 is verified when downloading. */
async function fileLooksFine(file, key) {
  let fh;
  try {
    const st = await stat(file);
    if (!st.isFile() || st.size < MIN_SVG_BYTES || st.size > MAX_SVG_BYTES) return false;
    const want = manifest?.get(key);
    if (want?.size && want.size !== st.size) return false;
    fh = await open(file, 'r');
    const head = Buffer.alloc(600), tail = Buffer.alloc(64);
    await fh.read(head, 0, 600, 0);
    await fh.read(tail, 0, 64, Math.max(0, st.size - 64));
    return /<svg[\s>]/.test(head.toString('utf8')) && tail.toString('utf8').trimEnd().endsWith('</svg>');
  } catch { return false; }
  finally { await fh?.close().catch(() => {}); }
}

/** Index what is on disk; damaged files and leftovers of interrupted downloads are removed so they get downloaded again. */
async function scanDisk(riwayat) {
  for (const riwaya of riwayat) {
    const dir = pageDir(riwaya);
    await mkdir(dir, { recursive: true });
    const set = have.get(riwaya);
    set.clear();
    let names = [];
    try { names = await readdir(dir); } catch { /* fresh folder */ }
    for (const name of names) {
      const file = path.join(dir, name);
      if (/\.part-\d+(-\d+)?$/.test(name)) {                     // leftover of an interrupted download — but not one that is being written right now
        const st = await stat(file).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 5 * 60_000) await unlink(file).catch(() => {});
        continue;
      }
      const m = /^(\d{3})\.svg$/.exec(name);
      if (!m) continue;
      const page = Number(m[1]);
      if (!isPageNo(page)) continue;
      if (await fileLooksFine(file, `${CDN_FOLDER[riwaya]}/${m[1]}.svg`)) set.add(page);
      else { logger.warn(`[mushaf-images] ${riwaya}/${name} is damaged — it will be downloaded again`); await unlink(file).catch(() => {}); }
    }
  }
}

async function loadManifest() {
  if (manifestTried && manifest) return manifest;
  manifestTried = true;
  try {
    const { data } = await axios.get(manifestUrl(), { timeout: 20_000, maxContentLength: 20_000_000, maxRedirects: 2, responseType: 'json' });
    manifest = parseManifest(data);
    logger.info(manifest ? `[mushaf-images] manifest read (${manifest.size} files) — sizes and SHA-256 will be verified` : '[mushaf-images] manifest has an unexpected format — files are checked by structure only');
  } catch (err) {
    manifest = null;
    logger.info(`[mushaf-images] manifest not available (${err.message}) — files are checked by structure only`);
  }
  return manifest;
}

// ── Download ───────────────────────────────────────────────────────────────────
const retryable = (err) => { const s = err?.response?.status; return !s || s === 408 || s === 425 || s === 429 || s >= 500; };

/** One page: download → verify → atomic write. Returns true when the page is on disk and trusted afterwards. */
export function downloadPage(riwaya, page, opts = {}) {
  if (!isRiwaya(riwaya) || !isPageNo(page)) return Promise.resolve(false);
  const id = `${riwaya}:${page}`;
  if (have.get(riwaya).has(page)) return Promise.resolve(true);
  if (isGone(riwaya, page)) return Promise.resolve(false);
  if (Date.now() - (failedAt.get(id) ?? 0) < FAIL_COOLDOWN_MS) return Promise.resolve(false);
  if (inflight.has(id)) return inflight.get(id);
  const p = doDownload(riwaya, page, opts).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doDownload(riwaya, page, { attempts = ATTEMPTS, timeoutMs = 30_000 } = {}) {
  const id = `${riwaya}:${page}`;
  const url = pageUrl(riwaya, page);
  const key = `${CDN_FOLDER[riwaya]}/${pad(page)}.svg`;
  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= attempts && !stopped; attempt++) {
    let tmp = null;
    try {
      const res = await axios.get(url, { timeout: timeoutMs, responseType: 'arraybuffer', maxContentLength: MAX_SVG_BYTES, maxRedirects: 2, validateStatus: s => s === 200 });
      const buf = Buffer.from(res.data);
      const want = manifest?.get(key);
      if (!isValidSvg(buf)) throw Object.assign(new Error('not a complete SVG document'), { corrupt: true });
      if (want?.size && want.size !== buf.length) throw Object.assign(new Error(`size ${buf.length} ≠ manifest ${want.size}`), { corrupt: true });
      if (want?.sha256 && want.sha256 !== sha256(buf)) throw Object.assign(new Error('SHA-256 differs from the manifest'), { corrupt: true });

      const file = pagePath(riwaya, page);
      await mkdir(path.dirname(file), { recursive: true });
      tmp = `${file}.part-${process.pid}-${attempt}`;
      await writeFile(tmp, buf);
      await rename(tmp, file);                    // atomic: a crash can never leave a half-written .svg
      have.get(riwaya).add(page);
      failedAt.delete(id);
      return true;
    } catch (err) {
      if (tmp) await unlink(tmp).catch(() => {});                 // a failed write (disk full…) must not leave a half file behind
      lastErr = err?.response?.status ? `HTTP ${err.response.status}` : err.message;
      if (err?.response?.status === 404) { missingForever.get(riwaya).set(page, Date.now()); logger.warn(`[mushaf-images] ${riwaya} page ${page} does not exist on the CDN (404)`); return false; }
      if (!retryable(err) && !err.corrupt) break;
      if (attempt < attempts) await sleep(Math.min(8_000, tuning.backoffBaseMs * 2 ** (attempt - 1)) + Math.random() * 300 * (tuning.backoffBaseMs / 1_000));
    }
  }
  failedAt.set(id, Date.now());
  logger.warn(`[mushaf-images] ${riwaya} page ${page} failed: ${lastErr}`);
  return false;
}

async function freeBytes(dir) {
  try { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
}

/** Download everything that is missing. Safe to call again: it only does the remaining work. */
async function syncOnce() {
  const riwayat = activeRiwayas();
  await scanDisk(riwayat);
  await loadManifest();
  if (manifest) await scanDisk(riwayat);       // re-judge the files with the manifest's exact sizes

  const todo = [];
  for (const r of riwayat) for (let p = 1; p <= TOTAL_PAGES; p++) if (!have.get(r).has(p) && !isGone(r, p)) todo.push([r, p]);
  const present = riwayat.length * TOTAL_PAGES - todo.length;
  if (!todo.length) { logger.info(`[mushaf-images] all ${present} pages are on disk`); return 0; }
  if (!config.mushafImages.prefetch) { logger.info(`[mushaf-images] ${present} pages on disk, ${todo.length} missing — prefetch is off, they download when opened`); return 0; }

  const dir = config.mushafImages.dir || DEFAULT_DIR;
  const need = todo.length * SVG_BYTES_ESTIMATE;
  const free = await freeBytes(dir);
  if (free < need + 200e6) {
    logger.warn(`[mushaf-images] only ${Math.round(free / 1e6)}MB free for ~${Math.round(need / 1e6)}MB of pages — bulk download skipped; pages are fetched when opened (set MUSHAF_IMAGES_RIWAYAT=hafs or warsh to need less)`);
    return 0;
  }

  logger.info(`[mushaf-images] ${present}/${riwayat.length * TOTAL_PAGES} pages on disk — downloading ${todo.length} missing ones in the background`);
  Object.assign(progress, { total: todo.length, done: 0, failed: 0, startedAt: Date.now() });
  let streak = 0;
  await mapLimit(todo, config.mushafImages.concurrency, async ([riwaya, page]) => {
    if (stopped || streak >= 12) return;       // 12 failures in a row = offline: stop and retry later instead of hammering
    const ok = await downloadPage(riwaya, page);
    if (ok) { streak = 0; progress.done++; } else { streak++; progress.failed++; }
    if (ok && progress.done % 100 === 0) logger.info(`[mushaf-images] ${progress.done}/${progress.total} downloaded`);
  });
  const left = todo.filter(([r, p]) => !have.get(r).has(p) && !isGone(r, p)).length;
  logger.info(`[mushaf-images] download finished: ${progress.done} new, ${left} still missing`);
  return left;
}

/** Called once the bot is ready. Never throws and never blocks start-up; retries by itself when the network was down. */
export function startMushafImages() {
  if (!config.mushafImages.enabled) { logger.info('[mushaf-images] switched off (MUSHAF_IMAGES=off)'); return Promise.resolve(); }
  if (running) return running;
  stopped = false;
  const run = async () => {
    try {
      const left = await syncOnce();
      if (left > 0 && !stopped) {
        clearTimeout(resyncTimer);
        resyncTimer = setTimeout(() => { running = null; void startMushafImages(); }, resyncDelay);
        resyncTimer.unref?.();
        resyncDelay = Math.min(RESYNC_MAX_MS, resyncDelay * 2);
      } else resyncDelay = RESYNC_MIN_MS;
    } catch (err) {
      logger.warn(`[mushaf-images] sync failed: ${err.message}`);
    } finally {
      if (running === current) running = null;
    }
  };
  const current = run();
  running = current;
  return current;
}

export function stopMushafImages() { stopped = true; clearTimeout(resyncTimer); resyncTimer = null; }

// ── SVG → PNG ──────────────────────────────────────────────────────────────────
async function renderer() {
  if (rendererBroken) return null;
  rendererPromise ??= import('@resvg/resvg-js').then(m => ({ Resvg: m.Resvg ?? m.default?.Resvg, renderAsync: m.renderAsync ?? m.default?.renderAsync })).catch(err => {
    rendererBroken = true;
    logger.warn(`[mushaf-images] the SVG renderer could not be loaded (${err.message}) — page images are disabled, the text reader is unaffected`);
    return null;
  });
  const r = await rendererPromise;
  return r?.Resvg ? r : null;
}

const BG = { r: 0xfb, g: 0xf7, b: 0xee };            // the page background '#fbf7ee'
const INK_PROBE_WIDTH = 600;                          // the first, small render only measures where the ink is
const INK_DIFF = 24;                                  // how far a pixel must differ from the background to count as ink

/** The visible ink of a raw RGBA bitmap as pixel bounds, or null when the bitmap is blank. */
export function inkBounds(pixels, width, height) {
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
      if (Math.abs(pixels[i] - BG.r) > INK_DIFF || Math.abs(pixels[i + 1] - BG.g) > INK_DIFF || Math.abs(pixels[i + 2] - BG.b) > INK_DIFF) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1 };
}

/**
 * The two opening pages fill a fifth of their box. Instead of trusting the box the SVG reports (it can miss the edge of a
 * line — Warsh page 1 lost the end of its lines that way), the page is drawn once, small, and the ink is MEASURED on the
 * bitmap; then the SVG's own viewBox is moved onto that ink and the page is drawn again at full size. Both draws run on the
 * thread pool. Returns null when the SVG has no usable viewBox (the caller then shows the whole page, never a cut one).
 */
async function cropToInk(svg, renderAsync, opts, width) {
  const text = Buffer.isBuffer(svg) ? svg.toString('utf8') : String(svg);
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  const vb = tag && /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/i.exec(tag);
  if (!vb) return null;
  const [vx, vy, vw, vh] = vb.slice(1).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) return null;
  const bare = tag.replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');           // size = viewBox, so pixels map to units exactly
  const withTag = (t) => text.replace(tag, () => t);
  const probe = await renderAsync(withTag(bare), { ...opts, fitTo: { mode: 'width', value: INK_PROBE_WIDTH } });
  const ink = inkBounds(probe.pixels, probe.width, probe.height);
  if (!ink) return null;
  const k = vw / probe.width;                                                               // viewBox units per probe pixel
  const margin = Math.max(10, 0.05 * Math.max(ink.x1 - ink.x0, ink.y1 - ink.y0));          // air around the ink, in probe pixels
  const nx = vx + (ink.x0 - margin) * k, ny = vy + (ink.y0 - margin) * k;
  const nw = (ink.x1 - ink.x0 + 1 + 2 * margin) * k, nh = (ink.y1 - ink.y0 + 1 + 2 * margin) * k;
  if (!(nw > 0 && nh > 0)) return null;
  const moved = bare.replace(/(\sviewBox\s*=\s*)(["'])[^"']*\2/i, (_m, pre, q) => `${pre}${q}${nx} ${ny} ${nw} ${nh}${q}`);
  return (await renderAsync(withTag(moved), { ...opts, fitTo: { mode: 'width', value: Math.round(width * 0.8) } })).asPng();
}

/**
 * Pure render of one SVG buffer into a PNG buffer. The two opening pages fill a fifth of their box, so those are cropped to the ink.
 *
 * Every render goes through renderAsync (rasterised on libuv's thread pool): a synchronous render() blocks Node's one thread for
 * the whole rasterisation, which cuts the voice streams of EVERY server — and makes Discord buttons fail with "This interaction
 * failed" when they arrive meanwhile — whenever somebody turns a page.
 */
export async function svgToPng(svg, { page, width = config.mushafImages.widthPx } = {}) {
  const lib = await renderer();
  if (!lib) return null;
  const { Resvg, renderAsync } = lib;
  const opts = { background: '#fbf7ee', font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: width } };
  if (typeof renderAsync !== 'function') return new Resvg(svg, opts).render().asPng();   // an older resvg without it: still works
  if (page !== undefined && page <= 2) {
    try { const cropped = await cropToInk(svg, renderAsync, opts, width); if (cropped) return cropped; }
    catch (err) { logger.warn(`[mushaf-images] page ${page}: cropping failed (${err.message}) — showing the whole page`); }
  }
  return (await renderAsync(svg, opts)).asPng();
}

/**
 * The picture of one page, ready to attach to a Discord message, or null when it cannot be had (images off, CDN down and the
 * page not on disk, renderer missing). Never throws: callers fall back to the text page.
 * @returns {Promise<{ buffer: Buffer, name: string } | null>}
 */
export async function getMushafImage(riwaya, page) {
  if (!config.mushafImages.enabled || !isRiwaya(riwaya) || !isPageNo(page) || !activeRiwayas().includes(riwaya)) return null;
  const id = `${riwaya}:${page}`;
  const name = `mushaf-${riwaya}-${pad(page)}.png`;
  const hit = pngCache.get(id);
  if (hit) { pngCache.delete(id); pngCache.set(id, hit); return { buffer: hit, name }; }
  if (pngInflight.has(id)) return pngInflight.get(id);

  const p = (async () => {
    try {
      const png = await withRenderSlot(async () => {
        const svg = await loadSvg(riwaya, page);
        return svg ? svgToPng(svg, { page }) : null;
      });
      if (!png) return null;
      pngCache.set(id, png);
      while (pngCache.size > PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value);
      return { buffer: png, name };
    } catch (err) {
      logger.warn(`[mushaf-images] ${riwaya} page ${page} could not be shown: ${err.message}`);
      return null;
    }
  })().finally(() => pngInflight.delete(id));
  pngInflight.set(id, p);
  return p;
}

const withDeadline = (promise, ms) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), ms); t.unref?.();
  promise.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(false); });
});

/**
 * The SVG of a page, from disk — downloading it first when it is not there. A member is waiting, so the download is quick
 * (2 tries, 10 s each, 20 s in all; it carries on in the background). A file that vanished (the host cleaned the folder) or
 * turned out damaged is forgotten and fetched once more instead of staying "present" forever.
 */
async function loadSvg(riwaya, page) {
  for (let pass = 0; pass < 2; pass++) {
    if (!have.get(riwaya).has(page)) await scanFile(riwaya, page);
    if (!have.get(riwaya).has(page) && !(await withDeadline(downloadPage(riwaya, page, { attempts: 2, timeoutMs: 10_000 }), tuning.onDemandDeadlineMs))) return null;
    try { const svg = await readFile(pagePath(riwaya, page)); if (isValidSvg(svg)) return svg; } catch { /* gone */ }
    have.get(riwaya).delete(page);
    await unlink(pagePath(riwaya, page)).catch(() => {});
  }
  return null;
}

/** A page may be on disk although the start-up scan has not reached it yet (or was skipped): look before downloading. */
async function scanFile(riwaya, page) {
  if (await fileLooksFine(pagePath(riwaya, page), `${CDN_FOLDER[riwaya]}/${pad(page)}.svg`)) have.get(riwaya).add(page);
}

/** Warm the next page in the background so "التالية" feels instant. Never throws, never waits. */
export function prefetchMushafImage(riwaya, page) {
  if (isRiwaya(riwaya) && isPageNo(page)) getMushafImage(riwaya, page).catch(() => {});
}
