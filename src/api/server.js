/**
 * Quran Bot — Express API Server
 * Import and call startApiServer(client) from src/bootstrap.js
 */

import crypto        from 'crypto';
import http          from 'http';
import express       from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import session       from 'express-session';
import MongoStore    from 'connect-mongo';
import cors          from 'cors';
import mongoose      from 'mongoose';
import { logger }    from '../utils/logger.js';
import { Statistics } from '../models/Statistics.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { normalizeRestrictions, isLocked } from '../utils/restrictionRules.js';
import { AsyncLocalStorage } from 'async_hooks';
import { getWorkerSessions } from '../services/siblingService.js';
import { sendWorkerCommand } from '../services/playerJobs.js';
import { getAllSessions, getSession, destroySession, pauseSession, resumeSession, skipSession, toggleLoop, setVolume } from '../managers/sessionManager.js';
import { ActivityType } from 'discord.js';
import { pickAnnouncementChannel as pickBroadcastChannel } from '../utils/channels.js';
import { Blacklist } from '../models/Blacklist.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { clearQuranCache } from '../services/quranService.js';
import { config } from '../config.js';
import { registerOwnerRoutes, resolveSendChannel } from './ownerRoutes.js';
import { registerOwnerPhase4, runBroadcast } from './ownerPhase4.js';
import { registerOwnerControl } from './ownerControl.js';
import { registerOwnerPhase5 } from './ownerPhase5.js';
import { buildPhase5Deps } from './phase5Deps.js';
import { getControlSync } from '../services/controlService.js';
import { modCan, MOD_CAPS } from '../utils/botControl.js';
import { Broadcast } from '../models/Broadcast.js';
import {
  methodGuard, requireDashboardHeader, securityHeaders, sessionLifetimeGuard, userWriteLimiter,
  oauthStateFresh, OAUTH_STATE_TTL_MS, OAUTH_COOKIE, signOauthState, verifyOauthState, readCookie, tuneServer, SERVER_LIMITS, clip, dbGuard
} from './hardening.js';

// Name of the session cookie. The "__Host-" prefix makes browsers accept it only when it is Secure, has Path=/ and no Domain:
// a sibling sub-domain (apps hosted on the same panel domain) can then never plant or overwrite it.
const SESSION_COOKIE = '__Host-qb.sid';

// Settings are parsed and validated once in src/config.js (weak SESSION_SECRET in production is fatal there).
const PORT           = config.api.port;
const CLIENT_ID      = config.discord.clientId;
const CLIENT_SECRET  = config.discord.clientSecret;
const SESSION_SECRET = config.api.sessionSecret;
// Owner(s) of the bot: the ONLY Discord accounts that can sign in to the dashboard.
const ADMIN_IDS      = config.admin.ids;
// Moderators (MOD_IDS): a limited dashboard. An owner who is also listed as moderator stays owner.
const MOD_IDS        = config.admin.modIds.filter(id => !ADMIN_IDS.includes(id));
const roleOf        = id => (ADMIN_IDS.includes(id) ? 'owner' : MOD_IDS.includes(id) ? 'mod' : null);
const API_BASE       = config.api.baseUrl;
// The dashboard is served by this same server at /admin (ADMIN_DASHBOARD_URL only if hosted elsewhere).
const ADMIN_URL      = config.api.dashboardUrl;

const __dirname = dirname(fileURLToPath(import.meta.url));

// Discord IDs are snowflakes: 17–20 digits.
const SNOWFLAKE = /^\d{17,20}$/;

// Never leak internal error text to the client — log it, return a generic message.
function fail(res, err, status = 500) {
  logger.error('[API]', err?.message ?? err);
  if (!res.headersSent) res.status(status).json({ error: 'Internal error' });
}

/** Request-body field as a trimmed non-empty string, or null (numbers / objects / arrays are rejected, not crashed on). */
const textField = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

const stripSlash = u => String(u ?? '').replace(/\/+$/, '');
// Browsers send Origin as scheme://host[:port] — compare that, never a URL with a path.
const originOf = u => { try { return new URL(u).origin; } catch { return stripSlash(u); } };

// ── Discord ActivityType map ────────────────────────────────────────────────
const ACTIVITY_TYPE_MAP = {
  playing:    ActivityType.Playing,
  listening:  ActivityType.Listening,
  watching:   ActivityType.Watching,
  competing:  ActivityType.Competing,
  custom:     ActivityType.Custom,
};

let apiServer = null;
/** Stop taking new requests and drop idle sockets (used by the shutdown routine). */
export function stopApiServer() {
  if (!apiServer) return Promise.resolve();
  return new Promise(r => { apiServer.close(() => r()); apiServer.closeIdleConnections?.(); setTimeout(r, 2000).unref?.(); });
}

export function startApiServer(client) {
  const app = express();

  // Bot logo — public on purpose: Discord's servers fetch it for the embed thumbnail (config.bot.thumbnailUrl points here).
  // Registered before sessions/auth so a fetch from Discord never creates a session. A fixed path, no user input.
  const LOGO_FILE = join(__dirname, '..', '..', 'assets', 'logo.png');
  app.get('/assets/logo.png', (req, res) => {
    res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });   // Discord (another site) must be able to embed it
    res.sendFile(LOGO_FILE, err => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ── Simple in-memory rate limiter ──────────────────────────────────────────
  // Uses req.ip (Express resolves it through `trust proxy`) — NOT the raw
  // X-Forwarded-For header, which any client can forge to dodge the limit.
  const limiterMaps = [];
  const MAX_LIMITER_KEYS = 20_000;   // hard cap per limiter: an attacker rotating IPs can't grow memory without bound
  // IPv6 clients own a whole /64 — key on that, otherwise one host can mint billions of "different" IPs.
  const ipKey = (ip) => {
    if (!ip || !ip.includes(':')) return ip;
    if (ip.startsWith('::ffff:') && ip.includes('.')) return ip.slice(7);
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = ip.includes('::') && tail ? tail.split(':') : [];
    const fill = ip.includes('::') ? Array(Math.max(8 - h.length - t.length, 0)).fill('0') : [];
    return [...h, ...fill, ...t].slice(0, 4).join(':');
  };
  const makeRateLimiter = (max, windowMs, skip) => {
    const hits = new Map(); // ip → { count, resetAt }
    limiterMaps.push(hits);
    return (req, res, next) => {
      if (skip?.(req)) return next();
      const key   = ipKey(req.ip);
      const now   = Date.now();
      const entry = hits.get(key);
      if (entry && now < entry.resetAt) {
        if (entry.count >= max) return res.status(429).json({ error: 'Too many requests — try again later.' });
        entry.count++;
      } else {
        if (!entry && hits.size >= MAX_LIMITER_KEYS) hits.delete(hits.keys().next().value);   // evict oldest
        hits.set(key, { count: 1, resetAt: now + windowMs });
      }
      next();
    };
  };

  // Drop expired entries every minute (windows are ≤ 15 min, so 30 min was far too lax)
  setInterval(() => {
    const now = Date.now();
    for (const m of limiterMaps) for (const [ip, e] of m.entries()) if (now >= e.resetAt) m.delete(ip);
  }, 60 * 1000).unref?.();

  const isAdminReq = req => req.session?.user && ADMIN_IDS.includes(req.session.user.id);
  const authRateLimit = makeRateLimiter(20, 15 * 60 * 1000);
  const apiRateLimit  = makeRateLimiter(240, 60 * 1000, isAdminReq);   // 240 req/min per IP, admins exempt

  // Required when running behind a reverse proxy (Nginx, Cloudflare, etc.)
  // TRUST_PROXY = number of proxies in front (default 1). 0 = directly exposed → X-Forwarded-* from clients is ignored,
  // so nobody can forge their IP to dodge the rate limiter.
  app.set('trust proxy', config.api.trustProxy);
  // Query strings stay flat (`a=1`): the default parser turns `a[$ne]=1` into an object, the classic way to smuggle a database operator.
  app.set('query parser', 'simple');
  // The app itself speaks plain HTTP, so a public https:// address means a TLS-terminating proxy IS in front (and the Secure
  // session cookie only works through it) — then trusting one hop is right. The warning is for the other case: an http://
  // address with a trusted hop, where a client reaching the port directly can forge X-Forwarded-For.
  if (config.api.trustProxy > 0 && !['127.0.0.1', '::1', 'localhost'].includes(config.api.host) && !API_BASE.startsWith('https://')) {
    logger.warn(`🌐 TRUST_PROXY=${config.api.trustProxy} while listening on ${config.api.host} with a non-https API_BASE_URL: if this port is reachable WITHOUT a reverse proxy, clients can forge X-Forwarded-For and dodge the rate limiter. Set TRUST_PROXY=0 (no proxy) or API_HOST=127.0.0.1 (local proxy). If the dashboard is served through an https domain, set API_BASE_URL to it and keep TRUST_PROXY=1.`);
  }

  // Behind an HTTPS-terminating proxy (panel hosts) the Secure session cookie needs to know the original scheme.
  // Only done when a proxy is trusted AND the public address is https — never when the port is exposed directly.
  if (config.api.trustProxy > 0 && API_BASE.startsWith('https://')) {
    app.use((req, _res, next) => { req.headers['x-forwarded-proto'] = 'https'; next(); });
  }

  app.disable('x-powered-by');
  // Scripts: only this server's own files (Chart.js is self-hosted in dashboard/admin/vendor, no third-party CDN) — NO inline scripts or inline event handlers,
  // so an HTML-injection bug can never turn into running code in the owner's session.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://cdn.discordapp.com",
    `connect-src 'self' ${originOf(API_BASE)}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    ...(API_BASE.startsWith('https://') ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
  app.use(securityHeaders(CSP));
  app.use(methodGuard);                                         // TRACE / PUT / PATCH … are not part of this API (the refusal carries the headers too)

  // Global flood limiter — runs BEFORE the session store so unauthenticated floods never reach MongoDB.
  app.use(makeRateLimiter(600, 60 * 1000, isAdminReq));

  app.use(express.json({ limit: '50kb' }));
  // Build allowed origins from env — fall back to localhost defaults in dev
  const allowedOrigins = [...new Set([ADMIN_URL, API_BASE].filter(Boolean).map(originOf))];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, server-to-server, mobile)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(stripSlash(origin))) return callback(null, true);
      callback(null, false);
    },
    credentials: true
  }));

  app.use(['/api', '/auth'], dbGuard(() => mongoose.connection.readyState === 1));   // DB down → 503 now, not a 30 s hang in the session store

  app.use(session({
    name:              SESSION_COOKIE,
    secret:            SESSION_SECRET,
    resave:            false,
    saveUninitialized: false,
    rolling:           true,
    // Reuse Mongoose's already-open MongoDB client (one connection pool instead of two — matters on free Atlas
    // tiers with a low connection cap). Falls back to its own connection if Mongoose isn't connected.
    store: MongoStore.create({
      ...(mongoose.connection.readyState === 1 ? { client: mongoose.connection.getClient() } : { mongoUrl: config.mongo.uri }),
      ttl:        86400 * config.api.sessionDays,
      touchAfter: 86400,
    }),
    cookie: {
      maxAge:   86400000 * config.api.sessionDays,    // owner-only dashboard: short sliding session (SESSION_DAYS, default 2)
      httpOnly: true,
      // Dashboard served by this server (the default) → 'lax' is enough and blocks cross-site cookie use.
      // Only a dashboard hosted on ANOTHER origin needs 'none'.
      sameSite: originOf(ADMIN_URL) === originOf(API_BASE) ? 'lax' : 'none',
      secure:   true,
    },
  }));

  // A signed-in session also has an absolute lifetime (the cookie itself slides, so it alone never ends).
  app.use(['/api', '/auth/me'], sessionLifetimeGuard());

  // ── Request logger (AFTER session so req.session is populated) ───────────
  // Only API/auth traffic is logged (static files and redirects would just flood the log file).
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
      logger.info(`[REQUEST] ${req.method} ${req.path} | user: ${req.session?.user?.id ?? 'none'}`);
    }
    next();
  });

  // ── CSRF guard ────────────────────────────────────────────────────────────
  // Session cookie is SameSite=None (cross-origin dashboards), so the browser attaches it
  // to requests fired from ANY site. Body-less POSTs are "simple requests" (no CORS preflight),
  // meaning a malicious page could trigger /api/admin/bot/restart etc. as a logged-in admin.
  // Every state-changing request must therefore come from one of our own origins.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    let origin = req.get('origin');
    if (!origin) {
      try { origin = new URL(req.get('referer') ?? '').origin; } catch { origin = null; }
    }
    if (!origin || !allowedOrigins.includes(stripSlash(origin))) {
      logger.warn(`[CSRF] blocked ${req.method} ${clip(req.path)} from origin '${clip(origin ?? 'none', 200)}'`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
  // Second layer: the dashboard script adds a custom header that no other site can send (it would need a CORS preflight).
  app.use(requireDashboardHeader);

  app.use('/api', apiRateLimit);
  // Per signed-in account: at most 60 changes a minute for the owner, 30 for a moderator.
  app.use('/api/admin', userWriteLimiter({ max: (req) => (ADMIN_IDS.includes(req.session?.user?.id) ? 60 : 30) }));

  // Every :id route in this API is a guild snowflake.
  app.param('id', (_req, res, next, id) =>
    SNOWFLAKE.test(id) ? next() : res.status(400).json({ error: 'Invalid id' }));

  // ── Config endpoint — injects env vars into dashboard HTML ────────────────
  app.get('/config.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`window.API_URL = ${JSON.stringify(API_BASE)};`);
  });

  // ── Dashboard paths (defined early for SPA fallback, static served LAST) ───
  const dashAdmin  = join(__dirname, '..', '..', 'dashboard', 'admin');

  // ── Middleware ─────────────────────────────────────────────────────────────
  const requireAuth  = (req, res, next) =>
    req.session?.user ? next() : res.status(401).json({ error: 'Unauthorized' });

  // Owner only (default for every sensitive route) …
  const requireAdmin = (req, res, next) =>
    req.session?.user
      ? ADMIN_IDS.includes(req.session.user.id)
        ? next()
        : res.status(403).json({ error: 'Forbidden' })
      : res.status(401).json({ error: 'Unauthorized' });
  // … and owner OR moderator for the day-to-day routes (role is re-read from the env lists on every request,
  // so removing an id from MOD_IDS takes effect at once, even for a signed-in session).
  const requireMod = (req, res, next) =>
    req.session?.user
      ? roleOf(req.session.user.id)
        ? next()
        : res.status(403).json({ error: 'Forbidden' })
      : res.status(401).json({ error: 'Unauthorized' });

  // A moderator route that the owner can switch off per capability (dashboard → مركز التحكم). Owners always pass.
  // Read from the in-memory copy on every request, so a change applies at once, even for a signed-in moderator.
  const requireCap = (cap) => (req, res, next) =>
    requireMod(req, res, () =>
      ADMIN_IDS.includes(req.session.user.id) || modCan(getControlSync(), cap)
        ? next()
        : res.status(403).json({ error: `أوقف المالك هذه الصلاحية للمشرفين: ${MOD_CAPS[cap]}` }));

  // Who did it: every pushActivity() call made while handling an admin request is stamped with that admin
  // (AsyncLocalStorage follows the request through awaits, so no handler needs to pass the user around).
  const auditCtx = new AsyncLocalStorage();
  app.use('/api/admin', (req, _res, next) => {
    const u = req.session?.user;
    auditCtx.run({ actor: u ? `${u.username ?? u.id} (${u.id})${roleOf(u.id) === 'mod' ? ' [مشرف]' : ''}` : '' }, next);
  });
  // Server-side confirmation for destructive actions: the client must echo the exact token, so a stray or forged
  // request (even from a valid session) cannot trigger it by accident.
  const needConfirm = (token) => (req, res, next) =>
    req.body?.confirm === token ? next() : res.status(400).json({ error: `confirm: "${token}" required` });

  // ── Discord OAuth2 ─────────────────────────────────────────────────────────
  app.get('/auth/discord', authRateLimit, (req, res) => {
    // Only two valid values; anything else (incl. injected `&redirect_uri=…`) falls back to 'public'.
    const origin = 'admin';                                  // the dashboard is the only login target
    const nonce  = crypto.randomBytes(16).toString('hex');
    // State goes in a signed, short-lived cookie bound to THIS browser (login-CSRF proof) — NOT in the session store, so an
    // anonymous visitor creates no database document.
    res.cookie(OAUTH_COOKIE, signOauthState(SESSION_SECRET, { nonce }), { maxAge: OAUTH_STATE_TTL_MS, httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const callback = encodeURIComponent(`${API_BASE}/auth/discord/callback`);
    res.redirect(
      `https://discord.com/api/oauth2/authorize` +
      `?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${callback}` +
      `&response_type=code` +
      `&scope=identify` +
      `&state=${encodeURIComponent(`${nonce}.${origin}`)}`
    );
  });

  app.get('/auth/discord/callback', authRateLimit, async (req, res) => {
    const { code, state } = req.query;
    const [stateNonce = ''] = String(state ?? '').split('.');

    // Missing code means Discord denied or user cancelled — redirect to login page
    if (!code) {
      return res.redirect(`${ADMIN_URL}?auth=denied`);
    }

    // Verify the state we issued (constant-time compare), then burn it (single use).
    const expected = verifyOauthState(SESSION_SECRET, readCookie(req.headers.cookie, OAUTH_COOKIE));
    res.clearCookie(OAUTH_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const a = Buffer.from(String(expected?.nonce ?? ''));
    const b = Buffer.from(stateNonce);
    if (!oauthStateFresh(expected) || a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      logger.warn('[OAuth] state missing, expired or mismatched — rejected');
      return res.redirect(`${ADMIN_URL}?auth=error`);
    }

    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type:    'authorization_code',
          code:          String(code),
          redirect_uri:  `${API_BASE}/auth/discord/callback`
        }),
        signal: AbortSignal.timeout(10_000)
      });
      const token = await tokenRes.json();
      if (!token.access_token) throw new Error('Token exchange failed');

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000)
      });
      const user = await userRes.json();
      if (!user.id) throw new Error('Failed to fetch user info');

      // Owners and moderators only: anyone else gets NO session at all.
      if (!roleOf(user.id)) {
        logger.warn(`[OAuth] sign-in refused for account ${clip(user.id, 30)} (not in ADMIN_IDS / MOD_IDS)`);
        pushActivity('ban', 'محاولة دخول مرفوضة للوحة', `${clip(user.username, 40)} (${clip(user.id, 30)}) · IP ${clip(req.ip, 45)}`);
        return res.redirect(`${ADMIN_URL}?auth=forbidden`);
      }

      const sessionUser = {
        id:       user.id,
        username: user.username,
        avatar:   user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`,
        isAdmin:  true,
        at:       Date.now(),         // sign-in time: the session has an absolute lifetime (see sessionLifetimeGuard)
        ip:       clip(req.ip, 45),   // shown on the dashboard's Security page (where is this session from?)
        ua:       clip(req.get('user-agent'), 160)
      };

      // New session ID on login → prevents session fixation.
      // The frontend reads ?dest and navigates client-side after confirming via /auth/me.
      req.session.regenerate((regenErr) => {
        if (regenErr) { logger.error('Session regenerate error:', regenErr.message); return res.status(500).send('Session error'); }
        req.session.user = sessionUser;
        req.session.save((saveErr) => {
          if (saveErr) {
            logger.error('Session save error:', saveErr.message);
            return res.status(500).send('Session save failed');
          }
          pushActivity('admin', `تسجيل دخول${roleOf(sessionUser.id) === 'mod' ? ' (مشرف)' : ''}`, `${clip(sessionUser.username, 40)} (${sessionUser.id}) · IP ${clip(req.ip, 45)}`);
          res.redirect(`${API_BASE}/auth/callback`);
        });
      });
    } catch (err) {
      logger.error('OAuth error:', err.message);
      res.redirect(`${ADMIN_URL}?auth=error`);
    }
  });

  app.get('/auth/me', requireAuth, (req, res) => {
    const role = roleOf(req.session.user.id);
    if (!role) return res.status(403).json({ error: 'Forbidden' });
    res.json({ ...req.session.user, isAdmin: true, role, caps: role === 'owner' ? null : getControlSync().modCaps });      // isAdmin = may open the dashboard; role decides what it shows
  });
  app.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) logger.warn('Session destroy error:', err.message);
      const cookieOpts = { path: '/', httpOnly: true, secure: true, sameSite: originOf(ADMIN_URL) === originOf(API_BASE) ? 'lax' : 'none' };
      res.clearCookie(SESSION_COOKIE, cookieOpts);
      res.clearCookie('connect.sid');           // the name used before the __Host- prefix
      res.json({ ok: true });
    });
  });

  // ── Public API ─────────────────────────────────────────────────────────────
  app.get('/api/status', requireMod, async (_req, res) => {
    try {
      const agg = await Statistics.aggregate([{
        $group: {
          _id: null,
          totalSurahs:   { $sum: '$totalPlayedSurahs' },
          totalPlayTime: { $sum: '$totalPlayTime' },
          totalSessions: { $sum: '$totalSessions' }
        }
      }]);
      const s = agg[0] ?? { totalSurahs: 0, totalPlayTime: 0, totalSessions: 0 };
      res.json({
        online:         true,
        uptime:         Math.floor(process.uptime()),
        guilds:         client.guilds.cache.size,
        activeSessions: getAllSessions().length,
        ping:           client.ws.ping,
        totalSurahs:    s.totalSurahs,
        totalPlayTime:  s.totalPlayTime,
        totalSessions:  s.totalSessions,
        // FIX: expose Node.js version for sysInfo panel
        nodeVersion:    process.version,
      });
    } catch (err) { fail(res, err); }
  });

  // Sessions of this bot AND of the voice-only second bot (published through the shared database, ≤15s old).
  app.get('/api/sessions', requireMod, async (_req, res) => {
    const remote = (await getWorkerSessions()).map(s => ({
      botId: s.botId, botTag: s.botTag, remote: true,
      guildId: s.guildId, guildName: client.guilds.cache.get(s.guildId)?.name ?? s.guildId, guildIcon: client.guilds.cache.get(s.guildId)?.iconURL() ?? null,
      channel: s.channelName, status: s.status, surah: s.surah, surahAr: s.surahAr, reciter: s.reciter,
      queueSize: s.queueSize, loop: s.loop, fullQuran: s.fullQuran, volume: s.volume
    }));
    res.json([...getAllSessions().map(s => ({
      botId:       client.user.id,
      botTag:      client.user.tag,
      guildId:     s.guildId,
      guildName:   client.guilds.cache.get(s.guildId)?.name ?? s.guildId,
      guildIcon:   client.guilds.cache.get(s.guildId)?.iconURL() ?? null,
      channel:     s.channelName,
      status:      s.status,
      surah:       s.current?.surah?.english ?? null,
      surahAr:     s.current?.surah?.arabic  ?? null,
      reciter:     s.current?.reciter ?? null,
      queueSize:   s.queue.length,
      loop:        s.loop,
      fullQuran:   s.fullQuran
    })), ...remote]);
  });

  // A dashboard action aimed at the voice-only bot: it must be a live worker that really has a session in that server.
  const WORKER_ACTIONS = new Set(['pause', 'resume', 'skip', 'loop', 'volume', 'stop']);
  async function viaWorker(req, res, botId, guildId, action, value = null) {
    if (!isSnowflake(botId)) return res.status(400).json({ error: 'invalid bot id' });
    const w = (await getWorkerSessions()).find(s => s.botId === botId && s.guildId === guildId);
    if (!w) return res.status(404).json({ error: 'no active session of that bot in this server' });
    if (!WORKER_ACTIONS.has(action)) return res.status(400).json({ error: 'unknown action' });
    if (action === 'volume' && !(Number.isInteger(value) && value >= 0 && value <= 150)) return res.status(400).json({ error: 'volume must be an integer 0-150' });
    const r = await sendWorkerCommand({ targetBotId: botId, guildId, action, value: action === 'volume' ? value : null, by: req.session.user.id });
    if (!r.ok) {
      const code = r.error === 'timeout' ? 504 : 409;
      const msg = { timeout: 'البوت الثاني لم يردّ (قد يكون متوقفاً)', no_session: 'لا توجد جلسة نشطة لدى البوت الثاني', bad_state: 'action not possible in the current state' }[r.error] ?? 'تعذّر تنفيذ الأمر على البوت الثاني';
      return res.status(code).json({ error: msg });
    }
    pushActivity('admin', `تحكم بالبوت الثاني: ${action}`, `${client.guilds.cache.get(guildId)?.name ?? guildId}${action === 'volume' ? ` · ${value}%` : ''}`);
    return res.json({ ok: true, ...(r.loop !== undefined ? { loop: r.loop } : {}) });
  }

  // ── Admin API ──────────────────────────────────────────────────────────────
  app.get('/api/admin/guilds', requireMod, async (_req, res) => {
    try {
      const [settings, stats] = await Promise.all([
        GuildSettings.find({}).lean(),
        Statistics.find({}).lean()
      ]);
      const statsMap    = Object.fromEntries(stats.map(s => [s.guildId, s]));
      const workerBy    = new Map((await getWorkerSessions()).map(s => [s.guildId, s.botId]));   // server → the voice-only bot reciting there
      const settingsMap = Object.fromEntries(settings.map(s => [s.guildId, s]));

      res.json(client.guilds.cache.map(g => {
        const rs = normalizeRestrictions(settingsMap[g.id]?.restrictions);
        const locked = isLocked(rs);
        return {
        id:            g.id,
        // Owner-panel server controls: lock state (a timed lock stops counting by itself), restrictions, auto-posting, last activity
        locked,
        lockedUntil:   locked ? rs.lockedUntil : null,
        restricted:    rs.disabledCommands.length > 0 || rs.maxQueue !== null,
        adhkar:        !!settingsMap[g.id]?.adhkar?.enabled,
        ayah:          !!settingsMap[g.id]?.ayah?.enabled,
        hadith:        !!settingsMap[g.id]?.hadith?.enabled,
        lastActivity:  statsMap[g.id]?.updatedAt ? new Date(statsMap[g.id].updatedAt).getTime() : null,
        name:          g.name,
        memberCount:   g.memberCount,
        icon:          g.iconURL(),
        // FIX: expose joinedAt for guild detail modal
        joinedAt:      g.joinedAt?.toISOString() ?? null,
        language:      settingsMap[g.id]?.language ?? 'en',
        totalSurahs:   statsMap[g.id]?.totalPlayedSurahs ?? 0,
        totalPlayTime: statsMap[g.id]?.totalPlayTime ?? 0,
        totalSessions: statsMap[g.id]?.totalSessions ?? 0,
        hasSession:    !!getSession(g.id) || workerBy.has(g.id),
        sessionBot:    getSession(g.id) ? null : (workerBy.get(g.id) ?? null),   // set only when the session belongs to the voice-only bot
        // FIX: expose top reciter per guild for analytics table
        topReciter:    statsMap[g.id]?.reciterPlayCounts
          ? Object.entries(statsMap[g.id].reciterPlayCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null
          : null,
        reciterPlayCounts: statsMap[g.id]?.reciterPlayCounts ?? {},
        };
      }));
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/admin/guilds/:id/stats', requireAdmin, async (req, res) => {
    try {
      await Statistics.deleteOne({ guildId: req.params.id });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/guilds/:id/language', requireCap('config'), async (req, res) => {
    const { language } = req.body;
    if (!['ar', 'en'].includes(language)) return res.status(400).json({ error: 'Invalid' });
    if (!client.guilds.cache.has(req.params.id)) return res.status(404).json({ error: 'Guild not found' });   // never create settings for a server the bot is not in
    try {
      await GuildSettings.findOneAndUpdate({ guildId: req.params.id }, { language }, { upsert: true });
      GuildSettings.invalidateLangCache(req.params.id);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // FIX: stop-all must be defined BEFORE /:id/stop — otherwise Express matches
  // "stop-all" as the :id param and routes the request to the wrong handler.
  app.post('/api/admin/sessions/stop-all', requireAdmin, needConfirm('STOP_ALL'), async (_req, res) => {
    try {
      const sessions = getAllSessions();
      const remote = await getWorkerSessions();
      await Promise.allSettled([
        ...sessions.map(s => destroySession(s.guildId)),
        ...remote.map(s => sendWorkerCommand({ targetBotId: s.botId, guildId: s.guildId, action: 'stop', by: _req.session.user.id }, { timeoutMs: 6_000 }))
      ]);
      pushActivity('admin', 'إيقاف جميع الجلسات', `${sessions.length + remote.length} جلسة`);
      res.json({ ok: true, stopped: sessions.length + remote.length });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/sessions/:id/stop', requireCap('stop'), async (req, res) => {
    try {
      if (req.body?.bot && req.body.bot !== client.user.id) return await viaWorker(req, res, String(req.body.bot), req.params.id, 'stop');
      await destroySession(req.params.id);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });


  // ── Voice control (any server) ─────────────────────────────────────────────
  const isSnowflake = (v) => /^\d{15,25}$/.test(String(v ?? ''));
  app.post('/api/admin/sessions/:id/control', requireCap('control'), async (req, res) => {
    const id = req.params.id;
    if (!isSnowflake(id)) return res.status(400).json({ error: 'invalid guild id' });
    const { bot } = req.body ?? {};
    if (bot && bot !== client.user.id) {
      try { return await viaWorker(req, res, String(bot), id, req.body?.action, typeof req.body?.value === 'number' ? req.body.value : null); }
      catch (err) { return fail(res, err); }
    }
    if (!getSession(id)) return res.status(404).json({ error: 'no active session in this server' });
    const gname = client.guilds.cache.get(id)?.name ?? id;
    const { action, value } = req.body ?? {};
    try {
      let ok = true; const extra = {};
      switch (action) {
        case 'pause':  ok = pauseSession(id);  break;
        case 'resume': ok = resumeSession(id); break;
        case 'skip':   ok = skipSession(id);   break;
        case 'loop':   extra.loop = toggleLoop(id); break;
        case 'volume': {
          const v = typeof value === 'number' ? value : NaN;   // a missing/null value must not become 0 (muting the bot)
          if (!Number.isInteger(v) || v < 0 || v > 150) return res.status(400).json({ error: 'volume must be an integer 0-150' });
          ok = await setVolume(id, v); extra.volume = v; break;
        }
        default: return res.status(400).json({ error: 'unknown action' });
      }
      if (!ok) return res.status(409).json({ error: 'action not possible in the current state' });
      pushActivity('admin', `تحكم بالصوت: ${action}`, `${gname}${extra.volume !== undefined ? ` · ${extra.volume}%` : ''}`);
      res.json({ ok: true, ...extra });
    } catch (err) { fail(res, err); }
  });

  // ── Server management ──────────────────────────────────────────────────────
  app.post('/api/admin/guilds/:id/leave', requireAdmin, async (req, res) => {
    const guild = isSnowflake(req.params.id) ? client.guilds.cache.get(req.params.id) : null;
    if (!guild) return res.status(404).json({ error: 'server not found' });
    if (req.body?.confirm !== guild.id) return res.status(400).json({ error: 'confirm must equal the server id' });
    try {
      await destroySession(guild.id).catch(() => {});
      const name = guild.name;
      await guild.leave();
      pushActivity('admin', `مغادرة سيرفر: ${name}`, `ID: ${guild.id}`);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // The bot speaks in other people's servers: cap how fast one account (owner or moderator) can do it, so a stolen
  // moderator session cannot turn the bot into a spam cannon. Bulk / broadcast have their own single-run locks.
  const msgSent = new Map();   // userId → timestamps of the last minute
  const msgGuildLast = new Map();   // `${userId}:${guildId}` → last send
  const MSG_PER_MIN = 10, MSG_GUILD_GAP_MS = 15_000;
  const msgThrottle = (req, res, next) => {
    const uid = req.session.user.id, now = Date.now();
    const recent = (msgSent.get(uid) ?? []).filter(t => now - t < 60_000);
    const gk = `${uid}:${req.params.id}`;
    if (recent.length >= MSG_PER_MIN) return res.status(429).json({ error: 'رسائل كثيرة خلال دقيقة — انتظر قليلاً' });
    if (now - (msgGuildLast.get(gk) ?? 0) < MSG_GUILD_GAP_MS) return res.status(429).json({ error: 'أُرسلت رسالة لهذا السيرفر قبل لحظات — انتظر ثوانٍ' });
    recent.push(now); msgSent.set(uid, recent); msgGuildLast.set(gk, now);
    if (msgGuildLast.size > 5000) for (const [k, t] of msgGuildLast) if (now - t > 60_000) msgGuildLast.delete(k);
    next();
  };

  app.post('/api/admin/guilds/:id/message', requireCap('message'), msgThrottle, async (req, res) => {
    const guild = isSnowflake(req.params.id) ? client.guilds.cache.get(req.params.id) : null;
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const message = textField(req.body?.message);
    const title   = textField(req.body?.title);
    if (!message) return res.status(400).json({ error: 'message required' });
    try {
      // Optional channelId = the channel the owner picked in the dashboard (validated: belongs to this server, is a text
      // channel, the bot can post there). Without it: the usual announcement channel.
      const wanted = textField(req.body?.channelId);
      const channel = wanted ? resolveSendChannel(guild, wanted) : pickBroadcastChannel(guild);
      if (!channel) return res.status(wanted ? 400 : 409).json({ error: wanted ? 'channel not found or the bot cannot write there' : 'no channel the bot can write to' });
      await channel.send({
        allowedMentions: { parse: [] },
        embeds: [{ title: (title || '📢 رسالة من إدارة البوت').slice(0, 256), description: message.slice(0, 4000), color: 0x5b6ff5, timestamp: new Date().toISOString() }]
      });
      pushActivity('admin', `رسالة لسيرفر: ${guild.name}`, message.slice(0, 80));
      res.json({ ok: true, channel: channel.name });
    } catch (err) { fail(res, err); }
  });

  // FIX: Bot activity now uses the `type` sent from frontend
  app.post('/api/admin/bot/activity', requireAdmin, (req, res) => {
    const { type } = req.body ?? {};
    const text = textField(req.body?.text);
    if (!text) return res.status(400).json({ error: 'No text' });
    const activityType = (Object.hasOwn(ACTIVITY_TYPE_MAP, type) ? ACTIVITY_TYPE_MAP[type] : ActivityType.Custom);
    try {
      if (activityType === ActivityType.Custom) {
        client.user.setPresence({
          status: 'online',
          activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: text }]
        });
      } else {
        client.user.setPresence({
          status: 'online',
          activities: [{ name: text, type: activityType }]
        });
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Activity Log (memory cache + MongoDB so it survives restarts) ──────────
  const activityLogStore = [];
  function pushActivity(type, action, meta = '') {
    const icons = { join:'🟢', leave:'🔴', play:'▶️', stop:'⏹️', admin:'🛡️', ban:'🚫', error:'❌', info:'ℹ️' };
    activityLogStore.unshift({ type, action, meta, ts: Date.now(), icon: icons[type] ?? '📌' });
    if (activityLogStore.length > 200) activityLogStore.length = 200;
    const actor = auditCtx.getStore()?.actor ?? '';
    activityLogStore[0].actor = actor;
    ActivityLog.create({ type: String(type).slice(0, 16), action: String(action).slice(0, 300), meta: String(meta ?? '').slice(0, 500), actor })
      .catch(err => logger.warn(`[ActivityLog] save failed: ${err.message}`));
  }
  app.locals.pushActivity = pushActivity;

  // FIX: expose pushActivity on client so event handlers (guildCreate/Delete/play) can use it
  client._pushActivity = pushActivity;

  app.get('/api/admin/activity', requireCap('audit'), async (_req, res) => {
    const icons = { join:'🟢', leave:'🔴', play:'▶️', stop:'⏹️', admin:'🛡️', ban:'🚫', error:'❌', info:'ℹ️' };
    try {
      const rows = await ActivityLog.find().sort({ ts: -1 }).limit(200).lean();
      res.json(rows.map(r => ({ type: r.type, action: r.action, meta: r.meta, actor: r.actor ?? '', ts: new Date(r.ts).getTime(), icon: icons[r.type] ?? '📌' })));
    } catch {
      res.json(activityLogStore);   // DB hiccup → fall back to the in-memory copy
    }
  });

  // ── Blacklist ──────────────────────────────────────────────────────────────
  app.get('/api/admin/blacklist', requireAdmin, async (_req, res) => {
    try {
      const list = await Blacklist.find({}).lean();
      res.json(list);
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/blacklist', requireAdmin, async (req, res) => {
    const { guildId, reason } = req.body;
    if (!SNOWFLAKE.test(String(guildId ?? ''))) return res.status(400).json({ error: 'valid guildId required' });
    try {
      const name = client.guilds.cache.get(guildId)?.name ?? null;
      const why  = String(reason || 'No reason provided').slice(0, 300);
      await Blacklist.findOneAndUpdate(
        { guildId },
        { guildId: String(guildId), name, reason: why, bannedAt: new Date() },
        { upsert: true, new: true }
      );
      const guild = client.guilds.cache.get(guildId);
      if (guild) await guild.leave().catch(() => {});
      Blacklist.invalidateCache();
      pushActivity('ban', `حظر سيرفر: ${name ?? guildId}`, `السبب: ${why}`);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // FIX: Added confirm token requirement for full blacklist wipe
  app.delete('/api/admin/blacklist', requireAdmin, async (req, res) => {
    const { confirm } = req.body ?? {};
    if (confirm !== 'CONFIRM') {
      return res.status(400).json({ error: 'يجب إرسال confirm: "CONFIRM" لتنفيذ هذه العملية' });
    }
    try {
      await Blacklist.deleteMany({});
      Blacklist.invalidateCache();
      pushActivity('admin', 'مسح القائمة السوداء بالكامل', '');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/admin/blacklist/:id', requireAdmin, async (req, res) => {
    try {
      await Blacklist.deleteOne({ guildId: req.params.id });
      Blacklist.invalidateCache();
      pushActivity('admin', `رفع حظر سيرفر: ${req.params.id}`, '');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Stats reset-all ───────────────────────────────────────────────────────
  app.delete('/api/admin/stats/reset-all', requireAdmin, needConfirm('RESET_ALL'), async (_req, res) => {
    try {
      await Statistics.deleteMany({});
      pushActivity('admin', 'إعادة ضبط كل الإحصائيات', 'جميع السيرفرات');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Audio engine status / reconnect / cache ──────────────────────────────
  // NOTE: route paths still say "lavalink" so the existing admin dashboard keeps
  // working untouched. They now report the local ffmpeg engine.
  app.get('/api/admin/lavalink/status', requireAdmin, async (_req, res) => {
    try {
      const { getEngineStats, getEngineHealth } = await import('../services/audioService.js');
      const stats  = getEngineStats();
      const health = getEngineHealth();
      res.json({
        connected:     stats.connected,
        nodes:         1,
        activePlayers: stats.activePlayers,
        totalPlayers:  stats.totalPlayers,
        ping:          stats.ping,
        uptime:        stats.uptime,
        memUsed:       stats.memUsed,
        cpuLoad:       stats.cpuLoad,
        nodesList: [{
          name:              `Local (${health.backend ?? 'none'})`,
          status:            stats.connected ? 'connected' : 'disconnected',
          players:           stats.totalPlayers,
          ping:              stats.ping,
          cpuLoad:           stats.cpuLoad,
          memUsed:           stats.memUsed,
          uptime:            stats.uptime,
          reconnectAttempts: health.reconnectCount,
          lastError:         health.lastError,
          lastConnectedAt:   health.lastReadyAt
        }]
      });
    } catch {
      res.json({ connected: false, nodes: 0, activePlayers: 0, totalPlayers: 0, ping: 0, uptime: 0, memUsed: 0, cpuLoad: 0, nodesList: [] });
    }
  });

  app.post('/api/admin/lavalink/reconnect', requireAdmin, async (_req, res) => {
    try {
      const { reconnectAll } = await import('../services/audioService.js');
      // Only voice connections that are NOT healthy get a rejoin — active playback is untouched.
      const n = reconnectAll();
      pushActivity('admin', 'إعادة اتصال الصوت', `${n} اتصال`);
      res.json({ ok: true, rejoined: n });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/admin/lavalink/cache', requireAdmin, (_req, res) => {
    clearQuranCache();                                   // really clears the reciters/suwar/radio caches
    pushActivity('admin', 'مسح كاش البيانات', 'القرّاء والسور والراديو');
    res.json({ ok: true });
  });

  // ── Bot control ───────────────────────────────────────────────────────────
  app.post('/api/admin/bot/deploy', requireAdmin, needConfirm('DEPLOY'), async (_req, res) => {
    try {
      const { execFile } = await import('child_process');
      const { fileURLToPath: fu } = await import('url');
      const { dirname: dn, join: jn } = await import('path');
      const deployPath = jn(dn(fu(import.meta.url)), '..', 'deploy-commands.js');
      execFile(process.execPath, [deployPath], { timeout: 60000 }, (err) => {
        if (err) return fail(res, err);
        pushActivity('admin', 'نشر أوامر البوت', '');
        res.json({ ok: true });          // the script's console output stays in the server log, never goes to the browser
      });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/admin/bot/cache', requireAdmin, (_req, res) => {
    try {
      // Only member caches are safe to drop. Clearing guild.channels.cache breaks voice joins,
      // panel refresh and the "bot alone in channel" check until the next restart.
      let swept = 0;
      client.guilds.cache.forEach(g => {
        swept += g.members.cache.sweep(m => m.id !== client.user.id);
      });
      pushActivity('admin', 'مسح كاش البوت', `${swept} عضو`);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/bot/sync-stats', requireAdmin, async (_req, res) => {
    try {
      await client.guilds.fetch();
      pushActivity('admin', 'مزامنة الإحصائيات', '');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // FIX: maintenanceMode now returns current state so frontend can sync toggle
  let maintenanceModeActive = false;
  app.get('/api/admin/bot/maintenance', requireAdmin, (_req, res) => {
    res.json({ maintenance: maintenanceModeActive });
  });
  app.post('/api/admin/bot/maintenance', requireAdmin, (_req, res) => {
    maintenanceModeActive = !maintenanceModeActive;
    client._maintenanceMode = maintenanceModeActive;
    pushActivity('admin', maintenanceModeActive ? 'تفعيل وضع الصيانة' : 'إيقاف وضع الصيانة', '');
    res.json({ ok: true, maintenance: maintenanceModeActive });
  });

  app.post('/api/admin/bot/restart', requireAdmin, needConfirm('RESTART'), (_req, res) => {
    pushActivity('admin', 'إعادة تشغيل البوت', '');
    res.json({ ok: true });
    logger.warn('🔄 Admin restart — exiting...');
    setTimeout(() => process.emit('SIGTERM'), 300);   // graceful: leaves voice first
  });

  // ── Settings (persisted in MongoDB under a special "_bot_" key) ──────────
  // FIX: previously stored in-memory — wiped on every restart.
  // Now uses GuildSettings with guildId="_bot_" as a simple key-value store.
  const BOT_SETTINGS_ID = '_bot_';
  app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    const { key, value } = req.body;
    // key becomes a Mongo field path: allow only plain names (no dots / $ / __proto__ tricks)
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(String(key ?? '')) || key === '__proto__') return res.status(400).json({ error: 'invalid key' });
    // Plain values only: an object could smuggle `$`-prefixed operator keys into the Mongo update.
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return res.status(400).json({ error: 'value must be a string, number, boolean or null' });
    if (JSON.stringify(value ?? null).length > 2000) return res.status(400).json({ error: 'value too large' });
    try {
      // Store each setting as a field inside a single MongoDB document
      await GuildSettings.findOneAndUpdate(
        { guildId: BOT_SETTINGS_ID },
        { $set: { [`settings.${key}`]: value } },
        { upsert: true }
      );
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
    try {
      const doc = await GuildSettings.findOne({ guildId: BOT_SETTINGS_ID }).lean();
      res.json(doc?.settings ?? {});
    } catch (err) { fail(res, err); }
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────
  // FIX: Track broadcast stats server-side
  const broadcastStats = { total: 0, lastSentAt: null, lastSentCount: 0 };

  app.get('/api/admin/broadcast/stats', requireAdmin, (_req, res) => {
    res.json(broadcastStats);
  });

  let broadcasting = false;

  app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
    const message = textField(req.body?.message);
    const title   = textField(req.body?.title);
    const type    = ['info', 'success', 'warning', 'maintenance'].includes(req.body?.type) ? req.body.type : 'info';
    if (!message) return res.status(400).json({ error: 'message required' });
    // One announcement run at a time — shared with the scheduler (client._broadcastBusy) so they never overlap.
    if (broadcasting || client._broadcastBusy) return res.status(409).json({ error: 'A broadcast is already running' });
    broadcasting = true; client._broadcastBusy = true;
    let result;
    try {
      // 10 at a time instead of one by one: hundreds of servers finish in seconds, well before a reverse proxy gives up
      // on the request (the dashboard waits for the final count). discord.js still queues around rate limits.
      result = await runBroadcast(client, [...client.guilds.cache.values()], { title, message, type });
    } catch (err) {
      return fail(res, err);
    } finally { broadcasting = false; client._broadcastBusy = false; }
    const sent = result.sent;
    broadcastStats.total++;
    broadcastStats.lastSentAt = new Date().toISOString();
    broadcastStats.lastSentCount = sent;
    const u = req.session.user;
    Broadcast.create({ title: (title ?? '').slice(0, 256), message: message.slice(0, 4000), type, target: 'all', status: 'done', result,
      createdBy: `${u.username ?? u.id} (${u.id})`, finishedAt: new Date() })
      .catch(err => logger.warn(`[Broadcast] history save failed: ${err.message}`));
    pushActivity('admin', `إعلان عام: "${(title || message).slice(0, 40)}"`, `أُرسل لـ ${sent} سيرفر${result.failed ? ` · فشل ${result.failed}` : ''}`);
    res.json({ ok: true, sent, failed: result.failed, skipped: result.skipped });
  });

  app.post('/api/admin/broadcast/test', requireAdmin, async (req, res) => {
    const message = textField(req.body?.message);
    if (!message) return res.status(400).json({ error: 'message required' });
    const guild = client.guilds.cache.first();
    if (!guild) return res.status(404).json({ error: 'No guild available for test' });
    try {
      const channel = pickBroadcastChannel(guild);
      if (!channel) return res.status(404).json({ error: 'No sendable channel found' });
      await channel.send({
        allowedMentions: { parse: [] },
        embeds: [{
          title: '🧪 إعلان تجريبي',
          description: message.slice(0, 4000),
          color: 0x5b6ff5,
          footer: { text: 'بوت القرآن الكريم — اختبار' },
          timestamp: new Date().toISOString()
        }]
      });
      res.json({ ok: true, guild: guild.name });
    } catch (err) { fail(res, err); }
  });

  // ── Owner panel phase 2: system monitor, logs, deep server info, bulk actions, cleanup, growth ──
  const owner = registerOwnerRoutes(app, { client, requireAdmin, requireMod, requireCap, pushActivity, fail });
  // Phase 4: alerts, server health, private notes/tags, audit filters, persistent + scheduled announcements.
  registerOwnerPhase4(app, { client, requireAdmin, requireMod, requireCap, pushActivity, fail, getHistory: owner.getHistory });
  registerOwnerControl(app, { client, requireAdmin, requireCap, pushActivity, fail });
  // Phase 5: fleet & /pull, stations & reciters, wird / adhkar / events, security (sessions, sign-in history, export). Owner only.
  registerOwnerPhase5(app, { client, requireAdmin, pushActivity, fail, ...buildPhase5Deps({ adminIds: ADMIN_IDS, modIds: MOD_IDS, roleOf, apiBase: API_BASE, sessionSecret: SESSION_SECRET }) });

  // ── Dashboard (AFTER all API routes) ──────────────────────────────────────
  app.use('/admin', express.static(dashAdmin, { dotfiles: 'deny', index: false, redirect: false }));
  app.get('/auth/callback', (_req, res) => res.sendFile(`${dashAdmin}/index.html`));
  app.get('/admin', (_req, res) => res.sendFile(`${dashAdmin}/index.html`));
  app.get(/^\/admin\/.*/, (_req, res) => res.sendFile(`${dashAdmin}/index.html`));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.get('*', (_req, res) => res.redirect('/admin'));    // no public website: everything leads to the dashboard

  // Last-resort error handler. Without it Express' default handler prints the stack trace (file paths included)
  // whenever NODE_ENV is not "production" — e.g. for a malformed JSON body, which is parsed before auth.
  app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) logger.error('[API]', err?.message ?? err);
    if (res.headersSent) return res.destroy();
    res.status(status).json({ error: status === 400 ? 'Bad request' : status === 413 ? 'Payload too large' : status < 500 ? 'Request error' : 'Internal error' });
  });

  // Default 0.0.0.0: panels run the bot in a container where only the IPv4 interface is reachable from outside.
  // Set API_HOST=127.0.0.1 when a reverse proxy on the same machine is the only way in.
  const server = http.createServer({ connectionsCheckingInterval: SERVER_LIMITS.connectionsCheckingInterval }, app);
  tuneServer(server);                                              // slow-header / slow-body clients are cut off, oversized headers refused
  server.listen(PORT, config.api.host, () => logger.success(`🌐 API running → port ${PORT}`));
  // A busy/forbidden port must not crash the bot: only the dashboard is lost, the recitations keep working.
  apiServer = server;
  server.on('error', (err) => logger.error(`🌐 API could not listen on port ${PORT} (${err.code ?? err.message}) — the dashboard is unavailable, the bot keeps running`));
}
