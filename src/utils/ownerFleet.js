/**
 * Owner panel — phase 5: pure logic (no Discord / Mongo / Express, so every rule is unit-tested).
 *
 *   Fleet & /pull      summarizeFleet · summarizeJobs · summarizePulls · normalizePullEntry
 *   Content            wirdState · eventStatus · pageParams
 *   Security           sessionRef · parseSessionDoc · securityChecklist · exportFileName · EXPORT_SETS
 */
import crypto from 'crypto';

export const SNOWFLAKE = /^\d{15,25}$/;
export const OBJECT_ID = /^[a-f0-9]{24}$/i;
export const ALIVE_MS = 90_000;           // same liveness rule as services/siblingService.js
export const DAY = 86_400_000;

/** Whole number inside [min, max], otherwise the default. */
export const intIn = (v, min, max, dflt) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : dflt; };

/** ?page=&limit= from a query string (strings), bounded. → { page, limit, skip } */
export function pageParams(q = {}, { def = 25, max = 100 } = {}) {
  const limit = intIn(q.limit, 1, max, def);
  const page = intIn(q.page, 1, 100_000, 1);
  return { page, limit, skip: (page - 1) * limit };
}

/** Free text from a query string: a string, trimmed, bounded; anything else (arrays, objects) is dropped. */
export const textParam = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/* ══ Fleet ══════════════════════════════════════════════════════════════════ */

/**
 * The bots of this database as the dashboard shows them.
 * @param {Array} instances BotInstance documents (lean)
 * @param {{ now?: number, selfId?: string, aliveMs?: number }} o
 */
export function summarizeFleet(instances, { now = Date.now(), selfId = null, aliveMs = ALIVE_MS } = {}) {
  const rows = (instances ?? []).map((d) => {
    const seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    const sessions = Array.isArray(d.sessions) ? d.sessions : [];
    return {
      id: String(d._id), tag: d.tag || String(d._id), role: d.role === 'secondary' ? 'secondary' : 'primary',
      self: selfId !== null && String(d._id) === String(selfId),
      alive: seen > 0 && now - seen <= aliveMs,
      lastSeenAgoSec: seen ? Math.max(0, Math.round((now - seen) / 1000)) : null,
      guilds: Array.isArray(d.guildIds) ? d.guildIds.length : 0,
      sessions: sessions.length,
      sessionList: sessions.map(s => ({
        guildId: s.guildId, channelId: s.channelId, channelName: s.channelName ?? '', status: s.status ?? 'idle',
        surah: s.surahAr ?? s.surah ?? null, reciter: s.reciter ?? null, queueSize: s.queueSize ?? 0
      }))
    };
  }).sort((a, b) => (b.self - a.self) || (b.alive - a.alive) || a.tag.localeCompare(b.tag));
  const alive = rows.filter(r => r.alive);
  return {
    rows,
    totals: {
      bots: rows.length, alive: alive.length, offline: rows.length - alive.length,
      workers: alive.filter(r => r.role === 'secondary').length,
      sessions: alive.reduce((n, r) => n + r.sessions, 0),
      freeWorkers: alive.filter(r => r.role === 'secondary' && r.sessions === 0).length
    }
  };
}

const KINDS = ['join', 'recite', 'live', 'move', 'resume'];
const STATUSES = ['pending', 'claimed', 'done', 'failed', 'cancelled'];
export const STUCK_PENDING_MS = 60_000;     // nobody picked it up within a minute: the worker is probably down
export const STUCK_CLAIMED_MS = 180_000;    // taken but never answered: the worker probably crashed in the middle

/** Counts, durations and the jobs that look stuck. @param {Array} jobs PlayerJob documents (lean) */
export function summarizeJobs(jobs, now = Date.now()) {
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
  const byKind = Object.fromEntries(KINDS.map(k => [k, 0]));
  const errors = {};
  const durations = [];
  const stuck = [];
  for (const j of jobs ?? []) {
    if (j.status in byStatus) byStatus[j.status]++;
    const kind = j.intent?.kind;
    if (kind in byKind) byKind[kind]++;
    const created = j.createdAt ? new Date(j.createdAt).getTime() : null;
    if (j.status === 'done' && created && j.finishedAt) durations.push(Math.max(0, new Date(j.finishedAt).getTime() - created));
    if (j.status === 'failed') { const k = j.error?.key ?? j.error?.code ?? 'unknown'; errors[k] = (errors[k] ?? 0) + 1; }
    if (created) {
      if (j.status === 'pending' && now - created > STUCK_PENDING_MS) stuck.push(String(j._id));
      if (j.status === 'claimed') {
        const claimed = j.claimedAt ? new Date(j.claimedAt).getTime() : created;
        if (now - claimed > STUCK_CLAIMED_MS) stuck.push(String(j._id));
      }
    }
  }
  const finished = byStatus.done + byStatus.failed;
  durations.sort((a, b) => a - b);
  const pick = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] : null);
  return {
    total: (jobs ?? []).length, byStatus, byKind, errors,
    failRate: finished ? Math.round((byStatus.failed / finished) * 1000) / 10 : null,
    avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p95Ms: pick(0.95),
    stuck
  };
}

/* ── /pull log ── */
export const PULL_KINDS = ['move', 'clone'];

/** A pull outcome as stored (bounded, known fields only). → entry | null */
export function normalizePullEntry(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = (v) => (SNOWFLAKE.test(String(v ?? '')) ? String(v) : null);
  const guildId = id(raw.guildId);
  if (!guildId) return null;
  const ok = raw.ok === true;
  return {
    guildId, userId: id(raw.userId),
    ok,
    kind: PULL_KINDS.includes(raw.kind) ? raw.kind : null,
    key: ok ? null : String(raw.key ?? 'unknown').replace(/[^a-z0-9_.-]/gi, '').slice(0, 60) || 'unknown',
    botId: id(raw.botId), fromBotId: id(raw.fromBotId),
    ms: intIn(Math.round(Number(raw.ms)), 0, 600_000, null),
    at: new Date(now)
  };
}

/** Totals for the dashboard. @param {Array} rows PullLog documents (lean) */
export function summarizePulls(rows, now = Date.now(), days = 7) {
  const list = rows ?? [];
  const ok = list.filter(r => r.ok);
  const byKind = { move: 0, clone: 0 };
  const byKey = {};
  const perDay = Array.from({ length: days }, (_, i) => ({ day: new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10), ok: 0, failed: 0 }));
  const times = [];
  for (const r of list) {
    if (r.ok && r.kind in byKind) byKind[r.kind]++;
    if (!r.ok) byKey[r.key ?? 'unknown'] = (byKey[r.key ?? 'unknown'] ?? 0) + 1;
    if (Number.isFinite(r.ms) && r.ok) times.push(r.ms);
    const d = new Date(r.at ?? 0).toISOString().slice(0, 10);
    const slot = perDay.find(p => p.day === d);
    if (slot) r.ok ? slot.ok++ : slot.failed++;
  }
  return {
    total: list.length, ok: ok.length, failed: list.length - ok.length,
    rate: list.length ? Math.round((ok.length / list.length) * 1000) / 10 : null,
    byKind,
    topFailures: Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count })),
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    perDay
  };
}

/** The reciters without the ones the owner hid (same objects, original order). */
export function visibleReciters(list, hiddenIds) {
  if (!Array.isArray(hiddenIds) || !hiddenIds.length) return list;
  const hidden = new Set(hiddenIds.map(String));
  return list.filter(r => !hidden.has(String(r.id)));
}

/** Add or remove one id from the hidden list (bounded, de-duplicated, only ids the API could have produced). → new list | null when the id is invalid */
export function toggleHidden(current, id, hide, max = 500) {
  const sid = String(id ?? '');
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(sid)) return null;
  const set = new Set((current ?? []).map(String));
  if (hide) { if (set.size >= max && !set.has(sid)) return null; set.add(sid); } else set.delete(sid);
  return [...set];
}

/* ══ Content ════════════════════════════════════════════════════════════════ */

export const WIRD_FAIL_LIMIT = 5;      // same value as services/wirdService.js (MAX_FAILS)

/** What state a wird subscription is in right now. */
export function wirdState(sub, now = Date.now()) {
  const exp = sub?.expiresAt ? new Date(sub.expiresAt).getTime() : 0;
  if (!sub?.active) return (sub?.failCount ?? 0) >= WIRD_FAIL_LIMIT ? 'failing' : 'paused';
  if (exp && exp <= now) return 'expired';
  if (exp && exp - now <= 7 * DAY) return 'expiring';
  return 'active';
}

/** Status of a religious event on a guild-local date (YYYY-MM-DD strings compare correctly as text). */
export function eventStatus(ev, today) {
  if (!ev?.enabled) return 'disabled';
  if (today > ev.endDate) return 'finished';
  if (today < ev.startDate) return 'upcoming';
  return 'active';
}

/* ══ Security ═══════════════════════════════════════════════════════════════ */

/** A short, one-way reference for a session id: enough to point at it in the dashboard, useless as a cookie. */
export const sessionRef = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex').slice(0, 16);

const cut = (v, n) => String(v ?? '').replace(/\p{Cc}/gu, '?').slice(0, n);

/**
 * One document of the session store → what the dashboard may show, or null when it is not a signed-in dashboard session.
 * The session id itself never leaves the server. `session` may be a JSON string (connect-mongo default) or an object.
 */
export function parseSessionDoc(doc, { now = Date.now(), roleOf = () => null } = {}) {
  if (!doc || typeof doc._id !== 'string') return null;
  let s = doc.session;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return null; } }
  const u = s?.user;
  if (!u || typeof u.id !== 'string' || !SNOWFLAKE.test(u.id)) return null;
  const expires = doc.expires ? new Date(doc.expires).getTime() : null;
  if (expires && expires <= now) return null;                       // already expired, the store just has not purged it yet
  return {
    ref: sessionRef(doc._id),
    userId: u.id, username: cut(u.username, 40), avatar: typeof u.avatar === 'string' && u.avatar.startsWith('https://cdn.discordapp.com/') ? u.avatar : null,
    role: roleOf(u.id),                                              // null = no longer listed in ADMIN_IDS / MOD_IDS: the session is dead already
    signedInAt: typeof u.at === 'number' ? u.at : null,
    ip: u.ip ? cut(u.ip, 45) : null, ua: u.ua ? cut(u.ua, 160) : null,
    expiresAt: expires
  };
}

/**
 * Honest checklist of the settings that matter for a dashboard that can restart the bot. Every item is derived from a value we know.
 * @param {object} i { apiBaseHttps, trustProxy, host, sessionDays, absoluteDays, adminCount, modCount, secretLength, modCapsOn, modCapsTotal, sameOrigin }
 * @returns {Array<{id, level:'ok'|'warn'|'critical', title, detail}>}
 */
export function securityChecklist(i = {}) {
  const out = [];
  const add = (id, level, title, detail) => out.push({ id, level, title, detail });
  if (i.apiBaseHttps) add('https', 'ok', 'العنوان العام يعمل بـ HTTPS', 'ملف تعريف الجلسة محمي (Secure + __Host-).');
  else add('https', 'critical', 'العنوان العام ليس HTTPS', 'ملف الجلسة يُرسل Secure فقط، فلن يعمل الدخول خلف http، وأي وسيط يرى الجلسة.');
  if (i.secretLength >= 32) add('secret', 'ok', 'مفتاح الجلسة قوي', `${i.secretLength} حرفاً.`);
  else add('secret', 'critical', 'مفتاح الجلسة (SESSION_SECRET) قصير', `${i.secretLength ?? 0} حرفاً — يجب ٣٢ على الأقل.`);
  if (i.trustProxy > 0 && !i.apiBaseHttps) add('proxy', 'warn', 'TRUST_PROXY مفعّل مع عنوان غير HTTPS', 'إن كان المنفذ مكشوفاً بلا وكيل عكسي يستطيع أي عميل تزوير X-Forwarded-For وتجاوز حدّ الطلبات.');
  else add('proxy', 'ok', 'إعداد الوكيل (TRUST_PROXY) متسق', `القيمة ${i.trustProxy ?? 0}.`);
  if (i.adminCount === 0) add('admins', 'critical', 'لا يوجد أي مالك في ADMIN_IDS', 'لن يستطيع أحد دخول اللوحة.');
  else if (i.adminCount > 3) add('admins', 'warn', `عدد الملّاك ${i.adminCount}`, 'كل مالك يستطيع إعادة تشغيل البوت وإخراجه من السيرفرات. أبقِ العدد في أضيق نطاق.');
  else add('admins', 'ok', `عدد الملّاك ${i.adminCount}`, 'ضمن الحد المعقول.');
  if (i.modCount > 0 && i.modCapsOn === i.modCapsTotal) add('mods', 'warn', 'المشرفون يملكون كل الصلاحيات', 'يمكنك إيقاف ما لا يحتاجونه من «مركز التحكم» (إرسال رسائل، تشغيل عن بعد…).');
  else add('mods', 'ok', i.modCount ? `المشرفون: ${i.modCount} (${i.modCapsOn}/${i.modCapsTotal} صلاحية)` : 'لا يوجد مشرفون', 'صلاحيات المشرفين محدودة.');
  if (i.sessionDays > 7) add('lifetime', 'warn', `مدة الجلسة ${i.sessionDays} أيام`, `الجلسة المسروقة تبقى صالحة أطول (الحد المطلق ${i.absoluteDays} أيام).`);
  else add('lifetime', 'ok', `مدة الجلسة ${i.sessionDays} يوم`, `مع حد مطلق ${i.absoluteDays} أيام لا يتجدد.`);
  return out;
}

/** Collections the owner may export. Personal data of members (wird progress, favourites, DMs) is deliberately NOT here. */
export const EXPORT_SETS = Object.freeze({
  settings:   'إعدادات السيرفرات',
  stations:   'محطات الراديو المخصصة',
  blacklist:  'القائمة السوداء',
  control:    'إعدادات التحكم العامة',
  notes:      'ملاحظات الأونر والوسوم',
  events:     'الفعاليات الدينية',
  broadcasts: 'سجل الإعلانات'
});
export const EXPORT_MAX_DOCS = 100_000;

/** A file name the browser may safely save: ascii letters, digits, dash, dot only. */
export const exportFileName = (set, now = Date.now()) =>
  `quran-bot-${String(set).replace(/[^a-z]/g, '').slice(0, 20) || 'export'}-${new Date(now).toISOString().slice(0, 10)}.json`;

/* ── Second bot coverage ── */

/**
 * Which of the main bot's servers have a voice-only second bot, and which do not (so the owner can see where /pull and the hand-over
 * have nobody to hand to). Pure. `secondaries` = BotInstance docs with role 'secondary'; `guilds` = [{ id, name, members }].
 * @returns {{ bots, guildsTotal, covered, coveredAlive, missing }}  `missing` is sorted by member count, newest-biggest first, capped
 */
export function secondCoverage(secondaries, guilds, { now = Date.now(), aliveMs = ALIVE_MS, limit = 40 } = {}) {
  const bots = (secondaries ?? []).map(d => {
    const seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    return { id: String(d._id), tag: d.tag || String(d._id), alive: seen > 0 && now - seen <= aliveMs, guilds: Array.isArray(d.guildIds) ? d.guildIds.length : 0,
      lastSeenAgoSec: seen ? Math.max(0, Math.round((now - seen) / 1000)) : null, guildIds: Array.isArray(d.guildIds) ? d.guildIds : [] };
  });
  const any = new Set(bots.flatMap(b => b.guildIds));
  const live = new Set(bots.filter(b => b.alive).flatMap(b => b.guildIds));
  const list = guilds ?? [];
  const missing = list.filter(g => !any.has(g.id)).sort((a, b) => (b.members ?? 0) - (a.members ?? 0)).slice(0, limit);
  return {
    bots: bots.map(({ guildIds, ...b }) => b),
    guildsTotal: list.length,
    covered: list.filter(g => any.has(g.id)).length,
    coveredAlive: list.filter(g => live.has(g.id)).length,
    missing
  };
}
