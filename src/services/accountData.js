/**
 * Everything the bot stores under a member's own Discord id — read, copied out, reset and deleted.
 * Every query here is keyed by `userId` alone: nothing reads a server, a channel or anyone else's data.
 *
 * Stored per member (and nowhere else): the personal list + reply language, the Mushaf view, the wird subscription with its
 * progress, and the favourite reciters / surahs saved from the player panel.
 */
async function defaultModels() {
  const [{ PersonalList }, { MushafPref }, { WirdSubscription }, { Favorites }] = await Promise.all([
    import('../models/PersonalList.js'),
    import('../models/MushafPref.js'),
    import('../models/WirdSubscription.js'),
    import('../models/Favorites.js')
  ]);
  return { PersonalList, MushafPref, WirdSubscription, Favorites };
}

/** @returns {Promise<{ list: object|null, pref: object|null, wird: object|null, favorites: { servers: number, reciters: number, surahs: number } }>} */
export async function collectAccountData(userId, models) {
  const m = models ?? await defaultModels();
  const [list, pref, wird, favs] = await Promise.all([
    m.PersonalList.findOne({ userId }).lean(),
    m.MushafPref.findOne({ userId }).lean(),
    m.WirdSubscription.findOne({ userId }).lean(),
    m.Favorites.find({ userId }).lean()
  ]);
  const used = (favs ?? []).filter(f => (f.reciters?.length ?? 0) + (f.surahs?.length ?? 0) > 0);
  return {
    list: list ?? null,
    pref: pref ?? null,
    wird: wird ?? null,
    favorites: {
      servers: used.length,
      reciters: used.reduce((n, f) => n + f.reciters.length, 0),
      surahs: used.reduce((n, f) => n + f.surahs.length, 0)
    }
  };
}

/** True when nothing at all is stored for the member. */
export function isEmptyAccount(d) {
  const l = d.list;
  return !(l && (l.pages?.length || l.verses?.length || l.lang)) && !d.pref && !d.wird && !d.favorites.servers;
}

/**
 * Delete the member's data. scope 'personal' = list, reply language, Mushaf view, favourites.
 * scope 'all' also removes the wird subscription and its progress (reminders stop).
 */
export async function eraseAccountData(userId, scope = 'personal', models) {
  const m = models ?? await defaultModels();
  const jobs = [
    m.PersonalList.deleteOne({ userId }),
    m.MushafPref.deleteOne({ userId }),
    m.Favorites.deleteMany({ userId })
  ];
  if (scope === 'all') jobs.push(m.WirdSubscription.deleteOne({ userId }));
  const results = await Promise.allSettled(jobs);
  const failed = results.filter(r => r.status === 'rejected').length;
  return { scope, failed };
}

/** Back to defaults: the reply language follows the command typed, the Mushaf opens as text. The saved list stays. */
export async function resetSettings(userId, models) {
  const m = models ?? await defaultModels();
  await Promise.all([
    m.PersonalList.updateOne({ userId }, { $unset: { lang: 1 }, $set: { updatedAt: new Date() } }),
    m.MushafPref.deleteOne({ userId })
  ]);
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** The copy handed to the member: plain data, no server ids, no internal bookkeeping. Pure. */
export function buildExport(userId, d, now = new Date()) {
  const w = d.wird;
  return {
    exportedAt: now.toISOString(),
    userId,
    settings: { replyLanguage: d.list?.lang ?? null, mushafView: d.pref?.view ?? 'text' },
    personalList: { pages: d.list?.pages ?? [], verses: d.list?.verses ?? [] },
    wird: w ? {
      active: !!w.active, startedAt: iso(w.startedAt), expiresAt: iso(w.expiresAt), renewals: w.renewals ?? 0,
      pagesPerDay: w.pagesPerDay, timezone: w.timezone, remindTime: w.remindTime, remindMode: w.remindMode,
      adhkarMorning: !!w.adhkarMorning, adhkarEvening: !!w.adhkarEvening,
      goalDays: w.goalDays ?? null, goalDeadline: w.goalDeadline ?? null,
      currentPage: w.currentPage ?? 0, khatmaCount: w.khatmaCount ?? 0, totalPagesRead: w.totalPagesRead ?? 0,
      streak: w.streak ?? 0, bestStreak: w.bestStreak ?? 0
    } : null,
    favorites: { serversWithFavorites: d.favorites.servers, reciters: d.favorites.reciters, surahs: d.favorites.surahs }
  };
}
