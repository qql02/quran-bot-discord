import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertSafeUrl, resolveFinalUrl } from '../src/services/urlSafety.js';

const PRIVATE = [
  '0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
  '192.0.0.8', '192.168.1.1', '198.18.0.5', '198.19.255.255', '224.0.0.1', '240.0.0.1', '255.255.255.255',
  '::', '::1', 'fe80::1', 'fec0::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
  '64:ff9b::a00:1', '2002:a00:1::', '::ffff:10.0.0.5', '::ffff:a00:5', 'fb00::1',   // fb00::1 is outside 2000::/3 (not global unicast)
];
const PUBLIC = [
  '1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '198.17.0.1', '198.20.0.1',
  '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8',
];

test('isPrivateIp blocks every internal / reserved range', () => {
  for (const ip of PRIVATE) assert.equal(isPrivateIp(ip), true, `${ip} should be blocked`);
});

test('isPrivateIp allows public addresses (and range edges)', () => {
  for (const ip of PUBLIC) assert.equal(isPrivateIp(ip), false, `${ip} should be allowed`);
});

test('assertSafeUrl rejects bad protocols and unparsable URLs', async () => {
  await assert.rejects(assertSafeUrl('file:///etc/passwd'), /blocked protocol/);
  await assert.rejects(assertSafeUrl('ftp://example.com/x'), /blocked protocol/);
  await assert.rejects(assertSafeUrl('javascript:alert(1)'), /blocked protocol/);
  await assert.rejects(assertSafeUrl('not a url'), /invalid URL/);
});

test('assertSafeUrl rejects internal IP literals (SSRF)', async () => {
  for (const u of [
    'http://127.0.0.1/', 'http://127.0.0.1:8080/admin', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[::ffff:10.0.0.5]/', 'http://localhost/',
  ]) {
    await assert.rejects(assertSafeUrl(u), /blocked private address/, `${u} should be blocked`);
  }
});

test('assertSafeUrl accepts a public IP literal', async () => {
  await assert.doesNotReject(assertSafeUrl('https://8.8.8.8/audio.mp3'));
});

// ── resolveFinalUrl: ffmpeg follows redirects itself, so every hop must be validated here ──
function mockFetch(t, handler) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const r = handler(String(url));
    return new Response(null, { status: r.status, headers: r.location ? { location: r.location } : {} });
  });
}

test('resolveFinalUrl returns the final URL after safe redirects', async (t) => {
  mockFetch(t, (u) => u === 'https://8.8.8.8/a'
    ? { status: 302, location: 'https://1.1.1.1/b' }
    : { status: 200 });
  assert.equal(await resolveFinalUrl('https://8.8.8.8/a'), 'https://1.1.1.1/b');
});

test('resolveFinalUrl refuses a public URL that redirects to an internal one', async (t) => {
  mockFetch(t, () => ({ status: 302, location: 'http://169.254.169.254/latest/meta-data' }));
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/a'), /blocked private address/);
});

test('resolveFinalUrl resolves relative redirects against the current URL', async (t) => {
  mockFetch(t, (u) => u === 'https://8.8.8.8/a' ? { status: 301, location: '/b' } : { status: 200 });
  assert.equal(await resolveFinalUrl('https://8.8.8.8/a'), 'https://8.8.8.8/b');
});

test('resolveFinalUrl gives up on redirect loops', async (t) => {
  mockFetch(t, () => ({ status: 302, location: 'https://8.8.8.8/loop' }));
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/loop', 3), /too many redirects/);
});

test('resolveFinalUrl FAILS CLOSED when the probe errors (an attacker could break only the probe)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('bad response'); });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/stream'), /stream probe failed/);
});

// ── HLS: ffmpeg fetches every segment/key/sub-playlist itself, so the playlist's hosts are validated too ──
import { extractPlaylistUris } from '../src/services/urlSafety.js';

function mockRoutes(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    const r = routes[String(url)];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body ?? null, { status: r.status ?? 200, headers: r.headers ?? {} });
  });
  return calls;
}
const HLS = { 'content-type': 'application/vnd.apple.mpegurl' };

test('extractPlaylistUris finds bare lines and URI attributes, resolving relative ones', () => {
  const text = '#EXTM3U\r\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\r\n#EXTINF:6,\r\nseg1.ts\r\n\r\nhttps://cdn.example.com/seg2.ts\r\n';
  assert.deepEqual(extractPlaylistUris(text, 'https://8.8.8.8/live/index.m3u8'), [
    'https://8.8.8.8/live/key.bin',
    'https://8.8.8.8/live/seg1.ts',
    'https://cdn.example.com/seg2.ts',
  ]);
});

test('HLS playlist with public segments is accepted', async (t) => {
  mockRoutes(t, {
    'https://8.8.8.8/live/index.m3u8': { headers: HLS, body: '#EXTM3U\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nhttps://1.1.1.1/seg2.ts\n' },
  });
  assert.equal(await resolveFinalUrl('https://8.8.8.8/live/index.m3u8'), 'https://8.8.8.8/live/index.m3u8');
});

test('HLS playlist whose segment points at an internal address is refused', async (t) => {
  mockRoutes(t, {
    'https://8.8.8.8/live/index.m3u8': { headers: HLS, body: '#EXTM3U\n#EXTINF:6,\nhttp://169.254.169.254/latest/meta-data\n' },
  });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/live/index.m3u8'), /blocked private address/);
});

test('HLS playlist cannot pivot to file: via a key URI', async (t) => {
  mockRoutes(t, {
    'https://8.8.8.8/p.m3u8': { headers: HLS, body: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="file:///etc/passwd"\nseg.ts\n' },
  });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/p.m3u8'), /blocked protocol/);
});

test('nested playlists are followed: an internal segment inside a variant is caught', async (t) => {
  mockRoutes(t, {
    'https://8.8.8.8/master.m3u8':  { headers: HLS, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nvariant/audio.m3u8\n' },
    'https://8.8.8.8/variant/audio.m3u8': { headers: HLS, body: '#EXTM3U\n#EXTINF:6,\nhttp://10.0.0.5/seg.ts\n' },
  });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/master.m3u8'), /blocked private address/);
});

test('a playlist is recognised by its extension even with a generic content type', async (t) => {
  mockRoutes(t, {
    'https://8.8.8.8/x.m3u8': { headers: { 'content-type': 'application/octet-stream' }, body: '#EXTM3U\nhttp://127.0.0.1/s.ts\n' },
  });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/x.m3u8'), /blocked private address/);
});

test('plain audio streams are not downloaded as playlists (only the probe request is made)', async (t) => {
  const calls = mockRoutes(t, { 'https://8.8.8.8/stream.mp3': { headers: { 'content-type': 'audio/mpeg' } } });
  assert.equal(await resolveFinalUrl('https://8.8.8.8/stream.mp3'), 'https://8.8.8.8/stream.mp3');
  assert.equal(calls.length, 1);
});

test('oversized playlists are refused', async (t) => {
  mockRoutes(t, { 'https://8.8.8.8/big.m3u8': { headers: HLS, body: '#EXTM3U\n' + '#'.repeat(300 * 1024) } });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/big.m3u8'), /too large/);
});

test('excessive playlist nesting is refused', async (t) => {
  mockRoutes(t, {
    'https://8.8.8.8/a.m3u8': { headers: HLS, body: '#EXTM3U\nb.m3u8\n' },
    'https://8.8.8.8/b.m3u8': { headers: HLS, body: '#EXTM3U\nc.m3u8\n' },
    'https://8.8.8.8/c.m3u8': { headers: HLS, body: '#EXTM3U\nd.m3u8\n' },
    'https://8.8.8.8/d.m3u8': { headers: HLS, body: '#EXTM3U\nseg.ts\n' },
  });
  await assert.rejects(resolveFinalUrl('https://8.8.8.8/a.m3u8'), /nesting too deep/);
});

test('assertSafeUrl fails closed when the host does not resolve', async () => {
  await assert.rejects(assertSafeUrl('https://no-such-host.invalid/x.mp3'), /could not resolve host/);
});


// ── Connect-time pinning (DNS rebinding) ──
import { safeLookup } from '../src/services/urlSafety.js';
import dns from 'node:dns/promises';

const lookupWith = (t, addrs) => t.mock.method(dns, 'lookup', async () => addrs);
const runLookup = (host, opts = {}) => new Promise(resolve => safeLookup(host, opts, (err, a, f) => resolve({ err, a, f })));

test('safeLookup refuses a name that resolves to a private address at connect time', async (t) => {
  lookupWith(t, [{ address: '10.0.0.5', family: 4 }]);
  assert.match((await runLookup('evil.example')).err.message, /blocked private address/);
});

test('safeLookup refuses when ANY of several answers is private', async (t) => {
  lookupWith(t, [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]);
  assert.ok((await runLookup('mixed.example', { all: true })).err);
});

test('safeLookup passes public answers through (single and all forms)', async (t) => {
  lookupWith(t, [{ address: '8.8.8.8', family: 4 }]);
  const one = await runLookup('ok.example');
  assert.equal(one.a, '8.8.8.8'); assert.equal(one.f, 4);
  const all = await runLookup('ok.example', { all: true });
  assert.deepEqual(all.a, [{ address: '8.8.8.8', family: 4 }]);
});

test('isPrivateIp: non-global IPv6 forms are refused, public IPv6 allowed', async () => {
  const { isPrivateIp } = await import('../src/services/urlSafety.js');
  for (const ip of ['::', '::1', '::7f00:1', '::ffff:7f00:1', '::ffff:0:7f00:1', '0:0:0:0:0:ffff:7f00:1',
                    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1', '2002:7f00:1::', '64:ff9b::7f00:1',
                    'fe80::1', 'fd00::1', 'ff02::1', '2001:db8::1', 'garbage::zz']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be refused`);
  }
  for (const ip of ['2606:4700::1111', '2a00:1450:4001::200e', '2001:4860:4860::8888']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be allowed`);
  }
});
