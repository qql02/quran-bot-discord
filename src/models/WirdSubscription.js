import mongoose from 'mongoose';

/**
 * One document per member: their free monthly wird subscription + reading progress.
 * Global per Discord user (progress follows them across servers); `guildId` is just where they subscribed last —
 * used for the fallback "ping in the wird room" when their DMs are closed.
 */
const wirdSchema = new mongoose.Schema({
  userId:        { type: String, required: true, unique: true },
  guildId:       { type: String, default: null },

  // ── Subscription (free, 30 days, renewable with one tap) ──────────────────
  active:        { type: Boolean, default: true },
  startedAt:     { type: Date,    default: Date.now },
  expiresAt:     { type: Date,    required: true },
  renewWarned:   { type: Boolean, default: false },   // the "expires soon" notice was sent for this cycle
  expiredNoticed:{ type: Boolean, default: false },   // the "expired" notice was sent for this cycle
  renewals:      { type: Number,  default: 0 },

  // ── Plan ──────────────────────────────────────────────────────────────────
  pagesPerDay:   { type: Number,  default: 2, min: 1, max: 100 },
  timezone:      { type: String,  default: 'Asia/Riyadh' },
  remindTime:    { type: String,  default: '20:00' },        // used in 'fixed' mode
  lang:          { type: String,  enum: ['ar', 'en'], default: 'ar' },   // language of the server they subscribed from (documents without it read as Arabic)
  remindMode:    { type: String,  enum: ['fixed', 'varied'], default: 'fixed' },   // 'varied' = morning / asr / evening in rotation (documents without the field stay fixed)

  // ── Personal adhkar in DMs (optional, same subscription): morning / evening at the member's own timezone ──
  adhkarMorning:     { type: Boolean, default: false },
  adhkarEvening:     { type: Boolean, default: false },
  lastAdhkarMorning: { type: String,  default: null },   // local date of the last morning set sent (atomic claim)
  lastAdhkarEvening: { type: String,  default: null },

  // ── Khatma goal (optional): finish within 30 / 60 / 90 days. pagesPerDay is derived from it. ──────────────
  goalDays:      { type: Number,  default: null },
  goalDeadline:  { type: String,  default: null },     // last local date (YYYY-MM-DD) to finish the khatma, inclusive

  // ── Progress ──────────────────────────────────────────────────────────────
  currentPage:   { type: Number,  default: 0 },        // last page finished in the current khatma (0 = not started)
  khatmaCount:   { type: Number,  default: 0 },
  totalPagesRead:{ type: Number,  default: 0 },
  streak:        { type: Number,  default: 0 },
  bestStreak:    { type: Number,  default: 0 },
  lastReadDate:  { type: String,  default: null },     // local date of the last COMPLETED day
  dayDate:       { type: String,  default: null },     // local date that dayPages refers to
  dayPages:      { type: Number,  default: 0 },
  khatmaStartedAt:{ type: Date,   default: Date.now },

  // ── Delivery bookkeeping ──────────────────────────────────────────────────
  lastRemindedDate: { type: String, default: null },   // local date of the last reminder (atomic claim)
  failCount:     { type: Number,  default: 0 },        // consecutive undeliverable reminders → auto-pause at 5
  createdAt:     { type: Date,    default: Date.now },
  updatedAt:     { type: Date,    default: Date.now }
});

wirdSchema.index({ active: 1, expiresAt: 1 });
wirdSchema.index({ guildId: 1 });

wirdSchema.pre('findOneAndUpdate', function (next) { this.set({ updatedAt: new Date() }); next(); });
wirdSchema.pre('updateOne',        function (next) { this.set({ updatedAt: new Date() }); next(); });

export const WirdSubscription = mongoose.model('WirdSubscription', wirdSchema);
