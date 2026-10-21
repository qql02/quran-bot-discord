/**
 * Central configuration — the ONLY module that reads process.env.
 *
 *  • Every setting is parsed, range-checked and given a default here, once.
 *  • Bad values never crash or silently turn into NaN: they fall back to the default and add a warning.
 *  • Fatal problems (missing token, weak secret in production) are collected in `configIssues.errors`;
 *    src/bootstrap.js prints everything through the logger and exits if there are errors.
 *  • This module only imports the zero-dependency utils/botToken.js, so it can be loaded from anywhere (bot, API, deploy script, tests)
 *    without circular dependencies. Environment variables must already be loaded by the entry point.
 *
 * Adding a setting = one line in the right group below + use `config.group.name` where needed.
 */

import { clientIdFromToken } from './utils/botToken.js';

const errors   = [];
const warnings = [];

// ── Parsers ────────────────────────────────────────────────────────────────────
const raw = (name) => {
  const v = process.env[name];
  return v === undefined || String(v).trim() === '' ? undefined : String(v).trim();
};

const str = (name, def) => raw(name) ?? def;

function int(name, def, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const v = raw(name);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    warnings.push(`${name}="${v}" is invalid (expected an integer ${min}–${max}) — using default ${def}`);
    return def;
  }
  return n;
}

function oneOf(name, allowed, def) {
  const v = raw(name)?.toLowerCase();
  if (v === undefined) return def;
  if (!allowed.includes(v)) {
    warnings.push(`${name}="${v}" is not one of [${allowed.join(', ')}] — using "${def}"`);
    return def;
  }
  return v;
}

const flag = (name) => ['1', 'true', 'yes', 'on'].includes((raw(name) ?? '').toLowerCase());

const SNOWFLAKE = /^\d{17,20}$/;

function snowflake(name) {
  const v = raw(name);
  if (v === undefined) return undefined;
  if (!SNOWFLAKE.test(v)) { warnings.push(`${name} is not a valid Discord ID (17–20 digits) — ignored`); return undefined; }
  return v;
}

function snowflakeList(name) {
  const out = [];
  for (const part of (raw(name) ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (SNOWFLAKE.test(part)) out.push(part);
    else warnings.push(`${name}: "${part}" is not a valid Discord ID — ignored`);
  }
  return out;
}

function url(name, def, { httpsOnly = false } = {}) {
  const v = raw(name);
  if (v === undefined) return def;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol) || (httpsOnly && u.protocol !== 'https:')) throw new Error('bad protocol');
    return v.replace(/\/+$/, '');            // no trailing slash → `${base}/path` never becomes `//path`
  } catch {
    warnings.push(`${name}="${v}" is not a valid ${httpsOnly ? 'https ' : ''}URL — using default`);
    return def;
  }
}

function clientIdSetting() {
  const fromToken = clientIdFromToken(raw('DISCORD_TOKEN'));
  const given = snowflake('CLIENT_ID');
  if (given && fromToken && given !== fromToken) {
    errors.push('CLIENT_ID does not belong to DISCORD_TOKEN (they are two different bots) — remove CLIENT_ID, it is derived from the token');
  }
  if (!given && !fromToken) errors.push('Cannot determine the bot ID: DISCORD_TOKEN is missing or malformed (set CLIENT_ID to override)');
  return fromToken ?? given;
}

function required(name) {
  const v = raw(name);
  if (v === undefined) errors.push(`Missing required env variable: ${name}`);
  return v;
}

/** BOT_PREFIX: 1-3 symbol characters (no spaces, letters or markdown characters); anything else falls back to "!" with a warning. */
function commandPrefix() {
  const p = str('BOT_PREFIX', '!').trim();
  if (/^[^\s\w@#<>`*_~|\\]{1,3}$/u.test(p)) return p;
  warnings.push(`BOT_PREFIX="${p}" is not usable (1-3 symbol characters, no spaces or letters) — using "!"`);
  return '!';
}

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};


// ── Memory-aware session cap ──────────────────────────────────────────────────────────────────────────────────────
// A default of "25 sessions" overflows a small host: 25 × ~50MB ffmpeg ≈ 1.25GB, so the host kills the whole bot
// (every server loses audio) instead of just refusing the 15th listener. When MAX_SESSIONS is not set, derive it
// from the memory the process is really allowed to use (container limit when there is one, else physical RAM).
const BASE_RSS_MB   = 250;   // Node + discord.js + Mongoose + API, with headroom
const STREAM_MB     = { ffmpeg: 55, wasm: 30 };
const memoryLimitMb = () => {
  const os = process.getBuiltinModule?.('node:os');
  const limits = [os?.totalmem?.(), process.constrainedMemory?.()]
    .filter(n => Number.isFinite(n) && n > 0 && n < 2 ** 50);          // "unlimited" cgroups report ~2^64
  return limits.length ? Math.min(...limits) / 1048576 : null;
};
/** Sessions that fit in `memMb` of RAM for the given audio backend (3 … 25). Exported for tests. */
export function safeSessionCap(memMb, backend = 'auto') {
  if (!memMb) return 25;
  const per = STREAM_MB[backend === 'wasm' ? 'wasm' : 'ffmpeg'];
  return Math.max(3, Math.min(25, Math.floor((memMb - BASE_RSS_MB) / per)));
}

// ── Settings ───────────────────────────────────────────────────────────────────
const nodeEnv = str('NODE_ENV', 'development');
const isProd  = nodeEnv === 'production';

// API_PORT wins, then PORT (Heroku/Railway/Render style), then SERVER_PORT (Pterodactyl panels: bot-hosting.net and similar).
const port    = int('API_PORT', int('PORT', int('SERVER_PORT', 3000, { max: 65535 }), { max: 65535 }), { max: 65535 });
const baseUrl = url('API_BASE_URL', `http://localhost:${port}`);

// Two-bot setups (same code, two processes, one database): the PRIMARY bot runs the scheduled posts (adhkar, verse/hadith of the day,
// wird reminders, events); a SECONDARY bot only recites + serves commands, so nothing is posted or DM'd twice.
const botRole = oneOf('BOT_ROLE', ['primary', 'secondary'], 'primary');

const sessionSecret = raw('SESSION_SECRET') ?? 'change-me';
const weakSecret    = !raw('SESSION_SECRET') || /^change[_-]?(me|this)/i.test(sessionSecret) || sessionSecret.length < 32;
if (weakSecret) {
  const msg = 'SESSION_SECRET is missing, a placeholder, or shorter than 32 characters — set a long random value';
  // Weak secrets are tolerated ONLY when NODE_ENV is explicitly "development" or "test".
  // An unset NODE_ENV (the usual state on panel hosts) is treated as production, not as a free pass.
  const explicitDev = ['development', 'test'].includes(raw('NODE_ENV')?.toLowerCase() ?? '');
  if (explicitDev) warnings.push(`${msg} (allowed because NODE_ENV=${nodeEnv})`); else errors.push(msg);
}

const config = deepFreeze({
  env: nodeEnv,
  isProd,

  discord: {
    token:        required('DISCORD_TOKEN'),
    clientId:     clientIdSetting(),                     // CLIENT_ID is optional: it is the first part of DISCORD_TOKEN and is derived from it
    clientSecret: raw('DISCORD_CLIENT_SECRET'),          // only needed for dashboard login
    guildId:      snowflake('GUILD_ID'),                 // the "mother" server (needed when DEPLOY_SCOPE=guild)
    deployScope:  oneOf('DEPLOY_SCOPE', ['global', 'guild'], 'global'), // ONE place for slash commands: every server, or only GUILD_ID
  },

  mongo: {
    uri: required('MONGODB_URI'),
  },

  admin: {
    ids: snowflakeList('ADMIN_IDS'),                     // owners: full control of the dashboard
    alertDm: !['0', 'false', 'no', 'off'].includes((raw('OWNER_ALERT_DM') ?? '').toLowerCase()),   // DM the owners on critical alerts (on by default)
    modIds: snowflakeList('MOD_IDS'),                    // moderators: limited dashboard (view, voice control, remote play, per-server settings, message) — no leave/blacklist/bulk/restart/logs
  },

  api: {
    port,
    host:          str('API_HOST', '0.0.0.0'),                    // 127.0.0.1 when a reverse proxy runs on the same machine
    trustProxy:    int('TRUST_PROXY', 1, { min: 0, max: 10 }),      // how many reverse proxies sit in front (0 = none, X-Forwarded-* is ignored)
    sessionDays:   int('SESSION_DAYS', 2, { min: 1, max: 30 }),      // dashboard login lifetime (sliding); shorter = smaller window if a cookie leaks
    baseUrl,
    dashboardUrl:  url('ADMIN_DASHBOARD_URL', `${baseUrl}/admin`),
    sessionSecret,
  },

  audio: {
    backend:        oneOf('AUDIO_BACKEND', ['auto', 'ffmpeg', 'wasm'], 'auto'),
    ffmpegPath:     raw('FFMPEG_PATH'),
    loadTimeoutMs:  int('STREAM_LOAD_TIMEOUT_MS',  20_000, { min: 1_000 }),   // wait for first audio bytes
    stuckTimeoutMs: int('STREAM_STUCK_TIMEOUT_MS', 25_000, { min: 1_000 }),   // no data while playing
    allowHls:       raw('AUDIO_ALLOW_HLS') === '1',      // HLS (.m3u8) must be opened by ffmpeg itself → weaker SSRF guarantees, off by default
    allowPrivate:   raw('AUDIO_ALLOW_PRIVATE') === '1',  // disables SSRF protection — local testing only
  },

  quran: {
    apiUrl:          url('QURAN_API_URL', 'https://mp3quran.net/api/v3'),
    cacheTtlMs:      int('QURAN_CACHE_TTL_HOURS', 6, { max: 168 }) * 60 * 60 * 1000,
    defaultReciter:  str('DEFAULT_RECITER', 'Mishary Rashid Alafasy'),
    extraSources:    oneOf('EXTRA_RECITER_SOURCES', ['on', 'off'], 'on') === 'on',   // a second source of complete reciters (QuranicAudio), verified in the background
  },

  ayah: {
    apiUrl:         url('AYAH_API_URL', 'https://api.alquran.cloud/v1'),     // verse text + tafsir (verse of the day)
    textEdition:    str('AYAH_TEXT_EDITION',   'quran-uthmani'),
    tafsirEdition:  str('AYAH_TAFSIR_EDITION', 'ar.muyassar'),               // التفسير الميسر — short and clear
    timeoutMs:      int('AYAH_API_TIMEOUT_MS', 10_000, { min: 1_000, max: 60_000 }),
  },

  hadithApi: {
    apiUrl:    url('HADITH_API_URL', 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1'),   // /hadith — the six books, one small JSON per hadith
    timeoutMs: int('HADITH_API_TIMEOUT_MS', 10_000, { min: 1_000, max: 60_000 }),
  },

  // Page images of the Mushaf (Hafs + Warsh, King Fahd Complex artwork via quran.ws): the SVG pages are downloaded in the background
  // and kept on disk, PNGs are rendered on demand. Everything is optional — off, or any failure, leaves the text reader untouched.
  mushafImages: {
    enabled:     oneOf('MUSHAF_IMAGES', ['on', 'off'], 'on') === 'on',
    cdnUrl:      url('MUSHAF_IMAGES_CDN', 'https://cdn.quran.ws/svg/pages/v1.1.1'),   // pinned release; <cdnUrl>/<hafs-kfqc|warsh-kfqc>/001.svg
    dir:         str('MUSHAF_IMAGES_DIR', ''),                                         // empty = <project>/assets/quran-images (point it at a persistent volume if the host wipes local files)
    prefetch:    oneOf('MUSHAF_IMAGES_PREFETCH', ['on', 'off'], botRole === 'secondary' ? 'off' : 'on') === 'on',       // on = fetch every missing page at start-up (background); off = only pages members open
    riwayat:     oneOf('MUSHAF_IMAGES_RIWAYAT', ['both', 'hafs', 'warsh'], 'both'),     // limit disk use: each riwaya is roughly 400MB of SVG
    concurrency: int('MUSHAF_IMAGES_CONCURRENCY', 3, { max: 8 }),
    widthPx:     int('MUSHAF_IMAGE_WIDTH', 1000, { min: 600, max: 2000 }),             // width of the PNG sent to Discord
  },

  session: {
    autoLeaveMs:   int('AUTO_LEAVE_MINUTES',   5,  { max: 1440 }) * 60 * 1000,
    pausedLeaveMs: int('PAUSED_LEAVE_MINUTES', 15, { max: 1440 }) * 60 * 1000,
    leaveForOtherBots: oneOf('LEAVE_FOR_OTHER_BOTS', ['on', 'off'], 'on') === 'on',   // another bot joins our voice channel → leave at once (no music mixed with the Quran)
    emptyLeaveMs:  int('EMPTY_LEAVE_SECONDS',  30, { min: 5, max: 3600 }) * 1000,   // nobody left in the voice channel → leave this fast
    pullGraceMs:   int('PULL_GRACE_SECONDS',   90, { min: 0, max: 600 }) * 1000,    // the LAST listener moved to ANOTHER voice room: wait this long (at least) so /pull can bring the recitation to them
    maxQueue:      100,                                  // per guild
    maxSessions:   int('MAX_SESSIONS', safeSessionCap(memoryLimitMb(), raw('AUDIO_BACKEND')?.toLowerCase()), { max: 1000 }),   // concurrent voice sessions: default fits the RAM this process may use (each ffmpeg stream ≈ 50MB, WASM ≈ 10–30MB)
  },

  bot: {
    activity:     str('BOT_ACTIVITY', '🕌 Reciting the Holy Quran').slice(0, 128),   // Discord custom-status limit
    // Default: the logo this server hosts at /assets/logo.png (needs a public https API_BASE_URL). On localhost Discord can't reach it → old placeholder.
    thumbnailUrl: url('BOT_THUMBNAIL_URL', baseUrl.startsWith('https://') ? `${baseUrl.replace(/\/+$/, '')}/assets/logo.png` : 'https://i.imgur.com/4MX8ZOE.png', { httpsOnly: true }),
    invitePermissions: str('INVITE_PERMISSIONS', '37047312'),   // permission bits in the /invite link. Default: View Channels, Send Messages, Embed Links, Read Message History (edit panels), Use External Emojis, Connect, Speak, Use Voice Activity, Manage Channels (/setup creates the rooms)
    donationUrl:  url('DONATION_URL', undefined, { httpsOnly: true }),   // optional: where /donation sends people (your own support page). Unset = the command says it is not enabled
    prefix:       commandPrefix(),          // DM commands: "<prefix>help", "<prefix>page 45" … (no slash needed in the bot's private chat)
    altBotId:     snowflake('ALT_BOT_ID') ?? clientIdFromToken(raw('SECOND_BOT_TOKEN')) ?? undefined,   // SECOND_BOT_TOKEN (run from this project) already tells us the second bot's ID               // optional fallback: the other bot to mention when this one is busy (sibling bots in the same database are discovered automatically)
    role:         botRole,                               // BOT_ROLE: 'primary' (default) | 'secondary' (no schedulers — see above)
  },

  log: {
    noColor: flag('NO_COLOR'),
    retentionDays: int('LOG_RETENTION_DAYS', 7, { max: 365 }),   // archived daily logs older than this are deleted
  },
});

// ── Cross-checks ───────────────────────────────────────────────────────────────
// The voice-only second bot has no dashboard, so the dashboard warnings would only be noise there.
if (config.bot.role !== 'secondary') {
  if (!config.discord.clientSecret) {
    warnings.push('DISCORD_CLIENT_SECRET is not set — dashboard login (OAuth2) will not work');
  }
  if (config.admin.ids.length === 0) {
    warnings.push('ADMIN_IDS is empty — nobody will be able to sign in to the dashboard');
  }
  if (config.api.baseUrl.startsWith('http://') && !/^http:\/\/localhost(:\d+)?$/.test(config.api.baseUrl)) {
    warnings.push('API_BASE_URL is plain http:// — dashboard login needs HTTPS (the session cookie is Secure-only)');
  }
}
if (config.audio.allowPrivate) {
  warnings.push('AUDIO_ALLOW_PRIVATE=1 — SSRF protection is OFF. Never use this in production');
}

{
  const mem = memoryLimitMb();
  const safe = safeSessionCap(mem, raw('AUDIO_BACKEND')?.toLowerCase());
  if (mem && raw('MAX_SESSIONS') && config.session.maxSessions > safe) {
    warnings.push(`MAX_SESSIONS=${config.session.maxSessions} is above ~${safe}, what ${Math.round(mem)}MB of RAM can hold (≈${STREAM_MB.ffmpeg}MB per ffmpeg stream) — the host may kill the bot when that many play at once`);
  }
}
export { config };
export const configIssues = Object.freeze({ errors: Object.freeze([...errors]), warnings: Object.freeze([...warnings]) });
