import { CustomStation } from '../models/CustomStation.js';
import { assertSafeUrl, safeFetch } from './urlSafety.js';
import { UserError } from '../utils/errors.js';
import {
  LIMITS, cleanName, validName, normalizeUrl, isAudioContentType, parseValue
} from './stationRules.js';
import { fetchRadio } from './quranService.js';
import { createHealth } from './stationHealth.js';

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Check the URL is safe and answers like a stream. Throws UserError with a fixable reason. */
export async function probeStream(url, { timeoutMs = 8000, expectData = false } = {}) {
  try { await assertSafeUrl(url); }
  catch (e) {
    if (/private|protocol/.test(e.message)) throw new UserError('station_unsafe');
    throw new UserError('station_unreachable');
  }
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, {
      method: 'GET', signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (QuranBot; +probe)', 'icy-metadata': '0' }
    });
    if (!res.ok && res.status !== 206) { res.body?.cancel?.().catch(() => {}); throw new UserError('station_unreachable'); }
    if (!isAudioContentType(res.headers.get('content-type'))) { res.body?.cancel?.().catch(() => {}); throw new UserError('station_not_audio'); }
    if (expectData) {   // "on the air" = bytes actually arrive (a dead station often answers 200 and then sends nothing)
      const chunk = await res.body?.getReader?.().read();
      res.body?.cancel?.().catch(() => {});
      if (!chunk || chunk.done || !chunk.value?.length) throw new UserError('station_unreachable');
    } else res.body?.cancel?.().catch(() => {});
  } catch (e) {
    if (e instanceof UserError) throw e;
    if (/private|protocol/.test(e?.message ?? '')) throw new UserError('station_unsafe');
    throw new UserError('station_unreachable');
  } finally { clearTimeout(timer); }
}

export const listGuildStations = guildId =>
  guildId ? CustomStation.find({ scope: 'guild', guildId }).sort({ name: 1 }).lean() : Promise.resolve([]);
export const listGlobalStations = () => CustomStation.find({ scope: 'global' }).sort({ name: 1 }).lean();

export async function addStation({ scope, guildId, name, url, userId }) {
  name = cleanName(name);
  if (!validName(name)) throw new UserError('station_name_invalid');
  const clean = normalizeUrl(url);
  if (!clean) throw new UserError('station_url_invalid');

  const q = scope === 'global' ? { scope: 'global' } : { scope: 'guild', guildId };
  if (await CustomStation.exists({ ...q, url: clean })) throw new UserError('station_exists');
  const count = await CustomStation.countDocuments(q);
  if (count >= LIMITS[scope]) throw new UserError(scope === 'global' ? 'station_limit_global' : 'station_limit_guild', { max: LIMITS[scope] });

  await probeStream(clean);

  try {
    return await CustomStation.create({
      scope, guildId: scope === 'global' ? null : guildId, name, url: clean, addedBy: userId
    });
  } catch (e) {
    if (e?.code === 11000) throw new UserError('station_exists');
    throw e;
  }
}

/** Delete one station. `scope` decides which group is searched, so the groups can never be mixed up. */
export async function removeStation({ scope, guildId, id }) {
  if (!/^[0-9a-f]{24}$/i.test(String(id))) throw new UserError('station_not_found');
  const q   = scope === 'global' ? { _id: id, scope: 'global' } : { _id: id, scope: 'guild', guildId };
  const doc = await CustomStation.findOneAndDelete(q).lean();
  if (!doc) throw new UserError('station_not_found');
  return doc;
}

// Is a station on the air right now? Cached for a few minutes (see stationHealth.js); a probe waits at most 4 seconds for the first audio bytes.
const health = createHealth({ probe: (url) => probeStream(url, { timeoutMs: 4000, expectData: true }) });
export const stationIsLive = (url) => health.check(url);

/** Value of the single answer shown when no station is on the air: it is not a station, resolveStation() returns null for it. */
export const NO_LIVE_VALUE = '__none';

/**
 * Autocomplete for /live (and the panel's radio menu): this server's stations, then the owner's, then mp3quran —
 * ONLY the ones that are on the air right now. Max 25.
 */
export async function stationChoices(guildId, query) {
  const q = String(query ?? '').toLowerCase().trim();
  const match = s => !q || s.name.toLowerCase().includes(q);
  const [own, global, api] = await Promise.all([
    listGuildStations(guildId).catch(() => []),
    listGlobalStations().catch(() => []),
    fetchRadio().catch(() => [])
  ]);
  health.warm(api.map(s => s.url).filter(Boolean));      // so the next keystroke is answered from the cache
  const all = [
    ...own.filter(match).map(s    => ({ url: s.url, name: truncate(`🏠 ${s.name}`, 100), value: `s:${s._id}` })),
    ...global.filter(match).map(s => ({ url: s.url, name: truncate(`⭐ ${s.name}`, 100), value: `g:${s._id}` })),
    ...api.filter(match).map(s    => ({ url: s.url, name: truncate(`📻 ${s.name}`, 100), value: String(s.id) }))
  ].filter(x => x.url);
  const live = await health.liveOnly(all, { limit: 25 });
  return live.map(({ name, value }) => ({ name, value }));
}

/** Turn the /live option value into a `{id,name,url}` station, or null. A server station only resolves in its own server. */
export async function resolveStation(guildId, value) {
  const p = parseValue(value);
  if (p.kind === 'api') {
    const stations = await fetchRadio();
    return stations.find(s => String(s.id) === p.id) ??
           stations.find(s => s.name.toLowerCase().includes(p.id.toLowerCase())) ?? null;
  }
  const q = p.kind === 'global' ? { _id: p.id, scope: 'global' } : { _id: p.id, scope: 'guild', guildId };
  const doc = await CustomStation.findOne(q).lean();
  return doc ? { id: String(doc._id), name: doc.name, url: doc.url } : null;
}
