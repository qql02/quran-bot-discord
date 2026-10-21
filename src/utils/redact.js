/**
 * redact.js — removes secrets from any text before it reaches the console or the log files
 * (a screenshot of the console or a shared log must never expose a token or a database password).
 * Zero imports.
 */
const SECRET_ENV = ['DISCORD_TOKEN', 'SECOND_BOT_TOKEN', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET'];
const TOKEN_RE = /[A-Za-z0-9_-]{23,30}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g;       // Discord bot token shape
const MONGO_RE = /(mongodb(?:\+srv)?:\/\/[^\s:/@]+:)[^\s@]+@/gi;                        // mongodb://user:PASSWORD@host

export function redact(text, env = process.env) {
  let out = String(text ?? '');
  for (const k of SECRET_ENV) {
    const v = (env[k] ?? '').trim();
    if (v.length >= 8) out = out.split(v).join('[hidden]');
  }
  const uri = (env.MONGODB_URI ?? '').match(/^mongodb(?:\+srv)?:\/\/[^\s:/@]+:([^\s@]+)@/i)?.[1];
  if (uri && uri.length >= 4) out = out.split(uri).join('***');
  return out.replace(TOKEN_RE, '[token]').replace(MONGO_RE, '$1***@');
}
