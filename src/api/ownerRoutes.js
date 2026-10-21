/**
 * Owner panel — phase 2 routes.
 *
 *   GET  /api/admin/system                 live health snapshot (CPU / RAM / event-loop lag / ping / MongoDB …)
 *   GET  /api/admin/system/history         last ~1 hour of samples for the charts
 *   GET  /api/admin/logs/files             available log files
 *   GET  /api/admin/logs                   tail of a log file (level / text filter, secrets redacted)
 *   GET  /api/admin/guilds/:id/details     deep info about one server (permissions, channels, schedules …)
 *   POST /api/admin/guilds/:id/disable-schedules   switch off adhkar / verse-of-the-day posting for one server
 *   POST /api/admin/guilds/bulk            message / leave / blacklist many servers at once (server-side confirm token)
 *   GET  /api/admin/guilds/inactive        servers that look abandoned (cleanup candidates)
 *   GET  /api/admin/growth                 joins / leaves per day (from the activity log)
 *   POST /api/admin/bot/status             online / idle / dnd / invisible (keeps the current activity text)
 *
 * Phase 3 (owner OR moderator unless noted):
 *   GET  /api/admin/guilds/:id/channels    text + voice channels of a server (channel picker, voice picker)
 *   POST /api/admin/guilds/:id/config      language, adhkar / verse-of-the-day channel + on/off
 *   POST /api/admin/guilds/:id/join        bot joins a voice channel (no playback)
 *   POST /api/admin/guilds/:id/play        bot joins (if needed) and plays / queues a surah
 *   GET  /api/admin/surahs, /api/admin/reciters?q=   pickers for the play form
 *   GET|POST /api/admin/guilds/:id/restrictions      OWNER ONLY: lock a server, disable commands, shorter queue
 *   POST /api/admin/guilds/:id/lock        OWNER ONLY: lock / unlock a server, optionally for N minutes (releases itself)
 *   POST /api/admin/guilds/bulk            also: lock · unlock · stop · language · schedules · tag (OWNER, server-side confirm token)
 *
 * Everything sits behind requireAdmin (owner Discord IDs only). Nothing here accepts a path, a shell command or a
 * Mongo operator from the client: log files are matched against a fixed pattern, ids must be snowflakes, and every
 * destructive action needs a confirm token that the server checks.
 */

import os   from 'os';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { monitorEventLoopDelay } from 'perf_hooks';
import mongoose from 'mongoose';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { mapLimit } from '../utils/mapLimit.js';
import { pickAnnouncementChannel } from '../utils/channels.js';
import { getSession, getAllSessions, destroySession, createAndJoin, enqueue, playNext, MAX_QUEUE, queueLimit } from '../managers/sessionManager.js';
import { findReciter, findDefaultReciter, searchReciters } from '../services/quranService.js';
import { SURAHS, getSurahByNumber } from '../data/surahs.js';
import { invalidateRestrictions } from '../utils/guildRestrictions.js';
import { normalizeRestrictions, isLocked, buildLockPatch, VOICE_COMMANDS } from '../utils/restrictionRules.js';
import { normalizeTags } from '../utils/ownerInsights.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { OwnerNote }     from '../models/OwnerNote.js';
import { Statistics }    from '../models/Statistics.js';
import { Blacklist }     from '../models/Blacklist.js';
import { ActivityLog }   from '../models/ActivityLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = path.resolve(__dirname, '../../logs');
const SNOWFLAKE = /^\d{15,25}$/;
const LOG_FILE  = /^(combined|error)(-\d{4}-\d{2}-\d{2})?\.log$/;
const DAY       = 86_400_000;

const textField = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Remove anything that looks like a bot token or a database password before a log line leaves the server. */
function redact(s) {
  return String(s ?? '')
    .replace(/[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g, '[token]')
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[credentials]@')
    .replace(/(secret|token|password|authorization)(["'\s:=]+)[^\s"',}]{6,}/gi, '$1$2[hidden]');
}

export async function tailLines(file, maxBytes = 512 * 1024) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // drop the (probably cut) first line
    return text.split('\n').filter(Boolean);
  } finally { await fh.close(); }
}

const isTextCh  = c => c?.type === ChannelType.GuildText || c?.type === ChannelType.GuildAnnouncement;
const isVoiceCh = c => c?.type === ChannelType.GuildVoice || c?.type === ChannelType.GuildStageVoice;

/** A text channel of THIS server that the bot can post embeds in — or null. Never trusts the id beyond that. */
export function resolveSendChannel(guild, id) {
  if (!SNOWFLAKE.test(String(id ?? ''))) return null;
  const c = guild.channels.cache.get(String(id));
  if (!isTextCh(c)) return null;
  return c.permissionsFor?.(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) ? c : null;
}
/** A voice channel of THIS server the bot may join and speak in — or null. */
function resolveVoiceChannel(guild, id) {
  if (!SNOWFLAKE.test(String(id ?? ''))) return null;
  const c = guild.channels.cache.get(String(id));
  if (!isVoiceCh(c)) return null;
  return c.permissionsFor?.(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]) ? c : null;
}

export function registerOwnerRoutes(app, { client, requireAdmin, requireMod, requireCap, pushActivity, fail }) {

  /* ── System sampler ─────────────────────────────────────────────────────── */
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const history = [];                      // { t, cpu, rss, heap, lag, ping, sessions }
  let lastCpu = process.cpuUsage(), lastAt = process.hrtime.bigint();

  function sample() {
    const nowAt = process.hrtime.bigint();
    const cpu   = process.cpuUsage(lastCpu);
    const wallUs = Number(nowAt - lastAt) / 1000 || 1;
    lastCpu = process.cpuUsage(); lastAt = nowAt;
    const mem = process.memoryUsage();
    const lag = loop.count ? loop.percentile(99) / 1e6 : 0;
    loop.reset();
    const s = {
      t: Date.now(),
      cpu: Math.round(((cpu.user + cpu.system) / wallUs) * 1000) / 10,     // % of one core
      rss: mem.rss, heap: mem.heapUsed,
      lag: Math.round(lag * 10) / 10,
      ping: client.ws?.ping ?? -1,
      sessions: getAllSessions().length
    };
    history.push(s);
    if (history.length > 240) history.shift();
    return s;
  }
  sample();
  setInterval(sample, 15_000).unref?.();

  const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  async function dbPing() {
    if (mongoose.connection.readyState !== 1) return null;
    const t0 = Date.now();
    try {
      await Promise.race([mongoose.connection.db.admin().ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      return Date.now() - t0;
    } catch { return null; }
  }

  app.get('/api/admin/system', requireAdmin, async (_req, res) => {
    try {
      const last = history.at(-1) ?? sample();
      const mem = process.memoryUsage();
      const guilds = [...client.guilds.cache.values()];
      res.json({
        now: Date.now(),
        uptime: Math.floor(process.uptime()),
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        cores: os.cpus().length,
        load: os.loadavg(),
        hostMem: { total: os.totalmem(), free: os.freemem() },
        proc: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
        cpu: last.cpu,
        lag: last.lag,
        ping: client.ws?.ping ?? -1,
        wsStatus: client.ws?.status ?? -1,
        mongo: { state: DB_STATES[mongoose.connection.readyState] ?? 'unknown', pingMs: await dbPing() },
        guilds: guilds.length,
        members: guilds.reduce((n, g) => n + (g.memberCount ?? 0), 0),
        users: client.users?.cache?.size ?? 0,
        channels: client.channels?.cache?.size ?? 0,
        sessions: last.sessions,
        maintenance: !!client._maintenanceMode
      });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/admin/system/history', requireAdmin, (_req, res) => res.json(history));

  /* ── Logs ───────────────────────────────────────────────────────────────── */
  app.get('/api/admin/logs/files', requireAdmin, async (_req, res) => {
    try {
      const names = (await fs.promises.readdir(LOG_DIR)).filter(f => LOG_FILE.test(f));
      const out = [];
      for (const name of names) {
        const st = await fs.promises.stat(path.join(LOG_DIR, name)).catch(() => null);
        if (st) out.push({ name, size: st.size, mtime: st.mtimeMs });
      }
      out.sort((a, b) => (a.name.startsWith('combined.') ? -1 : 0) - (b.name.startsWith('combined.') ? -1 : 0) || b.mtime - a.mtime);
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/admin/logs', requireAdmin, async (req, res) => {
    const name = String(req.query.file ?? 'combined.log');
    if (!LOG_FILE.test(name)) return res.status(400).json({ error: 'invalid log file' });
    const level = String(req.query.level ?? '').toUpperCase();
    const q     = textField(String(req.query.q ?? ''))?.slice(0, 100).toLowerCase() ?? '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 10), 500);
    try {
      const lines = await tailLines(path.join(LOG_DIR, name));
      const rows = [];
      for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
        let row;
        try { const j = JSON.parse(lines[i]); row = { ts: j.ts ?? null, level: String(j.level ?? 'INFO').toUpperCase(), message: String(j.message ?? '') }; }
        catch { row = { ts: null, level: 'INFO', message: lines[i] }; }
        if (level && row.level !== level) continue;
        row.message = redact(row.message).slice(0, 2000);
        if (q && !row.message.toLowerCase().includes(q)) continue;
        rows.push(row);
      }
      res.json({ file: name, rows });
    } catch (err) {
      if (err?.code === 'ENOENT') return res.json({ file: name, rows: [] });
      fail(res, err);
    }
  });

  /* ── One server, in depth ───────────────────────────────────────────────── */
  const WATCHED_PERMS = [
    ['Administrator', PermissionFlagsBits.Administrator],
    ['ViewChannel',   PermissionFlagsBits.ViewChannel],
    ['SendMessages',  PermissionFlagsBits.SendMessages],
    ['EmbedLinks',    PermissionFlagsBits.EmbedLinks],
    ['Connect',       PermissionFlagsBits.Connect],
    ['Speak',         PermissionFlagsBits.Speak],
    ['ManageMessages', PermissionFlagsBits.ManageMessages],
    ['ManageChannels', PermissionFlagsBits.ManageChannels],
    ['ManageRoles',    PermissionFlagsBits.ManageRoles]
  ];

  const guildOf = id => (SNOWFLAKE.test(String(id ?? '')) ? client.guilds.cache.get(id) : null);

  app.get('/api/admin/guilds/:id/details', requireMod, async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    try {
      const me = guild.members.me;
      const chans = [...guild.channels.cache.values()];
      const voice = chans.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
      const ownerTag = await guild.fetchOwner().then(m => m.user.username).catch(() => null);
      const [cfg, banned] = await Promise.all([
        GuildSettings.findOne({ guildId: guild.id }).lean(),
        Blacklist.exists({ guildId: guild.id }).then(Boolean).catch(() => false)
      ]);
      const s = getSession(guild.id);
      const announce = pickAnnouncementChannel(guild);
      res.json({
        id: guild.id,
        ownerId: guild.ownerId, ownerName: ownerTag,
        createdAt: guild.createdAt?.toISOString() ?? null,
        description: guild.description ?? null,
        locale: guild.preferredLocale ?? null,
        boostTier: guild.premiumTier ?? 0, boosts: guild.premiumSubscriptionCount ?? 0,
        verification: guild.verificationLevel ?? 0,
        features: (guild.features ?? []).slice(0, 12),
        counts: {
          roles: guild.roles.cache.size,
          text:  chans.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).length,
          voice: voice.length,
          categories: chans.filter(c => c.type === ChannelType.GuildCategory).length,
          emojis: guild.emojis.cache.size
        },
        botPerms: WATCHED_PERMS.map(([name, bit]) => ({ name, ok: !!me?.permissions?.has(bit) })),
        announceChannel: announce?.name ?? null,
        voiceChannels: voice.slice(0, 25).map(c => ({
          id: c.id, name: c.name,
          members: c.members?.size ?? 0,
          canJoin: !!c.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
        })),
        settings: {
          language: cfg?.language ?? 'en',
          adhkar: !!cfg?.adhkar?.enabled, adhkarScatter: !!cfg?.adhkar?.scatter?.enabled,
          adhkarChannelId: cfg?.adhkar?.channelId ?? null,
          ayah: !!cfg?.ayah?.enabled, ayahChannelId: cfg?.ayah?.channelId ?? null,
          hadith: !!cfg?.hadith?.enabled, hadithChannelId: cfg?.hadith?.channelId ?? null,
          locked: isLocked(normalizeRestrictions(cfg?.restrictions)),
          lockedUntil: isLocked(normalizeRestrictions(cfg?.restrictions)) ? normalizeRestrictions(cfg?.restrictions).lockedUntil : null,
          wirdRoom: !!cfg?.wird?.channelId,
          setupDone: !!cfg?.setup?.categoryId
        },
        blacklisted: banned,
        session: s ? {
          status: s.status, channel: s.channelName ?? null, queue: s.queue?.length ?? 0, loop: !!s.loop,
          surah: s.current?.surah?.arabic ?? null, reciter: s.current?.reciter ?? null, volume: Number.isFinite(s.volume) ? s.volume : 100
        } : null
      });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/guilds/:id/disable-schedules', requireCap('config'), async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    try {
      await GuildSettings.findOneAndUpdate({ guildId: guild.id },
        { $set: { 'adhkar.enabled': false, 'adhkar.scatter.enabled': false, 'ayah.enabled': false, 'hadith.enabled': false } });
      pushActivity('admin', `إيقاف النشر التلقائي: ${guild.name}`, 'أذكار + آية اليوم + حديث اليوم');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  /* ── Bulk actions ───────────────────────────────────────────────────────── */
  const BULK_TOKEN = {
    message: 'BULK_MESSAGE', leave: 'BULK_LEAVE', blacklist: 'BULK_BLACKLIST',
    lock: 'BULK_LOCK', unlock: 'BULK_UNLOCK', stop: 'BULK_STOP', language: 'BULK_LANGUAGE', schedules: 'BULK_SCHEDULES', tag: 'BULK_TAG'
  };
  const BULK_LABEL = {
    message: 'رسالة جماعية', leave: 'مغادرة جماعية', blacklist: 'حظر جماعي', lock: 'قفل جماعي', unlock: 'فتح جماعي',
    stop: 'إيقاف جلسات جماعي', language: 'تغيير لغة جماعي', schedules: 'إيقاف النشر التلقائي جماعيًا', tag: 'وسم جماعي'
  };
  let bulkRunning = false;

  app.post('/api/admin/guilds/bulk', requireAdmin, async (req, res) => {
    const { action, ids, confirm } = req.body ?? {};
    if (!Object.hasOwn(BULK_TOKEN, action)) return res.status(400).json({ error: 'unknown action' });
    if (confirm !== BULK_TOKEN[action]) return res.status(400).json({ error: `confirm: "${BULK_TOKEN[action]}" required` });
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) return res.status(400).json({ error: 'ids: 1 to 100 server ids required' });
    const list = [...new Set(ids.map(String))];
    if (!list.every(i => SNOWFLAKE.test(i))) return res.status(400).json({ error: 'invalid server id' });
    const message = textField(req.body?.message)?.slice(0, 4000);
    const title   = textField(req.body?.title)?.slice(0, 256);
    const reason  = String(textField(req.body?.reason) ?? 'Bulk action by owner').slice(0, 300);
    if (action === 'message' && !message) return res.status(400).json({ error: 'message required' });

    // Inputs of the new actions are validated BEFORE anything runs, so a typo can never half-apply to 100 servers.
    let lockPatch = null, language = null, tag = null;
    if (action === 'lock' || action === 'unlock') {
      const minutes = action === 'lock' && req.body?.minutes !== undefined ? req.body.minutes : null;
      const built = buildLockPatch(action === 'lock', minutes);
      if (built.error) return res.status(400).json({ error: built.error });
      lockPatch = built;
    }
    if (action === 'language') {
      language = req.body?.language;
      if (!['ar', 'en'].includes(language)) return res.status(400).json({ error: 'invalid language' });
    }
    if (action === 'tag') {
      tag = normalizeTags([req.body?.tag])[0];
      if (!tag) return res.status(400).json({ error: 'tag required (max 20 characters)' });
    }
    if (bulkRunning) return res.status(409).json({ error: 'another bulk action is still running' });

    bulkRunning = true;
    const result = { done: 0, failed: 0, skipped: 0 };
    try {
      await mapLimit(list, 5, async (id) => {
        const guild = client.guilds.cache.get(id);
        if (!guild) { result.skipped++; return; }
        try {
          if (action === 'message') {
            const ch = pickAnnouncementChannel(guild);
            if (!ch) { result.skipped++; return; }
            await ch.send({ allowedMentions: { parse: [] }, embeds: [{ title: title || '📢 رسالة من إدارة البوت', description: message, color: 0x5b6ff5, timestamp: new Date().toISOString() }] });
          } else if (action === 'leave') {
            await destroySession(id).catch(() => {});
            await guild.leave();
          } else if (action === 'stop') {
            if (!getSession(id)) { result.skipped++; return; }
            await destroySession(id);
          } else if (action === 'lock' || action === 'unlock') {
            await GuildSettings.findOneAndUpdate({ guildId: id }, { $set: lockPatch.patch }, { upsert: true });
            invalidateRestrictions(id);
          } else if (action === 'language') {
            await GuildSettings.findOneAndUpdate({ guildId: id }, { $set: { language } }, { upsert: true });
            GuildSettings.invalidateLangCache(id);
          } else if (action === 'schedules') {
            await GuildSettings.findOneAndUpdate({ guildId: id }, { $set: { 'adhkar.enabled': false, 'adhkar.scatter.enabled': false, 'ayah.enabled': false, 'hadith.enabled': false } });
          } else if (action === 'tag') {
            const before = (await OwnerNote.findOne({ guildId: id }, 'tags').lean())?.tags ?? [];
            const merged = normalizeTags([...before, tag]);
            if (merged.length === before.length) { result.skipped++; return; }          // already has it, or already at the limit
            const u = req.session?.user;
            await OwnerNote.findOneAndUpdate({ guildId: id }, { $set: { tags: merged, updatedBy: `${u?.username ?? u?.id ?? ''} (${u?.id ?? ''})`.slice(0, 100), updatedAt: new Date() } }, { upsert: true });
          } else {
            await Blacklist.findOneAndUpdate({ guildId: id }, { guildId: id, name: guild.name, reason, bannedAt: new Date() }, { upsert: true });
            await destroySession(id).catch(() => {});
            await guild.leave().catch(() => {});
          }
          result.done++;
        } catch (err) { result.failed++; logger.warn(`[bulk:${action}] ${id}: ${err.message}`); }
      });
      if (action === 'blacklist') Blacklist.invalidateCache();
      const extraInfo = lockPatch?.until ? ` · حتى ${new Date(lockPatch.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
      pushActivity(action === 'blacklist' ? 'ban' : 'admin', `${BULK_LABEL[action]}: ${list.length} سيرفر`, `نجح ${result.done} · فشل ${result.failed} · تخطّي ${result.skipped}${extraInfo}`);
      res.json({ ok: true, ...result });
    } catch (err) { fail(res, err); }
    finally { bulkRunning = false; }
  });

  /* ── Cleanup finder ─────────────────────────────────────────────────────── */
  app.get('/api/admin/guilds/inactive', requireAdmin, async (req, res) => {
    const days       = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const maxMembers = Math.min(Math.max(parseInt(req.query.maxMembers, 10) || 100000, 1), 10_000_000);
    const cutoff = Date.now() - days * DAY;
    try {
      const stats = await Statistics.find({}, 'guildId totalPlayedSurahs totalPlayTime updatedAt').lean();
      const byId = new Map(stats.map(s => [s.guildId, s]));
      const rows = [];
      for (const g of client.guilds.cache.values()) {
        if (getSession(g.id)) continue;                                   // playing right now
        if ((g.joinedTimestamp ?? 0) > cutoff) continue;                  // too new to judge
        if ((g.memberCount ?? 0) > maxMembers) continue;
        const st = byId.get(g.id);
        const last = st?.updatedAt ? new Date(st.updatedAt).getTime() : 0;
        if (last > cutoff) continue;
        rows.push({
          id: g.id, name: g.name, icon: g.iconURL(), memberCount: g.memberCount ?? 0,
          joinedAt: g.joinedAt?.toISOString() ?? null,
          lastActivity: last || null,
          neverPlayed: !st || !st.totalPlayedSurahs
        });
      }
      rows.sort((a, b) => (a.lastActivity ?? 0) - (b.lastActivity ?? 0));
      res.json({ days, total: rows.length, rows: rows.slice(0, 300) });
    } catch (err) { fail(res, err); }
  });

  /* ── Growth ─────────────────────────────────────────────────────────────── */
  app.get('/api/admin/growth', requireAdmin, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 30);   // the activity log keeps 30 days
    try {
      const since = new Date(Date.now() - days * DAY);
      const rows = await ActivityLog.aggregate([
        { $match: { type: { $in: ['join', 'leave'] }, ts: { $gte: since } } },
        { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, t: '$type' }, n: { $sum: 1 } } }
      ]);
      const map = {};
      for (const r of rows) (map[r._id.d] ??= { join: 0, leave: 0 })[r._id.t] = r.n;
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
        out.push({ day: d, join: map[d]?.join ?? 0, leave: map[d]?.leave ?? 0 });
      }
      res.json({ days, guilds: client.guilds.cache.size, series: out });
    } catch (err) { fail(res, err); }
  });


  /* ══ Phase 3 ═══════════════════════════════════════════════════════════════ */

  /* ── Channel lists (message-channel picker, voice-channel picker) ───────── */
  app.get('/api/admin/guilds/:id/channels', requireMod, (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const me = guild.members.me;
    const all = [...guild.channels.cache.values()].sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));
    const base = c => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null });
    res.json({
      text: all.filter(isTextCh).slice(0, 200).map(c => ({ ...base(c),
        canSend: !!c.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) })),
      voice: all.filter(isVoiceCh).slice(0, 200).map(c => ({ ...base(c), members: c.members?.size ?? 0, stage: c.type === ChannelType.GuildStageVoice,
        canJoin: !!c.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]) }))
    });
  });

  /* ── Per-server settings: language + adhkar / verse-of-the-day ──────────── */
  app.post('/api/admin/guilds/:id/config', requireCap('config'), async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const b = req.body ?? {};
    const set = {};
    try {
      if (b.language !== undefined) {
        if (!['ar', 'en'].includes(b.language)) return res.status(400).json({ error: 'invalid language' });
        set.language = b.language;
      }
      const cfg = await GuildSettings.findOne({ guildId: guild.id }).lean();
      for (const [key, chKey, enKey] of [['adhkar', 'adhkarChannelId', 'adhkarEnabled'], ['ayah', 'ayahChannelId', 'ayahEnabled'], ['hadith', 'hadithChannelId', 'hadithEnabled']]) {
        let channelId = cfg?.[key]?.channelId ?? null;
        if (b[chKey] !== undefined) {
          if (b[chKey] === null) channelId = null;
          else {
            const ch = resolveSendChannel(guild, b[chKey]);
            if (!ch) return res.status(400).json({ error: `${chKey}: channel not found or the bot cannot write there` });
            channelId = ch.id;
          }
          set[`${key}.channelId`] = channelId;
        }
        if (b[enKey] !== undefined) {
          if (typeof b[enKey] !== 'boolean') return res.status(400).json({ error: `${enKey} must be true or false` });
          if (b[enKey] && !channelId) return res.status(400).json({ error: `${key}: pick a channel before turning it on` });
          set[`${key}.enabled`] = b[enKey];
        } else if (b[chKey] === null) set[`${key}.enabled`] = false;       // no channel → nothing to post to
      }
      if (!Object.keys(set).length) return res.status(400).json({ error: 'nothing to change' });
      await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: set }, { upsert: true });
      if (set.language) GuildSettings.invalidateLangCache(guild.id);
      pushActivity('admin', `تعديل إعدادات سيرفر: ${guild.name}`, Object.keys(set).join(' · '));
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  /* ── Remote voice: join / play ──────────────────────────────────────────── */
  const voiceError = (res, err) => {
    if (err?.code === 'CAPACITY') return res.status(503).json({ error: 'البوت وصل للحد الأقصى من الجلسات (MAX_SESSIONS)' });
    if (err?.name === 'UserError' || err?.userMessage) return res.status(409).json({ error: 'عملية انضمام أخرى جارية، حاول بعد لحظات' });
    return fail(res, err);
  };

  app.post('/api/admin/guilds/:id/join', requireCap('play'), async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const vc = resolveVoiceChannel(guild, req.body?.voiceChannelId);
    if (!vc) return res.status(400).json({ error: 'voice channel not found or the bot cannot join/speak there' });
    const live = getSession(guild.id);
    if (live) {
      if (live.voiceChannelId === vc.id) return res.status(409).json({ error: 'البوت موجود في هذه القناة بالفعل' });
      if (req.body?.replace !== true) return res.status(409).json({ error: 'البوت في قناة أخرى بهذا السيرفر — فعّل «نقل البوت» أو أوقف الجلسة أولاً' });
    }
    try {
      if (live) await destroySession(guild.id);                       // explicit move requested by the owner/moderator
      const lang = await GuildSettings.getLanguage(guild.id);
      await createAndJoin(guild, vc, req.session.user.id, lang, client);
      pushActivity('admin', `إدخال البوت لروم صوتي: ${guild.name}`, `#${vc.name}`);
      res.json({ ok: true, channel: vc.name });
    } catch (err) { voiceError(res, err); }
  });

  app.get('/api/admin/surahs', requireMod, (_req, res) => res.json(SURAHS.map(s => ({ number: s.number, arabic: s.arabic, english: s.english }))));

  app.get('/api/admin/reciters', requireMod, async (req, res) => {
    try {
      const q = String(req.query.q ?? '').slice(0, 60);
      const list = await searchReciters(q, 'ar');
      res.json(list.filter(r => r.moshaf?.length).map(r => ({
        name: r.displayName || r.name,
        riwayat: [...new Set(r.moshaf.map(m => m.name).filter(Boolean))].slice(0, 8)
      })));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/guilds/:id/play', requireCap('play'), async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const surah = getSurahByNumber(Number(req.body?.surah));
    if (!surah) return res.status(400).json({ error: 'surah must be a number 1-114' });
    const reciterQuery = textField(req.body?.reciter)?.slice(0, 80) ?? null;
    const riwaya       = textField(req.body?.riwaya)?.slice(0, 80)  ?? null;
    try {
      const reciterObj = reciterQuery ? await findReciter(reciterQuery) : await findDefaultReciter(req.session.user.id, guild.id);
      if (!reciterObj?.moshaf?.length) return res.status(404).json({ error: 'reciter not found or has no recitations' });
      if (riwaya) {
        const q = riwaya.toLowerCase();
        if (!reciterObj.moshaf.some(m => (m.name ?? '').toLowerCase().includes(q))) return res.status(400).json({ error: 'this riwaya is not available for the reciter' });
        reciterObj.moshaf = [...reciterObj.moshaf.filter(m => (m.name ?? '').toLowerCase().includes(q)), ...reciterObj.moshaf.filter(m => !(m.name ?? '').toLowerCase().includes(q))];
      }

      let session = getSession(guild.id);
      if (session && req.body?.voiceChannelId && req.body.voiceChannelId !== session.voiceChannelId) {
        // The bot sits in another channel: by default the surah joins THAT session's queue (nothing is hijacked).
        // With replace:true the person explicitly asked to MOVE it — the old session is stopped first.
        if (req.body?.replace !== true) return res.status(409).json({ error: 'البوت في قناة أخرى بهذا السيرفر — فعّل «نقل البوت» أو أوقف الجلسة أولاً' });
        const target = resolveVoiceChannel(guild, req.body.voiceChannelId);
        if (!target) return res.status(400).json({ error: 'voice channel not found or the bot cannot join/speak there' });
        await destroySession(guild.id);
        session = null;
      }
      if (!session) {
        const vc = resolveVoiceChannel(guild, req.body?.voiceChannelId);
        if (!vc) return res.status(400).json({ error: 'pick a voice channel the bot can join and speak in' });
        const lang = await GuildSettings.getLanguage(guild.id);
        session = await createAndJoin(guild, vc, req.session.user.id, lang, client);
      }

      const name = reciterObj.displayName || reciterObj.name;
      const item = { surah, reciter: name, reciterObj };
      let queued = false;
      if (session.status === 'idle' || !session.current) {
        enqueue(guild.id, item);
        await playNext(guild.id);
        if (!getSession(guild.id)?.current) return res.status(502).json({ error: 'لا يوجد صوت متاح لهذه السورة/القارئ حاليًا' });
      } else {
        if (!enqueue(guild.id, item)) return res.status(409).json({ error: `الطابور ممتلئ (الحد ${queueLimit(session)})` });
        queued = true;
      }
      pushActivity('admin', `تشغيل عن بعد: ${surah.arabic} — ${name}`, `${guild.name} · #${getSession(guild.id)?.channelName ?? ''}${queued ? ' (طابور)' : ''}`);
      res.json({ ok: true, queued, surah: surah.arabic, reciter: name });
    } catch (err) { voiceError(res, err); }
  });

  /* ── Restrictions (OWNER ONLY) ──────────────────────────────────────────── */
  app.get('/api/admin/guilds/:id/restrictions', requireAdmin, async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    try {
      const doc = await GuildSettings.findOne({ guildId: guild.id }, 'restrictions').lean();
      res.json({
        restrictions: normalizeRestrictions(doc?.restrictions),
        commands: [...client.commands.keys()].sort(),
        voiceCommands: VOICE_COMMANDS.filter(c => client.commands.has(c)),
        maxQueueGlobal: MAX_QUEUE
      });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/guilds/:id/lock', requireAdmin, async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const built = buildLockPatch(req.body?.locked, req.body?.minutes ?? null);
    if (built.error) return res.status(400).json({ error: built.error });
    try {
      await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: built.patch }, { upsert: true });
      invalidateRestrictions(guild.id);
      pushActivity('admin', `${req.body.locked ? 'قفل' : 'فتح'} سيرفر: ${guild.name}`,
        req.body.locked ? (built.until ? `حتى ${new Date(built.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'حتى إشعار آخر') : '');
      res.json({ ok: true, locked: req.body.locked, until: built.until });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/guilds/:id/restrictions', requireAdmin, async (req, res) => {
    const guild = guildOf(req.params.id);
    if (!guild) return res.status(404).json({ error: 'server not found' });
    const b = req.body ?? {};
    const known = new Set(client.commands.keys());
    if (b.disabledCommands !== undefined && (!Array.isArray(b.disabledCommands) || !b.disabledCommands.every(c => known.has(c)))) {
      return res.status(400).json({ error: 'disabledCommands must be a list of existing command names' });
    }
    if (b.maxQueue !== null && b.maxQueue !== undefined && !(Number.isInteger(b.maxQueue) && b.maxQueue >= 1 && b.maxQueue <= MAX_QUEUE)) {
      return res.status(400).json({ error: `maxQueue must be 1-${MAX_QUEUE} or null` });
    }
    if (b.locked !== undefined && typeof b.locked !== 'boolean') return res.status(400).json({ error: 'locked must be true or false' });
    try {
      // The lock's end time is managed by /lock; saving the other restrictions must not silently turn a timed lock into a permanent one.
      const before = normalizeRestrictions((await GuildSettings.findOne({ guildId: guild.id }, 'restrictions').lean())?.restrictions);
      const rs = normalizeRestrictions({ locked: b.locked ?? before.locked, lockedUntil: (b.locked ?? before.locked) ? before.lockedUntil : null,
        disabledCommands: [...new Set(b.disabledCommands ?? [])], maxQueue: b.maxQueue ?? null, note: textField(b.note) ?? '' });
      await GuildSettings.findOneAndUpdate({ guildId: guild.id }, { $set: { restrictions: rs } }, { upsert: true });
      invalidateRestrictions(guild.id);
      const live = getSession(guild.id); if (live) live.queueCap = rs.maxQueue;
      pushActivity('admin', `قيود سيرفر: ${guild.name}`,
        [isLocked(rs) ? 'مقفل' : null, rs.disabledCommands.length ? `${rs.disabledCommands.length} أمر معطّل` : null, rs.maxQueue ? `طابور ≤ ${rs.maxQueue}` : null].filter(Boolean).join(' · ') || 'بلا قيود');
      res.json({ ok: true, restrictions: rs });
    } catch (err) { fail(res, err); }
  });

  /* ── Presence status ────────────────────────────────────────────────────── */
  app.post('/api/admin/bot/status', requireAdmin, (req, res) => {
    const status = req.body?.status;
    if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    try {
      const activities = (client.user.presence?.activities ?? []).map(a => ({ name: a.name, type: a.type, ...(a.state ? { state: a.state } : {}) }));
      client.user.setPresence({ status, activities });
      pushActivity('admin', `حالة البوت: ${status}`, '');
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  return { getHistory: () => history };
}
