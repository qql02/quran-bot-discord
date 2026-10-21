import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';
import { config } from '../config.js';

// ─── URL safety (SSRF) ─────────────────────────────────────────────────────────
// The bot host fetches whatever URL the Quran/radio APIs return.
// Only public http(s) is allowed: no file:, concat:, rtsp:… and no private/loopback/metadata IPs.
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
           (a === 100 && b >= 64 && b <= 127) ||               // CGNAT
           (a === 169 && b === 254) ||                         // link-local + cloud metadata
           (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 0 && c === 0) ||                // IETF protocol assignments
           (a === 192 && b === 168) ||
           (a === 198 && (b === 18 || b === 19)) ||            // benchmarking
           a >= 224;                                           // multicast + reserved + broadcast
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) {                                  // IPv4-mapped (URL parser rewrites it as hex: ::ffff:a00:5)
    const rest = v6.slice(7);
    if (net.isIPv4(rest)) return isPrivateIp(rest);
    const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (m) {
      const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return true;                                                   // unknown mapped form → refuse
  }
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) can wrap an internal IPv4 → refuse both outright.
  if (v6.startsWith('64:ff9b:') || v6.startsWith('2002:')) return true;
  // Everything that is not ordinary global unicast is refused. Blocking by exception missed forms such as
  // IPv4-compatible hex (::7f00:1), Teredo (2001::/32) and discard (100::/64); allow-listing 2000::/3 avoids that.
  const groups = expandV6(v6);
  if (!groups) return true;                                        // unparsable → refuse
  const [g0, g1] = groups;
  if ((g0 & 0xe000) !== 0x2000) return true;                       // outside 2000::/3 (loopback, ULA, link-local, multicast, ::/96 …)
  if (g0 === 0x2001 && g1 === 0x0000) return true;                 // Teredo 2001::/32 (embeds an IPv4 address)
  if (g0 === 0x2001 && g1 === 0x0db8) return true;                 // documentation
  if (g0 === 0x2002) return true;                                  // 6to4 (also caught above)
  return false;
}

/** Expand an IPv6 literal to 8 numeric groups, or null if malformed. */
function expandV6(ip) {
  let s = ip.split('%')[0];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || !all.every(g => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return all.map(g => parseInt(g, 16));
}

// ── Connect-time pinning ──────────────────────────────────────────────────────
// assertSafeUrl() resolves the name once and fetch() resolves it AGAIN → a hostile DNS server can answer with a
// public IP for the check and an internal one for the connection (DNS rebinding). This lookup runs at the moment of
// connecting and refuses private addresses there, so there is no gap between "checked" and "used".
export function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, family: options?.family ?? 0 }).then(
    (addrs) => {
      if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
        const err = new Error('blocked private address'); err.code = 'EBLOCKED';
        return cb(err);
      }
      return options?.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
    },
    (err) => cb(err)
  );
}

// One shared dispatcher for every outbound stream fetch (null when SSRF protection is deliberately off).
export const pinnedDispatcher = config.audio.allowPrivate ? undefined : new Agent({ connect: { lookup: safeLookup } });

export async function assertSafeUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`blocked protocol ${u.protocol}`);
  if (config.audio.allowPrivate) return;            // local testing only
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  if (!addrs.length) throw new Error('could not resolve host');   // fail closed: an unresolved name may resolve to an internal IP later
  if (addrs.some(isPrivateIp)) throw new Error('blocked private address');
}

/** fetch() that re-validates EVERY redirect hop (a public URL must not bounce us to an internal one). */
export async function safeFetch(url, opts = {}, maxRedirects = 5) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(current);
    const res = await fetch(current, { ...opts, redirect: 'manual', dispatcher: pinnedDispatcher });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      res.body?.cancel?.().catch(() => {});
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

// ── HLS playlists ──────────────────────────────────────────────────────────────
// ffmpeg reads an .m3u8 itself and then fetches every segment / key / sub-playlist it lists, so a public
// playlist could point at internal addresses (http://169.254.169.254/…) or other schemes. The ffmpeg source
// already restricts protocols to http/https/tcp/tls/crypto; here we also check every host the playlist names.
const HLS_MAX_BYTES     = 256 * 1024;
const HLS_MAX_PLAYLISTS = 8;     // master + variants + audio groups
const HLS_MAX_DEPTH     = 2;

export const looksLikeHls = (url, res) => {
  const type = res?.headers?.get?.('content-type') ?? '';
  return /mpegurl/i.test(type) || /\.m3u8?$/i.test(new URL(url).pathname);
};

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { reader.cancel().catch(() => {}); throw new Error('playlist too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Every URI a playlist references: bare lines plus URI="…" attributes (keys, init maps, media groups). */
export function extractPlaylistUris(text, baseUrl) {
  const uris = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      for (const m of line.matchAll(/URI\s*=\s*"([^"]*)"/gi)) uris.push(m[1]);
    } else {
      uris.push(line);
    }
  }
  return uris.map(u => new URL(u, baseUrl).toString());   // throws on garbage → treated as unsafe
}

export async function assertSafePlaylist(url, { depth = 0, state = { playlists: 0, hosts: new Set() } } = {}) {
  if (depth > HLS_MAX_DEPTH || ++state.playlists > HLS_MAX_PLAYLISTS) throw new Error('playlist nesting too deep');
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let text;
  try {
    const res = await safeFetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (QuranBot; +probe)' } });
    text = await readCapped(res, HLS_MAX_BYTES);
  } finally { clearTimeout(timer); }

  const nested = [];
  for (const uri of extractPlaylistUris(text, url)) {
    const u = new URL(uri);
    if (u.host && !state.hosts.has(u.origin)) { await assertSafeUrl(uri); state.hosts.add(u.origin); }
    else if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`blocked protocol ${u.protocol}`);
    if (/\.m3u8?$/i.test(u.pathname)) nested.push(uri);
  }
  for (const n of nested) await assertSafePlaylist(n, { depth: depth + 1, state });
}

/**
 * ffmpeg follows HTTP redirects on its own, so a public URL could bounce it to an internal one
 * AFTER assertSafeUrl() passed. Only used for the legacy AUDIO_ALLOW_HLS path (HLS must be opened by ffmpeg itself);
 * normal streams are downloaded by Node (safeFetch) and piped into ffmpeg. Probe errors are fatal (fail closed).
 */
export async function resolveFinalUrl(url, maxRedirects = 5, timeoutMs = 8000) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(current);
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res = null;
    try {
      res = await fetch(current, {
        method: 'GET', redirect: 'manual', signal: ctrl.signal, dispatcher: pinnedDispatcher,
        headers: { range: 'bytes=0-0', 'user-agent': 'Mozilla/5.0 (QuranBot; +probe)' }
      });
    } catch (err) {
      // Fail CLOSED: a probe that errors out must never let the URL through unchecked
      // (an attacker could break only the probe connection and serve a hostile playlist to ffmpeg afterwards).
      throw new Error(`stream probe failed: ${err?.cause?.message ?? err?.message ?? err}`);
    }
    finally { clearTimeout(timer); }
    res.body?.cancel?.().catch(() => {});
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    if (looksLikeHls(current, res)) await assertSafePlaylist(current);
    return current;
  }
  throw new Error('too many redirects');
}
