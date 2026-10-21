// Pure rules for custom radio stations (no discord / database imports → unit-testable).

export const LIMITS = Object.freeze({ guild: 25, global: 100, nameMin: 2, nameMax: 60, urlMax: 500 });

export function cleanName(raw) {
  // eslint-disable-next-line no-control-regex -- control + invisible direction characters are stripped on purpose
  return String(raw ?? '').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
}

export function validName(name) {
  return name.length >= LIMITS.nameMin && name.length <= LIMITS.nameMax;
}

/** Returns a normalised http(s) URL string, or null. Credentials in the URL are refused. */
export function normalizeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > LIMITS.urlMax) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.toString();
}

/** Does the Content-Type of a response look like a playable stream? Missing header = accept (many Icecast servers omit it). */
export function isAudioContentType(type) {
  if (!type) return true;
  const t = String(type).toLowerCase();
  if (/^(text\/html|application\/json|application\/xml|text\/xml|image\/|video\/(?!mp2t))/.test(t)) return false;
  return true;
}

/** Station ids used in the /live option: "123" (mp3quran), "g:<id>" (global), "s:<id>" (this server). */
export function parseValue(value) {
  const v = String(value ?? '');
  const m = /^([gs]):([0-9a-f]{24})$/i.exec(v);
  if (m) return { kind: m[1].toLowerCase() === 'g' ? 'global' : 'guild', id: m[2] };
  return { kind: 'api', id: v };
}

export function canManage({ scope, isOwner, hasManageGuild }) {
  return scope === 'global' ? !!isOwner : !!(isOwner || hasManageGuild);
}
