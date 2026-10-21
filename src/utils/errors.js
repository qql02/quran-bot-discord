import { createHash } from 'node:crypto';

/**
 * Two kinds of failure, handled differently:
 *
 *  1. USER-FIXABLE  (UserError, or a known Discord permission error)
 *     The person can fix it themselves (join a voice channel, give the bot a permission, raise a channel limit…).
 *     → they get a clear message that says WHAT is wrong and HOW to fix it. No code.
 *
 *  2. EVERYTHING ELSE (a bug, a host/network problem, an unexpected Discord/Mongo failure)
 *     Only a developer can fix it, so the person gets "unexpected error" + a short CODE, and nothing technical.
 *     The code is a hash of (where it happened + error type + message with ids/numbers removed), so the SAME bug
 *     always has the SAME code. Search the code in logs/error.log (or the dashboard activity feed) to find
 *     the full stack trace, guild, user and command.
 *
 * This file is pure (no discord.js / database imports) so it can be unit-tested.
 */

/** An error whose cause the user can fix. `key` is a locale key under `errors.*`. */
export class UserError extends Error {
  constructor(key, vars = {}) {
    super(`user-error:${key}`);
    this.name = 'UserError';
    this.key = key;
    this.vars = vars;
  }
}

/** Stable short code for an unexpected error, e.g. `E-9A41C2`. */
export function errorCode(err, where = 'unknown') {
  const first = String(err?.message ?? err ?? '').split('\n')[0]
    .replace(/https?:\/\/\S+/g, 'URL')       // urls differ per request
    .replace(/\d{5,}/g, 'N')                 // snowflakes / ports / timestamps
    .replace(/\b[0-9a-f]{8,}\b/gi, 'H')      // hashes / object ids
    .replace(/\d+/g, 'n')
    .slice(0, 120);
  const raw = [where, err?.name ?? typeof err, err?.code ?? '', first].join('|');
  return 'E-' + createHash('sha1').update(raw).digest('hex').slice(0, 6).toUpperCase();
}

// Discord API error codes that mean "the interaction is gone / already answered": nobody to tell, nothing to fix.
const IGNORED_DISCORD = new Set([10062, 40060, 10008, 10015]);
// Discord API error codes that mean the BOT lacks a permission — the server admin can fix that.
const MISSING_PERMISSION = new Set([50013]);
const MISSING_ACCESS     = new Set([50001]);

/**
 * @returns {{ kind: 'ignore' } | { kind: 'user', key: string, vars: object } | { kind: 'unexpected' }}
 */
export function classifyError(err) {
  if (err instanceof UserError) return { kind: 'user', key: err.key, vars: err.vars };
  if (err?.code === 'CAPACITY')  return { kind: 'user', key: 'busy', vars: {} };
  const code = typeof err?.code === 'number' ? err.code : undefined;
  if (code !== undefined) {
    if (IGNORED_DISCORD.has(code))      return { kind: 'ignore' };
    if (MISSING_PERMISSION.has(code))   return { kind: 'user', key: 'bot_missing_permissions', vars: {} };
    if (MISSING_ACCESS.has(code))       return { kind: 'user', key: 'bot_no_access', vars: {} };
  }
  return { kind: 'unexpected' };
}
