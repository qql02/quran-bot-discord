import mongoose from 'mongoose';

// In-memory cache to avoid a DB query on every interaction
const langCache = new Map(); // guildId -> { lang, expiresAt }
const LANG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const guildSettingsSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  language: {
    type: String,
    enum: ['ar', 'en'],
    default: 'en'
  },
  // Daily morning/evening adhkar auto-post (managed by /adhkar, sent by services/adhkarService.js).
  // lastMorning / lastEvening hold the guild-local date (YYYY-MM-DD) of the last post — the scheduler claims
  // a slot atomically by setting it, so a restart or overlapping tick can never post twice.
  adhkar: {
    enabled:     { type: Boolean, default: false },
    channelId:   { type: String,  default: null },
    timezone:    { type: String,  default: 'Asia/Riyadh' },
    morningTime: { type: String,  default: '06:00' },
    eveningTime: { type: String,  default: '17:00' },
    lastMorning: { type: String,  default: null },
    lastEvening: { type: String,  default: null },
    // Customisation (set from the /adhkar panel)
    roleId:      { type: String,  default: null },          // role pinged with each post (null = no ping)
    style:       { type: String,  enum: ['full', 'compact'], default: 'full' },
    deleteOld:   { type: Boolean, default: false },         // remove the previous post of the same slot after a new one is sent
    // Morning/evening posts delete THEMSELVES this many hours after they were sent (0 = never). A guild that never chose reads as 2 (see
    // utils/adhkarExpiry.js — lean() documents have no schema defaults). pendingDelete is the persistent to-do list (survives restarts).
    deleteAfterHours: { type: Number, default: 2, min: 0, max: 24 },
    pendingDelete: {
      type: [new mongoose.Schema({
        channelId: { type: String, required: true },
        ids:       { type: [String], default: [] },
        deleteAt:  { type: Date, required: true },
        tries:     { type: Number, default: 0 }
      })],
      default: []
    },
    // Short dhikr/du'a posts all day long, one every minGap–maxGap minutes (random each time) between from and to,
    // on top of morning/evening. Off unless an admin turns it on (or first-time /adhkar enable). day = guild-local
    // date the `sent` indexes belong to — the scheduler claims index k atomically, so a restart or overlapping tick can
    // never post the same one twice. recent = last titles (so they are not repeated right away).
    scatter: {
      enabled: { type: Boolean, default: false },
      from:    { type: String,  default: '07:00' },
      to:      { type: String,  default: '22:00' },
      minGap:  { type: Number,  default: 60 },
      maxGap:  { type: Number,  default: 90 },
      day:     { type: String,  default: null },
      sent:    { type: [Number], default: [] },
      recent:  { type: [String], default: [] }
    },
    // Message ids of the last scheduled post per slot — only used when deleteOld is on.
    lastPosts: {
      morning: { channelId: { type: String, default: null }, ids: { type: [String], default: [] } },
      evening: { channelId: { type: String, default: null }, ids: { type: [String], default: [] } }
    }
  },
  // Verse of the day (managed from the /adhkar panel → "آية اليوم", sent by services/ayahService.js).
  // Posts to its OWN channel. timezone null = follow the adhkar timezone. lastDate = guild-local date of the last post.
  ayah: {
    enabled:   { type: Boolean, default: false },
    channelId: { type: String,  default: null },
    time:      { type: String,  default: '08:00' },
    timezone:  { type: String,  default: null },
    roleId:    { type: String,  default: null },
    lastDate:  { type: String,  default: null }
  },
  // Hadith of the day (the /setup panel → "حديث اليوم", sent by services/hadithService.js). Same shape as `ayah`, its own channel.
  hadith: {
    enabled:   { type: Boolean, default: false },
    channelId: { type: String,  default: null },
    time:      { type: String,  default: '13:00' },
    timezone:  { type: String,  default: null },
    roleId:    { type: String,  default: null },
    lastDate:  { type: String,  default: null }
  },
  // Daily wird room (managed by /wird setup): where the subscribe panel lives, where khatma announcements go,
  // and the fallback place for reminders when a member's DMs are closed.
  wird: {
    channelId:       { type: String,  default: null },
    panelMessageId:  { type: String,  default: null },
    announceKhatma:  { type: Boolean, default: true },
    lang:            { type: String,  enum: ['ar', 'en', null], default: null }   // language of the room panel (null = the server's language)
  },
  // The reciter this server picked in the player panel (so a restart does not forget it). One of the two: a short-list key or a searched name.
  panel: {
    reciterKey:  { type: String, default: null },
    reciterName: { type: String, default: null }
  },
  // What /setup created (category + rooms), so running it again reuses them instead of making copies.
  setup: {
    categoryId:     { type: String, default: null },
    channels:       { type: mongoose.Schema.Types.Mixed, default: {} },   // { start, listen, adhkar, ayah, wird } → channel id
    guideMessageId: { type: String, default: null },
    lockedAt:       { type: Date,   default: null }    // set once the rooms are read-only (also marks the one-time repair of older servers as done)
  },
  // Owner-set limits for this server (dashboard → server → restrictions). See utils/restrictionRules.js.
  restrictions: {
    locked:           { type: Boolean,  default: false },
    lockedUntil:      { type: Date,     default: null },     // null = until the owner unlocks it
    disabledCommands: { type: [String], default: [] },
    maxQueue:         { type: Number,   default: null },
    note:             { type: String,   default: '' }
  },
  // Generic key-value store used by the admin dashboard "Settings" panel.
  // Stored under guildId="_bot_" for bot-wide settings.
  settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// The scheduler queries this every minute.
guildSettingsSchema.index({ 'adhkar.enabled': 1 });
guildSettingsSchema.index({ 'ayah.enabled': 1 });
guildSettingsSchema.index({ 'hadith.enabled': 1 });

guildSettingsSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

guildSettingsSchema.pre('findOneAndUpdate', function (next) {
  // FIX Bug #11: pre('save') does NOT fire for findOneAndUpdate.
  // This hook ensures updatedAt is always stamped on upsert/update calls too.
  this.set({ updatedAt: new Date() });
  next();
});

guildSettingsSchema.statics.getOrCreate = async function (guildId) {
  let settings = await this.findOne({ guildId });
  if (!settings) {
    settings = await this.create({ guildId });
  }
  return settings;
};

guildSettingsSchema.statics.getLanguage = async function (guildId) {
  const now = Date.now();
  const cached = langCache.get(guildId);
  if (cached && now < cached.expiresAt) return cached.lang;

  const settings = await this.findOne({ guildId }).lean();
  const lang = settings?.language ?? 'en';
  langCache.set(guildId, { lang, expiresAt: now + LANG_CACHE_TTL });
  return lang;
};

guildSettingsSchema.statics.invalidateLangCache = function (guildId) {
  langCache.delete(guildId);
};

/** Drop expired language entries (called by services/memoryJanitor.js): one entry per server that ever asked, never freed before. */
export function pruneLangCache(now = Date.now()) {
  let n = 0;
  for (const [k, v] of langCache) if (now >= v.expiresAt) { langCache.delete(k); n++; }
  return n;
}

export const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);
