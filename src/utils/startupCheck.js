/**
 * startupCheck.js — environment report printed to the console at start-up.
 * Every variable is listed with ✅ ok / ⚠️ warning / ❌ error and a plain explanation, so a missing or wrong value is
 * visible immediately instead of failing later. Secrets are masked. Pure function: `checkEnv` takes the env object.
 */
const SNOWFLAKE = /^\d{17,20}$/;
const mask = (v) => (v.length <= 10 ? '***' : `${v.slice(0, 4)}…${v.slice(-4)}`);

/** The bot's own ID is the first segment of its token (base64). Lets us catch CLIENT_ID ≠ DISCORD_TOKEN. */
export function tokenBotId(token) {
  try {
    const id = Buffer.from(String(token).split('.')[0], 'base64').toString('utf8');
    return SNOWFLAKE.test(id) ? id : null;
  } catch { return null; }
}

/**
 * @param {Record<string,string|undefined>} env
 * @param {{ hasEnvFile?: boolean }} [opts]
 * @returns {{ lines: Array<{level:'ok'|'warn'|'error', key:string, text:string}>, errors:number, warnings:number }}
 */
export function checkEnv(env, { hasEnvFile = true } = {}) {
  const lines = [];
  const add = (level, key, text) => lines.push({ level, key, text });
  const get = (k) => (env[k] ?? '').trim();
  const secondary = get('BOT_ROLE').toLowerCase() === 'secondary';

  // required value: ok / error
  const need = (key, { secret = false, check = null, hint = '' } = {}) => {
    const v = get(key);
    if (!v) return add('error', key, `MISSING — ${hint}`);
    const bad = check?.(v);
    if (bad) return add('error', key, `INVALID — ${bad}`);
    add('ok', key, secret ? mask(v) : v.slice(0, 70));
  };
  // recommended value: ok / warning
  const want = (key, { secret = false, check = null, hint = '' } = {}) => {
    const v = get(key);
    if (!v) return add('warn', key, `EMPTY — ${hint}`);
    const bad = check?.(v);
    if (bad) return add('warn', key, `SUSPICIOUS — ${bad}`);
    add('ok', key, secret ? mask(v) : v.slice(0, 70));
  };

  if (!hasEnvFile) add('warn', '.env', 'no .env file next to index.js — values are read from the host\'s Environment tab / system variables (fine, just make sure they are set there)');

  need('DISCORD_TOKEN', { secret: true, hint: 'the bot token (Developer Portal → Bot → Reset Token)', check: v => (v.split('.').length !== 3 ? 'does not look like a bot token (3 parts separated by dots); copy the token again with no spaces or quotes' : null) });
  const tid = tokenBotId(get('DISCORD_TOKEN'));
  if (!secondary) {
    need('CLIENT_ID', { hint: 'the Application ID (Developer Portal → General Information)', check: v => (!SNOWFLAKE.test(v) ? 'must be only digits (17–20)' : (tid && tid !== v ? `does not match the bot token (token belongs to ${tid}) — the token and CLIENT_ID are from different applications` : null)) });
  }
  need('MONGODB_URI', { secret: true, hint: 'MongoDB connection string', check: v => (!/^mongodb(\+srv)?:\/\//.test(v) ? 'must start with mongodb:// or mongodb+srv://' : null) });

  if (secondary) {
    add('ok', 'BOT_ROLE', 'secondary (voice-only helper) — it must use the SAME MONGODB_URI as the main bot and a DIFFERENT token');
    return summarize(lines);
  }

  want('DISCORD_CLIENT_SECRET', { secret: true, hint: 'needed for dashboard login (OAuth2)' });
  want('SESSION_SECRET', { secret: true, hint: 'needed in production for dashboard sessions', check: v => (v.length < 32 ? 'shorter than 32 characters' : null) });
  want('API_BASE_URL', { hint: 'public https URL of this bot\'s API/dashboard', check: v => (!/^https:\/\//.test(v) ? 'should be https:// (dashboard login needs it)' : null) });
  want('ADMIN_IDS', { hint: 'your Discord user ID (dashboard owner)', check: v => (v.split(',').some(x => !SNOWFLAKE.test(x.trim())) ? 'every ID must be 17–20 digits, comma-separated' : null) });

  const second = get('SECOND_BOT_TOKEN');
  const secondId = second ? tokenBotId(second) : null;
  if (!second) add('warn', 'SECOND_BOT_TOKEN', 'EMPTY — optional: paste the second bot\'s token here to run it from THIS project (voice-only helper for /pull and a second room)');
  else if (!secondId || second.split('.').length !== 3) add('error', 'SECOND_BOT_TOKEN', 'INVALID — not a bot token; copy it again from Developer Portal → Bot → Reset Token');
  else if (secondId === get('CLIENT_ID') || secondId === tid) add('error', 'SECOND_BOT_TOKEN', 'is the SAME bot as DISCORD_TOKEN — it must be a second, different Discord application');
  else add('ok', 'SECOND_BOT_TOKEN', `${mask(second)} (second bot ID ${secondId} — runs from this project)`);

  const alt = get('ALT_BOT_ID');
  if (!alt) {
    if (second) add('ok', 'ALT_BOT_ID', 'empty — taken from SECOND_BOT_TOKEN');
    else add('warn', 'ALT_BOT_ID', 'EMPTY — optional: only needed to show the 🎧 invite button when no second bot is configured');
  } else if (!SNOWFLAKE.test(alt)) add('warn', 'ALT_BOT_ID', 'INVALID — must be only digits (the second bot\'s Application ID)');
  else if (alt === get('CLIENT_ID') || alt === tid) add('error', 'ALT_BOT_ID', 'is the SAME bot as the main one — it must be the Application ID of a second, different bot');
  else add('ok', 'ALT_BOT_ID', alt);

  const role = get('BOT_ROLE').toLowerCase();
  if (role && role !== 'primary') add('error', 'BOT_ROLE', `INVALID — "${role}" (use primary or secondary)`);
  else add('ok', 'BOT_ROLE', role || 'primary (default)');

  return summarize(lines);
}

function summarize(lines) {
  return { lines, errors: lines.filter(l => l.level === 'error').length, warnings: lines.filter(l => l.level === 'warn').length };
}

/** Print the report through the logger. */
export function printEnvReport(logger, report) {
  logger.info('━━━━━━━━━━ Environment check ━━━━━━━━━━');
  for (const l of report.lines) {
    const msg = `${l.key.padEnd(22)} ${l.text}`;
    if (l.level === 'ok') logger.success(`✅ ${msg}`);
    else if (l.level === 'warn') logger.warn(`⚠️  ${msg}`);
    else logger.error(`❌ ${msg}`);
  }
  const summary = `Environment: ${report.errors} error(s), ${report.warnings} warning(s)`;
  if (report.errors) logger.error(`❌ ${summary}`);
  else if (report.warnings) logger.warn(`⚠️  ${summary}`);
  else logger.success(`✅ ${summary}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
