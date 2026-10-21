/**
 * Bot-token helpers: client ID from the token, token check, invite link, "is the bot in the server?" check.
 * Zero imports (config.js uses it too). Network functions take an injectable `fetchImpl` so tests never touch Discord.
 * A token is never logged or returned by anything here.
 */

const API = 'https://discord.com/api/v10';

// Permission bits the Quran bot needs in a server (View Channel, Send Messages, Embed Links, Connect, Speak).
export const NEEDED_PERMS = Object.freeze({
  ViewChannel: 1n << 10n, SendMessages: 1n << 11n, EmbedLinks: 1n << 14n, Connect: 1n << 20n, Speak: 1n << 21n
});
const ADMINISTRATOR = 1n << 3n;

/**
 * The VOICE-ONLY second bot needs a little more than the check above (it edits its own panel → Read Message History, and the panel
 * uses the server's emojis) but NOT Manage Channels (that is only for the main bot's /setup). Least privilege: the invite asks for exactly this.
 * 37047296 = View Channel + Send Messages + Embed Links + Read Message History + Use External Emojis + Connect + Speak + Use Voice Activity.
 */
export const VOICE_WORKER_PERMS = Object.freeze({
  ...NEEDED_PERMS, ReadMessageHistory: 1n << 16n
});
export const VOICE_WORKER_INVITE_PERMISSIONS = '37047296';

/** A bot token is only ever letters, digits, `.`, `_` and `-`. Anything else (a newline, a space, a quote) is rejected before it can reach a file. */
export const looksLikeTokenText = (token) => typeof token === 'string' && /^[A-Za-z0-9._-]{20,200}$/.test(token.trim());

/** A bot token is  base64(userId).timestamp.hmac  — the first part IS the bot's user/client ID. null when it is not a token. */
export function clientIdFromToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[0]) return null;
  try {
    const id = Buffer.from(parts[0], 'base64').toString('utf8');
    return /^\d{17,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** `commands: false` = a bot-only invite (no `applications.commands` scope): the voice-only bot registers no slash commands. */
export function inviteUrl(clientId, permissions = '37047312', guildId = null, { commands = true } = {}) {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&integration_type=0&scope=bot${commands ? '+applications.commands' : ''}` +
         (guildId ? `&guild_id=${guildId}&disable_guild_select=true` : '');
}

async function call(token, path, fetchImpl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Authorization: `Bot ${token}`, 'User-Agent': 'QuranBot-installer (add-bot)', ...(init.body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetchImpl(`${API}${path}`, { ...init, headers });
    if (res.status === 429 && attempt === 0) {
      const body = await res.json().catch(() => ({}));
      await sleep(Math.min(10_000, Math.ceil((body.retry_after ?? 1) * 1000)));
      continue;
    }
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return { status: 429, data: null };
}

/**
 * Ask Discord who the token belongs to. → { ok:true, id, name } | { ok:false, reason: 'format'|'invalid_token'|'not_a_bot'|'network' }
 * The ID from the token text and the ID Discord reports must agree.
 */
export async function inspectBot(token, fetchImpl = fetch) {
  const idFromToken = clientIdFromToken(token);
  if (!idFromToken) return { ok: false, reason: 'format' };
  let r;
  try { r = await call(token.trim(), '/users/@me', fetchImpl); } catch { return { ok: false, reason: 'network' }; }
  if (r.status === 401) return { ok: false, reason: 'invalid_token' };
  if (r.status !== 200 || !r.data?.id) return { ok: false, reason: 'network' };
  if (!r.data.bot || r.data.id !== idFromToken) return { ok: false, reason: 'not_a_bot' };
  return { ok: true, id: r.data.id, name: r.data.username };
}

/**
 * Can OTHER servers' admins add this bot? Only when the application is a "Public Bot" (Developer Portal → Installation / Bot) and does not
 * require a code grant — otherwise the invite link works for its owner alone and fails for everybody else.
 * → { ok:true, public, codeGrant } | { ok:false }   (never throws; `ok:false` = Discord did not answer, nothing is claimed)
 */
export async function inspectApplication(token, fetchImpl = fetch) {
  try {
    const r = await call(token.trim(), '/applications/@me', fetchImpl);
    if (r.status !== 200 || typeof r.data !== 'object' || r.data === null) return { ok: false };
    return { ok: true, public: r.data.bot_public === true, codeGrant: r.data.bot_require_code_grant === true };
  } catch { return { ok: false }; }
}

/** Is the bot a member of this server? (A bot can read a server only if it is in it.) */
export async function isInGuild(token, guildId, fetchImpl = fetch) {
  try { return (await call(token.trim(), `/guilds/${guildId}`, fetchImpl)).status === 200; } catch { return false; }
}

/** Server-wide permissions of the bot (roles only — channel overwrites are not considered). → { missing: string[] } | null */
export async function guildPermissionGaps(token, guildId, botId, fetchImpl = fetch, needed = NEEDED_PERMS) {
  try {
    const [roles, member] = await Promise.all([
      call(token.trim(), `/guilds/${guildId}/roles`, fetchImpl),
      call(token.trim(), `/guilds/${guildId}/members/${botId}`, fetchImpl)
    ]);
    if (roles.status !== 200 || member.status !== 200) return null;
    const mine = new Set([guildId, ...(member.data.roles ?? [])]);   // the @everyone role has the guild's ID
    let bits = 0n;
    for (const role of roles.data) if (mine.has(role.id)) bits |= BigInt(role.permissions);
    if (bits & ADMINISTRATOR) return { missing: [] };
    return { missing: Object.entries(needed).filter(([, bit]) => !(bits & bit)).map(([name]) => name) };
  } catch {
    return null;
  }
}

/** Poll until the bot is in the server. → true | false (timed out). */
export async function waitUntilInGuild(token, guildId, { intervalMs = 3000, timeoutMs = 300_000, fetchImpl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), onTick } = {}) {
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    if (await isInGuild(token, guildId, fetchImpl)) return true;
    onTick?.(waited);
    await sleep(intervalMs);
  }
  return false;
}

/** Global slash commands registered by this bot's application (the application ID of a bot is its user ID). → string[] | null when Discord cannot say. */
export async function listGlobalCommands(token, appId, fetchImpl = fetch) {
  try {
    const r = await call(token.trim(), `/applications/${appId}/commands`, fetchImpl);
    return r.status === 200 && Array.isArray(r.data) ? r.data.map(c => c.name) : null;
  } catch { return null; }
}

/** Remove every global slash command of the application (the voice-only bot must show none). → true when Discord accepted it. */
export async function clearGlobalCommands(token, appId, fetchImpl = fetch) {
  try {
    const r = await call(token.trim(), `/applications/${appId}/commands`, fetchImpl, undefined, { method: 'PUT', body: '[]' });
    return r.status === 200;
  } catch { return false; }
}
