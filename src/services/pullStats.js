import { normalizePullEntry } from '../utils/ownerFleet.js';

/**
 * Remember how a /pull ended (for the owner dashboard). Fire-and-forget: it never throws and never delays the member.
 * The model is loaded lazily so this file (and /pull) stays importable without a database, e.g. in tests.
 * @param {{ guildId, userId, result: {ok:boolean, kind?, key?, botId?, fromBotId?}, ms: number }} o
 */
export function recordPull({ guildId, userId, result, ms }, { model = null } = {}) {
  try {
    const entry = normalizePullEntry({ guildId, userId, ms, ok: result?.ok === true, kind: result?.kind, key: result?.key, botId: result?.botId, fromBotId: result?.fromBotId });
    if (!entry) return Promise.resolve(false);
    return Promise.resolve(model ?? import('../models/PullLog.js').then(m => m.PullLog))
      .then(M => M.create(entry)).then(() => true, () => false);
  } catch { return Promise.resolve(false); }
}
