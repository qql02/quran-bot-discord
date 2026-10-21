/**
 * Extra protection layers for the Express API (wired in src/api/server.js).
 * Everything here is plain middleware / helpers with no database and no Discord, so it can be unit-tested with a real
 * HTTP server on a throw-away port (test/hardening.test.js).
 */

import crypto from 'node:crypto';

// ── 1. Only the methods the API really uses ────────────────────────────────────────────────────────────────────────
export const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS']);

export function methodGuard(req, res, next) {
  if (ALLOWED_METHODS.includes(req.method)) return next();
  res.set('Allow', ALLOWED_METHODS.join(', '));
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── 2. Second CSRF layer: a header only our own dashboard script sends ─────────────────────────────────────────────
// A cross-site page can fire a form POST or a "simple" fetch, but it cannot add a custom header without a CORS preflight,
// and the preflight is refused for every origin that is not ours. This sits next to the Origin / Referer check, so one
// mistake in either (a proxy that strips Origin, a mis-set ADMIN_DASHBOARD_URL…) is not enough to open a hole.
export const DASHBOARD_HEADER = 'x-requested-with';
export const DASHBOARD_HEADER_VALUE = 'quran-bot-dashboard';

export function requireDashboardHeader(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get(DASHBOARD_HEADER) === DASHBOARD_HEADER_VALUE) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// ── 3. Response headers ─────────────────────────────────────────────────────────────────────────────────────────────
/** @param {string} csp the full Content-Security-Policy value */
export function securityHeaders(csp) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');                       // dashboards can't be framed (clickjacking)
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');    // no other site may embed our responses (the public logo route overrides this)
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), interest-cohort=()');
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

// ── 4. A session cannot live forever just because it keeps being used ──────────────────────────────────────────────
// The session cookie is "rolling" (every request extends it), so a stolen cookie used once a day would never expire.
// `user.at` is the moment of the sign-in; after `absoluteMs` the owner has to sign in again, whatever happens.
export const ABSOLUTE_SESSION_MS = 7 * 86_400_000;

export function sessionLifetimeGuard({ absoluteMs = ABSOLUTE_SESSION_MS, now = Date.now } = {}) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return next();
    if (typeof u.at !== 'number') { u.at = now(); return next(); }          // a session from before this check: starts counting now
    if (now() - u.at <= absoluteMs) return next();
    return req.session.destroy(() => res.status(401).json({ error: 'Unauthorized' }));
  };
}

// ── 5. A signed-in account cannot flood the write endpoints (a stolen moderator session cannot spam or wipe things) ────
/**
 * @param {{ max: (req) => number, windowMs?: number, now?: () => number, maxKeys?: number }} o
 * Counts only state-changing requests (POST / DELETE), per signed-in account.
 */
export function userWriteLimiter({ max, windowMs = 60_000, now = Date.now, maxKeys = 5000 }) {
  const hits = new Map();   // userId → { count, resetAt }
  return (req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'DELETE') return next();
    const uid = req.session?.user?.id;
    if (!uid) return next();                     // not signed in: the auth middleware answers 401, the IP limiters already ran
    const t = now();
    let e = hits.get(uid);
    if (!e || t >= e.resetAt) {
      if (!e && hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      e = { count: 0, resetAt: t + windowMs };
      hits.set(uid, e);
    }
    if (++e.count > max(req)) {
      res.set('Retry-After', String(Math.ceil((e.resetAt - t) / 1000)));
      return res.status(429).json({ error: 'Too many changes in a minute — wait a little.' });
    }
    next();
  };
}

// ── 6. The OAuth "state" is only good for a short time ──────────────────────────────────────────────────────────────
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const oauthStateFresh = (st, now = Date.now()) =>
  !!st && typeof st.at === 'number' && now - st.at >= 0 && now - st.at <= OAUTH_STATE_TTL_MS;

// The state lives in a short-lived SIGNED COOKIE, not in the session store: a visitor who is not signed in must not be able to
// create a database document just by opening /auth/discord (they used to fill the store and crowd real sessions out of the list).
export const OAUTH_COOKIE = '__Host-qb.oauth';
const oauthMac = (secret, body) => crypto.createHmac('sha256', String(secret)).update(`oauth-state:${body}`).digest('base64url');

/** → cookie value "nonce.at.mac" */
export function signOauthState(secret, { nonce, at = Date.now() }) {
  const body = `${nonce}.${at}`;
  return `${body}.${oauthMac(secret, body)}`;
}

/** cookie value → { nonce, at } when the signature is ours, else null (freshness is checked by oauthStateFresh) */
export function verifyOauthState(secret, value) {
  const parts = String(value ?? '').split('.');
  if (parts.length !== 3) return null;
  const [nonce, atRaw, mac] = parts;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^\d{10,16}$/.test(atRaw)) return null;
  const want = Buffer.from(oauthMac(secret, `${nonce}.${atRaw}`));
  const got  = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return { nonce, at: Number(atRaw) };
}

/** One cookie out of a raw Cookie header (no cookie-parser dependency). */
export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// ── 7. Slow-connection (slowloris) and oversized-header limits ──────────────────────────────────────────────────────
export const SERVER_LIMITS = Object.freeze({
  headersTimeout: 20_000,          // the whole header block must arrive within 20 s
  requestTimeout: 30_000,          // the whole request (headers + body) within 30 s — the handler may run longer
  keepAliveTimeout: 61_000,        // just above the 60 s idle timeout common to reverse proxies → no random 502 on reused connections
  maxHeadersCount: 100,            // Node's default is 2000
  connectionsCheckingInterval: 5_000   // how often those timeouts are checked (Node's default 30 s lets a slow client hold a socket long)
});

/** Apply the limits to an http.Server. */
export function tuneServer(server, limits = SERVER_LIMITS) {
  server.headersTimeout = limits.headersTimeout;
  server.requestTimeout = limits.requestTimeout;
  server.keepAliveTimeout = limits.keepAliveTimeout;
  server.maxHeadersCount = limits.maxHeadersCount;
  return server;
}

/** Cut anything a client controls before it goes into a log line. */
export const clip = (v, n = 120) => String(v ?? '').replace(/\p{Cc}/gu, '?').slice(0, n);   // control characters (newlines…) out, Arabic names stay

// ── 8. Database down → answer at once instead of hanging ────────────────────────────────────────────────────────────
// Sessions live in MongoDB. While it is unreachable every signed-in request would wait for the driver's timeout (~30 s),
// piling up sockets. This answers 503 immediately (sessions are not even touched) and lets the client retry.
/** @param {() => boolean} isUp */
export function dbGuard(isUp) {
  return (req, res, next) => {
    if (isUp()) return next();
    res.set('Retry-After', '5');
    return res.status(503).json({ error: 'Database unavailable — try again in a moment.' });
  };
}
