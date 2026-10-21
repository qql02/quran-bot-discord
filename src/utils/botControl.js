/**
 * Global controls set by the owner from the dashboard — the PURE logic (no database, easy to test).
 *
 *   disabledCommands  slash commands refused in EVERY server (owners are exempt)
 *   disabledFeatures  whole features switched off everywhere (see FEATURES): commands + buttons + scheduled posts
 *   maxQueue          one queue limit for every server (never above the global MAX_QUEUE; a server's own limit can only be shorter)
 *   locked/lockedUntil  every server becomes "read-only" (same rules as a per-server lock), optionally for N minutes
 *   note              short text shown to people who hit a disabled command / feature / lock
 *   modCaps           what a moderator (MOD_IDS) may do — the owner switches each one on/off from the dashboard
 */
import { VOICE_COMMANDS, LOCKED_ALLOW, LOCKED_ALLOW_PREFIX, MAX_LOCK_MINUTES, isLocked } from './restrictionRules.js';

/** key → what it switches off. `commands` / `prefixes` (button & modal ids) are refused; `jobs` are background posters. */
export const FEATURES = {
  voice:  { label: 'الصوت والتلاوة', desc: 'أمر /start وأزرار اللوحة الصوتية وأدواتها والطابور ومحطات الراديو (لا يدخل البوت قنوات صوتية جديدة)',
            commands: [...VOICE_COMMANDS], prefixes: ['panel:', 'queue:', 'stations:'] },
  mushaf: { label: 'المصحف', desc: 'أمر /mushaf وقارئ المصحف وأزرار تقليب الصفحات', commands: ['mushaf'], prefixes: ['mushaf:'] },
  wird:   { label: 'الورد اليومي', desc: 'الورد وأزراره والتذكيرات المجدولة', commands: [], prefixes: ['wird:', 'hub:wird:'], jobs: ['wird'] },
  adhkar: { label: 'الأذكار', desc: 'أمر /azkar وصفحة الأذكار في /setup والنشر التلقائي للأذكار', commands: ['azkar'], prefixes: ['adhkar:', 'azkar:'], jobs: ['adhkar'] },
  journey: { label: 'الرحلات القرآنية', desc: 'أمر /journey ورحلات الآيات والتفسير والوقفات', commands: ['journey'], prefixes: ['journey:'] },
  ayah:   { label: 'آية اليوم', desc: 'النشر التلقائي لآية اليوم', commands: [], prefixes: ['adhkar:ayah:', 'adhkar:ayah-', 'adhkar:view:ayah'], jobs: ['ayah'] },
  hadith: { label: 'الحديث', desc: 'أمر /hadith والنشر التلقائي لحديث اليوم', commands: ['hadith'], prefixes: ['hadith:', 'adhkar:hadith:', 'adhkar:hadith-', 'adhkar:view:hadith'], jobs: ['hadith'] },
  events: { label: 'الفعاليات الدينية', desc: 'صفحة الفعاليات في /setup والنشر المجدول', commands: [], prefixes: ['events:'], jobs: ['events'] },
  setup:  { label: 'الإعداد التلقائي', desc: 'إنشاء الرومات تلقائياً من لوحة /setup', commands: [], prefixes: ['setup:'] },
  welcome: { label: 'رسالة الترحيب', desc: 'الرسالة التي يرسلها البوت عند دخول سيرفر جديد', commands: [], prefixes: [], jobs: ['welcome'] }
};
export const FEATURE_KEYS = Object.keys(FEATURES);

/** What a moderator can be allowed to do. Viewing the dashboard is always allowed (it is what a moderator IS). */
export const MOD_CAPS = {
  control:  'تحكم بالتشغيل (إيقاف مؤقت / التالي / التكرار / الصوت)',
  queue:    'التحكم بطابور أي سيرفر (حذف / ترتيب / مسح)',
  play:     'إدخال البوت وتشغيل سور عن بعد',
  stop:     'إيقاف جلسة سيرفر',
  message:  'إرسال رسالة لسيرفر',
  config:   'تعديل إعدادات سيرفر (اللغة، الأذكار، آية اليوم، حديث اليوم)',
  audit:    'عرض سجل النشاط الكامل'
};
export const MOD_CAP_KEYS = Object.keys(MOD_CAPS);
/** Default = what moderators could always do before this setting existed, so upgrading changes nothing. */
export const DEFAULT_MOD_CAPS = Object.fromEntries(MOD_CAP_KEYS.map(k => [k, true]));

const toMs = (v) => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) && t > 0 ? t : null;
};

export function normalizeControl(r) {
  const caps = { ...DEFAULT_MOD_CAPS };
  for (const k of MOD_CAP_KEYS) if (typeof r?.modCaps?.[k] === 'boolean') caps[k] = r.modCaps[k];
  return {
    disabledCommands: [...new Set(Array.isArray(r?.disabledCommands) ? r.disabledCommands.filter(x => typeof x === 'string' && /^[a-z0-9_-]{1,32}$/.test(x)) : [])].slice(0, 80),
    disabledFeatures: [...new Set(Array.isArray(r?.disabledFeatures) ? r.disabledFeatures.filter(x => FEATURE_KEYS.includes(x)) : [])],
    maxQueue: Number.isInteger(r?.maxQueue) && r.maxQueue >= 1 ? r.maxQueue : null,
    hiddenReciters: [...new Set(Array.isArray(r?.hiddenReciters) ? r.hiddenReciters.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(x)) : [])].slice(0, 500),
    locked: !!r?.locked,
    lockedUntil: toMs(r?.lockedUntil),
    note: typeof r?.note === 'string' ? r.note.slice(0, 200) : '',
    modCaps: caps
  };
}

export const isFeatureOn = (ctl, key) => !ctl?.disabledFeatures?.includes(key);
export const modCan = (ctl, cap) => (ctl?.modCaps?.[cap] ?? DEFAULT_MOD_CAPS[cap]) === true;

/** Is the global lock in force right now? */
export const isGloballyLocked = (ctl, now = Date.now()) => isLocked({ locked: ctl?.locked, lockedUntil: ctl?.lockedUntil }, now);

/**
 * Why (if at all) the global controls refuse this interaction.
 * @returns {null | 'global-locked' | 'global-command' | 'global-feature'}
 */
export function globalBlockedBy(ctl, { kind, name = '', customId = '', now = Date.now() }) {
  if (!ctl) return null;
  const isCmd = kind === 'command' || kind === 'autocomplete';
  if (isCmd && ctl.disabledCommands.includes(name)) return 'global-command';
  for (const key of ctl.disabledFeatures) {
    const f = FEATURES[key];
    if (!f) continue;
    if (isCmd && f.commands.includes(name)) return 'global-feature';
    if (kind === 'component' && f.prefixes.some(p => customId.startsWith(p))) return 'global-feature';
  }
  if (isGloballyLocked(ctl, now)) {
    if (isCmd && !LOCKED_ALLOW.has(name)) return 'global-locked';
    if (kind === 'component' && !LOCKED_ALLOW_PREFIX.some(p => customId.startsWith(p))) return 'global-locked';
  }
  return null;
}

/**
 * Validate a partial update from the dashboard. Nothing unknown gets through.
 * @returns {{ error: string } | { patch: object }}  patch uses the stored field names
 */
export function buildControlPatch(body, { knownCommands, maxQueueGlobal, now = Date.now() }) {
  const b = body ?? {};
  const patch = {};
  if (b.disabledCommands !== undefined) {
    if (!Array.isArray(b.disabledCommands) || !b.disabledCommands.every(c => knownCommands.has(c))) return { error: 'disabledCommands must be a list of existing command names' };
    patch.disabledCommands = [...new Set(b.disabledCommands)];
  }
  if (b.disabledFeatures !== undefined) {
    if (!Array.isArray(b.disabledFeatures) || !b.disabledFeatures.every(f => FEATURE_KEYS.includes(f))) return { error: 'disabledFeatures must be a list of known feature keys' };
    patch.disabledFeatures = [...new Set(b.disabledFeatures)];
  }
  if (b.maxQueue !== undefined) {
    if (b.maxQueue !== null && !(Number.isInteger(b.maxQueue) && b.maxQueue >= 1 && b.maxQueue <= maxQueueGlobal)) return { error: `maxQueue must be 1-${maxQueueGlobal} or null` };
    patch.maxQueue = b.maxQueue;
  }
  if (b.note !== undefined) {
    if (b.note !== null && typeof b.note !== 'string') return { error: 'note must be text' };
    patch.note = (b.note ?? '').trim().slice(0, 200);
  }
  if (b.locked !== undefined) {
    if (typeof b.locked !== 'boolean') return { error: 'locked must be true or false' };
    const m = b.minutes ?? null;
    if (b.locked && m !== null && !(Number.isInteger(m) && m >= 1 && m <= MAX_LOCK_MINUTES)) return { error: `minutes must be a whole number 1-${MAX_LOCK_MINUTES} or empty` };
    patch.locked = b.locked;
    patch.lockedUntil = b.locked && m !== null ? new Date(now + m * 60_000) : null;
  }
  if (b.modCaps !== undefined) {
    if (!b.modCaps || typeof b.modCaps !== 'object' || Array.isArray(b.modCaps)) return { error: 'modCaps must be an object' };
    const out = {};
    for (const [k, v] of Object.entries(b.modCaps)) {
      if (!MOD_CAP_KEYS.includes(k) || typeof v !== 'boolean') return { error: `modCaps.${k}: unknown capability or not true/false` };
      out[k] = v;
    }
    patch.modCaps = out;
  }
  if (!Object.keys(patch).length) return { error: 'nothing to change' };
  return { patch };
}

/** Human line for the audit log. */
export function describePatch(patch) {
  const parts = [];
  if (patch.disabledCommands) parts.push(`${patch.disabledCommands.length} أمر معطّل`);
  if (patch.disabledFeatures) parts.push(`${patch.disabledFeatures.length} ميزة معطّلة`);
  if (patch.maxQueue !== undefined) parts.push(patch.maxQueue ? `طابور ≤ ${patch.maxQueue}` : 'طابور افتراضي');
  if (patch.locked !== undefined) parts.push(patch.locked ? 'قفل عام' : 'فتح عام');
  if (patch.modCaps) parts.push('صلاحيات المشرفين');
  if (patch.note !== undefined) parts.push('ملاحظة');
  return parts.join(' · ');
}
