/**
 * Owner panel — phase 4 routes.
 *
 *   GET    /api/admin/alerts                  live alert list (system, errors, server health, scheduled announcements)   OWNER
 *   GET    /api/admin/health/guilds           servers with problems (lost channels, missing permissions …)               OWNER
 *   GET    /api/admin/tags                    { guildId: { tags, hasNote } } for the servers table                      OWNER
 *   GET    /api/admin/guilds/:id/notes        private note + tags of one server                                          OWNER
 *   POST   /api/admin/guilds/:id/notes        save them (both empty → deleted)                                           OWNER
 *   GET    /api/admin/audit                   activity log with filters (type / actor / text / dates / paging)           OWNER or MOD
 *   GET    /api/admin/audit/actors            who has acted (filter dropdown)                                            OWNER or MOD
 *   GET    /api/admin/broadcasts              persistent announcement history + stats                                    OWNER
 *   POST   /api/admin/broadcasts/schedule     schedule an announcement (all servers or a chosen list)                    OWNER
 *   DELETE /api/admin/broadcasts/:bid         cancel a scheduled announcement                                            OWNER
 *
 * Also: a background check (every 60 s) DMs every ADMIN_IDS owner when a critical alert is confirmed — see services/alertNotifier.js.
 *
 * Same rules as the earlier phases: owner-only unless noted, no Mongo operator or path ever comes from the client,
 * every id is validated, and the scheduler never sends a stale announcement (see scheduleDecision).
 */

import os from 'os';
import path from 'path';
import v8 from 'v8';
import mongoose from 'mongoose';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { createAlertNotifier } from '../services/alertNotifier.js';
import { mapLimit } from '../utils/mapLimit.js';
import { pickAnnouncementChannel } from '../utils/channels.js';
import { LOG_DIR, tailLines } from './ownerRoutes.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Broadcast }     from '../models/Broadcast.js';
import { OwnerNote }     from '../models/OwnerNote.js';
import { ActivityLog }   from '../models/ActivityLog.js';
import {
  evaluateAlerts, auditGuildHealth, summarizeHealth, normalizeTags, validateSchedule, scheduleDecision,
  escapeRegex, qs, MAX_PENDING
} from '../utils/ownerInsights.js';

const SNOWFLAKE = /^\d{15,25}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;
const DAY = 86_400_000;
const SEND_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
const BCAST_COLOR = { info: 0x5b6ff5, success: 0x3ec88a, warning: 0xe8a83a, maintenance: 0xf07840 };
const BCAST_TYPES = Object.keys(BCAST_COLOR);
const AUDIT_ICONS = { join: '🟢', leave: '🔴', play: '▶️', stop: '⏹️', admin: '🛡️', ban: '🚫', error: '❌', info: 'ℹ️' };

const textField = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Send one announcement embed to many servers (10 at a time). Never throws for a single server.
 * @returns {{ sent: number, failed: number, skipped: number }} skipped = no channel the bot can write to
 */
export async function runBroadcast(client, guilds, { title, message, type = 'info' }) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  await mapLimit(guilds, 10, async (guild) => {
    try {
      const channel = pickAnnouncementChannel(guild);
      if (!channel) { result.skipped++; return; }
      await channel.send({
        allowedMentions: { parse: [] },
        embeds: [{
          title: (title || '📢 إعلان').slice(0, 256),
          description: String(message).slice(0, 4000),
          color: BCAST_COLOR[type] ?? BCAST_COLOR.info,
          footer: { text: 'بوت القرآن الكريم' },
          timestamp: new Date().toISOString()
        }]
      });
      result.sent++;
    } catch (err) { result.failed++; logger.debug?.(`[broadcast] ${guild.id}: ${err?.message}`); }
  });
  return result;
}

export function registerOwnerPhase4(app, { client, requireAdmin, requireCap, pushActivity, fail, getHistory }) {

  /* ── Server health ──────────────────────────────────────────────────────── */
  function channelState(guild, id) {
    if (!id) return 'none';
    const c = guild.channels.cache.get(id);
    if (!c) return 'missing';
    return c.permissionsFor?.(guild.members.me)?.has(SEND_PERMS) ? 'ok' : 'noperm';
  }

  function snapshotGuild(guild, cfg) {
    const me = guild.members.me;
    const voice = [...guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
    return {
      id: guild.id, name: guild.name, memberCount: guild.memberCount ?? 0, icon: guild.iconURL(),
      hasMe: !!me,
      announceChannel: !!pickAnnouncementChannel(guild),
      adhkar: { enabled: !!cfg?.adhkar?.enabled, channelId: cfg?.adhkar?.channelId ?? null, channel: channelState(guild, cfg?.adhkar?.channelId) },
      ayah:   { enabled: !!cfg?.ayah?.enabled,   channelId: cfg?.ayah?.channelId ?? null,   channel: channelState(guild, cfg?.ayah?.channelId) },
      hadith: { enabled: !!cfg?.hadith?.enabled, channelId: cfg?.hadith?.channelId ?? null, channel: channelState(guild, cfg?.hadith?.channelId) },
      voiceTotal: voice.length,
      voiceJoinable: voice.filter(c => c.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])).length,
      locked: !!cfg?.restrictions?.locked
    };
  }

  const healthCache = { at: 0, data: null, inflight: null };
  async function computeHealth() {
    if (healthCache.data && Date.now() - healthCache.at < 60_000) return healthCache.data;
    if (healthCache.inflight) return healthCache.inflight;
    healthCache.inflight = (async () => {
      const cfgs = await GuildSettings.find({}, 'guildId adhkar.enabled adhkar.channelId ayah.enabled ayah.channelId hadith.enabled hadith.channelId restrictions.locked').lean();
      const byId = new Map(cfgs.map(c => [c.guildId, c]));
      const rows = [];
      let n = 0;
      for (const guild of client.guilds.cache.values()) {
        if (++n % 50 === 0) await new Promise(r => setImmediate(r));       // thousands of servers: let the bot breathe between batches
        let snap;
        try { snap = snapshotGuild(guild, byId.get(guild.id)); } catch (err) { logger.debug?.(`[health] ${guild.id}: ${err?.message}`); continue; }
        const { level, issues } = auditGuildHealth(snap);
        rows.push({ id: snap.id, name: snap.name, icon: snap.icon, memberCount: snap.memberCount, level, issues });
      }
      const order = { critical: 0, warn: 1, ok: 2 };
      rows.sort((a, b) => order[a.level] - order[b.level] || b.memberCount - a.memberCount);
      healthCache.data = { at: Date.now(), summary: summarizeHealth(rows), rows };
      healthCache.at = Date.now();
      return healthCache.data;
    })().finally(() => { healthCache.inflight = null; });
    return healthCache.inflight;
  }

  app.get('/api/admin/health/guilds', requireAdmin, async (req, res) => {
    try {
      if (req.query.fresh === '1') healthCache.at = 0;
      const h = await computeHealth();
      res.json({ at: h.at, summary: h.summary, rows: h.rows.filter(r => r.level !== 'ok').slice(0, 500) });
    } catch (err) { fail(res, err); }
  });

  /* ── Alerts ─────────────────────────────────────────────────────────────── */
  const errCache = { at: 0, n: 0 };
  async function errorsLastHour() {
    if (Date.now() - errCache.at < 30_000) return errCache.n;
    let n = 0;
    try {
      const since = Date.now() - 3_600_000;
      for (const line of await tailLines(path.join(LOG_DIR, 'combined.log'))) {
        try {
          const j = JSON.parse(line);
          if (String(j.level ?? '').toUpperCase() === 'ERROR' && new Date(j.ts).getTime() >= since) n++;
        } catch { /* not a JSON line */ }
      }
    } catch { /* no log file yet */ }
    errCache.at = Date.now(); errCache.n = n;
    return n;
  }

  async function mongoPing() {
    if (mongoose.connection.readyState !== 1) return null;
    const t0 = Date.now();
    try {
      await Promise.race([mongoose.connection.db.admin().ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      return Date.now() - t0;
    } catch { return null; }
  }

  /** The full alert list (also used by the DM notifier). Never throws for a single failing source. */
  async function buildAlerts() {
    const DB = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const last = getHistory?.().at(-1);
    const mem = process.memoryUsage();
    const snap = {
      mongo: { state: DB[mongoose.connection.readyState] ?? 'unknown', pingMs: await mongoPing() },
      ws: { status: client.ws?.status, ping: client.ws?.ping },
      lagMs: last?.lag, cpuPct: last?.cpu,
      heapRatio: mem.heapUsed / v8.getHeapStatistics().heap_size_limit,
      hostMemRatio: (os.totalmem() - os.freemem()) / os.totalmem(),
      uptimeSec: process.uptime(),
      maintenance: !!client._maintenanceMode,
      errorsLastHour: await errorsLastHour()
    };
    try { const h = await computeHealth(); snap.health = h.summary; } catch { /* alert list still works without it */ }
    try {
      const now = Date.now();
      const [overdue, failed7d, pending] = await Promise.all([
        Broadcast.countDocuments({ status: 'scheduled', runAt: { $lte: new Date(now - 120_000) } }),
        Broadcast.countDocuments({ status: { $in: ['missed', 'failed'] }, createdAt: { $gte: new Date(now - 7 * DAY) } }),
        Broadcast.countDocuments({ status: 'scheduled' })
      ]);
      snap.scheduled = { overdue, failed7d, pending };
    } catch { /* ignore */ }
    return { alerts: evaluateAlerts(snap), health: snap.health ?? null };
  }

  app.get('/api/admin/alerts', requireAdmin, async (_req, res) => {
    try {
      const { alerts, health } = await buildAlerts();
      res.json({ at: Date.now(), alerts, health, counts: { critical: alerts.filter(a => a.level === 'critical').length, warn: alerts.filter(a => a.level === 'warn').length } });
    } catch (err) { fail(res, err); }
  });

  // Critical alerts → direct message to every owner (ADMIN_IDS). OWNER_ALERT_DM=0 switches it off.
  if (config.admin.alertDm && config.admin.ids.length) {
    const notifier = createAlertNotifier({
      client, ownerIds: config.admin.ids, dashboardUrl: config.api.dashboardUrl,
      getAlerts: async () => (await buildAlerts()).alerts
    });
    setInterval(() => { if (client.isReady?.()) notifier.tick(); }, 60_000).unref?.();
  }

  /* ── Private notes and tags ─────────────────────────────────────────────── */
  app.get('/api/admin/tags', requireAdmin, async (_req, res) => {
    try {
      const rows = await OwnerNote.find({}, 'guildId tags note').lean();
      const out = {};
      for (const r of rows) if (r.tags?.length || r.note) out[r.guildId] = { tags: r.tags ?? [], hasNote: !!r.note };
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/admin/guilds/:id/notes', requireAdmin, async (req, res) => {
    if (!SNOWFLAKE.test(req.params.id)) return res.status(400).json({ error: 'invalid server id' });
    try {
      const d = await OwnerNote.findOne({ guildId: req.params.id }).lean();
      res.json({ note: d?.note ?? '', tags: d?.tags ?? [], updatedBy: d?.updatedBy ?? '', updatedAt: d?.updatedAt ?? null });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/guilds/:id/notes', requireAdmin, async (req, res) => {
    if (!SNOWFLAKE.test(req.params.id)) return res.status(400).json({ error: 'invalid server id' });
    const guild = client.guilds.cache.get(req.params.id);
    const b = req.body ?? {};
    if (b.note !== undefined && typeof b.note !== 'string') return res.status(400).json({ error: 'note must be text' });
    if (b.tags !== undefined && !Array.isArray(b.tags)) return res.status(400).json({ error: 'tags must be a list' });
    const note = (b.note ?? '').trim();
    if (note.length > 1000) return res.status(400).json({ error: 'note: 1000 characters at most' });
    const tags = normalizeTags(b.tags);
    // A server the bot has left can no longer get a note, but its old note can still be cleared.
    if (!guild && (note || tags.length)) return res.status(404).json({ error: 'server not found' });
    try {
      if (!note && !tags.length) await OwnerNote.deleteOne({ guildId: req.params.id });
      else {
        const u = req.session.user;
        await OwnerNote.findOneAndUpdate({ guildId: guild.id },
          { $set: { note, tags, updatedBy: `${u.username ?? u.id} (${u.id})`, updatedAt: new Date() } }, { upsert: true });
      }
      pushActivity('admin', `ملاحظة/وسوم سيرفر: ${guild?.name ?? req.params.id}`, tags.length ? tags.join(' · ') : (note ? 'ملاحظة' : 'حُذفت'));
      res.json({ ok: true, tags, note });
    } catch (err) { fail(res, err); }
  });

  /* ── Audit trail (filters + paging; the dashboard builds the CSV from these rows) ── */
  function auditFilter(q) {
    const f = {};
    const type = qs(q.type, 16);
    if (/^[a-z]{1,16}$/.test(type)) f.type = type;
    const actor = qs(q.actor, 60);
    if (actor) f.actor = { $regex: escapeRegex(actor), $options: 'i' };
    const text = qs(q.q, 60);
    if (text) { const rx = { $regex: escapeRegex(text), $options: 'i' }; f.$or = [{ action: rx }, { meta: rx }]; }
    const range = {};
    const from = new Date(qs(q.from, 30)), to = new Date(qs(q.to, 30));
    if (qs(q.from, 30) && !Number.isNaN(from.getTime())) range.$gte = from;
    if (qs(q.to, 30) && !Number.isNaN(to.getTime())) range.$lte = to;
    if (Object.keys(range).length) f.ts = range;
    return f;
  }

  app.get('/api/admin/audit', requireCap('audit'), async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 2000);
    const skip  = Math.min(Math.max(parseInt(req.query.skip, 10) || 0, 0), 100_000);
    try {
      const f = auditFilter(req.query);
      const [total, rows] = await Promise.all([
        ActivityLog.countDocuments(f),
        ActivityLog.find(f).sort({ ts: -1 }).skip(skip).limit(limit).lean()
      ]);
      res.json({ total, skip, rows: rows.map(r => ({ type: r.type, action: r.action, meta: r.meta, actor: r.actor ?? '', ts: new Date(r.ts).getTime(), icon: AUDIT_ICONS[r.type] ?? '📌' })) });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/admin/audit/actors', requireCap('audit'), async (_req, res) => {
    try {
      const list = await ActivityLog.distinct('actor', { actor: { $ne: '' } });
      res.json(list.filter(a => typeof a === 'string').sort().slice(0, 100));
    } catch (err) { fail(res, err); }
  });

  /* ── Announcements: history, scheduling, scheduler ──────────────────────── */
  app.get('/api/admin/broadcasts', requireAdmin, async (_req, res) => {
    try {
      const [rows, agg, pending] = await Promise.all([
        Broadcast.find({}).sort({ createdAt: -1 }).limit(50).lean(),
        Broadcast.aggregate([{ $match: { status: 'done' } }, { $group: { _id: null, n: { $sum: 1 }, sent: { $sum: '$result.sent' }, failed: { $sum: '$result.failed' }, last: { $max: '$finishedAt' } } }]),
        Broadcast.countDocuments({ status: 'scheduled' })
      ]);
      const a = agg[0] ?? { n: 0, sent: 0, failed: 0, last: null };
      res.json({
        stats: { total: a.n, sent: a.sent, failed: a.failed, lastAt: a.last, pending, successRate: a.sent + a.failed ? Math.round((a.sent / (a.sent + a.failed)) * 1000) / 10 : null },
        rows: rows.map(r => ({
          id: String(r._id), title: r.title, message: r.message, type: r.type, target: r.target, targets: r.guildIds?.length ?? 0,
          runAt: r.runAt, status: r.status, result: r.result, createdBy: r.createdBy, createdAt: r.createdAt, finishedAt: r.finishedAt
        }))
      });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/broadcasts/schedule', requireAdmin, async (req, res) => {
    const b = req.body ?? {};
    const message = textField(b.message)?.slice(0, 2000);
    const title   = textField(b.title)?.slice(0, 256) ?? '';
    const type    = BCAST_TYPES.includes(b.type) ? b.type : 'info';
    if (!message) return res.status(400).json({ error: 'message required' });
    const when = validateSchedule(b.runAt);
    if (!when.ok) return res.status(400).json({ error: when.error });
    let ids = [];
    if (b.ids !== undefined && b.ids !== null) {
      if (!Array.isArray(b.ids) || b.ids.length > 100 || !b.ids.every(i => typeof i === 'string' && SNOWFLAKE.test(i))) return res.status(400).json({ error: 'ids: up to 100 valid server ids' });
      ids = [...new Set(b.ids)];
    }
    try {
      if (await Broadcast.countDocuments({ status: 'scheduled' }) >= MAX_PENDING) return res.status(409).json({ error: `الحد الأقصى ${MAX_PENDING} إعلانًا مجدولًا — ألغِ بعضها أولًا` });
      const u = req.session.user;
      const doc = await Broadcast.create({
        title, message, type, target: ids.length ? 'ids' : 'all', guildIds: ids,
        runAt: when.date, status: 'scheduled', createdBy: `${u.username ?? u.id} (${u.id})`
      });
      pushActivity('admin', `جدولة إعلان: "${(title || message).slice(0, 40)}"`, `${when.date.toISOString()} · ${ids.length ? `${ids.length} سيرفر` : 'كل السيرفرات'}`);
      res.json({ ok: true, id: String(doc._id) });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/admin/broadcasts/:bid', requireAdmin, async (req, res) => {
    if (!OBJECT_ID.test(req.params.bid)) return res.status(400).json({ error: 'invalid id' });
    try {
      const d = await Broadcast.findOneAndUpdate({ _id: req.params.bid, status: 'scheduled' }, { $set: { status: 'cancelled', finishedAt: new Date() } });
      if (!d) return res.status(404).json({ error: 'not found or no longer scheduled' });
      pushActivity('admin', `إلغاء إعلان مجدول: "${(d.title || d.message).slice(0, 40)}"`, '');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Scheduler: every 30 s send what is due. Overdue by more than 30 min (bot was off) → marked "missed", never sent late.
  let recovered = false;
  async function schedulerTick() {
    if (client._broadcastBusy || mongoose.connection.readyState !== 1) return;
    client._broadcastBusy = true;                                  // taken synchronously: a manual announcement cannot slip in between the checks below
    try {
      if (!recovered) {                                            // a run interrupted by a crash must not stay "running" forever
        recovered = true;
        await Broadcast.updateMany({ status: 'running' }, { $set: { status: 'failed', finishedAt: new Date() } });
      }
      const due = await Broadcast.find({ status: 'scheduled', runAt: { $lte: new Date() } }).sort({ runAt: 1 }).limit(3).lean();
      for (const job of due) {
        const decision = scheduleDecision(job.runAt);
        if (decision === 'missed') {
          const m = await Broadcast.findOneAndUpdate({ _id: job._id, status: 'scheduled' }, { $set: { status: 'missed', finishedAt: new Date() } });
          if (m) pushActivity('error', `إعلان مجدول فات موعده: "${(job.title || job.message).slice(0, 40)}"`, 'كان البوت متوقفًا وقت الإرسال');
          continue;
        }
        if (decision !== 'run') continue;
        const claimed = await Broadcast.findOneAndUpdate({ _id: job._id, status: 'scheduled' }, { $set: { status: 'running' } });
        if (!claimed) continue;                                    // cancelled or taken meanwhile
        try {
          const guilds = job.target === 'ids'
            ? job.guildIds.map(id => client.guilds.cache.get(id)).filter(Boolean)
            : [...client.guilds.cache.values()];
          const result = await runBroadcast(client, guilds, job);
          await Broadcast.updateOne({ _id: job._id }, { $set: { status: 'done', result, finishedAt: new Date() } });
          pushActivity('admin', `إعلان مجدول أُرسل: "${(job.title || job.message).slice(0, 40)}"`, `نجح ${result.sent} · فشل ${result.failed} · تخطّي ${result.skipped}`);
        } catch (err) {
          await Broadcast.updateOne({ _id: job._id }, { $set: { status: 'failed', finishedAt: new Date() } }).catch(() => {});
          logger.error(`[scheduler] broadcast ${job._id}: ${err?.message}`);
        }
      }
    } catch (err) { logger.warn(`[scheduler] ${err?.message}`); }
    finally { client._broadcastBusy = false; }
  }
  setInterval(schedulerTick, 30_000).unref?.();
  setTimeout(schedulerTick, 10_000).unref?.();
}
