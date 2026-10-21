import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat, truncate, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The page-image service against a local HTTP server standing in for cdn.quran.ws (no test ever touches the network).
// The "pages" served here are plain geometric test shapes — NOT Quran pages; they only need to be valid SVG documents.
const dir = await mkdtemp(path.join(tmpdir(), 'mushaf-images-'));
const hits = new Map();                      // url path → request count
const behaviour = new Map();                 // url path → (count) => { status, body? }
const wrongSha = new Set();

const fakeSvg = (riwaya, page) => {
  const vb = page <= 2 ? '-50 -200 345 550' : '0 0 345 550';
  const ink = Array.from({ length: 60 }, (_, i) => `<path d="M ${10 + (i % 10) * 30} ${20 + Math.floor(i / 10) * 40} h 24 v 18 h -24 Z"/>`).join('');
  return `<?xml version='1.0' encoding='UTF-8'?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${vb}"><path class="ayahPolygon" fill-opacity="0" d="M 0 0 L 10 0 L 10 10 Z"/>${ink}<!-- ${riwaya} ${page} ${'x'.repeat(2500)} --></svg>\n`;
};
const rel = (riwaya, page) => `${riwaya}-kfqc/${String(page).padStart(3, '0')}.svg`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const manifestDoc = () => {
  const files = {};
  for (const r of ['hafs', 'warsh']) for (let p = 1; p <= 604; p++) {
    const svg = fakeSvg(r, p);
    files[rel(r, p)] = { size: Buffer.byteLength(svg), sha256: wrongSha.has(rel(r, p)) ? 'f'.repeat(64) : sha(svg) };
  }
  return { version: 'v1.1.1', files };
};

const server = http.createServer(async (req, res) => {
  const url = req.url.replace(/^\/pages\/v1\.1\.1\//, '');
  const n = (hits.get(url) ?? 0) + 1; hits.set(url, n);
  const custom = behaviour.get(url)?.(n);
  if (custom?.delayMs) await new Promise(r => setTimeout(r, custom.delayMs));
  if (custom?.status) { res.statusCode = custom.status; return res.end(custom.body ?? ''); }
  if (url === 'manifest.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(manifestDoc())); }
  const m = /^(hafs|warsh)-kfqc\/(\d{3})\.svg$/.exec(url);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 604) { res.statusCode = 404; return res.end('nope'); }
  res.setHeader('content-type', 'image/svg+xml'); res.end(fakeSvg(m[1], Number(m[2])));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.MUSHAF_IMAGES_DIR = dir;
process.env.MUSHAF_IMAGES_CDN = `http://127.0.0.1:${server.address().port}/pages/v1.1.1`;
process.env.MUSHAF_IMAGES_CONCURRENCY = '6';
process.env.ADMIN_IDS = '999999999999999999';

const S = await import('../src/services/mushafImages.js');
const { kindFor, parseKind, imageView, TEXT_VIEW, viewFromPref, prefOfView } = await import('../src/utils/mushaf.js');
S.tuning.backoffBaseMs = 1;                  // retries without waiting seconds

after(async () => { S.stopMushafImages(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });

const svgFiles = async (riwaya) => (await readdir(path.join(dir, riwaya))).filter(f => f.endsWith('.svg')).length;
const reset = () => { S.stopMushafImages(); S.resetMushafImages(); };

test('pure helpers: URLs, paths, SVG validation', () => {
  assert.equal(S.pageUrl('hafs', 1, 'https://cdn.quran.ws/svg/pages/v1.1.1/'), 'https://cdn.quran.ws/svg/pages/v1.1.1/hafs-kfqc/001.svg');
  assert.equal(S.pageUrl('warsh', 604, 'https://cdn.quran.ws/svg/pages/v1.1.1'), 'https://cdn.quran.ws/svg/pages/v1.1.1/warsh-kfqc/604.svg');
  assert.equal(S.manifestUrl('https://x.test/v/'), 'https://x.test/v/manifest.json');
  assert.equal(S.pagePath('warsh', 45, '/data'), path.join('/data', 'warsh', '045.svg'));
  assert.deepEqual(S.activeRiwayas('both'), ['hafs', 'warsh']); assert.deepEqual(S.activeRiwayas('warsh'), ['warsh']);
  assert.ok(S.isPageNo(1) && S.isPageNo(604) && !S.isPageNo(0) && !S.isPageNo(605) && !S.isPageNo('3') && !S.isPageNo(2.5));

  const good = Buffer.from(fakeSvg('hafs', 3));
  assert.ok(S.isValidSvg(good));
  assert.ok(!S.isValidSvg(good.subarray(0, good.length - 40)), 'cut-off transfer');
  assert.ok(!S.isValidSvg(Buffer.from(`<html><body>${'x'.repeat(5000)}</body></html>`)), 'an HTML error page');
  assert.ok(!S.isValidSvg(Buffer.from('<svg></svg>')), 'tiny');
  assert.ok(!S.isValidSvg('<svg>'), 'not a buffer');
});

test('manifest parsing accepts the usual layouts and never throws', () => {
  const entry = { size: 1234, sha256: 'a'.repeat(64) };
  const expected = { size: 1234, sha256: 'a'.repeat(64) };
  assert.deepEqual(S.parseManifest({ files: { 'hafs-kfqc/001.svg': entry } }).get('hafs-kfqc/001.svg'), expected, 'map under files');
  assert.deepEqual(S.parseManifest({ 'svg/pages/v1.1.1/warsh-kfqc/002.svg': entry }).get('warsh-kfqc/002.svg'), expected, 'top-level map with a long path');
  assert.deepEqual(S.parseManifest([{ path: 'hafs-kfqc/003.svg', bytes: 1234, sha256: `sha256:${'A'.repeat(64)}` }]).get('hafs-kfqc/003.svg'), expected, 'array, bytes + prefixed uppercase hash');
  assert.deepEqual(S.parseManifest({ files: [{ file: 'warsh-kfqc/004.svg', size: 1234, hash: 'a'.repeat(64) }] }).get('warsh-kfqc/004.svg'), expected);
  assert.deepEqual(S.parseManifest({ files: { 'hafs-kfqc/005.svg': { size: 9 } } }).get('hafs-kfqc/005.svg'), { size: 9, sha256: null }, 'size only');
  for (const junk of [null, undefined, 5, 'x', [], {}, { files: {} }, { a: { b: 1 } }, [{ path: 'qalon-kfqc/001.svg', size: 1 }]]) assert.equal(S.parseManifest(junk), null, JSON.stringify(junk));
});

test('view codec: the reader ids stay backwards compatible and round-trip', () => {
  assert.equal(kindFor('p'), 'p'); assert.equal(kindFor('jump', TEXT_VIEW), 'jump'); assert.equal(kindFor('done'), 'done');
  assert.equal(kindFor('p', imageView('hafs')), 'ih'); assert.equal(kindFor('p', imageView('warsh')), 'iw');
  assert.equal(kindFor('jumpm', imageView('warsh')), 'jumpmiw'); assert.equal(kindFor('done', imageView('hafs')), 'doneih');
  for (const base of ['p', 'jump', 'jumpm', 'done', 'mine']) for (const view of [TEXT_VIEW, imageView('hafs'), imageView('warsh')]) {
    assert.deepEqual(parseKind(kindFor(base, view)), { base, view }, `${base} ${view.mode}${view.riwaya ?? ''}`);
  }
  assert.deepEqual(parseKind('open'), { base: 'open', view: TEXT_VIEW });
  for (const pref of ['text', 'hafs', 'warsh']) assert.equal(prefOfView(viewFromPref(pref)), pref, `saved choice ${pref} round-trips`);
  for (const junk of [null, undefined, '', 'qalon', 5]) assert.deepEqual(viewFromPref(junk), TEXT_VIEW, `${junk} opens as text`);
  assert.equal(imageView('qalon').mode, 'text', 'an unknown riwaya never becomes a picture view');
  for (const bad of ['iz', 'ihh', 'jumpiz', 'x', '', undefined, 'doneiw2']) assert.equal(parseKind(bad), null, String(bad));
});

test('download: retries, verification, atomic write — and a bad file is never kept', async () => {
  reset();
  // a transient failure is retried
  behaviour.set('hafs-kfqc/005.svg', (n) => (n <= 2 ? { status: 503, body: 'busy' } : null));
  assert.equal(await S.downloadPage('hafs', 5), true);
  assert.equal(hits.get('hafs-kfqc/005.svg'), 3, 'two failures + one success');
  assert.ok(existsSync(path.join(dir, 'hafs', '005.svg')));
  assert.equal(await S.downloadPage('hafs', 5), true); assert.equal(hits.get('hafs-kfqc/005.svg'), 3, 'a page on disk is not downloaded again');

  // a cut-off body (HTTP 200 but incomplete) is rejected every time and not saved
  const whole = fakeSvg('hafs', 6);
  behaviour.set('hafs-kfqc/006.svg', () => ({ status: 200, body: whole.slice(0, whole.length - 50) }));
  assert.equal(await S.downloadPage('hafs', 6), false);
  assert.equal(hits.get('hafs-kfqc/006.svg'), 4, 'all four attempts were used');
  assert.ok(!existsSync(path.join(dir, 'hafs', '006.svg')));
  const before = hits.get('hafs-kfqc/006.svg');
  assert.equal(await S.downloadPage('hafs', 6), false); assert.equal(hits.get('hafs-kfqc/006.svg'), before, 'a failed page is not hammered again right away');

  // 404: permanent, one request only
  behaviour.set('hafs-kfqc/007.svg', () => ({ status: 404, body: 'gone' }));
  assert.equal(await S.downloadPage('hafs', 7), false); assert.equal(await S.downloadPage('hafs', 7), false);
  assert.equal(hits.get('hafs-kfqc/007.svg'), 1);

  // an HTML page served with 200 is not an SVG
  behaviour.set('warsh-kfqc/008.svg', () => ({ status: 200, body: `<html>${'x'.repeat(6000)}</html>` }));
  assert.equal(await S.downloadPage('warsh', 8), false); assert.ok(!existsSync(path.join(dir, 'warsh', '008.svg')));

  // bad input never reaches the network
  const total = [...hits.values()].reduce((a, b) => a + b, 0);
  for (const [r, p] of [['qalon', 1], ['hafs', 0], ['hafs', 605], ['warsh', 1.5], [undefined, 1]]) assert.equal(await S.downloadPage(r, p), false);
  assert.equal([...hits.values()].reduce((a, b) => a + b, 0), total);
  assert.deepEqual((await readdir(path.join(dir, 'hafs'))).filter(f => f.includes('.part')), [], 'no temporary files left behind');
  for (const k of ['hafs-kfqc/005.svg', 'hafs-kfqc/006.svg', 'hafs-kfqc/007.svg', 'warsh-kfqc/008.svg']) behaviour.delete(k);
});

test('start-up sync: both riwayat × 604 pages, then only what is missing or damaged', async () => {
  await rm(dir, { recursive: true, force: true }); hits.clear(); reset();
  const bad = rel('hafs', 9); wrongSha.add(bad);                         // the manifest disagrees with this one file
  await S.startMushafImages();
  assert.equal(await svgFiles('warsh'), 604, 'every Warsh page');
  assert.equal(await svgFiles('hafs'), 603, 'every Hafs page except the one whose SHA-256 does not match the manifest');
  assert.ok(!existsSync(path.join(dir, 'hafs', '009.svg')), 'a file that fails verification is not kept');
  assert.equal(hits.get('manifest.json'), 1);
  assert.equal(hits.get(rel('hafs', 1)), 1);
  S.stopMushafImages();

  // second start (a restart of the bot): nothing is downloaded again except the page that never verified
  wrongSha.clear(); reset();
  const requestsBefore = [...hits.entries()].filter(([k]) => k.endsWith('.svg')).reduce((a, [, v]) => a + v, 0);
  const nineBefore = hits.get(bad);
  await S.startMushafImages();
  const requestsAfter = [...hits.entries()].filter(([k]) => k.endsWith('.svg')).reduce((a, [, v]) => a + v, 0);
  assert.equal(requestsAfter - requestsBefore, hits.get(bad) - nineBefore, 'only the missing page was requested');
  assert.equal(await svgFiles('hafs'), 604);
  assert.equal(hits.get(rel('hafs', 1)), 1, 'healthy files are never downloaded again');
  S.stopMushafImages();

  // damaged files: cut-off, empty, wrong size, leftovers of an interrupted download
  reset();
  const f1 = path.join(dir, 'hafs', '020.svg'); await truncate(f1, 3000);
  const f2 = path.join(dir, 'warsh', '021.svg'); await writeFile(f2, '');
  const f3 = path.join(dir, 'hafs', '022.svg'); await writeFile(f3, `${fakeSvg('hafs', 22)}\n<!-- appended garbage -->`);   // size differs from the manifest
  const stale = path.join(dir, 'hafs', '023.svg.part-1-1'); await writeFile(stale, 'half'); await utimes(stale, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  const seen = new Map([[20, hits.get(rel('hafs', 20))], [21, hits.get(rel('warsh', 21))], [22, hits.get(rel('hafs', 22))], [24, hits.get(rel('hafs', 24))]]);
  await S.startMushafImages();
  assert.equal(hits.get(rel('hafs', 20)), seen.get(20) + 1); assert.equal(hits.get(rel('warsh', 21)), seen.get(21) + 1); assert.equal(hits.get(rel('hafs', 22)), seen.get(22) + 1);
  assert.equal(hits.get(rel('hafs', 24)), seen.get(24), 'an intact neighbour is left alone');
  assert.equal((await stat(f1)).size, Buffer.byteLength(fakeSvg('hafs', 20)));
  assert.deepEqual((await readdir(path.join(dir, 'hafs'))).filter(f => f.includes('.part')), []);
  S.stopMushafImages();
});

test('PNG rendering: both riwayat, cached, on-demand download, never throws', async () => {
  reset();
  const png = await S.getMushafImage('warsh', 3);
  assert.ok(png && png.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'a PNG');
  assert.equal(png.name, 'mushaf-warsh-003.png'); assert.equal(png.buffer.readUInt32BE(16), 1000, 'configured width');
  const again = await S.getMushafImage('warsh', 3);
  assert.equal(again.buffer, png.buffer, 'second request is served from memory');
  assert.equal(S.mushafImageStatus().pngCached, 1);

  const [a, b] = await Promise.all([S.getMushafImage('hafs', 4), S.getMushafImage('hafs', 4)]);
  assert.equal(a.buffer, b.buffer, 'concurrent requests share one render');
  const hafs = await S.getMushafImage('hafs', 3), warsh = await S.getMushafImage('warsh', 3);
  assert.equal(hafs.name, 'mushaf-hafs-003.png'); assert.notEqual(hafs.buffer, warsh.buffer, 'the two riwayat are different pictures');

  const opening = await S.getMushafImage('hafs', 1);
  assert.ok(opening.buffer.readUInt32BE(16) < 1000, 'the opening pages are cropped to their content');

  // a page that is not on disk is fetched when a member opens it
  await rm(path.join(dir, 'hafs', '030.svg'), { force: true }); reset();
  const n0 = hits.get(rel('hafs', 30)) ?? 0;
  assert.ok(await S.getMushafImage('hafs', 30)); assert.equal(hits.get(rel('hafs', 30)), n0 + 1); assert.ok(existsSync(path.join(dir, 'hafs', '030.svg')));

  // a damaged file found at view time is dropped and downloaded again
  reset(); await truncate(path.join(dir, 'warsh', '031.svg'), 100);
  const n1 = hits.get(rel('warsh', 31));
  assert.ok(await S.getMushafImage('warsh', 31)); assert.equal(hits.get(rel('warsh', 31)), n1 + 1);

  for (const [r, p] of [['qalon', 1], ['hafs', 0], ['hafs', 605], ['warsh', '3'], [null, 3]]) assert.equal(await S.getMushafImage(r, p), null);

  // the cache is bounded
  reset(); for (let p = 40; p < 100; p++) await S.getMushafImage('hafs', p);
  assert.ok(S.mushafImageStatus().pngCached <= 40);
});

test('problems a member could hit: vanished files, slow CDN, leftovers', async () => {
  reset();
  // the host cleaned the folder while the bot was running: the page is fetched again instead of staying "present" forever
  assert.ok(await S.getMushafImage('hafs', 51));
  await rm(path.join(dir, 'hafs', '051.svg'));
  S.clearMushafPngCache();                                                        // (the rendered picture would otherwise answer)
  const n = hits.get(rel('hafs', 51));
  assert.ok(await S.getMushafImage('hafs', 51), 'recovered'); assert.equal(hits.get(rel('hafs', 51)), n + 1); assert.ok(existsSync(path.join(dir, 'hafs', '051.svg')));

  // a slow CDN: the member gets the text fallback within the deadline, not minutes later; the download still completes in the background
  S.tuning.onDemandDeadlineMs = 300;
  await rm(path.join(dir, 'warsh', '060.svg'), { force: true }); S.resetMushafImages();
  const n60 = hits.get(rel('warsh', 60)) ?? 0;
  behaviour.set(rel('warsh', 60), (c) => (c === n60 + 1 ? { delayMs: 1200 } : null));
  const t0 = Date.now(); assert.equal(await S.getMushafImage('warsh', 60), null);
  assert.ok(Date.now() - t0 < 1000, `answered in ${Date.now() - t0}ms`);
  await new Promise(r => setTimeout(r, 1500));
  assert.ok(existsSync(path.join(dir, 'warsh', '060.svg')), 'the slow download finished in the background');
  S.tuning.onDemandDeadlineMs = 20_000; behaviour.delete(rel('warsh', 60));

  // leftovers: a fresh .part (being written right now) is kept, an old one is removed at start-up
  const fresh = path.join(dir, 'hafs', '070.svg.part-1-1'), old = path.join(dir, 'hafs', '071.svg.part-1-1');
  await writeFile(fresh, 'x'); await writeFile(old, 'x'); const longAgo = new Date(Date.now() - 3_600_000); await utimes(old, longAgo, longAgo);
  S.resetMushafImages(); await S.startMushafImages(); S.stopMushafImages();
  assert.ok(existsSync(fresh), 'an in-flight temporary file is not deleted'); assert.ok(!existsSync(old), 'a stale one is');
  await rm(fresh, { force: true });
});

test('offline: sync gives up quietly, pages stay unavailable, nothing throws', async () => {
  await rm(dir, { recursive: true, force: true }); reset();
  const port = server.address().port;
  await new Promise(r => server.close(r));                               // the "internet" disappears
  const t0 = Date.now();
  await S.startMushafImages();
  assert.ok(Date.now() - t0 < 20_000, 'stops after a streak of failures instead of trying all 1208 pages');
  assert.equal(await svgFiles('hafs'), 0);
  assert.equal(await S.getMushafImage('hafs', 3), null, 'no picture, no crash — the reader falls back to text');
  S.stopMushafImages();
  await new Promise(r => server.listen(port, '127.0.0.1', r));           // back online
  reset();
  assert.ok(await S.getMushafImage('hafs', 3), 'recovers as soon as the network is back');
});

test('MUSHAF_IMAGES=off: nothing is downloaded and no picture is offered', () => {
  const script = `
    const S = await import(${JSON.stringify(new URL('../src/services/mushafImages.js', import.meta.url).href)});
    await S.startMushafImages();
    console.log(JSON.stringify({ enabled: S.mushafImagesEnabled(), image: await S.getMushafImage('hafs', 3) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 30_000, cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, MUSHAF_IMAGES: 'off', MUSHAF_IMAGES_DIR: path.join(dir, 'off'), ADMIN_IDS: '999999999999999999' }
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\{"enabled":false,"image":null\}/);
  assert.ok(!existsSync(path.join(dir, 'off')), 'the folder is not even created');
});
