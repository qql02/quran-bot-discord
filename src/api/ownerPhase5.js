/**
 * Owner panel — phase 5: four new pages. Everything here is OWNER ONLY (requireAdmin).
 *
 *  Fleet & /pull
 *   GET  /api/admin/fleet                       the bots of this database (alive / offline, their sessions) + totals
 *   GET  /api/admin/fleet/jobs                  the last 24 h of hand-over jobs (PlayerJob) with counts, durations, stuck ones
 *   POST /api/admin/fleet/jobs/:jid/cancel      cancel one pending / claimed job
 *   POST /api/admin/fleet/jobs/cancel-stuck     cancel every job that looks stuck
 *   POST /api/admin/fleet/bots/:bid/forget      remove a bot that has been offline from the registry   (confirm token)
 *   GET  /api/admin/fleet/pulls                 /pull statistics (PullLog) + the latest attempts
 *
 *  Stations & reciters
 *   GET  /api/admin/stations                    the owner's global stations + how many servers added their own
 *   POST /api/admin/stations                    add a global station (probed first)
 *   POST /api/admin/stations/check              probe one station, or all of them, for audio right now
 *   POST /api/admin/stations/:sid/rename        rename a global station
 *   POST /api/admin/stations/:sid/delete        remove a global station
 *   GET  /api/admin/stations/guild              stations that servers added (search / page) — for abuse clean-up
 *   POST /api/admin/stations/guild/:sid/delete  remove one of them
 *   GET  /api/admin/reciters/catalog            every reciter with hidden state (search / page)
 *   POST /api/admin/reciters/hide               hide / show a reciter in every search and menu
 *   POST /api/admin/reciters/check              is a reciter's recording URL reachable?
 *
 *  Wird, adhkar & events
 *   GET  /api/admin/content/wird                subscription numbers (states, khatmas, streaks, timezones, top readers)
 *   GET  /api/admin/content/wird/users          the subscriptions, filtered + paged
 *   POST /api/admin/content/wird/users/:uid/:action   pause | resume | renew | reset-fails
 *   POST /api/admin/content/wird/users/:uid/delete    delete a subscription                               (confirm token)
 *   GET  /api/admin/content/schedules           how many servers use adhkar / verse / hadith / wird posting + global switches
 *   GET  /api/admin/content/events              religious events of all servers (status filter / search / page)
 *   POST /api/admin/content/events/:eid/toggle  enable / disable an event
 *   POST /api/admin/content/events/:eid/test    post it now in its channel
 *   POST /api/admin/content/events/:eid/delete  delete an event                                           (confirm token)
 *
 *  Security
 *   GET  /api/admin/security/overview           checklist, who may sign in, moderator rights, counters
 *   GET  /api/admin/security/sessions           signed-in dashboard sessions (the session id itself never leaves the server)
 *   POST /api/admin/security/sessions/revoke    sign one session out
 *   POST /api/admin/security/sessions/revoke-all  sign everybody else out (or only moderators)           (confirm token)
 *   GET  /api/admin/security/logins             sign-in history (accepted and refused)
 *   GET  /api/admin/security/actions            who did how many admin actions in the last 7 days
 *   GET  /api/admin/security/export             download a JSON copy of one whitelisted collection
 *
 * Same rules as the earlier phases: ids are validated, nothing from the client becomes a Mongo operator or a path, every write is
 * audited (pushActivity stamps the signed-in account), destructive writes need a confirm token. Models and services come in through
 * `deps`, so the whole file is testable without Discord or a database.
 */

import { t } from '../utils/i18n.js';
import { inviteUrl, VOICE_WORKER_INVITE_PERMISSIONS } from '../utils/botToken.js';
import { escapeRegex } from '../utils/ownerInsights.js';
import { cleanName, validName, LIMITS } from '../services/stationRules.js';
import {
  SNOWFLAKE, OBJECT_ID, DAY, intIn, pageParams, textParam, ALIVE_MS,
  summarizeFleet, summarizeJobs, summarizePulls, STUCK_PENDING_MS, STUCK_CLAIMED_MS,
  wirdState, WIRD_FAIL_LIMIT, eventStatus, toggleHidden,
  secondCoverage, sessionRef, parseSessionDoc, securityChecklist, EXPORT_SETS, EXPORT_MAX_DOCS, exportFileName
} from '../utils/ownerFleet.js';

const WIRD_ACTIONS = ['pause', 'resume', 'renew', 'reset-fails'];
const WIRD_STATES = ['active', 'expiring', 'expired', 'paused', 'failing'];
const EVENT_STATES = ['active', 'upcoming', 'finished', 'disabled'];
const LOGIN_ACTION = /^(تسجيل دخول|محاولة دخول مرفوضة)/;       // fixed pattern: nothing from the client reaches the regex
const REF = /^[a-f0-9]{16}$/;

const isUserError = (e) => e?.name === 'UserError' && typeof e.key === 'string';
const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Bounded concurrency for the station probes (no dependency on ../utils/mapLimit so the file stays pure). */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 *   client, requireAdmin, pushActivity, fail
 *   models   { BotInstance, PlayerJob, PullLog, CustomStation, GuildSettings, WirdSubscription, ReligiousEvent, ActivityLog, … exportable ones }
 *   exportModels  { settings, stations, blacklist, control, notes, events, broadcasts } → Mongoose models (EXPORT_SETS keys)
 *   svc      { addStation, removeStation, probeStream, listAllReciters, getPlayableUrls, sendEvent, nextExpiry,
 *              getControl, saveControl, ownSessions, botRole }
 *   security { adminIds(), modIds(), roleOf(id), sessionsCollection(), info() }
 */
export function registerOwnerPhase5(app, { client, requireAdmin, pushActivity, fail, models, exportModels = {}, svc, security }) {
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { fail(res, err); } };
  const guildName = (id) => client.guilds.cache.get(id)?.name ?? null;
  const by = (req) => req.session?.user?.id ?? '';
  const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
  const needConfirm = (req, res, token) => (req.body?.confirm === token ? true : (bad(res, `confirm: "${token}" required`), false));
  const userMessage = (e) => t('ar', `errors.${e.key}`, e.vars ?? {}).replace(/^[❌⛔⏳✅]\s*/u, '');

  /* ══ 1. Fleet & /pull ══════════════════════════════════════════════════════ */

  app.get('/api/admin/fleet', requireAdmin, wrap(async (_req, res) => {
    const now = Date.now();
    const docs = await models.BotInstance.find({}).lean();
    const selfId = client.user.id;
    const own = { _id: selfId, tag: client.user.tag, role: svc.botRole, lastSeen: new Date(now), guildIds: [...client.guilds.cache.keys()], sessions: svc.ownSessions() };
    const all = [...docs.filter(d => String(d._id) !== String(selfId)), own];       // this process is always shown from live data
    const fleet = summarizeFleet(all, { now, selfId });
    for (const r of fleet.rows) for (const s of r.sessionList) s.guildName = guildName(s.guildId);
    const self = fleet.rows.find(r => r.self);
    if (self) self.ping = client.ws.ping;
    res.json({ ...fleet, aliveWindowSec: ALIVE_MS / 1000 });
  }));

  /** The voice-only second bot across servers: which bots exist, where each is, and which servers have none (with a pinned invite link). */
  app.get('/api/admin/fleet/second', requireAdmin, wrap(async (_req, res) => {
    const docs = await models.BotInstance.find({ role: 'secondary' }).lean();
    const guilds = [...client.guilds.cache.values()].map(g => ({ id: g.id, name: g.name, members: g.memberCount ?? 0 }));
    const cov = secondCoverage(docs, guilds, { now: Date.now() });
    const botId = cov.bots.find(b => b.alive)?.id ?? cov.bots[0]?.id ?? null;
    const link = (gid) => (botId ? inviteUrl(botId, VOICE_WORKER_INVITE_PERMISSIONS, gid, { commands: false }) : null);
    res.json({ ...cov, configured: !!botId, invite: link(null), missing: cov.missing.map(g => ({ ...g, invite: link(g.id) })) });
  }));

  app.get('/api/admin/fleet/jobs', requireAdmin, wrap(async (req, res) => {
    const now = Date.now();
    const status = ['pending', 'claimed', 'done', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const since = new Date(now - DAY);
    const recent = await models.PlayerJob.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(500).lean();
    const summary = summarizeJobs(recent, now);
    const stuck = new Set(summary.stuck);
    const rows = recent.filter(j => !status || j.status === status).slice(0, 60).map(j => ({
      id: String(j._id), status: j.status, kind: j.intent?.kind ?? 'join', targetBotId: j.targetBotId, fromBotId: j.fromBotId ?? null,
      guildId: j.guildId, guildName: guildName(j.guildId), userId: j.userId,
      ageSec: Math.round((now - new Date(j.createdAt).getTime()) / 1000),
      durationMs: j.finishedAt ? Math.max(0, new Date(j.finishedAt).getTime() - new Date(j.createdAt).getTime()) : null,
      error: j.error?.key ?? j.error?.code ?? null, panel: j.panel !== false, stuck: stuck.has(String(j._id))
    }));
    res.json({ summary: { ...summary, stuck: summary.stuck.length }, rows, limits: { pendingMs: STUCK_PENDING_MS, claimedMs: STUCK_CLAIMED_MS } });
  }));

  app.post('/api/admin/fleet/jobs/:jid/cancel', requireAdmin, wrap(async (req, res) => {
    if (!OBJECT_ID.test(req.params.jid)) return bad(res, 'Invalid id');
    const r = await models.PlayerJob.updateOne({ _id: req.params.jid, status: { $in: ['pending', 'claimed'] } }, { $set: { status: 'cancelled', finishedAt: new Date() } });
    if (!r.modifiedCount) return bad(res, 'المهمة انتهت أو أُلغيت مسبقاً', 404);
    pushActivity('admin', 'إلغاء مهمة بوت ثانٍ', req.params.jid);
    res.json({ ok: true });
  }));

  app.post('/api/admin/fleet/jobs/cancel-stuck', requireAdmin, wrap(async (_req, res) => {
    const now = Date.now();
    const r1 = await models.PlayerJob.updateMany({ status: 'pending', createdAt: { $lt: new Date(now - STUCK_PENDING_MS) } }, { $set: { status: 'cancelled', finishedAt: new Date() } });
    const r2 = await models.PlayerJob.updateMany({ status: 'claimed', claimedAt: { $lt: new Date(now - STUCK_CLAIMED_MS) } }, { $set: { status: 'cancelled', finishedAt: new Date() } });
    const n = (r1.modifiedCount ?? 0) + (r2.modifiedCount ?? 0);
    pushActivity('admin', 'إلغاء المهام العالقة', `${n} مهمة`);
    res.json({ ok: true, cancelled: n });
  }));

  app.post('/api/admin/fleet/bots/:bid/forget', requireAdmin, wrap(async (req, res) => {
    if (!SNOWFLAKE.test(req.params.bid)) return bad(res, 'Invalid id');
    if (!needConfirm(req, res, 'FORGET')) return;
    if (req.params.bid === client.user.id) return bad(res, 'لا يمكن حذف هذا البوت نفسه من السجل');
    const doc = await models.BotInstance.findById(req.params.bid).lean();
    if (!doc) return bad(res, 'البوت غير موجود في السجل', 404);
    if (doc.lastSeen && Date.now() - new Date(doc.lastSeen).getTime() <= ALIVE_MS) return bad(res, 'البوت متصل الآن — لا يُحذف من السجل وهو يعمل', 409);
    await models.BotInstance.deleteOne({ _id: req.params.bid });
    pushActivity('admin', 'حذف بوت غير متصل من السجل', `${doc.tag || doc._id}`);
    res.json({ ok: true });
  }));

  app.get('/api/admin/fleet/pulls', requireAdmin, wrap(async (_req, res) => {
    const now = Date.now();
    const rows = await models.PullLog.find({ at: { $gte: new Date(now - 7 * DAY) } }).sort({ at: -1 }).limit(5000).lean();
    res.json({
      summary: summarizePulls(rows, now, 7),
      recent: rows.slice(0, 25).map(r => ({ at: r.at, ok: r.ok, kind: r.kind, key: r.key, guildId: r.guildId, guildName: guildName(r.guildId), botId: r.botId, ms: r.ms }))
    });
  }));

  /* ══ 2. Stations & reciters ════════════════════════════════════════════════ */

  const stationRow = (s) => ({ id: String(s._id), name: s.name, url: s.url, addedBy: s.addedBy, createdAt: s.createdAt });

  app.get('/api/admin/stations', requireAdmin, wrap(async (_req, res) => {
    const [global, guildTotal, groups] = await Promise.all([
      models.CustomStation.find({ scope: 'global' }).sort({ name: 1 }).lean(),
      models.CustomStation.countDocuments({ scope: 'guild' }),
      models.CustomStation.aggregate([{ $match: { scope: 'guild' } }, { $group: { _id: '$guildId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }])
    ]);
    res.json({
      global: global.map(stationRow), limit: LIMITS.global, guildLimit: LIMITS.guild, guildTotal,
      topGuilds: groups.map(g => ({ guildId: g._id, name: guildName(g._id), count: g.n }))
    });
  }));

  app.post('/api/admin/stations', requireAdmin, wrap(async (req, res) => {
    const name = textParam(req.body?.name, 120), url = textParam(req.body?.url, 600);
    if (!name || !url) return bad(res, 'الاسم والرابط مطلوبان');
    try {
      const doc = await svc.addStation({ scope: 'global', name, url, userId: by(req) });
      pushActivity('admin', 'إضافة محطة عامة', `${doc.name}`);
      res.json({ ok: true, station: stationRow(doc) });
    } catch (e) { if (isUserError(e)) return bad(res, userMessage(e)); throw e; }
  }));

  /** Probe result for one station: { id, live, ms, error }. Never throws. */
  const probeOne = async (s) => {
    const t0 = Date.now();
    try { await svc.probeStream(s.url, { timeoutMs: 6000, expectData: true }); return { id: String(s._id), live: true, ms: Date.now() - t0, error: null }; }
    catch (e) { return { id: String(s._id), live: false, ms: Date.now() - t0, error: isUserError(e) ? e.key : 'unexpected' }; }
  };

  app.post('/api/admin/stations/check', requireAdmin, wrap(async (req, res) => {
    if (req.body?.all === true) {
      const list = await models.CustomStation.find({ scope: 'global' }).limit(LIMITS.global).lean();
      const results = await mapPool(list, 4, probeOne);
      return res.json({ ok: true, results });
    }
    const id = String(req.body?.id ?? '');
    if (!OBJECT_ID.test(id)) return bad(res, 'Invalid id');
    const s = await models.CustomStation.findOne({ _id: id, scope: 'global' }).lean();
    if (!s) return bad(res, 'المحطة غير موجودة', 404);
    res.json({ ok: true, results: [await probeOne(s)] });
  }));

  app.post('/api/admin/stations/:sid/rename', requireAdmin, wrap(async (req, res) => {
    if (!OBJECT_ID.test(req.params.sid)) return bad(res, 'Invalid id');
    const name = cleanName(textParam(req.body?.name, 120));
    if (!validName(name)) return bad(res, userMessage({ key: 'station_name_invalid' }));
    const r = await models.CustomStation.updateOne({ _id: req.params.sid, scope: 'global' }, { $set: { name } });
    if (!r.matchedCount) return bad(res, userMessage({ key: 'station_not_found' }), 404);
    pushActivity('admin', 'إعادة تسمية محطة عامة', name);
    res.json({ ok: true });
  }));

  app.post('/api/admin/stations/:sid/delete', requireAdmin, wrap(async (req, res) => {
    try { const doc = await svc.removeStation({ scope: 'global', id: req.params.sid }); pushActivity('admin', 'حذف محطة عامة', doc.name); res.json({ ok: true }); }
    catch (e) { if (isUserError(e)) return bad(res, userMessage(e), 404); throw e; }
  }));

  app.get('/api/admin/stations/guild', requireAdmin, wrap(async (req, res) => {
    const { limit, skip, page } = pageParams(req.query, { def: 25, max: 50 });
    const q = textParam(req.query.q, 60);
    const filter = { scope: 'guild' };
    if (SNOWFLAKE.test(q)) filter.guildId = q;
    else if (q) filter.$or = [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { url: { $regex: escapeRegex(q), $options: 'i' } }];
    const [rows, total] = await Promise.all([
      models.CustomStation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      models.CustomStation.countDocuments(filter)
    ]);
    res.json({ total, page, limit, rows: rows.map(s => ({ ...stationRow(s), guildId: s.guildId, guildName: guildName(s.guildId) })) });
  }));

  app.post('/api/admin/stations/guild/:sid/delete', requireAdmin, wrap(async (req, res) => {
    if (!OBJECT_ID.test(req.params.sid)) return bad(res, 'Invalid id');
    const doc = await models.CustomStation.findOneAndDelete({ _id: req.params.sid, scope: 'guild' }).lean();
    if (!doc) return bad(res, userMessage({ key: 'station_not_found' }), 404);
    pushActivity('admin', 'حذف محطة سيرفر', `${doc.name} · ${guildName(doc.guildId) ?? doc.guildId}`);
    res.json({ ok: true });
  }));

  app.get('/api/admin/reciters/catalog', requireAdmin, wrap(async (req, res) => {
    const { limit, skip, page } = pageParams(req.query, { def: 30, max: 60 });
    const q = textParam(req.query.q, 60).toLowerCase();
    const onlyHidden = req.query.hidden === '1';
    const hidden = new Set(svc.getControl().hiddenReciters ?? []);
    const all = await svc.listAllReciters();
    const rows = all
      .filter(r => (!onlyHidden || hidden.has(String(r.id))) && (!q || [r.englishName, r.arabicName, r.name, r.displayName].some(n => String(n ?? '').toLowerCase().includes(q))))
      .map(r => ({
        id: String(r.id), name: r.displayName ?? r.englishName ?? r.name, arabicName: r.arabicName ?? null,
        moshaf: (r.moshaf ?? []).length, surahs: Math.max(0, ...(r.moshaf ?? []).map(m => Number(m.surah_total) || 0)),
        hidden: hidden.has(String(r.id)), extra: typeof r.id === 'string' && r.id.startsWith('qa')
      }));
    res.json({ total: rows.length, page, limit, all: all.length, hiddenCount: hidden.size, rows: rows.slice(skip, skip + limit) });
  }));

  app.post('/api/admin/reciters/hide', requireAdmin, wrap(async (req, res) => {
    const id = String(req.body?.id ?? ''), hide = req.body?.hidden;
    if (typeof hide !== 'boolean') return bad(res, 'hidden must be true or false');
    const all = await svc.listAllReciters();
    const found = all.find(r => String(r.id) === id);
    if (hide && !found) return bad(res, 'القارئ غير موجود', 404);                  // only a reciter that exists can be hidden (no junk ids)
    const next = toggleHidden(svc.getControl().hiddenReciters, id, hide);
    if (!next) return bad(res, 'معرّف غير صالح أو تجاوزت الحد (٥٠٠)');
    await svc.saveControl({ hiddenReciters: next }, by(req));
    pushActivity('admin', hide ? 'إخفاء قارئ' : 'إظهار قارئ', found?.displayName ?? id);
    res.json({ ok: true, hiddenCount: next.length });
  }));

  app.post('/api/admin/reciters/check', requireAdmin, wrap(async (req, res) => {
    const id = String(req.body?.id ?? '');
    const found = (await svc.listAllReciters()).find(r => String(r.id) === id);
    if (!found) return bad(res, 'القارئ غير موجود', 404);
    const candidates = await svc.getPlayableUrls(found, 1);
    if (!candidates.length) return res.json({ ok: true, live: false, error: 'no_url' });
    const t0 = Date.now();
    try { await svc.probeStream(candidates[0].url, { timeoutMs: 6000 }); res.json({ ok: true, live: true, ms: Date.now() - t0 }); }
    catch (e) { res.json({ ok: true, live: false, ms: Date.now() - t0, error: isUserError(e) ? e.key : 'unexpected' }); }
  }));

  /* ══ 3. Wird, adhkar & events ══════════════════════════════════════════════ */

  const wirdRow = (s, now) => ({
    userId: s.userId, guildId: s.guildId ?? null, guildName: s.guildId ? guildName(s.guildId) : null, state: wirdState(s, now),
    expiresAt: s.expiresAt, renewals: s.renewals ?? 0, pagesPerDay: s.pagesPerDay, currentPage: s.currentPage ?? 0, khatmaCount: s.khatmaCount ?? 0,
    streak: s.streak ?? 0, bestStreak: s.bestStreak ?? 0, totalPagesRead: s.totalPagesRead ?? 0, failCount: s.failCount ?? 0,
    adhkar: !!(s.adhkarMorning || s.adhkarEvening), lastReadDate: s.lastReadDate ?? null
  });

  app.get('/api/admin/content/wird', requireAdmin, wrap(async (_req, res) => {
    const now = new Date(), in7 = new Date(now.getTime() + 7 * DAY);
    const count = (match) => [{ $match: match }, { $count: 'n' }];
    const [a] = await models.WirdSubscription.aggregate([{ $facet: {
      total: [{ $count: 'n' }],
      active: count({ active: true, expiresAt: { $gt: in7 } }),
      expiring: count({ active: true, expiresAt: { $gt: now, $lte: in7 } }),
      expired: count({ active: true, expiresAt: { $lte: now } }),
      paused: count({ active: false, failCount: { $lt: WIRD_FAIL_LIMIT } }),
      failing: count({ active: false, failCount: { $gte: WIRD_FAIL_LIMIT } }),
      sums: [{ $group: { _id: null, khatmas: { $sum: '$khatmaCount' }, pages: { $sum: '$totalPagesRead' }, avgStreak: { $avg: '$streak' },
        morning: { $sum: { $cond: ['$adhkarMorning', 1, 0] } }, evening: { $sum: { $cond: ['$adhkarEvening', 1, 0] } },
        varied: { $sum: { $cond: [{ $eq: ['$remindMode', 'varied'] }, 1, 0] } } } }],
      tz: [{ $group: { _id: '$timezone', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }],
      goals: [{ $group: { _id: '$goalDays', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      top: [{ $sort: { streak: -1 } }, { $limit: 10 }, { $project: { userId: 1, streak: 1, bestStreak: 1, khatmaCount: 1, totalPagesRead: 1 } }]
    } }]);
    const n = (k) => a?.[k]?.[0]?.n ?? 0;
    const s = a?.sums?.[0] ?? {};
    res.json({
      total: n('total'), states: { active: n('active'), expiring: n('expiring'), expired: n('expired'), paused: n('paused'), failing: n('failing') },
      khatmas: s.khatmas ?? 0, pagesRead: s.pages ?? 0, avgStreak: Math.round((s.avgStreak ?? 0) * 10) / 10,
      personalAdhkar: { morning: s.morning ?? 0, evening: s.evening ?? 0 }, variedReminders: s.varied ?? 0,
      timezones: (a?.tz ?? []).map(x => ({ timezone: x._id, count: x.n })),
      goals: (a?.goals ?? []).map(x => ({ days: x._id, count: x.n })),
      top: (a?.top ?? []).map(x => ({ userId: x.userId, streak: x.streak, bestStreak: x.bestStreak, khatmas: x.khatmaCount, pages: x.totalPagesRead }))
    });
  }));

  app.get('/api/admin/content/wird/users', requireAdmin, wrap(async (req, res) => {
    const { limit, skip, page } = pageParams(req.query, { def: 25, max: 50 });
    const q = textParam(req.query.q, 30), state = WIRD_STATES.includes(req.query.state) ? req.query.state : null;
    const now = new Date(), in7 = new Date(now.getTime() + 7 * DAY);
    const filter = {};
    if (q) { if (!SNOWFLAKE.test(q)) return bad(res, 'ابحث بمعرّف العضو أو السيرفر (أرقام فقط)'); filter.$or = [{ userId: q }, { guildId: q }]; }
    if (state === 'active') Object.assign(filter, { active: true, expiresAt: { $gt: in7 } });
    if (state === 'expiring') Object.assign(filter, { active: true, expiresAt: { $gt: now, $lte: in7 } });
    if (state === 'expired') Object.assign(filter, { active: true, expiresAt: { $lte: now } });
    if (state === 'paused') Object.assign(filter, { active: false, failCount: { $lt: WIRD_FAIL_LIMIT } });
    if (state === 'failing') Object.assign(filter, { active: false, failCount: { $gte: WIRD_FAIL_LIMIT } });
    const [rows, total] = await Promise.all([
      models.WirdSubscription.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      models.WirdSubscription.countDocuments(filter)
    ]);
    res.json({ total, page, limit, rows: rows.map(s => wirdRow(s, now.getTime())) });
  }));

  app.post('/api/admin/content/wird/users/:uid/delete', requireAdmin, wrap(async (req, res) => {
    if (!SNOWFLAKE.test(req.params.uid)) return bad(res, 'Invalid id');
    if (!needConfirm(req, res, 'DELETE')) return;
    const r = await models.WirdSubscription.deleteOne({ userId: req.params.uid });
    if (!r.deletedCount) return bad(res, 'الاشتراك غير موجود', 404);
    pushActivity('admin', 'حذف اشتراك ورد', req.params.uid);
    res.json({ ok: true });
  }));

  app.post('/api/admin/content/wird/users/:uid/:action', requireAdmin, wrap(async (req, res) => {
    const { uid, action } = req.params;
    if (!SNOWFLAKE.test(uid)) return bad(res, 'Invalid id');
    if (!WIRD_ACTIONS.includes(action)) return bad(res, 'Unknown action', 404);
    const update = {
      pause: { $set: { active: false } },
      resume: { $set: { active: true, failCount: 0 } },
      'reset-fails': { $set: { failCount: 0 } },
      renew: { $set: { active: true, expiresAt: svc.nextExpiry(), renewWarned: false, expiredNoticed: false, failCount: 0 }, $inc: { renewals: 1 } }
    }[action];
    const doc = await models.WirdSubscription.findOneAndUpdate({ userId: uid }, update, { new: true }).lean();
    if (!doc) return bad(res, 'الاشتراك غير موجود', 404);
    pushActivity('admin', `ورد: ${{ pause: 'إيقاف', resume: 'استئناف', renew: 'تجديد', 'reset-fails': 'تصفير الإخفاقات' }[action]}`, uid);
    res.json({ ok: true, row: wirdRow(doc, Date.now()) });
  }));

  app.get('/api/admin/content/schedules', requireAdmin, wrap(async (_req, res) => {
    const kinds = ['adhkar', 'ayah', 'hadith', 'wird'];
    const facets = { total: [{ $count: 'n' }] };
    for (const k of kinds) {
      facets[`${k}On`] = [{ $match: { [`${k}.enabled`]: true } }, { $count: 'n' }];
      facets[`${k}Ready`] = [{ $match: { [`${k}.enabled`]: true, [`${k}.channelId`]: { $type: 'string', $ne: '' } } }, { $count: 'n' }];
    }
    const [a] = await models.GuildSettings.aggregate([{ $facet: facets }]);
    const n = (key) => a?.[key]?.[0]?.n ?? 0;
    const ctl = svc.getControl();
    const today = todayUtc();
    const ev = await Promise.all([
      models.ReligiousEvent.countDocuments({ enabled: true, startDate: { $lte: today }, endDate: { $gte: today } }),
      models.ReligiousEvent.countDocuments({ enabled: true, startDate: { $gt: today } }),
      models.ReligiousEvent.countDocuments({ enabled: true, endDate: { $lt: today } }),
      models.ReligiousEvent.countDocuments({ enabled: false })
    ]);
    res.json({
      guildsWithSettings: n('total'), guildsTotal: client.guilds.cache.size,
      kinds: kinds.map(k => ({ key: k, enabled: n(`${k}On`), ready: n(`${k}Ready`), globallyOff: (ctl.disabledFeatures ?? []).includes(k) })),
      events: { active: ev[0], upcoming: ev[1], finished: ev[2], disabled: ev[3] }
    });
  }));

  app.get('/api/admin/content/events', requireAdmin, wrap(async (req, res) => {
    const { limit, skip, page } = pageParams(req.query, { def: 25, max: 50 });
    const q = textParam(req.query.q, 60), state = EVENT_STATES.includes(req.query.state) ? req.query.state : null;
    const today = todayUtc();
    const filter = {};
    if (SNOWFLAKE.test(q)) filter.guildId = q; else if (q) filter.title = { $regex: escapeRegex(q), $options: 'i' };
    if (state === 'active') Object.assign(filter, { enabled: true, startDate: { $lte: today }, endDate: { $gte: today } });
    if (state === 'upcoming') Object.assign(filter, { enabled: true, startDate: { $gt: today } });
    if (state === 'finished') Object.assign(filter, { enabled: true, endDate: { $lt: today } });
    if (state === 'disabled') filter.enabled = false;
    const [rows, total] = await Promise.all([
      models.ReligiousEvent.find(filter).sort({ startDate: -1 }).skip(skip).limit(limit).lean(),
      models.ReligiousEvent.countDocuments(filter)
    ]);
    res.json({
      total, page, limit, today,
      rows: rows.map(e => ({
        id: String(e._id), title: e.title, guildId: e.guildId, guildName: guildName(e.guildId), channelId: e.channelId, time: e.time, timezone: e.timezone,
        startDate: e.startDate, endDate: e.endDate, enabled: !!e.enabled, status: eventStatus(e, today), lastDate: e.lastDate ?? null
      }))
    });
  }));

  const eventById = async (req, res) => {
    if (!OBJECT_ID.test(req.params.eid)) { bad(res, 'Invalid id'); return null; }
    const ev = await models.ReligiousEvent.findById(req.params.eid).lean();
    if (!ev) { bad(res, 'الفعالية غير موجودة', 404); return null; }
    return ev;
  };

  app.post('/api/admin/content/events/:eid/toggle', requireAdmin, wrap(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return bad(res, 'enabled must be true or false');
    const ev = await eventById(req, res); if (!ev) return;
    await models.ReligiousEvent.updateOne({ _id: ev._id }, { $set: { enabled: req.body.enabled } });
    pushActivity('admin', req.body.enabled ? 'تفعيل فعالية' : 'إيقاف فعالية', `${ev.title} · ${guildName(ev.guildId) ?? ev.guildId}`);
    res.json({ ok: true });
  }));

  app.post('/api/admin/content/events/:eid/test', requireAdmin, wrap(async (req, res) => {
    const ev = await eventById(req, res); if (!ev) return;
    const r = await svc.sendEvent(client, ev, null);
    pushActivity('admin', 'اختبار فعالية', `${ev.title} · ${r.ok ? 'أُرسلت' : r.reason}`);
    res.status(r.ok ? 200 : 422).json(r.ok ? { ok: true } : { error: r.reason });
  }));

  app.post('/api/admin/content/events/:eid/delete', requireAdmin, wrap(async (req, res) => {
    if (!needConfirm(req, res, 'DELETE')) return;
    const ev = await eventById(req, res); if (!ev) return;
    await models.ReligiousEvent.deleteOne({ _id: ev._id });
    pushActivity('admin', 'حذف فعالية', `${ev.title} · ${guildName(ev.guildId) ?? ev.guildId}`);
    res.json({ ok: true });
  }));

  /* ══ 4. Security ═══════════════════════════════════════════════════════════ */

  const readSessions = async (req) => {
    // Only signed-in sessions: the store also holds anonymous visitors' documents, and an unfiltered limit(500) let them crowd a
    // real (even stolen) session out of the list — and so out of "revoke" / "revoke all". connect-mongo stores the session as a
    // JSON string by default; the object form is covered too.
    const signedIn = { $or: [{ session: { $regex: '"user"\\s*:\\s*\\{' } }, { 'session.user': { $exists: true } }] };
    const docs = await security.sessionsCollection().find(signedIn).sort({ expires: -1 }).limit(500).toArray();
    const now = Date.now();
    return docs.map(d => ({ doc: d, row: parseSessionDoc(d, { now, roleOf: security.roleOf }) })).filter(x => x.row)
      .map(x => ({ ...x, row: { ...x.row, current: x.doc._id === req.sessionID } }))
      .sort((a, b) => (b.row.signedInAt ?? 0) - (a.row.signedInAt ?? 0));
  };

  app.get('/api/admin/security/overview', requireAdmin, wrap(async (req, res) => {
    const since = new Date(Date.now() - 7 * DAY);
    const ctl = svc.getControl();
    const [sessions, ok7, refused7] = await Promise.all([
      readSessions(req),
      models.ActivityLog.countDocuments({ type: 'admin', action: { $regex: '^تسجيل دخول' }, ts: { $gte: since } }),
      models.ActivityLog.countDocuments({ type: 'ban', action: { $regex: '^محاولة دخول مرفوضة' }, ts: { $gte: since } })
    ]);
    const who = (id) => ({ id, username: client.users.cache.get(id)?.username ?? null });
    const info = security.info();
    res.json({
      checklist: securityChecklist(info),
      owners: security.adminIds().map(who), mods: security.modIds().map(who),
      modCaps: Object.entries(info.modCaps ?? {}).map(([key, label]) => ({ key, label, on: ctl.modCaps?.[key] !== false })),
      sessions: { total: sessions.length, mods: sessions.filter(s => s.row.role === 'mod').length, dead: sessions.filter(s => !s.row.role).length },
      logins7d: { ok: ok7, refused: refused7 },
      lifetime: { sessionDays: info.sessionDays, absoluteDays: info.absoluteDays }
    });
  }));

  app.get('/api/admin/security/sessions', requireAdmin, wrap(async (req, res) => {
    res.json({ rows: (await readSessions(req)).map(x => x.row) });
  }));

  app.post('/api/admin/security/sessions/revoke', requireAdmin, wrap(async (req, res) => {
    const ref = String(req.body?.ref ?? '');
    if (!REF.test(ref)) return bad(res, 'Invalid ref');
    const hit = (await readSessions(req)).find(x => x.row.ref === ref);
    if (!hit) return bad(res, 'الجلسة غير موجودة أو انتهت', 404);
    if (hit.row.current) return bad(res, 'هذه جلستك الحالية — استخدم «تسجيل الخروج»');
    await security.sessionsCollection().deleteOne({ _id: hit.doc._id });
    pushActivity('admin', 'إنهاء جلسة لوحة', `${hit.row.username} (${hit.row.userId})`);
    res.json({ ok: true });
  }));

  app.post('/api/admin/security/sessions/revoke-all', requireAdmin, wrap(async (req, res) => {
    if (!needConfirm(req, res, 'REVOKE')) return;
    const onlyMods = req.body?.onlyMods === true;
    const targets = (await readSessions(req)).filter(x => !x.row.current && (!onlyMods || x.row.role === 'mod'));
    let n = 0;
    for (const x of targets) { const r = await security.sessionsCollection().deleteOne({ _id: x.doc._id }); n += r.deletedCount ?? 0; }
    pushActivity('admin', onlyMods ? 'إنهاء جلسات المشرفين' : 'إنهاء كل جلسات اللوحة الأخرى', `${n} جلسة`);
    res.json({ ok: true, revoked: n });
  }));

  app.get('/api/admin/security/logins', requireAdmin, wrap(async (req, res) => {
    const { limit, skip, page } = pageParams(req.query, { def: 50, max: 100 });
    const filter = { type: { $in: ['admin', 'ban'] }, action: { $regex: LOGIN_ACTION.source } };
    const [rows, total] = await Promise.all([
      models.ActivityLog.find(filter).sort({ ts: -1 }).skip(skip).limit(limit).lean(),
      models.ActivityLog.countDocuments(filter)
    ]);
    res.json({ total, page, limit, rows: rows.map(r => ({ ts: r.ts, ok: r.type === 'admin', action: r.action, meta: r.meta })) });
  }));

  app.get('/api/admin/security/actions', requireAdmin, wrap(async (_req, res) => {
    const since = new Date(Date.now() - 7 * DAY);
    const agg = await models.ActivityLog.aggregate([
      { $match: { type: 'admin', ts: { $gte: since }, actor: { $ne: '' }, action: { $not: { $regex: '^تسجيل دخول' } } } },
      { $group: { _id: '$actor', n: { $sum: 1 }, last: { $max: '$ts' } } }, { $sort: { n: -1 } }, { $limit: 15 }
    ]);
    res.json({ rows: agg.map(a => ({ actor: a._id, count: a.n, last: a.last })) });
  }));

  app.get('/api/admin/security/export', requireAdmin, async (req, res) => {
    const set = typeof req.query.set === 'string' ? req.query.set : '';
    if (!Object.hasOwn(EXPORT_SETS, set) || !exportModels[set]) return bad(res, 'مجموعة غير معروفة');
    try {
      pushActivity('admin', 'تصدير بيانات', EXPORT_SETS[set]);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(set)}"`);
      res.write('[');
      let n = 0;
      for await (const doc of exportModels[set].find({}).lean().cursor()) {
        if (n >= EXPORT_MAX_DOCS) break;
        res.write(`${n ? ',' : ''}\n${JSON.stringify(doc)}`);
        n++;
      }
      res.end('\n]\n');
    } catch (err) {
      if (!res.headersSent) return fail(res, err);
      res.destroy();                                           // half a download must not look like a complete file
    }
  });
}
