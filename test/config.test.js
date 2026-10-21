import { test } from 'node:test';
import assert from 'node:assert/strict';

const KEYS = [
  'NODE_ENV', 'DISCORD_TOKEN', 'CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'GUILD_ID', 'MONGODB_URI', 'ADMIN_IDS',
  'API_PORT', 'PORT', 'SERVER_PORT', 'API_BASE_URL', 'ADMIN_DASHBOARD_URL', 'SESSION_SECRET', 'AUDIO_BACKEND', 'FFMPEG_PATH',
  'STREAM_LOAD_TIMEOUT_MS', 'STREAM_STUCK_TIMEOUT_MS', 'AUDIO_ALLOW_PRIVATE', 'QURAN_API_URL',
  'QURAN_CACHE_TTL_HOURS', 'DEFAULT_RECITER', 'AUTO_LEAVE_MINUTES', 'PAUSED_LEAVE_MINUTES',
  'BOT_ACTIVITY', 'BOT_THUMBNAIL_URL', 'NO_COLOR', 'DONATION_URL',
];
const GOOD = {
  DISCORD_TOKEN: 'tok', CLIENT_ID: '123456789012345678', MONGODB_URI: 'mongodb://h/db',
  SESSION_SECRET: 'x'.repeat(40), DISCORD_CLIENT_SECRET: 'secret', ADMIN_IDS: '123456789012345678',
};
let n = 0;

/** Load a fresh copy of config.js under the given environment (the query string defeats the module cache). */
async function load(env = {}) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => delete process.env[k]);
  Object.assign(process.env, env);
  try {
    return await import(`../src/config.js?case=${++n}`);
  } finally {
    KEYS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  }
}

test('valid environment → defaults filled in, no errors', async () => {
  const { config, configIssues } = await load(GOOD);
  assert.deepEqual(configIssues.errors, []);
  assert.deepEqual(configIssues.warnings, []);
  assert.equal(config.api.port, 3000);
  assert.equal(config.api.baseUrl, 'http://localhost:3000');
  assert.equal(config.api.dashboardUrl, 'http://localhost:3000/admin');
  assert.equal(config.session.autoLeaveMs, 5 * 60_000);
  assert.equal(config.session.emptyLeaveMs, 30_000);
  assert.equal(config.session.pausedLeaveMs, 15 * 60_000);
  assert.equal(config.audio.backend, 'auto');
  assert.equal(config.audio.loadTimeoutMs, 20_000);
  assert.equal(config.quran.cacheTtlMs, 6 * 3_600_000);
  assert.equal(config.quran.defaultReciter, 'Mishary Rashid Alafasy');
  assert.equal(config.session.maxQueue, 100);
});

test('missing required variables → every one is reported at once', async () => {
  const { configIssues } = await load({ SESSION_SECRET: 'x'.repeat(40) });
  assert.equal(configIssues.errors.length, 3);
  for (const k of ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGODB_URI']) {
    assert.ok(configIssues.errors.some(e => e.includes(k)), `${k} not reported`);
  }
});

test('production: weak / placeholder / short SESSION_SECRET is fatal', async () => {
  for (const secret of [undefined, 'short', 'change-me', 'change_this_to_a_long_random_string', 'y'.repeat(31)]) {
    const env = { ...GOOD, NODE_ENV: 'production' };
    if (secret === undefined) delete env.SESSION_SECRET; else env.SESSION_SECRET = secret;
    const { configIssues } = await load(env);
    assert.ok(configIssues.errors.some(e => e.includes('SESSION_SECRET')), `secret ${secret} should be fatal`);
  }
});

test('NODE_ENV unset: weak SESSION_SECRET is fatal (unset is not a free pass)', async () => {
  const { configIssues } = await load({ ...GOOD, SESSION_SECRET: 'change-me' });
  assert.ok(configIssues.errors.some(e => e.includes('SESSION_SECRET')));
});

test('explicit development: weak SESSION_SECRET only warns', async () => {
  const { configIssues } = await load({ ...GOOD, NODE_ENV: 'development', SESSION_SECRET: 'short' });
  assert.deepEqual(configIssues.errors, []);
  assert.ok(configIssues.warnings.some(w => w.includes('SESSION_SECRET')));
});

test('invalid numbers fall back to defaults with a warning (never NaN)', async () => {
  const { config, configIssues } = await load({
    ...GOOD, AUTO_LEAVE_MINUTES: 'abc', PAUSED_LEAVE_MINUTES: '-5', PORT: '99999',
    QURAN_CACHE_TTL_HOURS: '0', STREAM_LOAD_TIMEOUT_MS: '12.5', STREAM_STUCK_TIMEOUT_MS: '50',
  });
  assert.equal(config.session.autoLeaveMs, 5 * 60_000);
  assert.equal(config.session.pausedLeaveMs, 15 * 60_000);
  assert.equal(config.api.port, 3000);
  assert.equal(config.quran.cacheTtlMs, 6 * 3_600_000);
  assert.equal(config.audio.loadTimeoutMs, 20_000);
  assert.equal(config.audio.stuckTimeoutMs, 25_000);
  assert.equal(configIssues.warnings.length, 6);
  for (const v of [config.session.autoLeaveMs, config.api.port, config.quran.cacheTtlMs]) assert.ok(Number.isFinite(v));
});

test('valid numbers are honoured; API_PORT wins over PORT', async () => {
  const { config } = await load({ ...GOOD, API_PORT: '8080', PORT: '9090', AUTO_LEAVE_MINUTES: '2', QURAN_CACHE_TTL_HOURS: '12' });
  assert.equal(config.api.port, 8080);
  assert.equal(config.session.autoLeaveMs, 2 * 60_000);
  assert.equal(config.quran.cacheTtlMs, 12 * 3_600_000);
  assert.equal((await load({ ...GOOD, PORT: '9090' })).config.api.port, 9090);
});

test('AUDIO_BACKEND is validated and case-insensitive', async () => {
  assert.equal((await load({ ...GOOD, AUDIO_BACKEND: 'WASM' })).config.audio.backend, 'wasm');
  const { config, configIssues } = await load({ ...GOOD, AUDIO_BACKEND: 'foo' });
  assert.equal(config.audio.backend, 'auto');
  assert.ok(configIssues.warnings.some(w => w.includes('AUDIO_BACKEND')));
});

test('URLs: trailing slashes stripped, invalid ones ignored, dashboard URL derived', async () => {
  const { config } = await load({ ...GOOD, API_BASE_URL: 'https://bot.example.com//' });
  assert.equal(config.api.baseUrl, 'https://bot.example.com');
  assert.equal(config.api.dashboardUrl, 'https://bot.example.com/admin');
  const bad = await load({ ...GOOD, API_BASE_URL: 'not a url', BOT_THUMBNAIL_URL: 'ftp://x/y.png' });
  assert.equal(bad.config.api.baseUrl, 'http://localhost:3000');
  assert.equal(bad.config.bot.thumbnailUrl, 'https://i.imgur.com/4MX8ZOE.png');
  assert.equal(bad.configIssues.warnings.length, 2);
});

test('ADMIN_IDS keeps only valid Discord IDs', async () => {
  const { config, configIssues } = await load({ ...GOOD, ADMIN_IDS: ' 123456789012345678 , abc,987654321098765432,12 ' });
  assert.deepEqual(config.admin.ids, ['123456789012345678', '987654321098765432']);
  assert.equal(configIssues.warnings.filter(w => w.startsWith('ADMIN_IDS')).length, 2);
});

test('MOD_IDS: moderators list keeps only valid IDs and is empty by default', async () => {
  assert.deepEqual((await load({ ...GOOD })).config.admin.modIds, []);
  const { config } = await load({ ...GOOD, MOD_IDS: '111111111111111111, nope ,222222222222222222' });
  assert.deepEqual(config.admin.modIds, ['111111111111111111', '222222222222222222']);
});

test('GUILD_ID must be a snowflake', async () => {
  assert.equal((await load({ ...GOOD, GUILD_ID: '123456789012345678' })).config.discord.guildId, '123456789012345678');
  assert.equal((await load({ ...GOOD, GUILD_ID: 'nope' })).config.discord.guildId, undefined);
});

test('operational warnings: http base URL, empty admins, missing OAuth secret, SSRF switch', async () => {
  const { configIssues } = await load({
    DISCORD_TOKEN: 't', CLIENT_ID: '1', MONGODB_URI: 'm', SESSION_SECRET: 'x'.repeat(40),
    API_BASE_URL: 'http://1.2.3.4:3000', AUDIO_ALLOW_PRIVATE: '1',
  });
  const text = configIssues.warnings.join('\n');
  for (const needle of ['plain http', 'ADMIN_IDS is empty', 'DISCORD_CLIENT_SECRET', 'SSRF']) {
    assert.ok(text.includes(needle), `missing warning: ${needle}`);
  }
  assert.equal(configIssues.warnings.some(w => w.includes('plain http')), true);
  const local = await load({ ...GOOD, API_BASE_URL: 'http://localhost:3000' });
  assert.equal(local.configIssues.warnings.some(w => w.includes('plain http')), false, 'localhost is fine');
});

test('BOT_ACTIVITY is capped to Discord\'s 128-character limit', async () => {
  assert.equal((await load({ ...GOOD, BOT_ACTIVITY: 'a'.repeat(300) })).config.bot.activity.length, 128);
});

test('config is deeply frozen', async () => {
  const { config, configIssues } = await load(GOOD);
  assert.throws(() => { config.api.port = 1; }, TypeError);
  assert.throws(() => { config.admin.ids.push('1'); }, TypeError);
  assert.throws(() => { configIssues.errors.push('x'); }, TypeError);
});

test('DONATION_URL: off by default, only a valid https link turns it on', async () => {
  assert.equal((await load(GOOD)).config.bot.donationUrl, undefined);
  assert.equal((await load({ ...GOOD, DONATION_URL: 'https://example.com/support' })).config.bot.donationUrl, 'https://example.com/support');
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'not a url']) {
    const { config, configIssues } = await load({ ...GOOD, DONATION_URL: bad });
    assert.equal(config.bot.donationUrl, undefined, bad);
    assert.equal(configIssues.errors.length, 0);
    assert.ok(configIssues.warnings.some(w => w.includes('DONATION_URL')), bad);
  }
});

test('port: API_PORT beats PORT beats SERVER_PORT (panel hosts such as bot-hosting.net inject SERVER_PORT)', async () => {
  assert.equal((await load({ ...GOOD, SERVER_PORT: '25565' })).config.api.port, 25565);
  assert.equal((await load({ ...GOOD, SERVER_PORT: '25565', PORT: '8080' })).config.api.port, 8080);
  assert.equal((await load({ ...GOOD, SERVER_PORT: '25565', PORT: '8080', API_PORT: '4000' })).config.api.port, 4000);
  assert.equal((await load({ ...GOOD })).config.api.port, 3000);
  assert.equal((await load({ ...GOOD, SERVER_PORT: 'abc' })).config.api.port, 3000, 'a garbage value falls back instead of breaking');
});
