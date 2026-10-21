/**
 * Owner panel — phase 4: pure logic (no Discord / Mongo / Express here, so every rule is unit-tested).
 *
 *   evaluateAlerts()     system + fleet snapshot  → ordered list of alerts for the dashboard
 *   auditGuildHealth()   one server snapshot      → the problems that stop the bot from working there
 *   summarizeHealth()    many audited servers     → counts per level
 *   normalizeTags()      user input               → clean, unique, short tags
 *   validateSchedule()   run time                 → a Date or an error code
 *   scheduleDecision()   run time + now           → 'wait' | 'run' | 'missed'
 *   escapeRegex()        text                     → safe inside a Mongo $regex
 *   planAlertNotifications()  alerts + memory     → which critical alerts to DM the owner about now, and which have cleared
 */

export const LEVELS = ['critical', 'warn', 'info'];
const RANK = { critical: 0, warn: 1, info: 2 };

/* ══ Alerts ═════════════════════════════════════════════════════════════════ */

/**
 * @param {object} s snapshot — every field optional; a missing field never produces an alert.
 *   mongo:{state,pingMs}  ws:{status,ping}  lagMs  cpuPct  heapRatio  hostMemRatio  uptimeSec  maintenance
 *   errorsLastHour  health:{critical,warn,total}  scheduled:{overdue,failed7d,pending}  blacklistCount
 */
export function evaluateAlerts(s = {}) {
  const out = [];
  const add = (id, level, title, detail, page = null) => out.push({ id, level, title, detail, page });

  if (s.mongo) {
    if (s.mongo.state && s.mongo.state !== 'connected') add('mongo-down', 'critical', 'قاعدة البيانات غير متصلة', `الحالة: ${s.mongo.state}. الإعدادات والإحصائيات لن تُحفظ.`, 'system');
    else if (s.mongo.pingMs === null || s.mongo.pingMs === undefined) add('mongo-silent', 'warn', 'قاعدة البيانات لا تستجيب لأمر ping', 'الاتصال قائم لكن الرد تأخر أكثر من ٣ ثوانٍ.', 'system');
    else if (s.mongo.pingMs > 500) add('mongo-slow', 'warn', 'قاعدة البيانات بطيئة', `زمن الاستجابة ${s.mongo.pingMs}ms.`, 'system');
  }
  if (s.ws) {
    if (typeof s.ws.status === 'number' && s.ws.status !== 0) add('ws-down', 'critical', 'اتصال Discord غير جاهز', `WS status = ${s.ws.status}.`, 'system');
    else if (s.ws.ping > 800) add('ws-ping-high', 'critical', 'Discord ping مرتفع جدًا', `${s.ws.ping}ms — قد تتقطع التلاوات.`, 'system');
    else if (s.ws.ping > 300) add('ws-ping', 'warn', 'Discord ping مرتفع', `${s.ws.ping}ms.`, 'system');
  }
  if (s.lagMs > 250) add('loop-lag-high', 'critical', 'البوت متأخر في المعالجة', `تأخر الحلقة ${s.lagMs}ms — الصوت قد يتقطع.`, 'system');
  else if (s.lagMs > 100) add('loop-lag', 'warn', 'تأخر في حلقة الأحداث', `${s.lagMs}ms (p99).`, 'system');

  if (s.heapRatio > 0.9) add('heap-high', 'critical', 'ذاكرة البوت شبه ممتلئة', `${Math.round(s.heapRatio * 100)}% من الـ heap — خطر إعادة تشغيل مفاجئة.`, 'system');
  else if (s.heapRatio > 0.75) add('heap', 'warn', 'ذاكرة البوت مرتفعة', `${Math.round(s.heapRatio * 100)}% من الـ heap.`, 'system');
  if (s.hostMemRatio > 0.92) add('host-mem', 'warn', 'ذاكرة الجهاز شبه ممتلئة', `${Math.round(s.hostMemRatio * 100)}% مستخدمة.`, 'system');
  if (s.cpuPct > 90) add('cpu', 'warn', 'المعالج مشغول', `${s.cpuPct}% من نواة واحدة.`, 'system');

  if (s.errorsLastHour >= 50) add('errors-many', 'critical', 'أخطاء كثيرة في السجل', `${s.errorsLastHour} خطأ خلال آخر ساعة.`, 'logs');
  else if (s.errorsLastHour >= 10) add('errors', 'warn', 'أخطاء في السجل', `${s.errorsLastHour} خطأ خلال آخر ساعة.`, 'logs');

  if (s.health?.critical > 0) add('guild-critical', 'critical', 'سيرفرات بمشاكل حرجة', `${s.health.critical} سيرفر من ${s.health.total} لا تعمل فيه ميزة أساسية.`, 'health');
  if (s.health?.warn > 0) add('guild-warn', 'warn', 'سيرفرات تحتاج انتباهًا', `${s.health.warn} سيرفر فيه مشكلة قابلة للإصلاح.`, 'health');

  if (s.scheduled?.overdue > 0) add('sched-overdue', 'warn', 'إعلان مجدول تأخر موعده', `${s.scheduled.overdue} إعلان لم يُرسل بعد رغم حلول موعده.`, 'broadcast');
  if (s.scheduled?.failed7d > 0) add('sched-failed', 'warn', 'إعلانات مجدولة لم تُرسل', `${s.scheduled.failed7d} إعلان فاته موعده أو فشل خلال ٧ أيام.`, 'broadcast');
  if (s.scheduled?.pending > 0) add('sched-pending', 'info', 'إعلانات مجدولة قادمة', `${s.scheduled.pending} إعلان بانتظار موعده.`, 'broadcast');

  if (s.maintenance) add('maintenance', 'info', 'وضع الصيانة مفعّل', 'المستخدمون لا يستطيعون استعمال أوامر البوت الآن.', 'control');
  if (typeof s.uptimeSec === 'number' && s.uptimeSec < 300) add('fresh-restart', 'info', 'البوت أُعيد تشغيله للتو', `منذ ${Math.max(1, Math.round(s.uptimeSec / 60))} دقيقة.`, 'system');

  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/* ══ Per-server health ══════════════════════════════════════════════════════ */

/**
 * @param {object} g plain snapshot of one server:
 *   id, name, memberCount, hasMe (bot member present), announceChannel (bool: a channel the bot can post to exists),
 *   adhkar / ayah / hadith: { enabled, channelId, channel: 'ok' | 'missing' | 'noperm' | 'none' },
 *   voiceTotal, voiceJoinable, locked
 * @returns {{ level: 'critical'|'warn'|'ok', issues: {code, level, label}[] }}
 */
export function auditGuildHealth(g) {
  const issues = [];
  const add = (code, level, label) => issues.push({ code, level, label });

  if (!g.hasMe) add('no_member', 'critical', 'البوت غير ظاهر كعضو في السيرفر');

  for (const [key, ar] of [['adhkar', 'الأذكار'], ['ayah', 'آية اليوم'], ['hadith', 'حديث اليوم']]) {
    const f = g[key];
    if (!f?.enabled) continue;
    if (f.channel === 'missing' || f.channel === 'none') add(`${key}_channel_lost`, 'critical', `${ar}: القناة محذوفة أو غير محددة`);
    else if (f.channel === 'noperm') add(`${key}_no_permission`, 'critical', `${ar}: لا صلاحية للنشر في القناة`);
  }

  if (!g.announceChannel) add('no_announce_channel', 'warn', 'لا توجد قناة يستطيع البوت الكتابة فيها (الإعلانات لن تصل)');

  if (g.voiceTotal > 0 && g.voiceJoinable === 0) add('no_voice_access', 'warn', 'لا توجد قناة صوتية يستطيع البوت دخولها والتحدث فيها');
  else if (g.voiceTotal === 0) add('no_voice_channels', 'warn', 'السيرفر بلا قنوات صوتية');

  if (g.locked) add('locked', 'warn', 'السيرفر مقفل (وضع القراءة فقط) من لوحة المالك');

  const level = issues.some(i => i.level === 'critical') ? 'critical' : issues.length ? 'warn' : 'ok';
  return { level, issues };
}

export function summarizeHealth(rows) {
  const out = { total: rows.length, critical: 0, warn: 0, ok: 0 };
  for (const r of rows) out[r.level] = (out[r.level] ?? 0) + 1;
  return out;
}

/* ══ Notes / tags ═══════════════════════════════════════════════════════════ */

export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 20;

/** Trim, collapse spaces, drop empties and duplicates (case-insensitive), cap length and count. Non-strings are ignored. */
export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,،\n]/) : [];
  const seen = new Set(), out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.replace(/\s+/g, ' ').trim().replace(/^#+/, '').slice(0, MAX_TAG_LEN).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/* ══ Scheduled broadcasts ═══════════════════════════════════════════════════ */

export const MIN_LEAD_MS = 60_000;                 // at least a minute ahead
export const MAX_LEAD_MS = 90 * 86_400_000;        // at most 90 days ahead
export const MISSED_AFTER_MS = 30 * 60_000;        // a bot that was off for longer than this does not send a stale announcement
export const MAX_PENDING = 20;

/** @returns {{ ok: true, date: Date } | { ok: false, error: string }} */
export function validateSchedule(value, now = Date.now()) {
  if (typeof value !== 'string' && typeof value !== 'number') return { ok: false, error: 'runAt مطلوب' };
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return { ok: false, error: 'تاريخ غير صالح' };
  if (t < now + MIN_LEAD_MS) return { ok: false, error: 'الموعد يجب أن يكون بعد دقيقة على الأقل من الآن' };
  if (t > now + MAX_LEAD_MS) return { ok: false, error: 'الحد الأقصى للجدولة ٩٠ يومًا' };
  return { ok: true, date: new Date(t) };
}

/** 'wait' (not yet) · 'run' (due) · 'missed' (due long ago — e.g. the bot was offline). */
export function scheduleDecision(runAt, now = Date.now()) {
  const t = new Date(runAt).getTime();
  if (!Number.isFinite(t)) return 'missed';
  if (t > now) return 'wait';
  return now - t > MISSED_AFTER_MS ? 'missed' : 'run';
}

/* ══ Owner DM alerts ════════════════════════════════════════════════════════ */

export const ALERT_CONFIRM_TICKS = 2;                 // an alert must be seen on this many consecutive checks (1 check ≈ 1 min) → no DM for a blip
export const ALERT_RENOTIFY_MS = 6 * 3_600_000;       // still critical after this long → remind once more
export const ALERT_NOTIFY_EXCLUDE = new Set(['guild-critical']);   // per-server problems: the server's own owner is told weekly, and they can last for days

/**
 * Decide what to send. `state` is a Map kept by the caller between checks (mutated here):
 *   id → { seen: consecutive checks, notifiedAt: ms | null, title }
 * Only CRITICAL alerts qualify (minus ALERT_NOTIFY_EXCLUDE). Returns
 *   fire     — alerts to announce now (confirmed on ≥ ALERT_CONFIRM_TICKS checks, never announced or last announced ≥ ALERT_RENOTIFY_MS ago)
 *   resolved — alerts that were announced and are no longer critical (so the owner learns it recovered)
 */
export function planAlertNotifications(alerts, state, now = Date.now()) {
  const current = new Map();
  for (const a of alerts ?? []) if (a?.level === 'critical' && a.id && !ALERT_NOTIFY_EXCLUDE.has(a.id)) current.set(a.id, a);

  const fire = [], resolved = [];
  for (const [id, a] of current) {
    const e = state.get(id) ?? { seen: 0, notifiedAt: null, title: a.title };
    e.seen++; e.title = a.title;
    if (e.seen >= ALERT_CONFIRM_TICKS && (e.notifiedAt === null || now - e.notifiedAt >= ALERT_RENOTIFY_MS)) { fire.push(a); e.notifiedAt = now; }
    state.set(id, e);
  }
  for (const [id, e] of [...state]) {
    if (current.has(id)) continue;
    if (e.notifiedAt !== null) resolved.push({ id, title: e.title });
    state.delete(id);
  }
  return { fire, resolved };
}

/* ══ Misc ═══════════════════════════════════════════════════════════════════ */

export const escapeRegex = s => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Query-string value as a bounded, trimmed string ('' when absent / not a string — arrays and objects are rejected). */
export const qs = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
